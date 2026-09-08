"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
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
  assert.equal(result.html.includes('typeof body.formUrl !== "string"'), true);
  assert.equal(result.html.includes("Check your email"), false);
  assert.equal(result.html.includes('acceptedRequest && body.state === "sent_confirmed"'), true);
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
  assert.match(result.html, /aria-live="polite" aria-atomic="true"/);
  assert.match(result.html, /aria-describedby="status"/);
  assert.match(result.html, /button:focus-visible,input:focus-visible/);
  assert.match(result.html, /button:not\(:disabled\):hover/);
  assert.match(result.html, /button:not\(:disabled\):active/);
  assert.match(result.html, /prefers-reduced-motion:reduce/);
  assert.match(result.html, /button\[aria-busy="true"\]::before/);
});

const TOKEN = "T".repeat(43);
const VERIFICATION_ID = "a".repeat(64);
const FORM_URL = `https://forms.zohopublic.com/synthetic/form/perma/example?handle=${"H".repeat(43)}`;
const SENT = { ok: true, state: "sent_confirmed", verificationId: VERIFICATION_ID };
const PENDING = { ok: false, state: "verified_setup_pending", code: "setup_preparation_unavailable" };

function browserFixture({ fragment = `#setupToken=${TOKEN}`, navigationThrows = false } = {}) {
  const elements = Object.fromEntries(["status", "code", "verify", "resend"].map((id) => [id, {
    textContent: "", value: "", disabled: true, dataset: {}, attributes: {}, listeners: {}, focuses: 0,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    focus() { this.focuses += 1; },
    fire(name, event = {}) { return this.listeners[name]?.(event); },
  }]));
  const calls = [], navigations = [], historyCalls = [], timers = new Map();
  let timerId = 0;
  const location = { hash: fragment, pathname: "/synthetic/access",
    assign(value) { if (navigationThrows) throw new Error("synthetic navigation rejection"); navigations.push(value); },
  };
  const page = renderAccessPage({ otpRequestPath: "/form2/otp/request", otpVerifyPath: "/form2/otp/verify" });
  const script = page.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const context = {
    URL, URLSearchParams, AbortController, location,
    document: { getElementById: (id) => elements[id] },
    history: { replaceState(...args) { historyCalls.push(args); location.hash = ""; } },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(path, options) {
      return new Promise((resolve, reject) => {
        const call = { path, options, body: JSON.parse(options.body), resolve, reject };
        calls.push(call);
        options.signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
      });
    },
  };
  vm.runInNewContext(script, context);
  return {
    elements, calls, navigations, historyCalls, location, timers,
    async reply(index, status, body) {
      calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
      await new Promise(setImmediate);
    },
    async reject(index) { calls[index].reject(new Error("synthetic private failure")); await new Promise(setImmediate); },
    async runTimers(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) { timers.delete(id); timer.callback(); }
      }
      await new Promise(setImmediate);
    },
  };
}

async function readyPage(options) {
  const page = browserFixture(options);
  await page.reply(0, 202, SENT);
  return page;
}

test("browser clears the fragment, sends it once, and shows restrained busy feedback", async () => {
  const page = browserFixture();
  assert.equal(page.location.hash, "");
  assert.deepEqual(page.historyCalls[0], [null, "", "/synthetic/access"]);
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.calls[0].body, { setupToken: TOKEN });
  assert.equal(page.calls[0].options.credentials, "omit");
  assert.equal(page.calls[0].options.cache, "no-store");
  assert.equal(page.calls[0].options.redirect, "error");
  assert.equal(page.elements.resend.textContent, "Sending code…");
  assert.equal(page.elements.resend.attributes["aria-busy"], "true");
  page.elements.resend.fire("click");
  page.elements.verify.fire("click");
  assert.equal(page.calls.length, 1);
  await page.reply(0, 202, SENT);
  assert.match(page.elements.status.textContent, /^Code sent\./);
  assert.equal(page.elements.code.disabled, false);
  assert.equal(page.elements.verify.disabled, false);
  assert.equal(page.elements.resend.disabled, false);
  assert.equal(page.elements.resend.attributes["aria-busy"], "false");
  assert.equal(page.elements.code.focuses, 1);
  assert.equal(page.timers.size, 0);
});

test("invalid or cleared setup fragments cannot issue email or enable controls", () => {
  for (const fragment of ["", "#setupToken=short"]) {
    const page = browserFixture({ fragment });
    assert.equal(page.calls.length, 0);
    assert.equal(page.elements.code.disabled, true);
    assert.equal(page.elements.verify.disabled, true);
    assert.equal(page.elements.resend.disabled, true);
    assert.match(page.elements.status.textContent, /Open setup again from CRM/);
  }
});

