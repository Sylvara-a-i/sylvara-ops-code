"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { normalizePaidCrmMetadata } = require("../../../tools/normalize-paid-crm-metadata");
const { validatePaidCrmReadback } = require("../../../tools/validate-paid-crm-readback");

const EXPECTED = Object.freeze({
  organizationId: "synthetic-organization", layoutId: "synthetic-layout",
  notBefore: "2026-01-01T00:00:00.000Z", evaluatedAt: "2026-01-02T00:00:00.000Z",
  fields: [
    { apiName: "Plan", fieldId: "synthetic-plan-field", globalSetId: "synthetic-plan-global-set" },
    { apiName: "Subscription_Status", fieldId: "synthetic-status-field", globalSetId: "synthetic-status-global-set" },
  ],
});
const SECTIONS = ["globalSets", "fields", "rawOptions", "layout"];

function envelope(readbackId, details) {
  return { organizationId: EXPECTED.organizationId, moduleApiName: "Deals",
    source: "independent_readback", complete: true, readbackId,
    capturedAt: "2026-01-01T12:00:00.000Z", ...details };
}

function fixture(values = [["Option 1", "Option 2", "Pro"], ["Scheduled", "Active"]]) {
  const global = EXPECTED.fields.map((binding, index) => ({ globalSetId: binding.globalSetId,
    options: values[index].map((actualValue, option) => ({
      id: `synthetic-global-${index}-${option}`, actualValue, active: true,
    })) }));
  const fields = EXPECTED.fields.map((binding, index) => ({ ...binding, dataType: "picklist",
    ...(index === 1 ? { apiUpdate: true, readOnly: false } : {}),
    options: values[index].map((actualValue, option) => ({
      id: `synthetic-local-${index}-${option}`, actualValue, active: true,
    })) }));
  return {
    globalSets: envelope("synthetic-global-readback", { sets: global }),
    fields: envelope("synthetic-field-readback", { fields }),
    rawOptions: envelope("synthetic-raw-readback", { fields: EXPECTED.fields.map((binding, index) => ({
      ...binding, layoutId: EXPECTED.layoutId,
      options: global[index].options.flatMap((row, option) => [structuredClone(fields[index].options[option]),
        structuredClone(row)]),
    })) }),
    layout: envelope("synthetic-layout-readback", { layoutId: EXPECTED.layoutId, active: true,
      fields: EXPECTED.fields.map((binding, index) => ({ ...binding,
        ...(index === 1 ? { readOnly: false } : {}), options: structuredClone(fields[index].options),
      })) }),
  };
}

function localFixture(localNames = ["Plan"], values) {
  const readbacks = fixture(values);
  const expected = structuredClone(EXPECTED);
  for (const name of localNames) {
    const binding = expected.fields.find((field) => field.apiName === name);
    readbacks.globalSets.sets = readbacks.globalSets.sets.filter((set) => set.globalSetId !== binding.globalSetId);
    binding.globalSetId = null;
    for (const section of ["fields", "rawOptions", "layout"]) {
      readbacks[section].fields.find((field) => field.apiName === name).globalSetId = null;
    }
    readbacks.rawOptions.fields.find((field) => field.apiName === name).options =
      structuredClone(readbacks.fields.fields.find((field) => field.apiName === name).options);
  }
  return { readbacks, expected };
}

function assertRejected(readbacks, reason, expected = EXPECTED) {
  const report = normalizePaidCrmMetadata(readbacks, expected);
  assert.equal(report.status, "rejected");
  assert.equal(report.schemaVersion, "paid-crm-metadata-v1");
  assert.equal(report.fieldInventory, null);
  assert.equal(report.layoutInventory, null);
  assert.ok(report.reasons.length > 0);
  if (reason) assert.deepEqual(report.reasons, [reason]);
  return report;
}

function preflight(report) {
  const { fields, ...expected } = EXPECTED;
  return validatePaidCrmReadback(report.fieldInventory, { ...expected, principalId: "synthetic-runtime-principal" });
}

function optionArrays(value) {
  return [value.globalSets.sets, value.fields.fields, value.rawOptions.fields, value.layout.fields]
    .flatMap((rows) => rows.map((row) => row.options));
}

