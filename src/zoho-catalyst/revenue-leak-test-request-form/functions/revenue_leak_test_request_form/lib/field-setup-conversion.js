"use strict";

const crypto = require("node:crypto");
const {
  FieldSetupContractError,
  assertOperatorBound,
} = require("./field-setup-contract");

const RECORD_ID_PATTERN = /^[0-9]{1,30}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 &+\-/]{0,99}$/;
const MANDATORY_DEAL_FIELDS = Object.freeze([
  "Deal_Name",
  "Stage",
  "Pipeline",
  "Account_Name",
  "Closing_Date",
  "Type",
]);
const POST_WRITE_STATUSES = new Set([
  "write_started",
  "reconciliation_required",
  "completion_pending",
]);
const PREVIEW_STATE = "lead_conversion_preview";
const CONFIRMATION_STATE = "lead_conversion_confirmation";
const COMPLETED_STATE = "handoff_to_client_form2";

class ConversionError extends FieldSetupContractError {
  constructor(message, publicCode = "conversion_blocked", { ambiguous = false } = {}) {
    super(message, publicCode);
    this.name = "ConversionError";
    this.status = publicCode === "conversion_not_found" ? 404 : 409;
    this.ambiguous = ambiguous;
  }
}

function requireMethods(value, methods, label) {
  for (const method of methods) {
    if (typeof value?.[method] !== "function") {
      throw new ConversionError(`${label} is missing ${method}`, "configuration_invalid");
    }
  }
  return value;
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversionError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ConversionError(`${label} does not match the approved contract`);
  }
  return value;
}

function recordId(value, label) {
  if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value)) {
    throw new ConversionError(`${label} is invalid`);
  }
  return value;
}

function journeyKey(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ConversionError("Journey identity is invalid");
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function safeValue(value, field) {
  if (typeof value !== "string" || !SAFE_VALUE_PATTERN.test(value)) {
    throw new ConversionError(`${field} controlled value is invalid`, "configuration_invalid");
  }
  return value;
}

function safeDisplay(value, label, maximumLength = 200) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ConversionError(`${label} display value is invalid`);
  }
  return value;
}

function normalizeMetadata(value, leadId) {
  if (
    !value ||
    value.sourceLeadId !== leadId ||
    !Array.isArray(value.fields) ||
    !value.fields.length
  ) {
    throw new ConversionError("Record-specific Deal field metadata is unavailable");
  }
  const fields = new Map();
  for (const field of value.fields) {
    if (!field || typeof field.apiName !== "string" || fields.has(field.apiName)) {
      throw new ConversionError("Deal field metadata is ambiguous");
    }
    fields.set(field.apiName, field);
  }
  for (const apiName of MANDATORY_DEAL_FIELDS) {
    const field = fields.get(apiName);
    if (!field || field.writable !== true) {
      throw new ConversionError(`Mandatory Deal field ${apiName} is unavailable`);
    }
  }
  return fields;
}

function assertPicklistValue(fields, apiName, value) {
  const field = fields.get(apiName);
  if (!Array.isArray(field.allowedValues) || !field.allowedValues.includes(value)) {
    throw new ConversionError(`Controlled ${apiName} value is not a current picklist option`);
  }
}

function oneOrNone(value, label) {
  if (!Array.isArray(value) || value.length > 1) {
    throw new ConversionError(`${label} candidates are ambiguous`);
  }
  if (value.length === 1) {
    return Object.freeze({
      id: recordId(value[0]?.id, `${label} candidate`),
      displayName: safeDisplay(value[0]?.displayName, `${label} candidate`, 200),
    });
  }
  return null;
}

function normalizePreviewRequest(value) {
  exactObject(value, ["journeyKey", "leadId"], "Conversion preview request");
  return Object.freeze({
    journeyKey: journeyKey(value.journeyKey),
    leadId: recordId(value.leadId, "Lead"),
  });
}

function normalizeConfirmation(value) {
  exactObject(value, ["confirm", "previewFingerprint", "revision"], "Conversion confirmation");
  if (
    value.confirm !== true ||
    typeof value.previewFingerprint !== "string" ||
    !SHA256_PATTERN.test(value.previewFingerprint) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new ConversionError("Conversion confirmation is invalid");
  }
  return Object.freeze(value);
}

function normalizeControlledDefaults(value) {
  exactObject(
    value,
    ["closingDate", "pipeline", "stage", "type"],
    "Controlled Deal defaults",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.closingDate)) {
    throw new ConversionError("Closing_Date controlled value is invalid", "configuration_invalid");
  }
  return Object.freeze({
    closingDate: value.closingDate,
    pipeline: safeValue(value.pipeline, "Pipeline"),
    stage: safeValue(value.stage, "Stage"),
    type: safeValue(value.type, "Type"),
  });
}

