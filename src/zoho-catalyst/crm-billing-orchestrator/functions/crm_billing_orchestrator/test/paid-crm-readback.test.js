"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { validatePaidCrmReadback } = require("../../../tools/validate-paid-crm-readback");
const { CANONICAL_PLAN_BY_CRM_API_VALUE } = require("../lib/crm-client");
const { loadConfig } = require("../lib/config");
const { baseEnvironment, REVISION } = require("./helpers");

const EXPECTED = Object.freeze({
  organizationId: "synthetic-organization", layoutId: "synthetic-layout", principalId: "synthetic-principal",
  notBefore: "2026-01-01T00:00:00.000Z", evaluatedAt: "2026-01-02T00:00:00.000Z",
});
const SECTION_CHECKS = Object.freeze({
  fields: ["fields"], picklists: ["plan", "futureStatus", "liveStatus"],
  effectiveLayout: ["effectiveLayout"], permissions: ["permissions"],
});

function envelope(details) {
  return { organizationId: EXPECTED.organizationId, moduleApiName: "Deals",
    source: "independent_readback", complete: true, capturedAt: "2026-01-01T12:00:00.000Z", ...details };
}

function fixture() {
  const plan = Object.entries(CANONICAL_PLAN_BY_CRM_API_VALUE)
    .map(([actualValue, displayValue]) => ({ actualValue, displayValue, active: true }));
  const statuses = ["Scheduled", "Active"].map((actualValue) => ({ actualValue, active: true }));
  return {
    fields: envelope({ fields: [
      { apiName: "Plan", dataType: "picklist" },
      { apiName: "Subscription_Status", dataType: "picklist", apiUpdate: true, readOnly: false },
    ] }),
    picklists: envelope({ fields: [
      { apiName: "Plan", options: plan }, { apiName: "Subscription_Status", options: statuses },
    ] }),
    effectiveLayout: envelope({ principalId: EXPECTED.principalId, matches: [{
      layoutId: EXPECTED.layoutId, active: true, fields: [
        { apiName: "Plan", options: structuredClone(plan) },
        { apiName: "Subscription_Status", readOnly: false, options: structuredClone(statuses) },
      ],
    }] }),
    permissions: envelope({ principalId: EXPECTED.principalId, layoutId: EXPECTED.layoutId,
      moduleRead: true, moduleUpdate: true, fields: [
        { apiName: "Plan", read: true }, { apiName: "Subscription_Status", read: true, update: true },
      ] }),
  };
}

function assertCheck(report, name, status, reason) {
  assert.deepEqual(report.checks[name], { status, reasons: reason ? [reason] : [] });
}

const optionFieldSelectors = [
  (value) => value.picklists.fields, (value) => value.effectiveLayout.matches[0].fields,
];
const rowSelectors = [
  (value) => value.fields.fields, (value) => value.picklists.fields,
  (value) => value.effectiveLayout.matches[0].fields, (value) => value.permissions.fields,
  (value) => value.picklists.fields[0].options, (value) => value.picklists.fields[1].options,
  (value) => value.effectiveLayout.matches[0].fields[0].options,
  (value) => value.effectiveLayout.matches[0].fields[1].options,
];

test("complete independent metadata matches the immutable runtime crosswalks", () => {
  assert.deepEqual(CANONICAL_PLAN_BY_CRM_API_VALUE,
    { "Option 1": "Launch", "Option 2": "Growth", Pro: "Scale" });
  assert.equal(Object.isFrozen(CANONICAL_PLAN_BY_CRM_API_VALUE), true);
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  assert.deepEqual(config.paidSubscriptionStatusMap, { future: "Scheduled", live: "Active" });
  const report = validatePaidCrmReadback(fixture(), EXPECTED);
  assert.equal(report.schemaVersion, "paid-crm-readback-v1");
  assert.equal(report.scope, "paid_crm_plan_and_subscription_status_only");
  assert.equal(report.status, "compatible");
  for (const name of Object.keys(report.checks)) assertCheck(report, name, "compatible");
  for (const actualValue of Object.keys(CANONICAL_PLAN_BY_CRM_API_VALUE)) {
    const evidence = fixture();
    evidence.picklists.fields[0].options = evidence.picklists.fields[0].options
      .filter((option) => option.actualValue !== actualValue);
    assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "plan", "incompatible",
      "required_api_value_unavailable");
  }
});

