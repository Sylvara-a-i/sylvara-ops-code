"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { SignatureError, verifyBillingSignature, verifySharedHeader } = require("../lib/signature");

const currentKey = "<synthetic-current-signing-value>";
const previousKey = "<synthetic-previous-signing-value>";
const body = Buffer.from('{"event_id":"event_sample_001","event_type":"subscription_created"}', "utf8");

function digest(key, encoding) {
  return crypto.createHmac("sha256", key).update(body).digest(encoding);
}

test("verifies exact raw bytes with hex or Base64 fixtures", () => {
  assert.equal(verifyBillingSignature(body, digest(currentKey, "hex"), [currentKey], "hex"), true);
  assert.equal(verifyBillingSignature(body, digest(currentKey, "base64"), [currentKey], "base64"), true);
});

test("supports a previous key without short-circuiting invalid input", () => {
  assert.equal(
    verifyBillingSignature(body, digest(previousKey, "hex"), [currentKey, previousKey], "hex"),
    true,
  );
  assert.throws(
    () => verifyBillingSignature(Buffer.from(`${body.toString("utf8")} `), digest(currentKey, "hex"), [currentKey], "hex"),
    SignatureError,
  );
});

test("rejects malformed encodings and mismatched shared headers", () => {
  assert.throws(() => verifyBillingSignature(body, "not-a-digest", [currentKey], "hex"), SignatureError);
  assert.throws(() => verifySharedHeader("wrong", "<synthetic-shared-header-value>"), SignatureError);
  assert.doesNotThrow(() => verifySharedHeader("<synthetic-shared-header-value>", "<synthetic-shared-header-value>"));
});