test("paired global and local IDs normalize to one option without changing duplicate rejection", () => {
  const readbacks = fixture();
  const report = normalizePaidCrmMetadata(readbacks, EXPECTED);
  assert.equal(report.status, "normalized");
  assert.deepEqual(report.reasons, []);
  assert.deepEqual(report.fieldInventory.picklists.fields.map((row) => row.options), [
    ["Option 1", "Option 2", "Pro"].map((actualValue) => ({ actualValue, active: true })),
    ["Scheduled", "Active"].map((actualValue) => ({ actualValue, active: true })),
  ]);
  assert.equal(report.layoutInventory.layoutId, EXPECTED.layoutId);
  assert.equal(preflight(report).checks.futureStatus.status, "compatible");
  assert.equal(preflight(report).checks.liveStatus.status, "compatible");
  const duplicate = structuredClone(report);
  const rows = duplicate.fieldInventory.picklists.fields[1].options;
  rows.push(structuredClone(rows[0]));
  assert.deepEqual(preflight(duplicate).checks.futureStatus,
    { status: "unknown", reasons: ["option_rows_malformed_or_duplicate"] });
});

test("explicit local Plan and paired status inventories normalize without deduplication", () => {
  const { readbacks, expected } = localFixture(["Plan"], [
    ["Option 1", "Option 2", "Pro", "synthetic-extra-plan", "synthetic-retired-plan"],
    ["Scheduled", "Active", ...Array.from({ length: 5 }, (_, index) => `synthetic-status-${index}`)],
  ]);
  for (const options of optionArrays(readbacks)) {
    for (const row of options) if (row.actualValue === "synthetic-retired-plan") row.active = false;
  }
  assert.deepEqual(readbacks.rawOptions.fields.map((field) => field.options.length), [5, 14]);
  assert.equal(readbacks.globalSets.sets.length, 1);
  const report = normalizePaidCrmMetadata(readbacks, expected);
  assert.equal(report.status, "normalized");
  assert.deepEqual(report.fieldInventory.picklists.fields.map((field) => field.options.length), [5, 7]);
  assert.deepEqual(report.fieldInventory.picklists.fields[0].options.at(-1),
    { actualValue: "synthetic-retired-plan", active: false });
  assert.equal(preflight(report).checks.plan.status, "compatible");
  assert.equal(preflight(report).checks.futureStatus.status, "compatible");
  assert.equal(preflight(report).checks.liveStatus.status, "compatible");
  assert.equal(preflight(report).status, "unknown");
  assert.equal(Object.hasOwn(report.fieldInventory, "effectiveLayout"), false);
  assert.equal(Object.hasOwn(report.fieldInventory, "permissions"), false);
});

test("both explicitly local fields require an independently complete empty global inventory", () => {
  const { readbacks, expected } = localFixture(["Plan", "Subscription_Status"]);
  assert.deepEqual(readbacks.globalSets.sets, []);
  assert.equal(normalizePaidCrmMetadata(readbacks, expected).status, "normalized");
  for (const mutate of [
    (value) => { delete value.globalSets; },
    (value) => { delete value.globalSets.sets; },
    (value) => { value.globalSets.complete = false; },
    (value) => { value.globalSets.sets = null; },
    (value) => { value.globalSets.readbackId = value.fields.readbackId; },
  ]) {
    const invalid = structuredClone(readbacks);
    mutate(invalid);
    assertRejected(invalid, undefined, expected);
  }
});

test("explicit local-only bindings apply independently to either field", () => {
  const { readbacks, expected } = localFixture(["Subscription_Status"]);
  assert.equal(readbacks.globalSets.sets[0].globalSetId, EXPECTED.fields[0].globalSetId);
  const report = normalizePaidCrmMetadata(readbacks, expected);
  assert.equal(report.status, "normalized");
  assert.deepEqual(report.fieldInventory.picklists.fields[1].options,
    ["Scheduled", "Active"].map((actualValue) => ({ actualValue, active: true })));
  for (const key of ["futureStatus", "liveStatus"]) assert.equal(preflight(report).checks[key].status, "compatible");
});

test("missing or malformed expected global binding never means local-only", () => {
  for (const index of [0, 1]) {
    for (const value of [undefined, "", " ", " synthetic-set", 0, false, [], {}]) {
      const { readbacks, expected } = localFixture(["Plan", "Subscription_Status"]);
      expected.fields[index].globalSetId = value;
      assertRejected(readbacks, "expected_scope_or_interval_invalid", expected);
    }
    const { readbacks, expected } = localFixture(["Plan", "Subscription_Status"]);
    delete expected.fields[index].globalSetId;
    assertRejected(readbacks, "expected_scope_or_interval_invalid", expected);
  }
});