function assertBoundEvidence(value, leadId, label) {
  if (!value || value.sourceLeadId !== leadId) {
    throw new ConversionError(`${label} is not bound to the current Lead`);
  }
  return value;
}

function assertJourneyRevision(journey, expectedState) {
  if (
    journey?.state !== expectedState ||
    !Number.isSafeInteger(journey.revision) ||
    journey.revision < 1 ||
    typeof journey.sessionDigest !== "string" ||
    !SHA256_PATTERN.test(journey.sessionDigest) ||
    journey.environment !== "development"
  ) {
    throw new ConversionError("Journey conversion state is unavailable or stale");
  }
}

function assertPermission(options, permission) {
  if (options.permissions?.[permission] !== true) {
    throw new ConversionError(`Current ${permission} permission is unavailable`);
  }
}

async function loadAuthoritativePlan(crm, request, defaults) {
  // Every confirmation rebuilds this ephemeral plan. Only its digest may be persisted.
  const [lead, optionsInput, metadataInput, candidatesInput] = await Promise.all([
    crm.getLead(request.leadId),
    crm.getConversionOptions(request.leadId),
    crm.getDealFieldMetadata(request.leadId),
    crm.findConversionCandidates(request.leadId),
  ]);
  if (lead?.id !== request.leadId || lead.locked !== false) {
    throw new ConversionError("Lead is unavailable or locked");
  }
  const options = assertBoundEvidence(optionsInput, request.leadId, "Native conversion options");
  if (options.permitted !== true || options.nativeV8 !== true || options.ambiguous === true) {
    throw new ConversionError("Current native conversion options are unavailable or ambiguous");
  }
  assertPermission(options, "convertLead");
  assertPermission(options, "createDeal");

  const fields = normalizeMetadata(metadataInput, request.leadId);
  assertPicklistValue(fields, "Pipeline", defaults.pipeline);
  assertPicklistValue(fields, "Stage", defaults.stage);
  assertPicklistValue(fields, "Type", defaults.type);

  const candidates = assertBoundEvidence(candidatesInput, request.leadId, "Duplicate candidates");
  const account = oneOrNone(candidates.accounts, "Account");
  const contact = oneOrNone(candidates.contacts, "Contact");
  const deal = oneOrNone(candidates.deals, "Deal");
  if (deal) {
    throw new ConversionError("An existing matching Deal requires operator reconciliation");
  }
  assertPermission(options, account ? "associateAccount" : "createAccount");
  assertPermission(options, contact ? "associateContact" : "createContact");

  if (typeof lead.company !== "string" || !lead.company.trim() || lead.company.length > 200) {
    throw new ConversionError("Lead company is missing or invalid");
  }
  const companyDisplayName = safeDisplay(lead.company.trim(), "Lead company", 200);
  const contactDisplayName = contact
    ? contact.displayName
    : safeDisplay(lead.contactDisplayName, "Lead contact", 200);
  const dealName = `${lead.company.trim()} — Free Revenue Leak Test`;
  const nameLimit = fields.get("Deal_Name")?.maxLength;
  if (Number.isSafeInteger(nameLimit) && dealName.length > nameLimit) {
    throw new ConversionError("Generated Deal name exceeds current Deal metadata");
  }
  return Object.freeze({
    accountDisplayName: account ? account.displayName : companyDisplayName,
    accountId: account?.id ?? null,
    closingDate: defaults.closingDate,
    contactDisplayName,
    contactId: contact?.id ?? null,
    dealName,
    leadId: request.leadId,
    pipeline: defaults.pipeline,
    stage: defaults.stage,
    type: defaults.type,
  });
}

function sanitizedPreview(plan) {
  return Object.freeze({
    account: Object.freeze({
      action: plan.accountId ? "associate_one_verified_match" : "create_from_conversion_mapping",
      displayName: plan.accountDisplayName,
    }),
    contact: Object.freeze({
      action: plan.contactId ? "associate_one_verified_match" : "create_from_conversion_mapping",
      displayName: plan.contactDisplayName,
    }),
    deal: Object.freeze({
      closingDate: plan.closingDate,
      dealName: plan.dealName,
      mandatoryDealFields: MANDATORY_DEAL_FIELDS,
      pipeline: plan.pipeline,
      stage: plan.stage,
      type: plan.type,
    }),
    noEmailOrRoutingEffect: true,
  });
}

