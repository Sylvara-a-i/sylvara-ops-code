"use strict";

// Source-only projection of the immutable runtime crosswalks. Behavioral parity
// tests pin these values without loading runtime clients or configuration here.
const PLAN = Object.freeze({ "Option 1": "Launch", "Option 2": "Growth", Pro: "Scale" });
const STATUS = Object.freeze({ future: "Scheduled", live: "Active" });
const FIELDS = Object.freeze(["Plan", "Subscription_Status"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function shape(value, keys) {
  return object(value) && Object.keys(value).every((key) => keys.includes(key));
}

function text(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function time(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : NaN;
}

function result(status, reason) {
  return { status, reasons: reason ? [reason] : [] };
}

function combine(checks) {
  return {
    status: checks.some((check) => check.status === "incompatible") ? "incompatible"
      : checks.some((check) => check.status === "unknown") ? "unknown" : "compatible",
    reasons: [...new Set(checks.flatMap((check) => check.reasons))],
  };
}

function envelope(section, expected, keys) {
  if (!shape(section, ["organizationId", "moduleApiName", "source", "complete", "capturedAt", ...keys])) {
    return result("unknown", "evidence_missing_or_malformed");
  }
  if (section.organizationId !== expected.organizationId || section.moduleApiName !== "Deals") {
    return result("unknown", "evidence_scope_mismatch");
  }
  if (section.source !== "independent_readback" || section.complete !== true) {
    return result("unknown", "independent_complete_readback_required");
  }
  const captured = time(section.capturedAt);
  if (!Number.isFinite(captured)) return result("unknown", "capture_time_invalid");
  if (captured < time(expected.notBefore) || captured > time(expected.evaluatedAt)) {
    return result("unknown", "evidence_outside_observation_interval");
  }
  return null;
}

function rowsByField(rows, keys) {
  if (!Array.isArray(rows) || rows.some((row) => !shape(row, ["apiName", ...keys]) || !text(row.apiName)) ||
      new Set(rows.map((row) => row.apiName)).size !== rows.length) return null;
  return new Map(rows.map((row) => [row.apiName, row]));
}

function malformedFlags(row, keys) {
  return keys.some((key) => Object.hasOwn(row, key) && typeof row[key] !== "boolean");
}

function checkFields(section, expected) {
  const invalid = envelope(section, expected, ["fields"]);
  if (invalid) return invalid;
  const fields = rowsByField(section.fields, ["dataType", "apiUpdate", "readOnly"]);
  if (!fields) return result("unknown", "field_rows_malformed_or_duplicate");
  return combine(FIELDS.map((name) => {
    const field = fields.get(name);
    if (!field) return result("incompatible", "required_field_missing");
    const checks = [!text(field.dataType) ? result("unknown", "field_type_unknown")
      : field.dataType === "picklist" ? result("compatible") : result("incompatible", "field_type_mismatch")];
    if (name === "Subscription_Status") {
      // Each capability is independent: an unknown peer cannot hide a proved denial.
      for (const [flag, allowed] of [[field.apiUpdate, true], [field.readOnly, false]]) {
        checks.push(typeof flag !== "boolean" ? result("unknown", "field_update_capability_unknown")
          : flag === allowed ? result("compatible") : result("incompatible", "field_update_unavailable"));
      }
    } else if (malformedFlags(field, ["apiUpdate", "readOnly"])) {
      checks.push(result("unknown", "field_update_capability_unknown"));
    }
    return combine(checks);
  }));
}

function checkOptions(rows, required) {
  if (!Array.isArray(rows) || rows.some((row) => !shape(row, ["actualValue", "displayValue", "active"]) || !text(row.actualValue) ||
      typeof row.active !== "boolean" ||
      (Object.hasOwn(row, "displayValue") && !text(row.displayValue))) ||
      new Set(rows.map((row) => row.actualValue)).size !== rows.length) {
    return result("unknown", "option_rows_malformed_or_duplicate");
  }
  // Display labels are deliberately never used to select a stored API value.
  return required.every((value) => rows.some((row) => row.actualValue === value && row.active))
    ? result("compatible") : result("incompatible", "required_api_value_unavailable");
}

function checkPicklist(section, expected, field, required) {
  const invalid = envelope(section, expected, ["fields"]);
  if (invalid) return invalid;
  const fields = rowsByField(section.fields, ["options"]);
  if (!fields) return result("unknown", "picklist_fields_malformed_or_duplicate");
  if (!fields.has(field)) return result("unknown", "picklist_readback_missing");
  return checkOptions(fields.get(field).options, required);
}

function checkLayout(section, expected) {
  const invalid = envelope(section, expected, ["principalId", "matches"]);
  if (invalid) return invalid;
  if (section.principalId !== expected.principalId) return result("unknown", "layout_scope_mismatch");
  if (!Array.isArray(section.matches) || section.matches.length !== 1 || !shape(section.matches[0], ["layoutId", "active", "fields"])) {
    return result("unknown", "effective_layout_missing_or_ambiguous");
  }
  const layout = section.matches[0];
  if (layout.layoutId !== expected.layoutId) return result("unknown", "layout_scope_mismatch");
  if (typeof layout.active !== "boolean") return result("unknown", "layout_active_unknown");
  if (!layout.active) return result("incompatible", "effective_layout_inactive");
  const fields = rowsByField(layout.fields, ["readOnly", "options"]);
  if (!fields) return result("unknown", "layout_fields_malformed_or_duplicate");
  return combine(FIELDS.map((name) => {
    const field = fields.get(name);
    if (!field) return result("incompatible", "layout_field_missing");
    if (malformedFlags(field, ["readOnly"])) return result("unknown", "layout_field_access_unknown");
    if (name === "Subscription_Status") {
      if (typeof field.readOnly !== "boolean") return result("unknown", "layout_field_access_unknown");
      if (field.readOnly) return result("incompatible", "layout_field_read_only");
    }
    return checkOptions(field.options, name === "Plan" ? Object.keys(PLAN) : Object.values(STATUS));
  }));
}

function checkPermissions(section, expected) {
  const invalid = envelope(section, expected, ["principalId", "layoutId", "moduleRead", "moduleUpdate", "fields"]);
  if (invalid) return invalid;
  if (section.principalId !== expected.principalId || section.layoutId !== expected.layoutId) {
    return result("unknown", "permission_scope_mismatch");
  }
  const fields = rowsByField(section.fields, ["read", "update"]);
  if (!fields) return result("unknown", "permission_fields_malformed_or_duplicate");
  const flags = [section.moduleRead, section.moduleUpdate,
    fields.get("Plan")?.read, fields.get("Subscription_Status")?.read,
    fields.get("Subscription_Status")?.update];
  const checks = flags.map((flag) => typeof flag !== "boolean"
    ? result("unknown", "permissions_unknown")
    : flag ? result("compatible") : result("incompatible", "required_permission_denied"));
  if ([...fields.values()].some((field) => malformedFlags(field, ["read", "update"]))) {
    checks.push(result("unknown", "permissions_unknown"));
  }
  return combine(checks);
}

/**
 * Validate normalized JSON metadata collected independently of a proposed change.
 * The trusted caller supplies organization, effective layout, executing principal,
 * and an explicit observation interval; no provider-specific age is invented.
 * No record/credential input, IO, environment access, clock reads, or runtime hook.
 * Compatibility is limited to these two paid CRM fields, never launch readiness.
 */
function validatePaidCrmReadback(evidence, expected) {
  const validExpected = shape(expected, ["organizationId", "layoutId", "principalId", "notBefore", "evaluatedAt"]) &&
    [expected.organizationId, expected.layoutId, expected.principalId].every(text) &&
    Number.isFinite(time(expected.notBefore)) && Number.isFinite(time(expected.evaluatedAt)) &&
    time(expected.notBefore) <= time(expected.evaluatedAt);
  const validEvidence = object(evidence) &&
    Object.keys(evidence).every((key) => ["fields", "picklists", "effectiveLayout", "permissions"].includes(key));
  const unavailable = !validExpected ? result("unknown", "expected_scope_or_interval_invalid")
    : !validEvidence ? result("unknown", "evidence_missing_or_malformed") : null;
  const checks = {
    fields: unavailable || checkFields(evidence.fields, expected),
    plan: unavailable || checkPicklist(evidence.picklists, expected, "Plan", Object.keys(PLAN)),
    futureStatus: unavailable || checkPicklist(evidence.picklists, expected, "Subscription_Status", [STATUS.future]),
    liveStatus: unavailable || checkPicklist(evidence.picklists, expected, "Subscription_Status", [STATUS.live]),
    effectiveLayout: unavailable || checkLayout(evidence.effectiveLayout, expected),
    permissions: unavailable || checkPermissions(evidence.permissions, expected),
  };
  return {
    schemaVersion: "paid-crm-readback-v1",
    scope: "paid_crm_plan_and_subscription_status_only",
    status: combine(Object.values(checks)).status,
    checks,
  };
}

module.exports = { validatePaidCrmReadback };
