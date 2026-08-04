"use strict";

const { readRawBody } = require("./http");
const { normalizeEvent } = require("./normalize-event");
const { verifyBillingSignature, verifySharedHeader } = require("./signature");

class RequestValidationError extends Error {
  constructor(message, status, publicCode) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function getHeader(request, name) {
  if (typeof request.get === "function") {
    const selected = request.get(name);
    if (selected !== undefined) return selected;
  }
  const headers = request.headers ?? {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const selected = key ? headers[key] : undefined;
  if (Array.isArray(selected)) return selected.length === 1 ? selected[0] : undefined;
  return selected;
}

function validateRequestBoundary(request, config) {
  if (String(request.method ?? "").toUpperCase() !== "POST") {
    throw new RequestValidationError("Method is not approved", 405, "method_not_allowed");
  }
  let parsed;
  try {
    parsed = new URL(String(request.url ?? request.originalUrl ?? ""), "https://gateway.invalid");
  } catch {
    throw new RequestValidationError("Route is invalid", 404, "route_not_found");
  }
  if (parsed.pathname !== config.allowedPath || parsed.search || parsed.hash) {
    throw new RequestValidationError("Route is not approved", 404, "route_not_found");
  }
  const contentType = String(getHeader(request, "content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== config.contentType) {
    throw new RequestValidationError("Content type is not approved", 415, "content_type_not_allowed");
  }
  const contentLength = String(getHeader(request, "content-length") ?? "").trim();
  if (contentLength) {
    if (!/^[0-9]+$/.test(contentLength)) {
      throw new RequestValidationError("Content length is invalid", 400, "content_length_invalid");
    }
    if (Number(contentLength) > config.maxBodyBytes) {
      throw new RequestValidationError("Body is too large", 413, "body_too_large");
    }
  }
}

function parseJson(rawBody) {
  if (!rawBody.length) {
    throw new RequestValidationError("Body is required", 400, "body_required");
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw new RequestValidationError("Body encoding is invalid", 400, "body_encoding_invalid");
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new RequestValidationError("Body is not valid JSON", 400, "body_invalid");
  }
}

async function handleBillingWebhook(request, dependencies) {
  const { config, store, creatorClient, nowMs = Date.now() } = dependencies;
  validateRequestBoundary(request, config);

  const rawBody = await readRawBody(request, {
    maximumBytes: config.maxBodyBytes,
    timeoutMs: config.inboundBodyTimeoutMs,
  });
  if (config.requireSharedHeader) {
    verifySharedHeader(getHeader(request, config.sharedHeaderName), config.sharedHeaderValue);
  }
  verifyBillingSignature(
    rawBody,
    getHeader(request, "x-zoho-webhook-signature"),
    config.webhookSecrets,
    config.signatureEncoding,
  );

  const normalized = normalizeEvent(parseJson(rawBody), config, { rawBody, nowMs });
  const claim = await store.claim({
    eventKey: normalized.eventKey,
    eventFingerprint: normalized.eventFingerprint,
    eventType: normalized.eventType,
    sourceEventId: normalized.sourceEventId,
  });
  if (claim.outcome === "duplicate-completed") {
    return {
      status: 200,
      stage: "idempotency",
      outcome: "duplicate_completed",
      body: { ok: true, accepted: true, duplicate: true },
    };
  }
  if (claim.outcome !== "claimed") {
    return {
      status: 503,
      stage: "idempotency",
      outcome: "reconciliation_required",
      body: { ok: false, code: "reconciliation_required" },
    };
  }

  if (config.deliveryMode === "register-only") {
    await store.mark(claim.rowId, "completed", "registered_only");
    return {
      status: 200,
      stage: "registration",
      outcome: "completed",
      body: { ok: true, accepted: true, duplicate: false },
    };
  }

  if (!creatorClient) {
    await store.mark(claim.rowId, "reconciliation_required", "creator_client_unavailable");
    return {
      status: 503,
      stage: "delivery",
      outcome: "configuration_invalid",
      body: { ok: false, code: "configuration_invalid" },
    };
  }
  try {
    await creatorClient.deliver(normalized.downstreamEnvelope);
  } catch {
    await store.mark(claim.rowId, "reconciliation_required", "downstream_outcome_unknown");
    return {
      status: 503,
      stage: "delivery",
      outcome: "reconciliation_required",
      body: { ok: false, code: "reconciliation_required" },
    };
  }

  try {
    await store.mark(claim.rowId, "completed", "creator_readback_confirmed");
  } catch {
    return {
      status: 503,
      stage: "readback",
      outcome: "reconciliation_required",
      body: { ok: false, code: "reconciliation_required" },
    };
  }
  return {
    status: 200,
    stage: "delivery",
    outcome: "completed",
    body: { ok: true, accepted: true, duplicate: false },
  };
}

module.exports = {
  RequestValidationError,
  getHeader,
  handleBillingWebhook,
  validateRequestBoundary,
};