test("every captured binding must explicitly match local-only or its bound global set", () => {
  for (const section of ["fields", "rawOptions", "layout"]) {
    for (const index of [0, 1]) {
      for (const value of [undefined, "", " ", 0, false, [], {}, "synthetic-other-set",
        index === 0 ? EXPECTED.fields[0].globalSetId : null]) {
        const { readbacks, expected } = localFixture();
        readbacks[section].fields[index].globalSetId = value;
        assertRejected(readbacks, undefined, expected);
      }
      const { readbacks, expected } = localFixture();
      delete readbacks[section].fields[index].globalSetId;
      assertRejected(readbacks, "field_rows_malformed_or_duplicate", expected);
    }
  }
});

test("global inventory contains exactly the distinct non-null expected bindings", () => {
  for (const mutate of [
    (value) => { value.globalSets.sets = []; },
    (value) => value.globalSets.sets.push(structuredClone(value.globalSets.sets[0])),
    (value) => value.globalSets.sets.push(structuredClone(fixture().globalSets.sets[0])),
    (value) => { value.globalSets.sets[0].globalSetId = null; },
    (value) => { value.globalSets.sets[0].globalSetId = EXPECTED.fields[0].globalSetId; },
  ]) {
    const { readbacks, expected } = localFixture();
    mutate(readbacks);
    assertRejected(readbacks, undefined, expected);
  }
  for (const section of ["fields", "rawOptions", "layout"]) {
    for (const key of ["fieldId", "globalSetId"]) {
      const readbacks = fixture();
      readbacks[section].fields[1][key] = readbacks[section].fields[0][key];
      assertRejected(readbacks, "field_rows_malformed_or_duplicate");
    }
  }
  const expected = structuredClone(EXPECTED);
  expected.fields[1].globalSetId = expected.fields[0].globalSetId;
  assertRejected(fixture(), "expected_scope_or_interval_invalid", expected);
});

test("local raw inventory requires each exact local ID once without global substitutes", () => {
  for (const mutate of [
    (rows) => rows.push(structuredClone(rows[0])),
    (rows) => rows.pop(),
    (rows) => { rows[0].id = "synthetic-global-0-0"; },
    (rows) => { rows[0].id = "synthetic-global-1-0"; },
    (rows) => { rows[0].id = "synthetic-local-1-0"; },
    (rows) => { rows[0].id = "synthetic-unknown-option"; },
    (rows) => rows.push({ ...rows[0], id: "synthetic-extra-id" }),
    (rows) => { rows[0].actualValue = "option 1"; },
    (rows) => { rows[0].active = false; },
  ]) {
    const { readbacks, expected } = localFixture();
    mutate(readbacks.rawOptions.fields[0].options);
    assertRejected(readbacks, undefined, expected);
  }
});

test("local inventory and configured layout retain strict IDs, values, statuses and completeness", () => {
  for (const section of ["fields", "layout"]) {
    for (const mutate of [
      (rows) => rows.push(structuredClone(rows[0])),
      (rows) => rows.push({ ...rows[0], id: "synthetic-extra-id" }),
      (rows) => rows.pop(),
      (rows) => { rows[0].id = "synthetic-global-1-0"; },
      (rows) => { rows[0].id = "synthetic-local-1-0"; },
      (rows) => { rows[0].actualValue = "option 1"; },
      (rows) => { rows[0].active = false; },
      (rows) => { rows[0].active = "true"; },
    ]) {
      const { readbacks, expected } = localFixture();
      mutate(readbacks[section].fields[0].options);
      assertRejected(readbacks, undefined, expected);
    }
  }
});