test("API values are exact and display labels never substitute for them", () => {
  for (const selector of optionFieldSelectors) {
    for (const substitute of ["Launch", "option 1", "Option 1 "]) {
      const evidence = fixture();
      Object.assign(selector(evidence)[0].options[0], { actualValue: substitute, displayValue: "Option 1" });
      assert.notEqual(validatePaidCrmReadback(evidence, EXPECTED).status, "compatible");
    }
    const evidence = fixture();
    for (const option of selector(evidence)[0].options) option.displayValue = "Synthetic renamed label";
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "compatible");
  }
});

test("missing Scheduled is incompatible for future status while Active stays compatible", () => {
  const evidence = fixture();
  for (const selector of optionFieldSelectors) {
    selector(evidence)[1].options = [{ actualValue: "Active", displayValue: "Scheduled", active: true }];
  }
  const report = validatePaidCrmReadback(evidence, EXPECTED);
  assert.equal(report.status, "incompatible");
  assertCheck(report, "plan", "compatible");
  assertCheck(report, "futureStatus", "incompatible", "required_api_value_unavailable");
  assertCheck(report, "liveStatus", "compatible");
  assertCheck(report, "effectiveLayout", "incompatible", "required_api_value_unavailable");
});

test("inactive API options cannot satisfy global or effective-layout evidence", () => {
  for (const selector of optionFieldSelectors) {
    for (const fieldIndex of [0, 1]) {
      const evidence = fixture();
      selector(evidence)[fieldIndex].options[0].active = false;
      assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "incompatible");
    }
  }
});

test("every evidence section independently requires exact scope, provenance and observation interval", () => {
  const mutations = [
    [() => null, "evidence_missing_or_malformed"],
    [(section) => ({ ...section, organizationId: "synthetic-other-organization" }), "evidence_scope_mismatch"],
    [(section) => ({ ...section, moduleApiName: "Leads" }), "evidence_scope_mismatch"],
    [(section) => ({ ...section, source: "proposed_change" }), "independent_complete_readback_required"],
    [(section) => ({ ...section, complete: false }), "independent_complete_readback_required"],
    [(section) => ({ ...section, capturedAt: "invalid-time" }), "capture_time_invalid"],
    [(section) => ({ ...section, capturedAt: "2026-01-01T12:00:00Z" }), "capture_time_invalid"],
    [(section) => ({ ...section, capturedAt: "2025-12-31T23:59:59.999Z" }), "evidence_outside_observation_interval"],
    [(section) => ({ ...section, capturedAt: "2026-01-02T00:00:00.001Z" }), "evidence_outside_observation_interval"],
  ];
  for (const [sectionName, affectedChecks] of Object.entries(SECTION_CHECKS)) {
    for (const [mutate, reason] of mutations) {
      const evidence = fixture();
      evidence[sectionName] = mutate(evidence[sectionName]);
      const report = validatePaidCrmReadback(evidence, EXPECTED);
      assert.equal(report.status, "unknown", `${sectionName}: ${reason}`);
      for (const name of affectedChecks) assertCheck(report, name, "unknown", reason);
    }
    const evidence = fixture();
    delete evidence[sectionName];
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "unknown");
  }
});

test("freshness uses only the caller's interval and accepts its exact endpoints", () => {
  for (const capturedAt of [EXPECTED.notBefore, EXPECTED.evaluatedAt]) {
    const evidence = fixture();
    for (const section of Object.values(evidence)) section.capturedAt = capturedAt;
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "compatible");
  }
  const evidence = fixture();
  for (const section of Object.values(evidence)) section.capturedAt = "2000-01-01T00:00:00.000Z";
  assert.equal(validatePaidCrmReadback(evidence, { ...EXPECTED,
    notBefore: "2000-01-01T00:00:00.000Z", evaluatedAt: "2000-01-01T00:00:00.000Z" }).status, "compatible");
});

test("malformed expected scope, timestamps and reversed intervals remain unknown", () => {
  for (const expected of [null, [], {}, { ...EXPECTED, principalId: " " },
    { ...EXPECTED, layoutId: null }, { ...EXPECTED, organizationId: 123 },
    { ...EXPECTED, notBefore: "not-a-date" }, { ...EXPECTED, evaluatedAt: "2026-01-02" },
    { ...EXPECTED, notBefore: EXPECTED.evaluatedAt, evaluatedAt: EXPECTED.notBefore }]) {
    const report = validatePaidCrmReadback(fixture(), expected);
    assert.equal(report.status, "unknown");
    for (const name of Object.keys(report.checks)) {
      assertCheck(report, name, "unknown", "expected_scope_or_interval_invalid");
    }
  }
});

