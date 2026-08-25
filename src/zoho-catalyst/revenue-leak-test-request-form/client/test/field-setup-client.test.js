"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const CLIENT_ROOT = path.resolve(__dirname, "..");
const ROUTE_ROOT = path.join(CLIENT_ROOT, "field-setup");
const PROJECT_ROOT = path.resolve(CLIENT_ROOT, "..");
const BROWSER_FILES = [
  path.join(ROUTE_ROOT, "index.html"),
  path.join(ROUTE_ROOT, "styles.css"),
  path.join(ROUTE_ROOT, "launch-fragment.js"),
  path.join(ROUTE_ROOT, "state-model.js"),
  path.join(ROUTE_ROOT, "api-adapter.js"),
  path.join(ROUTE_ROOT, "main.js")
];

const launchContract = require(path.join(ROUTE_ROOT, "launch-fragment.js"));
const stateModel = require(path.join(ROUTE_ROOT, "state-model.js"));
const apiContract = require(path.join(ROUTE_ROOT, "api-adapter.js"));

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function browserBundle() {
  return BROWSER_FILES.map(read).join("\n");
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    readValues() {
      return [...values.values()];
    }
  };
}

test("the state inventory contains the exact 22 required screens in order", () => {
  const expectedNames = [
    "Loading and session validation",
    "Company and progress summary",
    "Hand-iPad-to-client instruction",
    "Open or resume Form 1",
    "Form 1 completion confirmation",
    "Return-iPad-to-Gabriel instruction",
    "Operator qualification review",
    "Lead-conversion preview",
    "Explicit conversion confirmation",
    "Hand-iPad-to-client instruction",
    "Email verification for Form 2",
    "Open or resume Form 2",
    "Form 2 completion confirmation",
    "Return-iPad-to-Gabriel instruction",
    "Test-number reservation status",
    "Forwarding instructions",
    "Rollback instructions",
    "Route-verification status",
    "Ready for approval",
    "Live status",
    "Stop/rollback status",
    "Specific recoverable blocked/error state"
  ];

  assert.equal(stateModel.FIELD_SETUP_STATES.length, 22);
  assert.deepEqual(stateModel.FIELD_SETUP_STATES.map((state) => state.name), expectedNames);
  assert.equal(new Set(stateModel.FIELD_SETUP_STATES.map((state) => state.id)).size, 22);
});

test("every screen has exactly one primary action", () => {
  for (const state of stateModel.FIELD_SETUP_STATES) {
    assert.deepEqual(Object.keys(state).filter((key) => key === "primaryAction"), ["primaryAction"]);
    assert.equal(typeof state.primaryAction.id, "string", state.id);
    assert.ok(state.primaryAction.id.length > 0, state.id);
    assert.equal(typeof state.primaryAction.label, "string", state.id);
    assert.ok(state.primaryAction.label.length > 0, state.id);
  }

  const html = read(path.join(ROUTE_ROOT, "index.html"));
  assert.equal((html.match(/data-role="primary-action"/g) || []).length, 1);
});

test("qualification criteria and decision choices match the operator contract", () => {
  assert.deepEqual([...stateModel.QUALIFICATION_CRITERIA], [
    "Company Has Meaningful Call Volume",
    "Can Accept Additional Profitable Work",
    "Has A Repeatable Intake Process",
    "Will Authorize A Controlled Forwarding Path",
    "Has An Accountable Callback / Handoff Owner",
    "Decision-Maker Is Present"
  ]);

  const qualification = stateModel.getState("operator-qualification-review");
  assert.equal(qualification.serverOutcomeRequired, true);
  assert.equal(qualification.primaryAction.label, "Qualified — Continue Setup");
  assert.deepEqual(qualification.secondaryActions.map((action) => action.label), [
    "Not Ready — Save And Follow Up",
    "Disqualified"
  ]);
});

test("launch fragments are removed without leaking them into the replacement URL", () => {
  const syntheticNonce = "a".repeat(43);
  const calls = [];
  const locationLike = {
    hash: `#launch=${syntheticNonce}`,
    pathname: "/field-setup/",
    search: "?preview=session-validation"
  };
  const historyLike = {
    replaceState(...args) {
      calls.push(args);
    }
  };

  assert.equal(launchContract.captureAndRemove(locationLike, historyLike), true);
  assert.deepEqual(calls, [[null, "", "/field-setup/?preview=session-validation"]]);
  assert.equal(calls[0][2].includes(syntheticNonce), false);
  assert.equal(launchContract.consumeLaunchNonce(), syntheticNonce);
  assert.equal(launchContract.consumeLaunchNonce(), null);
});

test("malformed fragments are still removed and never accepted as launch material", () => {
  const calls = [];
  const locationLike = { hash: "#unexpected=value", pathname: "/field-setup/", search: "" };
  const historyLike = { replaceState: (...args) => calls.push(args) };

  assert.equal(launchContract.captureAndRemove(locationLike, historyLike), false);
  assert.deepEqual(calls, [[null, "", "/field-setup/"]]);
  assert.equal(launchContract.consumeLaunchNonce(), null);
});