test("local normalization preserves missing, inactive and case-sensitive values without granting compatibility", () => {
  for (const mode of ["missing", "inactive", "case"]) {
    const { readbacks, expected } = localFixture(["Plan", "Subscription_Status"]);
    for (const section of ["fields", "rawOptions", "layout"]) {
      const status = readbacks[section].fields[1];
      if (mode === "missing") status.options = status.options.filter((row) => row.actualValue !== "Scheduled");
      else {
        const row = status.options.find((option) => option.actualValue === "Scheduled");
        if (mode === "inactive") row.active = false;
        else Object.assign(row, { actualValue: "scheduled", displayValue: "Scheduled" });
      }
    }
    const report = normalizePaidCrmMetadata(readbacks, expected);
    assert.equal(report.status, "normalized");
    assert.equal(preflight(report).checks.futureStatus.status, "incompatible");
    assert.equal(preflight(report).checks.liveStatus.status, "compatible");
    assert.equal(preflight(report).checks.effectiveLayout.status, "unknown");
    assert.equal(preflight(report).checks.permissions.status, "unknown");
  }
});

test("local normalization is immutable and deterministic while labels and row order stay descriptive", () => {
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    }
    return value;
  }
  const { readbacks, expected } = localFixture();
  for (const [index, rows] of optionArrays(readbacks).entries()) {
    rows.reverse();
    for (const row of rows) row.displayValue = `Synthetic shared label ${index}`;
  }
  for (const section of ["fields", "rawOptions", "layout"]) readbacks[section].fields.reverse();
  expected.fields.reverse();
  readbacks.globalSets.capturedAt = EXPECTED.notBefore;
  const before = JSON.stringify({ readbacks, expected });
  freeze(readbacks);
  freeze(expected);
  const report = normalizePaidCrmMetadata(readbacks, expected);
  assert.equal(report.status, "normalized");
  assert.deepEqual(normalizePaidCrmMetadata(readbacks, expected), report);
  assert.equal(JSON.stringify({ readbacks, expected }), before);
  assert.deepEqual(report.fieldInventory.picklists.fields.map((field) => field.options.length), [3, 2]);
  assert.equal(report.fieldInventory.picklists.capturedAt, EXPECTED.notBefore);
  assert.equal(report.layoutInventory.capturedAt, EXPECTED.notBefore);
  assert.equal(preflight(report).checks.plan.status, "compatible");
});

test("complete metadata never implies the effective runtime principal or its permissions", () => {
  const report = normalizePaidCrmMetadata(fixture(), EXPECTED);
  assert.equal(report.status, "normalized");
  assert.equal(Object.hasOwn(report.fieldInventory, "effectiveLayout"), false);
  assert.equal(Object.hasOwn(report.fieldInventory, "permissions"), false);
  assert.equal(Object.hasOwn(report.layoutInventory, "principalId"), false);
  const checked = preflight(report);
  assert.equal(checked.status, "unknown");
  for (const name of ["fields", "plan", "futureStatus", "liveStatus"]) {
    assert.equal(checked.checks[name].status, "compatible");
  }
  for (const name of ["effectiveLayout", "permissions"]) assert.equal(checked.checks[name].status, "unknown");
  const { fields, ...withoutPrincipal } = EXPECTED;
  const absentPrincipal = validatePaidCrmReadback(report.fieldInventory, withoutPrincipal);
  assert.equal(absentPrincipal.status, "unknown");
  for (const check of Object.values(absentPrincipal.checks)) assert.equal(check.status, "unknown");
});

test("independently supplied effective-layout and permission evidence remains required for compatibility", () => {
  const report = normalizePaidCrmMetadata(fixture(), EXPECTED);
  const principalId = "synthetic-runtime-principal";
  const { fields, ...expected } = EXPECTED;
  const common = { organizationId: EXPECTED.organizationId, moduleApiName: "Deals",
    source: "independent_readback", complete: true, capturedAt: "2026-01-01T13:00:00.000Z", principalId };
  const statusOptions = ["Scheduled", "Active"].map((actualValue) => ({ actualValue, active: true }));
  const evidence = { ...report.fieldInventory,
    effectiveLayout: { ...common, matches: [{ layoutId: EXPECTED.layoutId, active: true, fields: [
      { apiName: "Plan", options: ["Option 1", "Option 2", "Pro"].map((actualValue) => ({ actualValue, active: true })) },
      { apiName: "Subscription_Status", readOnly: false, options: statusOptions },
    ] }] },
    permissions: { ...common, layoutId: EXPECTED.layoutId, moduleRead: true, moduleUpdate: true, fields: [
      { apiName: "Plan", read: true }, { apiName: "Subscription_Status", read: true, update: true },
    ] },
  };
  assert.equal(validatePaidCrmReadback(evidence, { ...expected, principalId }).status, "compatible");
  evidence.effectiveLayout.principalId = "synthetic-other-principal";
  assert.equal(validatePaidCrmReadback(evidence, { ...expected, principalId }).status, "unknown");
});