function conversionWritePlan(plan) {
  return Object.freeze({
    accountId: plan.accountId,
    closingDate: plan.closingDate,
    contactId: plan.contactId,
    dealName: plan.dealName,
    leadId: plan.leadId,
    pipeline: plan.pipeline,
    stage: plan.stage,
    type: plan.type,
  });
}

function normalizeResponseIds(value) {
  exactObject(value, ["accountId", "contactId", "dealId"], "Native conversion response");
  return Object.freeze({
    accountId: recordId(value.accountId, "Converted Account"),
    contactId: recordId(value.contactId, "Converted Contact"),
    dealId: recordId(value.dealId, "Converted Deal"),
  });
}

function assertConversionReadback(readback, response, plan) {
  if (!readback || readback.converted !== true || readback.leadId !== plan.leadId) {
    throw new ConversionError("Converted Lead readback is missing or inconsistent");
  }
  const accountId = recordId(readback.account?.id, "Account readback");
  const contactId = recordId(readback.contact?.id, "Contact readback");
  const dealId = recordId(readback.deal?.id, "Deal readback");
  if (
    accountId !== response.accountId ||
    contactId !== response.contactId ||
    dealId !== response.dealId ||
    readback.account.sourceLeadId !== plan.leadId ||
    readback.contact.sourceLeadId !== plan.leadId ||
    readback.contact.accountId !== accountId ||
    readback.deal.sourceLeadId !== plan.leadId ||
    readback.deal.accountId !== accountId ||
    readback.deal.contactId !== contactId
  ) {
    throw new ConversionError("Converted record associations do not match authoritative readback");
  }
  if (
    (plan.accountId !== null && accountId !== plan.accountId) ||
    (plan.contactId !== null && contactId !== plan.contactId)
  ) {
    throw new ConversionError("Requested Account or Contact association was not honored");
  }

  const fields = exactObject(
    readback.deal.fields,
    MANDATORY_DEAL_FIELDS,
    "Converted Deal mandatory-field readback",
  );
  const expectedFields = {
    Account_Name: accountId,
    Closing_Date: plan.closingDate,
    Deal_Name: plan.dealName,
    Pipeline: plan.pipeline,
    Stage: plan.stage,
    Type: plan.type,
  };
  for (const [apiName, expected] of Object.entries(expectedFields)) {
    if (fields[apiName] !== expected) {
      throw new ConversionError(`Converted Deal ${apiName} readback does not match the approved plan`);
    }
  }

  const mappings = exactObject(
    readback.conversionMappings,
    ["accountId", "contactId", "dealId", "leadId", "requestedAccountId", "requestedContactId"],
    "Native conversion mapping readback",
  );
  if (
    mappings.leadId !== plan.leadId ||
    mappings.accountId !== accountId ||
    mappings.contactId !== contactId ||
    mappings.dealId !== dealId ||
    mappings.requestedAccountId !== plan.accountId ||
    mappings.requestedContactId !== plan.contactId
  ) {
    throw new ConversionError("Native conversion mappings do not match the approved plan");
  }
  if (
    readback.authorizationStatus !== "Not Sent" ||
    readback.testStatus !== "Not Started" ||
    readback.routingStarted !== false ||
    readback.emailSent !== false
  ) {
    throw new ConversionError("Conversion produced an unapproved downstream side effect");
  }
}

function reconciliationError(message = "Conversion outcome requires reconciliation") {
  return new ConversionError(message, "reconciliation_required", { ambiguous: true });
}

