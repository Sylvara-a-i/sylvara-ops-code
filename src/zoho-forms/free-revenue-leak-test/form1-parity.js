"use strict";

const SHARED_PROPERTIES = Object.freeze([
  "type",
  "required",
  "maximum_length",
  "validation",
  "classification",
  "crm_destination",
  "webhook_key",
]);

function add(errors, code, field = null, property = null) {
  errors.push(Object.freeze({ code, field, property }));
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

function form1From(manifest) {
  return manifest?.forms?.find((form) =>
    form.logical_name === "REVENUE_LEAK_TEST_REQUEST_FORM");
}

/**
 * Checks repository policy without inspecting provider identifiers or private values.
 * Callers receive stable mismatch codes rather than observed values so this result is
 * safe to retain in sanitized release evidence.
 */
function verifyCanonicalForm1(manifest, executableContract) {
  const errors = [];
  const form1 = form1From(manifest);
  if (!form1) return Object.freeze({ ok: false, errors: [{ code: "FORM1_MISSING", field: null, property: null }] });

  const fields = form1.shared_field_schema;
  if (!Array.isArray(fields) || fields.length !== 22) {
    add(errors, "SHARED_FIELD_COUNT", null, "shared_field_schema");
    return Object.freeze({ ok: false, errors });
  }
  for (const property of ["key", "webhook_key", "crm_destination", "alias_reference"]) {
    for (const selected of duplicates(fields.map((field) => field[property]))) {
      add(errors, "DUPLICATE_SHARED_VALUE", selected || null, property);
    }
  }
  for (const field of fields) {
    if (field.key !== field.webhook_key) add(errors, "WEBHOOK_KEY_DRIFT", field.key, "webhook_key");
    if (!Array.isArray(field.applicable_channels) ||
      field.applicable_channels.join("|") !== "public|crm_assisted") {
      add(errors, "CHANNEL_APPLICABILITY_DRIFT", field.key, "applicable_channels");
    }
    if (typeof field.alias_reference !== "string" ||
      !field.alias_reference.startsWith("private_provider_alias:")) {
      add(errors, "PRIVATE_ALIAS_REFERENCE_INVALID", field.key, "alias_reference");
    }
  }

  const expectedFormKeys = [...executableContract.formKeys];
  if (fields.map(({ key }) => key).join("|") !== expectedFormKeys.join("|")) {
    add(errors, "EXECUTABLE_FORM_KEYS_DRIFT", null, "shared_field_schema");
  }
  const sourceSpecs = new Map(executableContract.fieldSpecs.map(
    ([key, crmDestination, maximumLength, required]) =>
      [key, { crmDestination, maximumLength, required }],
  ));
  for (const field of fields.filter(({ key }) => key !== "contactConsent")) {
    const source = sourceSpecs.get(field.key);
    if (!source) {
      add(errors, "EXECUTABLE_FIELD_MISSING", field.key, null);
      continue;
    }
    if (field.crm_destination !== source.crmDestination) {
      add(errors, "CRM_DESTINATION_DRIFT", field.key, "crm_destination");
    }
    if (field.maximum_length !== source.maximumLength) {
      add(errors, "MAXIMUM_LENGTH_DRIFT", field.key, "maximum_length");
    }
    if (field.required !== source.required) {
      add(errors, "REQUIRED_POLICY_DRIFT", field.key, "required");
    }
  }
  const consent = fields.find(({ key }) => key === "contactConsent");
  if (!consent || consent.type !== "boolean" || consent.required !== true ||
    consent.validation !== "exact_boolean_true_no_prefill") {
    add(errors, "CONSENT_POLICY_DRIFT", "contactConsent", "validation");
  }
  const expectedServerAuthority = {
    public: "trusted native-writer input configured outside respondent authority",
    crm_assisted: "browser value ignored; server-owned trusted constant",
  };
  for (const key of ["leadSource", "sourcePage"]) {
    const field = fields.find((candidate) => candidate.key === key);
    if (JSON.stringify(field?.channel_authority) !== JSON.stringify(expectedServerAuthority)) {
      add(errors, "SERVER_AUTHORITY_DRIFT", key, "channel_authority");
    }
  }

  const expectedTransport = [...executableContract.submissionKeys];
  const configuredTransport = form1.assisted_prefill?.submission_webhook?.provider_transport_keys;
  if (!Array.isArray(configuredTransport) || configuredTransport.length !== 25 ||
    configuredTransport.join("|") !== expectedTransport.join("|")) {
    add(errors, "ASSISTED_TRANSPORT_DRIFT", null, "provider_transport_keys");
  }
  const surfaces = form1.physical_surfaces;
  if (!surfaces || Object.keys(surfaces).join("|") !== "public|crm_assisted") {
    add(errors, "FORM1_SURFACE_SET_DRIFT", null, "physical_surfaces");
  } else {
    for (const [name, expected] of Object.entries({
      public: { native_crm_writer: true, catalyst_crm_writer: false, dynamic_prefill: false },
      crm_assisted: { native_crm_writer: false, catalyst_crm_writer: true, dynamic_prefill: true },
    })) {
      const actual = surfaces[name]?.required_integrations;
      for (const [property, value] of Object.entries(expected)) {
        if (actual?.[property] !== value) add(errors, "SURFACE_INTEGRATION_DRIFT", name, property);
      }
      if (Number(actual?.native_crm_writer) + Number(actual?.catalyst_crm_writer) !== 1) {
        add(errors, "SINGLE_WRITER_VIOLATION", name, "required_integrations");
      }
    }
    const publicBaseline = surfaces.public?.sanitized_live_baseline;
    const expectedPublicBaseline = {
      observed_date: "2026-09-04",
      observed_field_count: 34,
      field_alias_row_count: 1,
      required_visible_field_marker_count: 11,
      required_visible_name_counting_rule: "Name is counted once as one Forms builder field",
      rules: {
        field_rules_active: 1,
        choice_rules: 0,
        form_rules: 0,
        page_rules: 0,
        deny_rules: 0,
      },
      webhook_count: 1,
      submission_webhook: {
        payload_key_count: 25,
        payload_keys_unique: true,
        custom_header_count: 1,
      },
      transitional_assisted_prefill: {
        state: "existing_public_surface_prestate_only",
        method: "POST",
        custom_header_count: 2,
        mapping_count: 22,
        desired_for_public_surface: false,
        removal_gate: "remove only after the separate CRM-assisted replacement is installed, independently read back, and cut over",
      },
      thank_you: {
        selected_type: "page",
        content_type: "rich_text",
        redirect_enabled: false,
        add_another_entry_enabled: false,
        pdf_download_enabled: false,
        tracking_enabled: false,
      },
      captcha: "Zoho Forms Text",
      geolocation_enabled: false,
      save_for_later_state: "inactive",
      double_opt_in_enabled: false,
      public_enabled: true,
      sharing: "public",
      embed_available: true,
      embed_modes_available: ["iframe", "JavaScript"],
      crm_module: "Leads",
      crm_layout: "Standard",
      native_crm_writer: true,
      crm_automation_and_process_management: true,
      upsert_enabled: true,
      upsert_preference_order: ["Intake Submission ID", "Contact Email"],
      blank_overwrite: false,
      submission_webhook_key_count: 25,
      email_notifications: false,
      sms_notifications: false,
      push_notifications: false,
    };
    if (JSON.stringify(publicBaseline) !== JSON.stringify(expectedPublicBaseline)) {
      add(errors, "PUBLIC_BASELINE_DRIFT", "public", "sanitized_live_baseline");
    }
    const assistedState = surfaces.crm_assisted?.required_state;
    if (assistedState?.native_crm_writer !== false ||
      assistedState?.catalyst_crm_writer !== true ||
      assistedState?.dynamic_prefill !== true ||
      assistedState?.submission_webhook_key_count !== 25 ||
      assistedState?.submission_webhook_keys_reference !==
        "assisted_prefill.submission_webhook.provider_transport_keys") {
      add(errors, "ASSISTED_REQUIRED_STATE_DRIFT", "crm_assisted", "required_state");
    }
    // A preserved failed Forms entry must not block a newly authorized session
    // for the same contact. Catalyst owns assisted duplicate prevention; the
    // public form keeps its existing provider field-entry policy.
    if (surfaces.public?.field_entry_uniqueness_policy !== "preserve_existing_provider_settings" ||
      !form1.allowed_surface_exceptions?.includes("field_entry_uniqueness")) {
      add(errors, "FIELD_UNIQUENESS_POLICY_DRIFT", "public", "field_entry_uniqueness_policy");
    }
    const assistedUniqueness = assistedState?.field_entry_uniqueness;
    if (!assistedUniqueness || Object.keys(assistedUniqueness).join("|") !== "email|mobilePhone" ||
      assistedUniqueness.email !== false || assistedUniqueness.mobilePhone !== false ||
      assistedState?.duplicate_prevention !== "server_bound_session_and_idempotent_crm_update") {
      add(errors, "ASSISTED_FIELD_UNIQUENESS_DRIFT", "crm_assisted", "field_entry_uniqueness");
    }
  }
  if (manifest.surface_inventory?.logical_stage_count !== 2 ||
    manifest.surface_inventory?.physical_surface_count !== 3 ||
    manifest.surface_inventory?.form1_physical_surface_count !== 2) {
    add(errors, "SURFACE_INVENTORY_DRIFT", null, "surface_inventory");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

/** Compare a private normalized provider readback with the canonical shared schema. */
function verifySurfaceReadback(manifest, surfaceName, observed) {
  const errors = [];
  const form1 = form1From(manifest);
  const expectedSurface = form1?.physical_surfaces?.[surfaceName];
  if (!expectedSurface) return Object.freeze({ ok: false, errors: [{ code: "SURFACE_UNKNOWN", field: surfaceName, property: null }] });
  if (!observed || observed.readback_complete !== true || !Array.isArray(observed.shared_fields)) {
    return Object.freeze({ ok: false, errors: [{ code: "READBACK_INCOMPLETE", field: surfaceName, property: null }] });
  }
  const expectedFields = new Map(form1.shared_field_schema.map((field) => [field.key, field]));
  const actualFields = new Map(observed.shared_fields.map((field) => [field.key, field]));
  if (actualFields.size !== expectedFields.size) add(errors, "OBSERVED_FIELD_SET_DRIFT", surfaceName, "shared_fields");
  for (const [key, expected] of expectedFields) {
    const actual = actualFields.get(key);
    if (!actual) {
      add(errors, "OBSERVED_FIELD_MISSING", key, null);
      continue;
    }
    for (const property of SHARED_PROPERTIES) {
      if (actual[property] !== expected[property]) add(errors, "OBSERVED_FIELD_DRIFT", key, property);
    }
    if (actual.choice_parity !== true && expected.choices_reference) {
      add(errors, "CHOICE_PARITY_UNPROVEN", key, "choice_parity");
    }
    if (actual.alias_parity !== true) add(errors, "ALIAS_PARITY_UNPROVEN", key, "alias_parity");
    const requiredUniqueness = expectedSurface.required_state?.field_entry_uniqueness;
    if (Object.hasOwn(requiredUniqueness ?? {}, key) &&
      actual.no_duplicates !== requiredUniqueness[key]) {
      add(errors, "OBSERVED_FIELD_UNIQUENESS_DRIFT", key, "no_duplicates");
    }
  }
  for (const [property, value] of Object.entries(expectedSurface.required_integrations)) {
    if (observed.integrations?.[property] !== value) {
      add(errors, "OBSERVED_INTEGRATION_DRIFT", surfaceName, property);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

module.exports = { SHARED_PROPERTIES, verifyCanonicalForm1, verifySurfaceReadback };
