"use strict";

class HttpBoundaryError extends Error {
  constructor(message, { ambiguous = false, publicCode = "dependency_failed", status = 503 } = {}) {
    super(message);
    this.name = "HttpBoundaryError";
    this.ambiguous = ambiguous;
    this.publicCode = publicCode;
    this.status = status;
  }
}

async function requestJson(url, options, boundary, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const expiresAt = performance.now() + boundary.timeoutMs;
  let reader, completed = false, cancelled = false, rejectDeadline;
  const failed = message => new HttpBoundaryError(message, {
    ambiguous: boundary.sideEffecting,
    publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
  });
  // Abort the actual fetch/body and bound our wait even if a dependency ignores
  // cancellation. An interrupted write remains unknown; this helper never retries.
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch (_) {}
  };
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    cancel();
    rejectDeadline(failed("Dependency request did not complete"));
  }, boundary.timeoutMs);
  const active = () => {
    if (controller.signal.aborted || performance.now() >= expiresAt) {
      cancel();
      throw failed("Dependency request did not complete");
    }
  };
  async function run() {
    active();
    const response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
    if (controller.signal.aborted || performance.now() >= expiresAt) {
      try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch (_) {}
    }
    active();
    const declared = String(response.headers?.get?.("content-length") ?? "");
    if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > boundary.maximumBytes)) {
      try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch (_) {}
      throw failed("Dependency response is too large");
    }
    const chunks = [];
    let bytes = 0;
    if (response.body !== null) {
      if (typeof response.body?.getReader !== "function") {
        throw failed("Dependency response is unavailable");
      }
      reader = response.body.getReader();
      while (true) {
        active();
        const part = await reader.read();
        active();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)
          || part.value.byteLength > boundary.maximumBytes - bytes) {
          throw failed("Dependency response is too large");
        }
        if (part.value.byteLength) {
          bytes += part.value.byteLength;
          chunks.push(Buffer.from(part.value));
        }
      }
    }
    const raw = Buffer.concat(chunks, bytes);
    let json = null;
    if (raw.length) {
      try {
        json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
      } catch {
        throw failed("Dependency response is not valid JSON");
      }
    }
    active();
    completed = true;
    return Object.freeze({ status: response.status, json });
  }
  try {
    return await Promise.race([run(), deadline]);
  } catch (error) {
    if (error instanceof HttpBoundaryError) throw error;
    throw failed("Dependency request did not complete");
  } finally {
    clearTimeout(timer);
    if (!completed) cancel();
    try { reader?.releaseLock(); } catch (_) {}
  }
}

module.exports = { HttpBoundaryError, requestJson };