test("verify double clicks, Enter and resend cannot overlap an active verification", async () => {
  const page = await readyPage();
  page.elements.code.value = "12345678";
  const operation = page.elements.verify.fire("click");
  assert.equal(page.elements.verify.textContent, "Verifying…");
  assert.equal(page.elements.verify.attributes["aria-busy"], "true");
  assert.equal(page.elements.resend.disabled, true);
  assert.equal(page.elements.code.disabled, true);
  page.elements.verify.fire("click");
  page.elements.resend.fire("click");
  page.elements.code.fire("keydown", { key: "Enter", preventDefault() {} });
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.calls[1].body, { verificationId: VERIFICATION_ID, code: "12345678" });
  await page.reply(1, 200, { ok: true, formUrl: FORM_URL });
  await operation;
  assert.equal(page.elements.status.textContent, "Email verified. Opening your setup form…");
  assert.equal(page.elements.verify.textContent, "Email verified");
  assert.equal(page.elements.code.value, "");
  assert.equal(page.navigations.length, 0);
  await page.runTimers(150);
  assert.deepEqual(page.navigations, [FORM_URL]);
  page.elements.verify.fire("click");
  page.elements.resend.fire("click");
  assert.equal(page.calls.length, 2);
});

test("manual resend serializes controls, drops old code and never reuses the setup token", async () => {
  const page = await readyPage();
  page.elements.code.value = "12345678";
  const operation = page.elements.resend.fire("click");
  assert.equal(page.elements.code.value, "");
  page.elements.resend.fire("click");
  page.elements.verify.fire("click");
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.calls[1].body, { verificationId: VERIFICATION_ID });
  assert.equal(page.elements.verify.disabled, true);
  await page.reply(1, 202, SENT);
  await operation;
  assert.equal(page.elements.code.value, "");
  assert.equal(page.elements.verify.disabled, false);
});

test("invalid code input stays local and keyboard Enter invokes one valid verification", async () => {
  const page = await readyPage();
  page.elements.code.value = "123";
  await page.elements.verify.fire("click");
  assert.equal(page.calls.length, 1);
  assert.match(page.elements.status.textContent, /Enter the eight-digit code/);
  page.elements.code.value = "12345678";
  let prevented = false;
  page.elements.code.fire("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.calls.length, 2);
  await page.reply(1, 403, { ok: false, code: "verification_required" });
  assert.match(page.elements.status.textContent, /not currently accepted/);
  assert.equal(page.elements.verify.disabled, false);
  assert.equal(page.elements.verify.attributes["aria-busy"], "false");
});

test("accepted OTP with pending setup is explicit and disables verify and resend without retry", async () => {
  for (const stage of ["request", "verify"]) {
    const page = stage === "request" ? browserFixture() : await readyPage();
    if (stage === "verify") {
      page.elements.code.value = "12345678";
      page.elements.verify.fire("click");
    }
    const count = page.calls.length;
    await page.reply(count - 1, 503, PENDING);
    assert.match(page.elements.status.textContent, /^Email verified\. Setup is temporarily unavailable/);
    assert.equal(page.elements.verify.textContent, "Email verified");
    assert.equal(page.elements.verify.disabled, true);
    assert.equal(page.elements.resend.disabled, true);
    assert.equal(page.elements.code.disabled, true);
    assert.equal(page.elements.code.value, "");
    page.elements.verify.fire("click");
    page.elements.resend.fire("click");
    assert.equal(page.calls.length, count);
    assert.equal(page.timers.size, 0);
    assert.equal(page.navigations.length, 0);
  }
});

test("unknown server verification failures never call the code wrong or resend automatically", async () => {
  for (const status of [400, 401, 409, 500, 503]) {
    const page = await readyPage();
    page.elements.code.value = "12345678";
    page.elements.verify.fire("click");
    await page.reply(1, status, { ok: false, code: "service_unavailable" });
    assert.match(page.elements.status.textContent, /does not mean the code was wrong/);
    assert.equal(page.elements.verify.disabled, true);
    assert.equal(page.elements.resend.disabled, true);
    assert.equal(page.calls.length, 2);
    assert.equal(page.timers.size, 0);
  }
});

test("verification success and retry controls reject inconsistent HTTP envelopes", async () => {
  for (const [status, body] of [
    [202, { ok: true, formUrl: FORM_URL }],
    [200, { ok: false, formUrl: FORM_URL }],
    [403, { ok: true, code: "verification_required" }],
  ]) {
    const page = await readyPage();
    page.elements.code.value = "12345678";
    page.elements.verify.fire("click");
    await page.reply(1, status, body);
    assert.equal(page.navigations.length, 0);
    assert.equal(page.timers.size, 0);
    assert.equal(page.elements.status.textContent.startsWith("Email verified."), false);
    assert.equal(page.elements.verify.disabled, true);
    assert.equal(page.elements.resend.disabled, true);
  }
});

test("network or JSON ambiguity stops without a new verification or email request", async () => {
  for (const stage of ["request", "verify"]) {
    for (const failure of ["network", "json", "timeout"]) {
      const page = stage === "request" ? browserFixture() : await readyPage();
      if (stage === "verify") {
        page.elements.code.value = "12345678";
        page.elements.verify.fire("click");
      }
      const count = page.calls.length;
      if (failure === "network") await page.reject(count - 1);
      else if (failure === "json") await page.reply(count - 1, 200, null);
      else await page.runTimers(30000);
      assert.match(page.elements.status.textContent, /outcome is unknown/);
      assert.equal(page.elements.verify.disabled, true);
      assert.equal(page.elements.resend.disabled, true);
      assert.equal(page.calls.length, count);
      assert.equal(page.navigations.length, 0);
      assert.equal(page.timers.size, 0);
    }
  }
});

test("only an explicit retryable delivery failure offers a manual send retry", async () => {
  const page = browserFixture();
  await page.reply(0, 503, { ok: false, state: "retryable_failure", verificationId: VERIFICATION_ID });
  assert.equal(page.elements.verify.disabled, true);
  assert.equal(page.elements.resend.disabled, false);
  assert.equal(page.calls.length, 1);
  page.elements.resend.fire("click");
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.calls[1].body, { verificationId: VERIFICATION_ID });
  await page.reply(1, 202, SENT);
  assert.equal(page.elements.verify.disabled, false);
});