test("consistently missing Scheduled stays missing while Active remains available", () => {
  const readbacks = fixture();
  for (const rows of [readbacks.globalSets.sets, readbacks.fields.fields,
    readbacks.rawOptions.fields, readbacks.layout.fields]) {
    rows[1].options = rows[1].options.filter((option) => option.actualValue !== "Scheduled");
  }
  const report = normalizePaidCrmMetadata(readbacks, EXPECTED);
  assert.equal(report.status, "normalized");
  const checked = preflight(report);
  assert.equal(checked.status, "incompatible");
  assert.deepEqual(checked.checks.futureStatus,
    { status: "incompatible", reasons: ["required_api_value_unavailable"] });
  assert.equal(checked.checks.liveStatus.status, "compatible");
});

test("coherent inactive options are preserved without granting availability", () => {
  const readbacks = fixture();
  for (const options of optionArrays(readbacks)) {
    for (const option of options) if (option.actualValue === "Scheduled") option.active = false;
  }
  const report = normalizePaidCrmMetadata(readbacks, EXPECTED);
  assert.equal(report.status, "normalized");
  assert.equal(preflight(report).checks.futureStatus.status, "incompatible");
});

test("each independent inventory rejects repeated IDs and repeated API values", () => {
  for (const select of [(value) => value.globalSets.sets, (value) => value.fields.fields,
    (value) => value.layout.fields]) {
    for (const mutate of [
      (rows) => rows.push(structuredClone(rows[0])),
      (rows) => rows.push({ ...rows[0], id: "synthetic-extra-id" }),
      (rows) => { rows[1].id = rows[0].id; },
    ]) {
      const readbacks = fixture();
      mutate(select(readbacks)[0].options);
      assertRejected(readbacks);
    }
  }
  const readbacks = fixture();
  readbacks.fields.fields[0].options[0].id = readbacks.globalSets.sets[0].options[0].id;
  assertRejected(readbacks, "inventory_id_ambiguous");
});

test("raw options must match every namespace row exactly once", () => {
  for (const mutate of [
    (rows) => rows.push(structuredClone(rows[0])),
    (rows) => rows.splice(0, 1),
    (rows) => { rows[0].id = "synthetic-unknown-option"; },
    (rows) => { rows[0].id = rows[1].id; },
  ]) {
    const readbacks = fixture();
    mutate(readbacks.rawOptions.fields[1].options);
    assertRejected(readbacks);
  }
  const readbacks = fixture();
  readbacks.rawOptions.fields[0].options[0].id = readbacks.fields.fields[1].options[0].id;
  assertRejected(readbacks, "raw_option_id_unknown_or_wrong_namespace");
});

test("stored API values and statuses must agree across every matched source", () => {
  for (const select of [
    (value) => value.globalSets.sets[1].options[0], (value) => value.fields.fields[1].options[0],
    (value) => value.rawOptions.fields[1].options[0], (value) => value.layout.fields[1].options[0],
  ]) {
    for (const patch of [{ active: false }, { actualValue: "synthetic-contradictory-value" }]) {
      const readbacks = fixture();
      Object.assign(select(readbacks), patch);
      assertRejected(readbacks);
    }
  }
  const readbacks = fixture();
  readbacks.globalSets.sets[1].options[0].active = false;
  readbacks.rawOptions.fields[1].options.find((row) => row.id === "synthetic-global-1-0").active = false;
  assertRejected(readbacks, "global_field_inventory_contradiction");
});

test("layout options require exact local IDs and complete field inventory", () => {
  for (const id of ["synthetic-global-0-0", "synthetic-local-1-0", "synthetic-unknown-layout-option"]) {
    const readbacks = fixture();
    readbacks.layout.fields[0].options[0].id = id;
    assertRejected(readbacks, "layout_option_id_unknown_or_wrong_namespace");
  }
  const readbacks = fixture();
  readbacks.layout.fields[1].options.pop();
  assertRejected(readbacks, "layout_inventory_incomplete");
});

