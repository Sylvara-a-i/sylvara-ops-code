"use strict";

const crypto = require("node:crypto");

class SnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = "SnapshotError";
    this.status = 503;
    this.publicCode = "configuration_invalid";
  }
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new SnapshotError("Snapshot may not contain cycles");
    seen.add(value);
    const result = value.map((entry) => canonicalize(entry, seen));
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SnapshotError("Snapshot contains an unsupported value");
  }
  if (seen.has(value)) throw new SnapshotError("Snapshot may not contain cycles");
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) {
      throw new SnapshotError("Snapshot contains an unsafe key");
    }
    result[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function fingerprintSnapshot(snapshot, pepper) {
  if (
    typeof pepper !== "string" ||
    Buffer.byteLength(pepper, "utf8") < 32 ||
    Buffer.byteLength(pepper, "utf8") > 256
  ) {
    throw new SnapshotError("Snapshot pepper is invalid");
  }
  const canonical = JSON.stringify(canonicalize(snapshot));
  if (Buffer.byteLength(canonical, "utf8") > 32768) {
    throw new SnapshotError("Snapshot exceeds its approved bound");
  }
  return crypto
    .createHmac("sha256", pepper)
    .update("sylvara.form2.prefill-snapshot.v1", "utf8")
    .update(Buffer.from([0]))
    .update(canonical, "utf8")
    .digest("hex");
}

module.exports = { SnapshotError, fingerprintSnapshot };
