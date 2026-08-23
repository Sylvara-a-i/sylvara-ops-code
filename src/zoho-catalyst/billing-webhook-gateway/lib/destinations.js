"use strict";

const crypto = require("node:crypto");

const CREATOR_CUSTOM_API_ORIGIN = "https://www.zohoapis.com";
const CREATOR_CUSTOM_API_PATH =
  /^\/creator\/custom\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_-]{1,100}$/;

class DestinationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DestinationValidationError";
  }
}

function normalizeCreatorCustomApiUrl(raw) {
  if (typeof raw !== "string") {
    throw new DestinationValidationError("Creator destination is not an absolute URL");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DestinationValidationError("Creator destination is not an absolute URL");
  }
  if (
    parsed.origin !== CREATOR_CUSTOM_API_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    raw !== parsed.href ||
    raw.includes("?") ||
    raw.includes("#") ||
    parsed.search ||
    parsed.hash ||
    !CREATOR_CUSTOM_API_PATH.test(parsed.pathname)
  ) {
    throw new DestinationValidationError(
      "Creator destination is outside the source-owned Custom API boundary",
    );
  }
  return parsed.href;
}

function destinationDigest(url) {
  return crypto.createHash("sha256").update(url, "utf8").digest("hex");
}

function assertCreatorDestination(raw, approvedDigest) {
  const normalized = normalizeCreatorCustomApiUrl(raw);
  if (!/^[a-f0-9]{64}$/.test(String(approvedDigest ?? ""))) {
    throw new DestinationValidationError("Creator destination artifact is not stamped");
  }
  const actual = Buffer.from(destinationDigest(normalized), "hex");
  const approved = Buffer.from(approvedDigest, "hex");
  if (actual.length !== approved.length || !crypto.timingSafeEqual(actual, approved)) {
    throw new DestinationValidationError("Creator destination does not match the artifact");
  }
  return normalized;
}

module.exports = {
  CREATOR_CUSTOM_API_ORIGIN,
  DestinationValidationError,
  assertCreatorDestination,
  destinationDigest,
  normalizeCreatorCustomApiUrl,
};
