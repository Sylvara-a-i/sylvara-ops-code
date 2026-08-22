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
  const timer = setTimeout(() => controller.abort(), boundary.timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new HttpBoundaryError("Dependency request did not return", {
      ambiguous: boundary.sideEffecting,
      publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
    });
  } finally {
    clearTimeout(timer);
  }
  const declared = String(response.headers?.get?.("content-length") ?? "");
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > boundary.maximumBytes)) {
    throw new HttpBoundaryError("Dependency response is too large", {
      ambiguous: boundary.sideEffecting,
      publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
    });
  }
  let raw;
  try {
    raw = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new HttpBoundaryError("Dependency response is unavailable", {
      ambiguous: boundary.sideEffecting,
      publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
    });
  }
  if (raw.length > boundary.maximumBytes) {
    throw new HttpBoundaryError("Dependency response is too large", {
      ambiguous: boundary.sideEffecting,
      publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
    });
  }
  let json = null;
  if (raw.length) {
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch {
      throw new HttpBoundaryError("Dependency response is not valid JSON", {
        ambiguous: boundary.sideEffecting,
        publicCode: boundary.sideEffecting ? "reconciliation_required" : "dependency_failed",
      });
    }
  }
  return Object.freeze({ status: response.status, json });
}

module.exports = { HttpBoundaryError, requestJson };
