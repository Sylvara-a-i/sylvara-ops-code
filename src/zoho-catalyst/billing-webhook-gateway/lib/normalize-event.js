"use strict";

const crypto = require("node:crypto");
const { parseStrictIsoTimestamp } = require("./iso-timestamp");

class EventValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EventValidationError";
    this.publicCode = "event_invalid";
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(root, path) {
  let current = root;
  for (const segment of path.split(".")) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizeScalar(value, path) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && Buffer.byteLength(value, "utf8") <= 512) return value;
  throw new EventValidationError(`Allowlisted field ${path} is not a bounded scalar`);
}

function validateEventTime(raw, config, nowMs) {
  const eventTimeMs = parseStrictIsoTimestamp(raw);
  if (eventTimeMs === null) {
    throw new EventValidationError("event_time is missing or invalid");
  }
  if (eventTimeMs > nowMs + (config.maxFutureSkewSeconds * 1000)) {
    throw new EventValidationError("event_time is too far in the future");
  }
  if (eventTimeMs < nowMs - (config.maxEventAgeSeconds * 1000)) {
    throw new EventValidationError("event_time is outside the accepted replay window");
  }
  return raw;
}

function normalizeEvent(payload, config, { rawBody, nowMs = Date.now() } = {}) {
  if (!isPlainObject(payload)) throw new EventValidationError("Event must be an object");
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    throw new EventValidationError("Signed raw event bytes are required");
  }
  const eventId = payload.event_id;
  const eventType = payload.event_type;
  if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(eventId)) {
    throw new EventValidationError("event_id is missing or invalid");
  }
  if (typeof eventType !== "string" || !config.allowedEventTypes.includes(eventType)) {
    throw new EventValidationError("event_type is not allowlisted");
  }
  const eventTime = validateEventTime(payload.event_time, config, nowMs);

  const eventKey = crypto
    .createHash("sha256")
    .update(`${config.deploymentEnvironment}\0${config.billingSourceKey}\0${eventId}`, "utf8")
    .digest("hex");
  const fields = Object.create(null);
  for (const path of config.creatorFieldAllowlist ?? []) {
    const selected = readPath(payload, path);
    if (selected !== undefined) fields[path] = normalizeScalar(selected, path);
  }
  const semanticEnvelope = JSON.stringify([
    eventId,
    eventType,
    eventTime,
    Object.keys(fields).sort().map((path) => [path, fields[path]]),
  ]);
  // A keyed semantic fingerprint ignores transport formatting while detecting
  // conflicting reuse of every value this gateway can act on or forward.
  const eventFingerprint = crypto
    .createHmac("sha256", config.eventFingerprintSecret)
    .update(semanticEnvelope, "utf8")
    .digest("hex");

  return {
    eventKey,
    eventFingerprint,
    eventType,
    sourceEventId: eventId,
    downstreamEnvelope: {
      schema_version: 1,
      event_key: eventKey,
      billing_event_id: eventId,
      billing_event_time: eventTime,
      event_type: eventType,
      fields,
    },
  };
}

module.exports = { EventValidationError, normalizeEvent };
