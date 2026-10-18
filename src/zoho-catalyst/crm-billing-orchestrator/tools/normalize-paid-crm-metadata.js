"use strict";

const FIELDS = Object.freeze(["Plan", "Subscription_Status"]);
const SECTIONS = Object.freeze(["globalSets", "fields", "rawOptions", "layout"]);

function shape(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function time(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function reject(reason) {
  return { schemaVersion: "paid-crm-metadata-v1", status: "rejected", reasons: [reason],
    fieldInventory: null, layoutInventory: null };
}

function unique(rows, key) {
  return new Set(rows.map((row) => row[key])).size === rows.length;
}

function fieldRows(rows, keys) {
  return Array.isArray(rows) && rows.length === FIELDS.length &&
    rows.every((row) => shape(row, ["apiName", "fieldId", "globalSetId", ...keys]) &&
      FIELDS.includes(row.apiName) && text(row.fieldId) && Object.hasOwn(row, "globalSetId") &&
      (row.globalSetId === null || text(row.globalSetId))) &&
    ["apiName", "fieldId"].every((key) => unique(rows, key)) &&
    unique(rows.filter((row) => row.globalSetId !== null), "globalSetId");
}

function flags(row, keys) {
  return keys.every((key) => !Object.hasOwn(row, key) || typeof row[key] === "boolean");
}

function options(rows, inventory) {
  return Array.isArray(rows) && rows.every((row) =>
    shape(row, ["id", "actualValue", "displayValue", "active"]) && text(row.id) &&
    text(row.actualValue) && typeof row.active === "boolean" &&
    (!Object.hasOwn(row, "displayValue") || text(row.displayValue))) &&
    unique(rows, "id") && (!inventory || unique(rows, "actualValue"));
}

function sameOption(left, right) {
  // Labels can differ by localization or source. Stored values and status cannot.
  return left.actualValue === right.actualValue && left.active === right.active;
}

function projectOption(row) {
  return { actualValue: row.actualValue, active: row.active,
    ...(Object.hasOwn(row, "displayValue") ? { displayValue: row.displayValue } : {}) };
}

function projectFlags(row, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
}

/**
 * Reconcile four separately captured, allowlisted metadata projections offline.
 * The caller supplies verified bindings and a bounded observation interval.
 * This checks consistency, not collector authenticity or runtime permissions.
 * No IO, clock read, provider client, credential input, or runtime integration.
 */
function normalizePaidCrmMetadata(readbacks, expected) {
  if (!shape(expected, ["organizationId", "layoutId", "notBefore", "evaluatedAt", "fields"]) ||
      !text(expected.organizationId) || !text(expected.layoutId) ||
      !Number.isFinite(time(expected.notBefore)) || !Number.isFinite(time(expected.evaluatedAt)) ||
      time(expected.notBefore) > time(expected.evaluatedAt) || !fieldRows(expected.fields, [])) {
    return reject("expected_scope_or_interval_invalid");
  }
  if (!shape(readbacks, SECTIONS)) return reject("readbacks_missing_or_malformed");
  const sectionKeys = { globalSets: ["sets"], fields: ["fields"], rawOptions: ["fields"],
    layout: ["layoutId", "active", "fields"] };
  const readbackIds = new Set();
  for (const name of SECTIONS) {
    const section = readbacks[name];
    if (!shape(section, ["organizationId", "moduleApiName", "source", "readbackId", "complete", "capturedAt",
      ...sectionKeys[name]])) return reject("readback_missing_or_malformed");
    if (section.organizationId !== expected.organizationId || section.moduleApiName !== "Deals") {
      return reject("readback_scope_mismatch");
    }
    if (section.source !== "independent_readback" || section.complete !== true || !text(section.readbackId)) {
      return reject("independent_complete_readback_required");
    }
    if (readbackIds.has(section.readbackId)) return reject("readback_provenance_reused");
    readbackIds.add(section.readbackId);
    const captured = time(section.capturedAt);
    if (!Number.isFinite(captured)) return reject("capture_time_invalid");
    if (captured < time(expected.notBefore) || captured > time(expected.evaluatedAt)) {
      return reject("readback_outside_observation_interval");
    }
  }

  const { globalSets, fields, rawOptions, layout } = readbacks;
  const globalBindingCount = expected.fields.filter((field) => field.globalSetId !== null).length;
  if (!Array.isArray(globalSets.sets) || globalSets.sets.length !== globalBindingCount ||
      globalSets.sets.some((set) => !shape(set, ["globalSetId", "options"]) || !text(set.globalSetId)) ||
      !unique(globalSets.sets, "globalSetId")) return reject("global_sets_malformed_or_duplicate");
  if (!fieldRows(fields.fields, ["dataType", "apiUpdate", "readOnly", "options"]) ||
      fields.fields.some((field) => !text(field.dataType) || !flags(field, ["apiUpdate", "readOnly"])) ||
      !fieldRows(rawOptions.fields, ["layoutId", "options"]) ||
      !fieldRows(layout.fields, ["readOnly", "options"]) ||
      layout.fields.some((field) => !flags(field, ["readOnly"]))) {
    return reject("field_rows_malformed_or_duplicate");
  }
  if (layout.layoutId !== expected.layoutId || typeof layout.active !== "boolean" ||
      rawOptions.fields.some((field) => field.layoutId !== expected.layoutId)) {
    return reject("layout_scope_or_state_invalid");
  }

  // No ID may identify multiple inventory rows, even across fields/namespaces.
  const inventoryIds = new Set();
  for (const inventory of [...globalSets.sets, ...fields.fields]) {
    if (!options(inventory.options, true)) return reject("inventory_options_malformed_or_duplicate");
    for (const row of inventory.options) {
      if (inventoryIds.has(row.id)) return reject("inventory_id_ambiguous");
      inventoryIds.add(row.id);
    }
  }
  const rawIds = new Set();
  const layoutIds = new Set();
  for (const name of FIELDS) {
    const binding = expected.fields.find((field) => field.apiName === name);
    const field = fields.fields.find((row) => row.apiName === name);
    const raw = rawOptions.fields.find((row) => row.apiName === name);
    const configured = layout.fields.find((row) => row.apiName === name);
    // Explicit null is verified local-only scope, never a missing global binding.
    const global = binding.globalSetId === null ? null :
      globalSets.sets.find((set) => set.globalSetId === binding.globalSetId);
    if (global === undefined || [field, raw, configured].some((row) => row.fieldId !== binding.fieldId ||
        row.globalSetId !== binding.globalSetId)) return reject("field_or_global_set_binding_mismatch");
    if (!options(raw.options, false) || !options(configured.options, true)) {
      return reject("raw_or_layout_options_malformed_or_duplicate");
    }
    const globalOptions = global === null ? [] : global.options;
    const globalById = new Map(globalOptions.map((row) => [row.id, row]));
    const fieldById = new Map(field.options.map((row) => [row.id, row]));
    const globalByValue = new Map(globalOptions.map((row) => [row.actualValue, row]));
    if (global !== null && (globalOptions.length !== field.options.length || field.options.some((row) =>
      !globalByValue.has(row.actualValue) || !sameOption(row, globalByValue.get(row.actualValue))))) {
      return reject("global_field_inventory_contradiction");
    }
    for (const row of raw.options) {
      if (rawIds.has(row.id)) return reject("raw_option_id_duplicate");
      rawIds.add(row.id);
      // Resolve by ID against this field's inventories, never by value or ID form.
      const match = globalById.get(row.id) || fieldById.get(row.id);
      if (!match) return reject("raw_option_id_unknown_or_wrong_namespace");
      if (!sameOption(row, match)) return reject("raw_option_contradiction");
    }
    if (raw.options.length !== globalOptions.length + field.options.length) {
      return reject("raw_namespace_inventory_incomplete");
    }
    for (const row of configured.options) {
      if (layoutIds.has(row.id)) return reject("layout_option_id_duplicate");
      layoutIds.add(row.id);
      const match = fieldById.get(row.id);
      if (!match) return reject("layout_option_id_unknown_or_wrong_namespace");
      if (!sameOption(row, match)) return reject("layout_option_contradiction");
    }
    if (configured.options.length !== field.options.length) return reject("layout_inventory_incomplete");
  }

  // All contributing captures were checked; retain the oldest for the projection.
  const capturedAt = SECTIONS.map((name) => readbacks[name].capturedAt).sort()[0];
  const envelope = { organizationId: expected.organizationId, moduleApiName: "Deals",
    source: "independent_readback", complete: true, capturedAt };
  const orderedFields = FIELDS.map((name) => fields.fields.find((field) => field.apiName === name));
  return { schemaVersion: "paid-crm-metadata-v1", status: "normalized", reasons: [],
    fieldInventory: {
      fields: { ...envelope, fields: orderedFields.map((field) => ({ apiName: field.apiName,
        dataType: field.dataType, ...projectFlags(field, ["apiUpdate", "readOnly"]) })) },
      picklists: { ...envelope, fields: orderedFields.map((field) => ({ apiName: field.apiName,
        options: field.options.map(projectOption) })) },
    },
    // Configured metadata cannot attest the executing principal's effective layout.
    layoutInventory: { ...envelope, layoutId: layout.layoutId, active: layout.active,
      fields: FIELDS.map((name) => {
        const field = layout.fields.find((row) => row.apiName === name);
        return { apiName: name, ...projectFlags(field, ["readOnly"]), options: field.options.map(projectOption) };
      }) },
  };
}

module.exports = { normalizePaidCrmMetadata };