test("fragment removal script runs synchronously before route styles and application scripts", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const fragmentScript = html.indexOf('<script src="./launch-fragment.js"></script>');
  const stylesheet = html.indexOf('<link rel="stylesheet" href="./styles.css">');
  const application = html.indexOf('<script defer src="./main.js"></script>');

  assert.ok(fragmentScript > -1);
  assert.ok(fragmentScript < stylesheet);
  assert.ok(fragmentScript < application);
});

test("the synthetic adapter autosaves safe state only and exposes no activation operation", async () => {
  const storage = memoryStorage();
  const api = apiContract.createSyntheticApi({ stateModel, storage });
  const validation = stateModel.getState("session-validation");
  const outcome = await api.completeStep({
    stateId: validation.id,
    actionId: validation.primaryAction.id
  });

  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "company-progress-summary");
  assert.deepEqual(storage.readValues(), ["company-progress-summary"]);

  const operationNames = Object.keys(api).join(" ").toLowerCase();
  assert.doesNotMatch(operationNames, /activate|approve|start.?test|route.?traffic/);
  assert.deepEqual(Object.keys(api).sort(), [
    "completeStep",
    "loadJourney",
    "mode",
    "requestStop",
    "submitOperatorDecision"
  ]);
});

test("a launch nonce cannot be exchanged by the source-preview adapter", async () => {
  const api = apiContract.createSyntheticApi({ stateModel });
  const outcome = await api.loadJourney({ launchNonce: "a".repeat(43) });

  assert.equal(outcome.authoritative, false);
  assert.equal(outcome.nextState, "recoverable-blocked");
});

test("the browser bundle has no network primitive, secret-shaped value, PII, or durable identifier", () => {
  const bundle = browserBundle();
  const forbiddenPatterns = [
    /\bfetch\s*\(/i,
    /XMLHttpRequest/i,
    /sendBeacon/i,
    /WebSocket/i,
    /https?:\/\//i,
    /-----BEGIN [A-Z ]+-----/,
    /\bBearer\s+[A-Za-z0-9._~-]+/i,
    /(?:api[_-]?key|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']+["']/i,
    /\b[0-9]{12,}\b/,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?1[-. (]*)?\d{3}[-. )]*\d{3}[-. ]*\d{4}/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(bundle, pattern, pattern.toString());
  }
});

test("the bundle has no iframe or unsafe HTML injection path", () => {
  const bundle = browserBundle();
  assert.doesNotMatch(bundle, /<iframe\b/i);
  assert.doesNotMatch(bundle, /\.innerHTML\s*=/);
  assert.doesNotMatch(bundle, /insertAdjacentHTML/);
  assert.doesNotMatch(bundle, /document\.write/);
});

test("touch controls meet the minimum target and actions are not hover-only", () => {
  const css = read(path.join(ROUTE_ROOT, "styles.css"));
  assert.match(css, /button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*48px;/s);
  assert.match(css, /\.button:focus-visible/);
  assert.match(css, /\.button-primary\s*\{[^}]*background:/s);
  assert.match(css, /\.button-secondary\s*\{[^}]*border-color:/s);
});

test("the two required iPad viewport contracts are explicit", () => {
  assert.deepEqual(stateModel.SUPPORTED_VIEWPORTS, [
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 }
  ]);

  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const css = read(path.join(ROUTE_ROOT, "styles.css"));
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(css, /@media \(min-width: 48rem\) and \(max-height: 64rem\)/);
  assert.match(css, /width:\s*min\(100%, 72rem\)/);
});

test("semantic controls, focus movement, and status announcements support keyboard use", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  const script = read(path.join(ROUTE_ROOT, "main.js"));
  const buttonCount = (html.match(/<button\b/g) || []).length;
  const typedButtonCount = (html.match(/<button\b[^>]*type="button"/g) || []).length;

  assert.equal(buttonCount, typedButtonCount);
  assert.match(html, /class="skip-link" href="#journey-content"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /id="step-title" tabindex="-1"/);
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  assert.match(script, /elements\.title\.focus\(\)/);
});

test("the Catalyst source descriptor keeps the client unregistered and deployment-gated", () => {
  const catalyst = JSON.parse(read(path.join(PROJECT_ROOT, "catalyst.json")));
  const clientPackage = JSON.parse(read(path.join(CLIENT_ROOT, "client-package.json")));
  const gate = catalyst["x-sylvara-source-only-client"];

  assert.equal(Object.hasOwn(catalyst, "client"), false);
  assert.equal(gate.source, "client");
  assert.equal(gate.route, "/field-setup/");
  assert.equal(gate.published, false);
  assert.equal(gate.deploymentAllowed, false);
  assert.equal(gate.registrationRequired, true);
  assert.equal(gate.deploymentGate, "SEPARATE_DEVELOPMENT_WEB_CLIENT_REGISTRATION_AND_PUBLISH_APPROVAL_REQUIRED");
  assert.equal(clientPackage.homepage, "field-setup/index.html");
  assert.equal(fs.existsSync(path.join(CLIENT_ROOT, "index.html")), true);
});

test("the content security policy blocks frames, forms, and network access", () => {
  const html = read(path.join(ROUTE_ROOT, "index.html"));
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /connect-src 'none'/);
});
