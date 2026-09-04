"use strict";

const crypto = require("node:crypto");
const { FixtureConfigurationError, loadConfig } = require("./config");
const { FORM1_PREFILL_MAPPING_SAMPLE } = require("./sample");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const BODY_LIMIT_BYTES = 512;
const BODY_TIMEOUT_MS = 2000;
const PROJECT_ID_PATTERN = /^[1-9][0-9]{0,29}$/;
const PROBE_VALUE = "ZZZ_SYNTHETIC_MAPPING_ONLY";
const PUBLIC_CODES = new Set([
  "authentication_failed",
  "body_invalid",
  "body_required",
  "body_timeout",
  "body_too_large",
  "body_unavailable",
  "configuration_invalid",
  "content_encoding_not_allowed",
  "content_length_invalid",
  "content_type_not_allowed",
  "fixture_expired",
  "method_not_allowed",
  "request_invalid",
  "route_not_found",
  "service_unavailable"
]);

class FixtureRequestError extends Error {
  constructor(message, { status = 400, publicCode = "request_invalid" } = {}) {
    super(message);
    this.name = "FixtureRequestError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function headerValues(request, expectedName) {
  const normalized = expectedName.toLowerCase();
  const distinct = Object.entries(request?.headersDistinct ?? {})
    .filter(([name]) => name.toLowerCase() === normalized);
  if (distinct.length > 0) {
    return distinct.length === 1 && Array.isArray(distinct[0][1]) ? distinct[0][1] : [];
  }
  if (Array.isArray(request?.rawHeaders)) {
    if (request.rawHeaders.length % 2 !== 0) return [];
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (typeof request.rawHeaders[index] === "string" &&
          request.rawHeaders[index].toLowerCase() === normalized) {
        values.push(request.rawHeaders[index + 1]);
      }
    }
    if (values.length > 0) return values;
  }
  return Object.entries(request?.headers ?? {})
    .filter(([name]) => typeof name === "string" && name.toLowerCase() === normalized)
    .map(([, value]) => value);
}