test("field, global-set and configured-layout bindings cannot be substituted", () => {
  for (const select of [(value) => value.fields.fields[0], (value) => value.rawOptions.fields[0],
    (value) => value.layout.fields[0]]) {
    for (const key of ["fieldId", "globalSetId"]) {
      const readbacks = fixture();
      select(readbacks)[key] = "synthetic-other-binding";
      assertRejected(readbacks, "field_or_global_set_binding_mismatch");
    }
  }
  for (const select of [(value) => value.layout, (value) => value.rawOptions.fields[0]]) {
    const readbacks = fixture();
    select(readbacks).layoutId = "synthetic-other-layout";
    assertRejected(readbacks, "layout_scope_or_state_invalid");
  }
});

test("every capture independently requires scope, provenance, completeness and caller-bounded freshness", () => {
  for (const section of SECTIONS) {
    for (const patch of [
      { organizationId: "synthetic-other-organization" }, { moduleApiName: "Leads" },
      { source: "proposed_change" }, { complete: false }, { readbackId: undefined }, { readbackId: " " },
      { capturedAt: "2026-01-01T12:00:00Z" }, { capturedAt: "2025-12-31T23:59:59.999Z" },
      { capturedAt: "2026-01-02T00:00:00.001Z" },
    ]) {
      const readbacks = fixture();
      Object.assign(readbacks[section], patch);
      assertRejected(readbacks);
    }
    const absent = fixture();
    delete absent[section];
    assertRejected(absent, "readback_missing_or_malformed");
  }
  const readbacks = fixture();
  readbacks.rawOptions.readbackId = readbacks.fields.readbackId;
  assertRejected(readbacks, "readback_provenance_reused");
  for (const capturedAt of [EXPECTED.notBefore, EXPECTED.evaluatedAt]) {
    const boundary = fixture();
    for (const section of SECTIONS) boundary[section].capturedAt = capturedAt;
    assert.equal(normalizePaidCrmMetadata(boundary, EXPECTED).status, "normalized");
  }
});

test("malformed expected scope, field bindings and intervals reject without partial inventory", () => {
  for (const expected of [null, [], {}, { ...EXPECTED, organizationId: " " },
    { ...EXPECTED, layoutId: null }, { ...EXPECTED, fields: [EXPECTED.fields[0], EXPECTED.fields[0]] },
    { ...EXPECTED, fields: EXPECTED.fields.slice(0, 1) }, { ...EXPECTED, notBefore: "invalid" },
    { ...EXPECTED, notBefore: EXPECTED.evaluatedAt, evaluatedAt: EXPECTED.notBefore },
    { ...EXPECTED, principalId: "synthetic-unproven-principal" }]) {
    assertRejected(fixture(), "expected_scope_or_interval_invalid", expected);
  }
});

test("malformed values and unrelated data reject at every object boundary", () => {
  for (const select of [
    (value) => value, ...SECTIONS.map((name) => (value) => value[name]),
    (value) => value.globalSets.sets[0], (value) => value.fields.fields[0],
    (value) => value.rawOptions.fields[0], (value) => value.layout.fields[0],
    (value) => value.globalSets.sets[0].options[0], (value) => value.fields.fields[0].options[0],
    (value) => value.rawOptions.fields[0].options[0], (value) => value.layout.fields[0].options[0],
  ]) {
    const readbacks = fixture();
    select(readbacks).records = [{ name: "synthetic-private-marker" }];
    assert.equal(JSON.stringify(assertRejected(readbacks)).includes("synthetic-private-marker"), false);
  }
  for (const patch of [{ id: 1 }, { id: " " }, { actualValue: null }, { active: "true" }, { displayValue: null }]) {
    for (let index = 0; index < optionArrays(fixture()).length; index += 1) {
      const readbacks = fixture();
      Object.assign(optionArrays(readbacks)[index][0], patch);
      assertRejected(readbacks);
    }
  }
});

test("malformed sections, field rows and option rows reject without throwing", () => {
  for (const invalid of [null, [], {}, "synthetic-malformed-value"]) {
    assertRejected(invalid);
    for (const section of SECTIONS) {
      const readbacks = fixture();
      readbacks[section] = invalid;
      assertRejected(readbacks);
    }
    for (const select of [(value) => value.globalSets.sets, (value) => value.fields.fields,
      (value) => value.rawOptions.fields, (value) => value.layout.fields]) {
      const readbacks = fixture();
      select(readbacks)[0] = invalid;
      assertRejected(readbacks);
    }
    for (let index = 0; index < optionArrays(fixture()).length; index += 1) {
      const readbacks = fixture();
      optionArrays(readbacks)[index][0] = invalid;
      assertRejected(readbacks);
    }
  }
});