test("missing, ambiguous and wrong-scope effective layouts never imply compatibility", () => {
  for (const matches of [undefined, [], [{}, {}], [null]]) {
    const evidence = fixture();
    evidence.effectiveLayout.matches = matches;
    assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "effectiveLayout", "unknown",
      "effective_layout_missing_or_ambiguous");
  }
  for (const mutate of [
    (value) => { value.effectiveLayout.principalId = "synthetic-other-principal"; },
    (value) => { value.effectiveLayout.matches[0].layoutId = "synthetic-other-layout"; },
    (value) => { value.permissions.principalId = "synthetic-other-principal"; },
    (value) => { value.permissions.layoutId = "synthetic-other-layout"; },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "unknown");
  }
});

test("duplicate field rows and option rows remain ambiguous even when identical", () => {
  for (const selector of rowSelectors) {
    const evidence = fixture();
    const rows = selector(evidence);
    rows.push(structuredClone(rows[0]));
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "unknown");
  }
});

test("malformed rows and option flags cannot establish compatibility", () => {
  for (const selector of rowSelectors) {
    for (const row of [null, [], {}, { apiName: " " }]) {
      const evidence = fixture();
      selector(evidence)[0] = row;
      assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "unknown");
    }
  }
  for (const patch of [{ active: "true" }, { actualValue: 1 }, { displayValue: null }]) {
    const evidence = fixture();
    Object.assign(evidence.picklists.fields[0].options[0], patch);
    assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "plan", "unknown",
      "option_rows_malformed_or_duplicate");
  }
});

test("known field or layout incompatibility is distinct from unknown capability", () => {
  for (const [patch, status, reason] of [
    [{ dataType: "text" }, "incompatible", "field_type_mismatch"],
    [{ dataType: null }, "unknown", "field_type_unknown"],
    [{ apiUpdate: false }, "incompatible", "field_update_unavailable"],
    [{ readOnly: true }, "incompatible", "field_update_unavailable"],
    [{ apiUpdate: null }, "unknown", "field_update_capability_unknown"],
  ]) {
    const evidence = fixture();
    Object.assign(evidence.fields.fields[1], patch);
    assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "fields", status, reason);
  }
  const evidence = fixture();
  evidence.effectiveLayout.matches[0].active = false;
  assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "effectiveLayout", "incompatible",
    "effective_layout_inactive");
  evidence.effectiveLayout.matches[0].active = true;
  evidence.effectiveLayout.matches[0].fields[1].readOnly = true;
  assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "effectiveLayout", "incompatible",
    "layout_field_read_only");
});

test("every required permission must be explicitly known and granted", () => {
  for (const [target, name] of [
    [(value) => value.permissions, "moduleRead"], [(value) => value.permissions, "moduleUpdate"],
    [(value) => value.permissions.fields[0], "read"], [(value) => value.permissions.fields[1], "read"],
    [(value) => value.permissions.fields[1], "update"],
  ]) {
    for (const flag of [undefined, null, "true", false]) {
      const evidence = fixture();
      target(evidence)[name] = flag;
      assertCheck(validatePaidCrmReadback(evidence, EXPECTED), "permissions",
        flag === false ? "incompatible" : "unknown",
        flag === false ? "required_permission_denied" : "permissions_unknown");
    }
  }
});

test("customer, credential and unrelated input is rejected at every object boundary", () => {
  for (const selector of [
    (value) => value, (value) => value.fields, (value) => value.fields.fields[0],
    (value) => value.picklists, (value) => value.picklists.fields[0],
    (value) => value.picklists.fields[0].options[0], (value) => value.effectiveLayout,
    (value) => value.effectiveLayout.matches[0], (value) => value.effectiveLayout.matches[0].fields[0],
    (value) => value.effectiveLayout.matches[0].fields[0].options[0],
    (value) => value.permissions, (value) => value.permissions.fields[0],
  ]) {
    const evidence = fixture();
    selector(evidence).records = [{ name: "synthetic-private-marker" }];
    const report = validatePaidCrmReadback(evidence, EXPECTED);
    assert.equal(report.status, "unknown");
    assert.equal(JSON.stringify(report).includes("synthetic-private-marker"), false);
  }
  for (const key of ["credentials", "customer", "billing", "records"]) {
    assert.equal(validatePaidCrmReadback({ ...fixture(), [key]: {} }, EXPECTED).status, "unknown");
  }
  assert.equal(validatePaidCrmReadback(fixture(), { ...EXPECTED, credentials: {} }).status, "unknown");
});