function singleHeader(request, name) {
  const values = headerValues(request, name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftDigest = crypto.createHash("sha256").update(left, "utf8").digest();
  const rightDigest = crypto.createHash("sha256").update(right, "utf8").digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function assertRuntimeBinding(request, config) {
  if (singleHeader(request, "x-zc-environment")?.trim().toLowerCase() !== "development") {
    throw new FixtureConfigurationError("Catalyst Development identity is unavailable");
  }
  const projectId = singleHeader(request, "x-zc-projectid");
  if (!PROJECT_ID_PATTERN.test(projectId ?? "")) {
    throw new FixtureConfigurationError("Catalyst project identity is unavailable");
  }
  const actual = crypto.createHash("sha256").update(projectId, "utf8").digest("hex");
  if (!constantTimeEqual(actual, config.expectedProjectHash)) {
    throw new FixtureConfigurationError("Catalyst project identity does not match configuration");
  }
}

function parsePath(request) {
  let url;
  try {
    url = new URL(String(request?.url ?? request?.originalUrl ?? ""), "https://fixture.invalid");
  } catch {
    throw new FixtureRequestError("Route is invalid", {
      status: 404,
      publicCode: "route_not_found"
    });
  }
  if (url.search || url.hash) {
    throw new FixtureRequestError("Query strings and fragments are prohibited", {
      status: 404,
      publicCode: "route_not_found"
    });
  }
  return url.pathname;
}

function authenticate(request, config) {
  if (String(request?.method ?? "").toUpperCase() !== "POST") {
    throw new FixtureRequestError("Method is not approved", {
      status: 405,
      publicCode: "method_not_allowed"
    });
  }
  if (parsePath(request) !== config.fixturePath) {
    throw new FixtureRequestError("Route is not approved", {
      status: 404,
      publicCode: "route_not_found"
    });
  }
  const contentType = String(singleHeader(request, "content-type") ?? "")
    .split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new FixtureRequestError("Content type is not approved", {
      status: 415,
      publicCode: "content_type_not_allowed"
    });
  }
  const encodingValues = headerValues(request, "content-encoding");
  if (encodingValues.length > 1) {
    throw new FixtureRequestError("Content encoding is ambiguous", {
      status: 415,
      publicCode: "content_encoding_not_allowed"
    });
  }
  const encoding = String(encodingValues[0] ?? "identity").toLowerCase();
  if (encoding !== "identity") {
    throw new FixtureRequestError("Compressed bodies are prohibited", {
      status: 415,
      publicCode: "content_encoding_not_allowed"
    });
  }
  if (!constantTimeEqual(singleHeader(request, config.fixtureHeaderName),
    config.fixtureHeaderSecret)) {
    throw new FixtureRequestError("Fixture authentication failed", {
      status: 401,
      publicCode: "authentication_failed"
    });
  }
}

async function readRawBody(request) {
  if (Buffer.isBuffer(request?.rawBody)) {
    if (request.rawBody.length > BODY_LIMIT_BYTES) {
      throw new FixtureRequestError("Body is too large", {
        status: 413,
        publicCode: "body_too_large"
      });
    }
    return request.rawBody;
  }
  if (!request || typeof request.on !== "function") {
    throw new FixtureRequestError("Body stream is unavailable", {
      publicCode: "body_unavailable"
    });
  }
  const declaredValues = headerValues(request, "content-length");
  if (declaredValues.length > 1) {
    throw new FixtureRequestError("Content length is ambiguous", {
      publicCode: "content_length_invalid"
    });
  }
  const declared = String(declaredValues[0] ?? "").trim();
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > BODY_LIMIT_BYTES)) {
    throw new FixtureRequestError("Content length is invalid", {
      status: Number(declared) > BODY_LIMIT_BYTES ? 413 : 400,
      publicCode: Number(declared) > BODY_LIMIT_BYTES
        ? "body_too_large"
        : "content_length_invalid"
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
      const selected = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += selected.length;
      if (total > BODY_LIMIT_BYTES) {
        finish(reject, new FixtureRequestError("Body is too large", {
          status: 413,
          publicCode: "body_too_large"
        }));
        if (typeof request.resume === "function") request.resume();
        return;
      }
      chunks.push(selected);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks, total));
    const onError = () => finish(reject, new FixtureRequestError("Body stream failed", {
      publicCode: "body_unavailable"
    }));
    const onAborted = () => finish(reject, new FixtureRequestError("Body stream aborted", {
      publicCode: "body_unavailable"
    }));
    const timer = setTimeout(() => {
      finish(reject, new FixtureRequestError("Body stream timed out", {
        status: 408,
        publicCode: "body_timeout"
      }));
      if (typeof request.resume === "function") request.resume();
    }, BODY_TIMEOUT_MS);
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

function validateProbe(rawBody) {
  if (!rawBody.length) {
    throw new FixtureRequestError("Body is required", { publicCode: "body_required" });
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    throw new FixtureRequestError("Body is invalid JSON", { publicCode: "body_invalid" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Reflect.ownKeys(body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(body, "prefillHandle") ||
      body.prefillHandle !== PROBE_VALUE) {
    throw new FixtureRequestError("Body does not match the synthetic probe", {
      status: 422,
      publicCode: "request_invalid"
    });
  }
}

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  if (typeof response.status === "function") response.status(status);
  else response.statusCode = status;
  if (typeof response.setHeader === "function") {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store, max-age=0");
    response.setHeader("pragma", "no-cache");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
  }
  if (typeof response.send === "function") response.send(serialized);
  else if (typeof response.end === "function") response.end(serialized);
  else throw new Error("Catalyst response adapter is unavailable");
}

function normalizeError(error) {
  if (error instanceof FixtureConfigurationError || error instanceof FixtureRequestError) {
    return error;
  }
  return new FixtureRequestError("Fixture failed closed", {
    status: 500,
    publicCode: "service_unavailable"
  });
}

function createRequestListener({
  environment = process.env,
  now = Date.now,
  artifactSourceRevision = ARTIFACT_SOURCE_REVISION
} = {}) {
  return async function requestListener(request, response) {
    try {
      const nowMs = now();
      const config = loadConfig(environment, artifactSourceRevision, nowMs);
      if (!config.active) {
        sendJson(response, 503, { ok: false, code: "service_unavailable" });
        return;
      }
      assertRuntimeBinding(request, config);
      authenticate(request, config);
      if (nowMs >= config.expiresAtMs) {
        throw new FixtureRequestError("Fixture has expired", {
          status: 410,
          publicCode: "fixture_expired"
        });
      }
      const rawBody = await readRawBody(request);
      validateProbe(rawBody);
      sendJson(response, 200, FORM1_PREFILL_MAPPING_SAMPLE);
    } catch (rawError) {
      const error = normalizeError(rawError);
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
      const code = PUBLIC_CODES.has(error.publicCode) ? error.publicCode : "service_unavailable";
      sendJson(response, status, { ok: false, code });
    }
  };
}

module.exports = {
  BODY_LIMIT_BYTES,
  BODY_TIMEOUT_MS,
  FixtureRequestError,
  PROBE_VALUE,
  assertRuntimeBinding,
  authenticate,
  createRequestListener,
  readRawBody,
  validateProbe
};