test("missing or malformed inventory arrays cannot be mistaken for complete readback", () => {
  for (const invalid of [undefined, null, {}, "synthetic-malformed-array", []]) {
    for (const section of SECTIONS) {
      const readbacks = fixture();
      readbacks[section][section === "globalSets" ? "sets" : "fields"] = invalid;
      assertRejected(readbacks);
    }
    for (let index = 0; index < optionArrays(fixture()).length; index += 1) {
      const readbacks = fixture();
      const rows = [readbacks.globalSets.sets, readbacks.fields.fields,
        readbacks.rawOptions.fields, readbacks.layout.fields].flat();
      rows[index].options = invalid;
      assertRejected(readbacks);
    }
  }
});

test("labels and row order cannot determine ID namespaces or API values", () => {
  const readbacks = fixture();
  for (const [index, rows] of optionArrays(readbacks).entries()) {
    rows.reverse();
    for (const row of rows) row.displayValue = `Synthetic display label ${index}`;
  }
  readbacks.globalSets.sets.reverse();
  readbacks.fields.fields.reverse();
  readbacks.rawOptions.fields.reverse();
  readbacks.layout.fields.reverse();
  const report = normalizePaidCrmMetadata(readbacks, EXPECTED);
  assert.equal(report.status, "normalized");
  assert.equal(preflight(report).checks.plan.status, "compatible");
  assert.equal(preflight(report).checks.futureStatus.status, "compatible");
});

test("display labels never repair a consistently wrong stored API value", () => {
  const readbacks = fixture();
  for (const options of optionArrays(readbacks)) {
    for (const option of options) {
      if (option.actualValue === "Option 1") Object.assign(option, { actualValue: "Launch", displayValue: "Option 1" });
    }
  }
  const report = normalizePaidCrmMetadata(readbacks, EXPECTED);
  assert.equal(report.status, "normalized");
  assert.equal(preflight(report).checks.plan.status, "incompatible");
});

test("normalization is deterministic, preserves the oldest capture and does not mutate frozen inputs", () => {
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    }
    return value;
  }
  const readbacks = fixture();
  readbacks.rawOptions.capturedAt = EXPECTED.notBefore;
  const before = JSON.stringify(readbacks);
  freeze(readbacks);
  const expected = freeze(structuredClone(EXPECTED));
  const report = normalizePaidCrmMetadata(readbacks, expected);
  assert.equal(report.status, "normalized");
  assert.deepEqual(normalizePaidCrmMetadata(readbacks, expected), report);
  assert.equal(JSON.stringify(readbacks), before);
  assert.equal(report.fieldInventory.fields.capturedAt, EXPECTED.notBefore);
  assert.equal(report.fieldInventory.picklists.capturedAt, EXPECTED.notBefore);
  assert.equal(report.layoutInventory.capturedAt, EXPECTED.notBefore);
  for (const excluded of ["synthetic-global-1-0", "synthetic-local-1-0", "synthetic-plan-field",
    "synthetic-plan-global-set", "synthetic-global-readback"]) {
    assert.equal(JSON.stringify(report).includes(excluded), false);
  }
});

test("source loads and normalizes with no IO, environment, provider or clock access", () => {
  const source = fs.readFileSync(require.resolve("../../../tools/normalize-paid-crm-metadata"), "utf8");
  const accesses = [];
  const sandbox = { module: { exports: {} }, exports: {} };
  for (const name of ["require", "process", "fetch", "console", "setTimeout", "setInterval",
    "setImmediate", "queueMicrotask", "XMLHttpRequest", "WebSocket"]) {
    Object.defineProperty(sandbox, name, { get() { accesses.push(name); throw new Error(`Forbidden ${name}`); } });
  }
  sandbox.Date = class extends Date {
    constructor(...args) {
      assert.notEqual(args.length, 0, "normalizer cannot read the current clock");
      super(...args);
    }
    static now() { throw new Error("normalizer cannot read the current clock"); }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const output = vm.runInContext(`JSON.stringify(module.exports.normalizePaidCrmMetadata(
    ${JSON.stringify(fixture())}, ${JSON.stringify(EXPECTED)}))`, context);
  assert.equal(JSON.parse(output).status, "normalized");
  assert.deepEqual(accesses, []);
});