test("results are deterministic, sanitized and do not mutate frozen input", () => {
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    }
    return value;
  }
  const evidence = fixture();
  evidence.picklists.fields[0].options[0].displayValue = "synthetic-private-marker";
  const before = JSON.stringify(evidence);
  freeze(evidence);
  const report = validatePaidCrmReadback(evidence, EXPECTED);
  assert.deepEqual(validatePaidCrmReadback(evidence, EXPECTED), report);
  assert.equal(JSON.stringify(evidence), before);
  const output = JSON.stringify(report);
  for (const forbidden of [EXPECTED.organizationId, EXPECTED.layoutId, EXPECTED.principalId,
    EXPECTED.notBefore, "synthetic-private-marker", "Launch", "Option 1"]) {
    assert.equal(output.includes(forbidden), false);
  }
});

test("source loads and evaluates with zero IO, environment, provider or clock access", () => {
  const source = fs.readFileSync(require.resolve("../../../tools/validate-paid-crm-readback"), "utf8");
  const accesses = [];
  const sandbox = { module: { exports: {} }, exports: {} };
  for (const name of ["require", "process", "fetch", "console", "setTimeout", "setInterval",
    "setImmediate", "queueMicrotask", "XMLHttpRequest", "WebSocket"]) {
    Object.defineProperty(sandbox, name, { get() { accesses.push(name); throw new Error(`Forbidden ${name}`); } });
  }
  sandbox.Date = class extends Date {
    constructor(...args) {
      assert.notEqual(args.length, 0, "validator cannot read the current clock");
      super(...args);
    }
    static now() { throw new Error("validator cannot read the current clock"); }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const output = vm.runInContext(`JSON.stringify(module.exports.validatePaidCrmReadback(
    ${JSON.stringify(fixture())}, ${JSON.stringify(EXPECTED)}))`, context);
  assert.equal(JSON.parse(output).status, "compatible");
  assert.deepEqual(accesses, []);
});

test("known permission denial remains incompatible alongside unknown permissions", () => {
  const evidence = fixture();
  evidence.permissions.moduleRead = false;
  delete evidence.permissions.fields[1].update;
  const report = validatePaidCrmReadback(evidence, EXPECTED);
  assert.equal(report.status, "incompatible");
  assert.equal(report.checks.permissions.status, "incompatible");
  assert.deepEqual(new Set(report.checks.permissions.reasons),
    new Set(["required_permission_denied", "permissions_unknown"]));
});

test("supplied optional metadata flags must be booleans without requiring Plan write access", () => {
  for (const [target, name] of [
    [(value) => value.fields.fields[0], "apiUpdate"],
    [(value) => value.fields.fields[0], "readOnly"],
    [(value) => value.effectiveLayout.matches[0].fields[0], "readOnly"],
    [(value) => value.permissions.fields[0], "update"],
  ]) {
    const evidence = fixture();
    target(evidence)[name] = "true";
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "unknown");
    target(evidence)[name] = false;
    assert.equal(validatePaidCrmReadback(evidence, EXPECTED).status, "compatible");
  }
});

for (const [denied, value, peer] of [["apiUpdate", false, "readOnly"], ["readOnly", true, "apiUpdate"]]) {
  test(`denied ${denied} remains incompatible alongside an unknown peer capability`, () => {
    for (const malformed of [undefined, null, "false", 0, {}, []]) {
      const evidence = fixture();
      const field = evidence.fields.fields[1];
      field[denied] = value;
      if (malformed === undefined) delete field[peer];
      else field[peer] = malformed;
      const report = validatePaidCrmReadback(evidence, EXPECTED);
      assert.equal(report.status, "incompatible");
      assert.equal(report.checks.fields.status, "incompatible");
      assert.deepEqual(new Set(report.checks.fields.reasons),
        new Set(["field_update_unavailable", "field_update_capability_unknown"]));
    }
  });
}
