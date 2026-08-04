"use strict";

class HttpBoundaryError extends Error {
  constructor(message, { publicCode = "dependency_failed", ambiguous = false } = {}) {
    super(message);
    this.name = "HttpBoundaryError";
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function boundedBuffer(chunks, total, maximum) {
  if (total > maximum) {
    throw new HttpBoundaryError("Body exceeds configured limit", {
      publicCode: "body_too_large",
    });
  }
  return Buffer.concat(chunks, total);
}

async function readRawBody(request, { maximumBytes, timeoutMs }) {
  if (Buffer.isBuffer(request.rawBody)) {
    return boundedBuffer([request.rawBody], request.rawBody.length, maximumBytes);
  }
  if (typeof request.rawBody === "string") {
    const raw = Buffer.from(request.rawBody, "utf8");
    return boundedBuffer([raw], raw.length, maximumBytes);
  }
  if (!request || typeof request.on !== "function") {
    throw new HttpBoundaryError("Raw request stream is unavailable", {
      publicCode: "body_unavailable",
    });
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
      callback(value);
    };
    const drain = () => {
      // Preserve the response channel while discarding the remainder of a rejected body.
      if (typeof request.resume === "function") request.resume();
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maximumBytes) {
        finish(reject, new HttpBoundaryError("Body exceeds configured limit", {
          publicCode: "body_too_large",
        }));
        drain();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks, total));
    const onError = () => finish(reject, new HttpBoundaryError("Request stream failed", {
      publicCode: "body_unavailable",
    }));
    const onAborted = () => finish(reject, new HttpBoundaryError("Request was aborted", {
      publicCode: "body_unavailable",
    }));
    const timer = setTimeout(() => {
      finish(reject, new HttpBoundaryError("Request body timed out", {
        publicCode: "body_timeout",
      }));
      drain();
    }, timeoutMs);

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

async function readResponseBody(response, maximumBytes) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpBoundaryError("Outbound body exceeds configured limit");
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) {
      if (typeof response.body.cancel === "function") await response.body.cancel();
      throw new HttpBoundaryError("Outbound body exceeds configured limit");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

async function requestJson(url, options, boundary, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new HttpBoundaryError("Fetch implementation is unavailable", {
      ambiguous: Boolean(boundary.sideEffecting),
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundary.timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new HttpBoundaryError("Outbound request failed", {
      ambiguous: Boolean(boundary.sideEffecting),
    });
  }

  let body;
  try {
    body = await readResponseBody(response, boundary.maximumBytes);
  } catch (error) {
    if (error instanceof HttpBoundaryError && boundary.sideEffecting) {
      error.ambiguous = true;
      throw error;
    }
    if (error instanceof HttpBoundaryError) throw error;
    throw new HttpBoundaryError("Outbound response stream failed", {
      ambiguous: Boolean(boundary.sideEffecting),
    });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  if (body.length) {
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw new HttpBoundaryError("Outbound response is not valid bounded JSON", {
        ambiguous: Boolean(boundary.sideEffecting),
      });
    }
  }
  return { status: response.status, json };
}

module.exports = { HttpBoundaryError, readRawBody, requestJson };
