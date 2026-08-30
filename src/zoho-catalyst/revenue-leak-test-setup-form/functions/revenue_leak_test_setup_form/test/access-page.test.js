"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { renderAccessPage } = require("../lib/access-page");

test("renders a self-contained no-store access page with a nonce-only CSP", () => {
  const result = renderAccessPage({
    otpRequestPath: "/form2/otp/request",
    otpVerifyPath: "/form2/otp/verify",
    randomBytes: () => Buffer.alloc(18, 0x01),
  });
  assert.match(result.html, /^<!doctype html>/);
  assert.equal(result.html.includes("/form2/otp/request"), true);
  assert.equal(result.html.includes("/form2/otp/verify"), true);
  assert.equal(result.html.includes("location.hash.slice(1)"), true);
  assert.equal(result.html.includes("history.replaceState"), true);
  assert.equal(result.html.includes('typeof body.formUrl === "string"'), true);
  assert.equal(result.html.includes("Check your email"), false);
  assert.equal(result.html.includes('response.ok && body.state === "sent_confirmed"'), true);
  assert.equal(result.html.includes('body.state === "in_flight"'), true);
  assert.equal(result.html.includes('body.state === "retryable_failure"'), true);
  assert.equal(result.html.includes('body.state === "delivery_disabled"'), true);
  assert.equal(result.html.includes("Send another code"), true);
  assert.equal(result.html.includes("background:#00A6C1"), true);
  assert.equal(result.html.includes("#173f35"), false);
  assert.equal(result.html.includes("#49645d"), false);
  assert.equal(result.html.includes("localStorage"), false);
  assert.equal(result.html.includes("sessionStorage"), false);
  assert.equal(result.headers["Cache-Control"], "no-store, max-age=0");
  assert.match(result.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(result.headers["Content-Security-Policy"], /connect-src 'self'/);
  assert.match(result.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(result.headers["Referrer-Policy"], "no-referrer");
});

test("rejects unsafe routes and an invalid nonce source", () => {
  assert.throws(() => renderAccessPage({
    otpRequestPath: "https://evil.invalid/request",
    otpVerifyPath: "/form2/otp/verify",
  }));
  assert.throws(() => renderAccessPage({
    otpRequestPath: "/form2/otp/request",
    otpVerifyPath: "/form2/otp/verify",
    randomBytes: () => Buffer.alloc(17),
  }));
});
