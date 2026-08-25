"use strict";

class HttpBoundaryError extends Error {
  constructor(message, { status = 400, publicCode = "request_invalid", ambiguous = false } = {}) {
    super(message);
    this.name = "HttpBoundaryError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function getHeader(request, name) {
  if (typeof request?.get === "function") {
    const selected = request.get(name);
    if (selected !== undefined) return selected;
  }
  const headers = request?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const matches = Object.entries(headers)
    .filter(([candidate]) => candidate.toLowerCase() === name.toLowerCase());
  if (matches.length !== 1 || Array.isArray(matches[0][1])) return undefined;
  return matches[0][1];
}

function parseRequestPath(request) {
  let parsed;
  try {
    parsed = new URL(String(request?.url ?? request?.originalUrl ?? ""), "https://controller.invalid");
  } catch {
    throw new HttpBoundaryError("Route is invalid", { status: 404, publicCode: "route_not_found" });
  }
  if (parsed.search || parsed.hash) {
    throw new HttpBoundaryError("Query strings are prohibited", {
      status: 404,
      publicCode: "route_not_found",
    });
  }
  return parsed.pathname;
}

function validateJsonPost(request, allowedPaths) {
  if (String(request?.method ?? "").toUpperCase() !== "POST") {
    throw new HttpBoundaryError("Method is not approved", {
      status: 405,
      publicCode: "method_not_allowed",
    });
  }
  const path = parseRequestPath(request);
  if (!allowedPaths.has(path)) {
    throw new HttpBoundaryError("Route is not approved", {
      status: 404,
      publicCode: "route_not_found",
    });
  }
  const contentType = String(getHeader(request, "content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpBoundaryError("Content type is not approved", {
      status: 415,
      publicCode: "content_type_not_allowed",
    });
  }
  return path;
}

async function readRawBody(request, { maximumBytes, timeoutMs }) {
  if (Buffer.isBuffer(request?.rawBody)) {
    if (request.rawBody.length > maximumBytes) {
      throw new HttpBoundaryError("Body exceeds configured limit", {
        status: 413,
        publicCode: "body_too_large",
      });
    }
    return request.rawBody;
  }
  if (!request || typeof request.on !== "function") {
    throw new HttpBoundaryError("Raw request stream is unavailable", {
      publicCode: "body_unavailable",
    });
  }
  const declared = String(getHeader(request, "content-length") ?? "").trim();
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpBoundaryError("Content length is invalid", {
      status: Number(declared) > maximumBytes ? 413 : 400,
      publicCode: Number(declared) > maximumBytes ? "body_too_large" : "content_length_invalid",
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
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maximumBytes) {
        finish(reject, new HttpBoundaryError("Body exceeds configured limit", {
          status: 413,
          publicCode: "body_too_large",
        }));
        if (typeof request.resume === "function") request.resume();
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
        status: 408,
        publicCode: "body_timeout",
      }));
      if (typeof request.resume === "function") request.resume();
    }, timeoutMs);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function parseJsonObject(rawBody) {
  if (!rawBody.length) {
    throw new HttpBoundaryError("Body is required", { publicCode: "body_required" });
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    throw new HttpBoundaryError("Body is not valid UTF-8 JSON", { publicCode: "body_invalid" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpBoundaryError("Body must be a JSON object", { publicCode: "body_invalid" });
  }
  return value;
}

async function readResponseJson(response, maximumBytes, { ambiguous = false } = {}) {
  const declared = response.headers?.get?.("content-length");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpBoundaryError("Outbound response exceeded its bound", {
      status: 503,
      publicCode: "dependency_failed",
      ambiguous,
    });
  }
  if (!response.body) return null;
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maximumBytes) {
      if (typeof response.body.cancel === "function") await response.body.cancel();
      throw new HttpBoundaryError("Outbound response exceeded its bound", {
        status: 503,
        publicCode: "dependency_failed",
        ambiguous,
      });
    }
    chunks.push(buffer);
  }
  if (!total) return null;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)));
  } catch {
    throw new HttpBoundaryError("Outbound response was not valid bounded JSON", {
      status: 503,
      publicCode: "dependency_failed",
      ambiguous,
    });
  }
}

async function requestJson(url, options, boundary, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new HttpBoundaryError("Fetch implementation is unavailable", {
      status: 503,
      publicCode: "dependency_failed",
      ambiguous: Boolean(boundary.sideEffecting),
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundary.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
    const json = await readResponseJson(response, boundary.maximumBytes, {
      ambiguous: Boolean(boundary.sideEffecting),
    });
    return { status: response.status, json, headers: response.headers };
  } catch (error) {
    if (error instanceof HttpBoundaryError) throw error;
    throw new HttpBoundaryError("Outbound request failed", {
      status: 503,
      publicCode: "dependency_failed",
      ambiguous: Boolean(boundary.sideEffecting),
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  HttpBoundaryError,
  getHeader,
  parseJsonObject,
  parseRequestPath,
  readRawBody,
  requestJson,
  validateJsonPost,
};