test("delivery state labels require the exact HTTP, ok and identity contract before enabling controls", async () => {
  for (const state of ["sent_confirmed", "in_flight", "retryable_failure", "delivery_disabled", "terminal_failure"]) {
    const accepted = state === "sent_confirmed" || state === "in_flight";
    const expectedStatus = accepted ? 202 : 503;
    const body = { ok: accepted, state, verificationId: VERIFICATION_ID };
    for (const [status, malformed] of [
      [200, body],
      [expectedStatus, { ...body, ok: !accepted }],
      [expectedStatus, { ...body, verificationId: undefined }],
      [expectedStatus, { ...body, verificationId: "bad" }],
    ]) {
      const page = browserFixture();
      await page.reply(0, status, malformed);
      assert.equal(page.elements.verify.disabled, true);
      assert.equal(page.elements.resend.disabled, true);
      assert.equal(page.elements.code.disabled, true);
      assert.match(page.elements.status.textContent, /could not be confirmed/);
      page.elements.resend.fire("click");
      assert.equal(page.calls.length, 1);
    }
  }
});

test("a forged or malformed setup-pending label cannot claim that email was verified", async () => {
  for (const stage of ["request", "verify"]) {
    for (const [status, body] of [
      [200, PENDING], [403, PENDING], [503, { ...PENDING, ok: true }],
      [503, { ...PENDING, code: "service_unavailable" }],
      [503, { state: "verified_setup_pending" }],
    ]) {
      const page = stage === "request" ? browserFixture() : await readyPage();
      if (stage === "verify") {
        page.elements.code.value = "12345678";
        page.elements.verify.fire("click");
      }
      const count = page.calls.length;
      await page.reply(count - 1, status, body);
      assert.equal(page.elements.status.textContent.startsWith("Email verified."), false);
      assert.equal(page.elements.verify.textContent, "Continue to setup");
      assert.equal(page.elements.verify.disabled, true);
      assert.equal(page.elements.resend.disabled, true);
      assert.equal(page.calls.length, count);
      assert.equal(page.navigations.length, 0);
    }
  }
});

test("processing, disabled, malformed and unknown send outcomes never imply confirmed delivery", async () => {
  for (const body of [
    { ok: true, state: "in_flight", verificationId: VERIFICATION_ID },
    { ok: false, state: "delivery_disabled", verificationId: VERIFICATION_ID },
    { ok: false, state: "terminal_failure", verificationId: VERIFICATION_ID },
    { ok: true, state: "sent_confirmed" },
    { ok: false, state: "sent_confirmed", verificationId: VERIFICATION_ID },
    { state: "verified_setup_pending" },
  ]) {
    const page = browserFixture();
    await page.reply(0, 202, body);
    assert.equal(page.elements.code.disabled, true);
    assert.equal(page.elements.resend.disabled, true);
    assert.equal(page.elements.status.textContent.startsWith("Code sent."), false);
    assert.equal(page.elements.status.textContent.startsWith("Email verified."), false);
    assert.equal(page.calls.length, 1);
  }
});

test("successful resume opens only the approved Forms URL and reports blocked navigation honestly", async () => {
  const page = browserFixture({ navigationThrows: true });
  await page.reply(0, 200, { ok: true, state: "already_verified", verificationId: VERIFICATION_ID, formUrl: FORM_URL });
  assert.match(page.elements.status.textContent, /^Email verified\. Opening/);
  await page.runTimers(150);
  assert.match(page.elements.status.textContent, /setup form could not open/);
  assert.equal(page.elements.resend.disabled, true);
  assert.equal(page.calls.length, 1);
  for (const formUrl of [
    "javascript:alert(1)", FORM_URL.replace("forms.zohopublic.com", "forms.zohopublic.com.evil.invalid"),
    FORM_URL.replace("https:", "http:"), `${FORM_URL}#fragment`, `${FORM_URL}&extra=x`,
    FORM_URL.replace("H".repeat(43), "short"), "https://forms.zohopublic.com/",
  ]) {
    const denied = browserFixture();
    await denied.reply(0, 200, { ok: true, state: "already_verified", verificationId: VERIFICATION_ID, formUrl });
    assert.equal(denied.navigations.length, 0);
    assert.equal(denied.timers.size, 0);
    assert.equal(denied.elements.status.textContent.startsWith("Email verified."), false);
  }
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
