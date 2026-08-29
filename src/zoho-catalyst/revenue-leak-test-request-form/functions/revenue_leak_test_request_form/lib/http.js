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
  const headers = request?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return undefined;
  const matches = Object.entries(headers).filter(
    ([candidate]) => typeof candidate === "string" && candidate.toLowerCase() === name.toLowerCase(),
  );
  if (matches.length !== 1 || typeof matches[0][1] !== "string") return undefined;
  return matches[0][1];
}

function parseRequestPath(request) {
  let url;
  try {
    url = new URL(String(request?.url ?? request?.originalUrl ?? ""), "https://controller.invalid");
  } catch {
    throw new HttpBoundaryError("Route is invalid", { status: 404, publicCode: "route_not_found" });
  }
  if (url.search || url.hash) {
    throw new HttpBoundaryError("Query strings are prohibited", {
      status: 404,
      publicCode: "route_not_found",
    });
  }
  return url.pathname;
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
  const contentEncoding = String(getHeader(request, "content-encoding") ?? "identity").toLowerCase();
  if (contentEncoding !== "identity") {
    throw new HttpBoundaryError("Compressed request bodies are prohibited", {
      status: 415,
      publicCode: "content_encoding_not_allowed",
    });
  }
  return path;
}

module.exports = {
  HttpBoundaryError,
  getHeader,
  parseRequestPath,
  validateJsonPost,
};