function createFieldSetupConversionService({ crm, store } = {}) {
  requireMethods(
    crm,
    [
      "convertLead",
      "findConversionCandidates",
      "getConversionOptions",
      "getDealFieldMetadata",
      "getLead",
      "readConversionResult",
    ],
    "CRM conversion adapter",
  );
  requireMethods(
    store,
    [
      "claimConversion",
      "completeConversion",
      "createPreview",
      "markReconciliationRequired",
      "markWriteStarted",
    ],
    "Conversion store",
  );

  async function buildPreview(input, journey, operator, controlledDefaultsInput) {
    const request = normalizePreviewRequest(input);
    assertOperatorBound(journey, operator);
    assertJourneyRevision(journey, PREVIEW_STATE);
    if (
      journey.journeyKey !== request.journeyKey ||
      journey.recordId !== request.leadId ||
      journey.moduleApiName !== "Leads" ||
      journey.qualificationStatus !== "qualified" ||
      journey.conversionStatus !== "not_started" ||
      journey.conversionPreviewFingerprint !== null
    ) {
      throw new ConversionError("Journey is not eligible for conversion");
    }
    const defaults = normalizeControlledDefaults(controlledDefaultsInput);
    const plan = await loadAuthoritativePlan(crm, request, defaults);
    const previewFingerprint = fingerprint(plan);
    const stored = await store.createPreview({
      environment: journey.environment,
      expectedConversionStatus: "not_started",
      expectedPreviewFingerprint: null,
      expectedRevision: journey.revision,
      expectedState: PREVIEW_STATE,
      journeyKey: request.journeyKey,
      leadId: request.leadId,
      nextState: CONFIRMATION_STATE,
      operatorUserId: journey.operatorUserId,
      previewFingerprint,
      sessionDigest: journey.sessionDigest,
    });
    if (
      stored?.previewFingerprint !== previewFingerprint ||
      !Number.isSafeInteger(stored?.revision) ||
      stored.revision !== journey.revision + 1 ||
      stored.state !== CONFIRMATION_STATE ||
      stored.status !== "preview_ready"
    ) {
      throw reconciliationError("Conversion preview readback is inconsistent");
    }
    return Object.freeze({
      previewFingerprint,
      revision: stored.revision,
      sanitizedPreview: sanitizedPreview(plan),
    });
  }

  async function readPreview(input, journey, operator, controlledDefaultsInput) {
    const request = normalizePreviewRequest(input);
    assertOperatorBound(journey, operator);
    assertJourneyRevision(journey, CONFIRMATION_STATE);
    if (
      journey.journeyKey !== request.journeyKey ||
      journey.recordId !== request.leadId ||
      journey.moduleApiName !== "Leads" ||
      journey.qualificationStatus !== "qualified" ||
      journey.conversionStatus !== "preview_ready" ||
      !SHA256_PATTERN.test(journey.conversionPreviewFingerprint ?? "")
    ) {
      throw new ConversionError("Journey conversion preview is unavailable");
    }
    const defaults = normalizeControlledDefaults(controlledDefaultsInput);
    const plan = await loadAuthoritativePlan(crm, request, defaults);
    const previewFingerprint = fingerprint(plan);
    if (previewFingerprint === journey.conversionPreviewFingerprint) {
      return Object.freeze({
        previewFingerprint,
        revision: journey.revision,
        sanitizedPreview: sanitizedPreview(plan),
      });
    }

    // A mutable CRM record can legitimately change after preview. Replace only
    // the exact still-current preview receipt so the operator can review the new
    // evidence without weakening the confirmation CAS or reusing a stale revision.
    const stored = await store.createPreview({
      environment: journey.environment,
      expectedConversionStatus: "preview_ready",
      expectedPreviewFingerprint: journey.conversionPreviewFingerprint,
      expectedRevision: journey.revision,
      expectedState: CONFIRMATION_STATE,
      journeyKey: request.journeyKey,
      leadId: request.leadId,
      nextState: CONFIRMATION_STATE,
      operatorUserId: journey.operatorUserId,
      previewFingerprint,
      sessionDigest: journey.sessionDigest,
    });
    if (
      stored?.previewFingerprint !== previewFingerprint ||
      !Number.isSafeInteger(stored?.revision) ||
      stored.revision !== journey.revision + 1 ||
      stored.state !== CONFIRMATION_STATE ||
      stored.status !== "preview_ready"
    ) {
      throw reconciliationError("Conversion preview refresh readback is inconsistent");
    }
    return Object.freeze({
      previewFingerprint,
      revision: stored.revision,
      sanitizedPreview: sanitizedPreview(plan),
    });
  }

  async function confirmConversion(
    input,
    journey,
    operator,
    controlledDefaultsInput,
    dealResumeBindingDigest,
  ) {
    const confirmation = normalizeConfirmation(input);
    assertOperatorBound(journey, operator);
    assertJourneyRevision(journey, CONFIRMATION_STATE);
    if (
      journey.moduleApiName !== "Leads" ||
      journey.qualificationStatus !== "qualified" ||
      journey.conversionStatus !== "preview_ready" ||
      journey.conversionPreviewFingerprint !== confirmation.previewFingerprint ||
      confirmation.revision !== journey.revision ||
      typeof dealResumeBindingDigest !== "function"
    ) {
      throw new ConversionError("Journey is not eligible for conversion");
    }
    const defaults = normalizeControlledDefaults(controlledDefaultsInput);
    const claimRequest = {
      journeyKey: journey.journeyKey,
      environment: journey.environment,
      expectedState: CONFIRMATION_STATE,
      operatorUserId: journey.operatorUserId,
      previewFingerprint: confirmation.previewFingerprint,
      revision: confirmation.revision,
      sessionDigest: journey.sessionDigest,
    };
    const claim = await store.claimConversion(claimRequest);
    if (
      claim?.status === "completed" &&
      claim.previewFingerprint === confirmation.previewFingerprint &&
      Number.isSafeInteger(claim.revision)
    ) {
      return Object.freeze({
        ok: true,
        replay: true,
        status: "conversion_readback_confirmed",
        revision: claim.revision,
      });
    }
    if (POST_WRITE_STATUSES.has(claim?.status)) {
      throw reconciliationError();
    }
    if (
      claim?.status !== "claimed" ||
      claim.previewFingerprint !== confirmation.previewFingerprint ||
      claim.revision !== confirmation.revision
    ) {
      throw reconciliationError("Conversion claim is unavailable or stale");
    }

    // Re-read all mutable CRM evidence at confirmation. A stale preview never crosses the write boundary.
    const plan = await loadAuthoritativePlan(
      crm,
      { journeyKey: journey.journeyKey, leadId: recordId(journey.recordId, "Lead") },
      defaults,
    );
    const currentFingerprint = fingerprint(plan);
    if (currentFingerprint !== confirmation.previewFingerprint) {
      throw new ConversionError("Conversion preview is stale; build a new preview");
    }

    let started;
    try {
      started = await store.markWriteStarted({
        ...claimRequest,
        sideEffectFingerprint: currentFingerprint,
      });
    } catch {
      try {
        await store.markReconciliationRequired(
          claimRequest,
          "write_boundary_persistence_unconfirmed",
        );
      } catch {
        // No CRM write is attempted when the durable boundary cannot be confirmed.
      }
      throw reconciliationError("Conversion write boundary could not be persisted");
    }
    if (
      started?.status !== "write_started" ||
      started.startedNow !== true ||
      started.sideEffectFingerprint !== currentFingerprint ||
      !Number.isSafeInteger(started.revision) ||
      started.revision !== journey.revision + 1
    ) {
      throw reconciliationError();
    }
    // Keep the post-boundary receipt digest-only. It is safe to persist and safe to pass to the store.
    const writeReceipt = Object.freeze({
      environment: claimRequest.environment,
      expectedState: claimRequest.expectedState,
      journeyKey: claimRequest.journeyKey,
      operatorUserId: claimRequest.operatorUserId,
      previewFingerprint: claimRequest.previewFingerprint,
      revision: started.revision,
      sessionDigest: claimRequest.sessionDigest,
      sideEffectFingerprint: currentFingerprint,
    });

    try {
      const response = normalizeResponseIds(await crm.convertLead(conversionWritePlan(plan)));
      // This lookup is intentionally keyed by the source Lead, not by trusting response IDs.
      const readback = await crm.readConversionResult(plan.leadId);
      assertConversionReadback(readback, response, plan);
      const outcomeFingerprint = fingerprint(readback);
      const dealBindingDigest = dealResumeBindingDigest(Object.freeze({
        dealId: response.dealId,
        environment: journey.environment,
      }));
      if (!SHA256_PATTERN.test(dealBindingDigest ?? "")) {
        throw new Error("conversion_deal_binding_invalid");
      }
      const completed = await store.completeConversion(writeReceipt, {
        dealResumeBindingDigest: dealBindingDigest,
        nextState: COMPLETED_STATE,
        outcomeFingerprint,
      });
      if (
        completed?.status !== "completed" ||
        completed.previewFingerprint !== confirmation.previewFingerprint ||
        completed.state !== COMPLETED_STATE ||
        completed.revision !== started.revision + 1 ||
        completed.sideEffectFingerprint !== currentFingerprint ||
        completed.outcomeFingerprint !== outcomeFingerprint ||
        completed.dealResumeBindingDigest !== dealBindingDigest
      ) {
        throw new Error("conversion_completion_not_durable");
      }
    } catch {
      try {
        await store.markReconciliationRequired(writeReceipt, "post_write_outcome_unconfirmed");
      } catch {
        // The persisted write_started state remains the durable no-retry boundary.
      }
      throw reconciliationError();
    }
    return Object.freeze({
      ok: true,
      replay: false,
      status: "conversion_readback_confirmed",
      revision: started.revision + 1,
    });
  }

  return Object.freeze({ buildPreview, confirmConversion, readPreview });
}

module.exports = {
  ConversionError,
  MANDATORY_DEAL_FIELDS,
  createFieldSetupConversionService,
  fingerprint,
};
