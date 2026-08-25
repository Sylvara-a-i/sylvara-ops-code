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
  if (value.length === 1) return recordId(value[0]?.id, `${label} candidate`);
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
  const accountId = oneOrNone(candidates.accounts, "Account");
  const contactId = oneOrNone(candidates.contacts, "Contact");
  const dealId = oneOrNone(candidates.deals, "Deal");
  if (dealId) {
    throw new ConversionError("An existing matching Deal requires operator reconciliation");
  }
  assertPermission(options, accountId ? "associateAccount" : "createAccount");
  assertPermission(options, contactId ? "associateContact" : "createContact");

  if (typeof lead.company !== "string" || !lead.company.trim() || lead.company.length > 200) {
    throw new ConversionError("Lead company is missing or invalid");
  }
  const dealName = `${lead.company.trim()} — Free Revenue Leak Test`;
  const nameLimit = fields.get("Deal_Name")?.maxLength;
  if (Number.isSafeInteger(nameLimit) && dealName.length > nameLimit) {
    throw new ConversionError("Generated Deal name exceeds current Deal metadata");
  }
  return Object.freeze({
    accountId,
    closingDate: defaults.closingDate,
    contactId,
    dealName,
    leadId: request.leadId,
    pipeline: defaults.pipeline,
    stage: defaults.stage,
    type: defaults.type,
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
    if (
      journey.journeyKey !== request.journeyKey ||
      journey.recordId !== request.leadId ||
      journey.moduleApiName !== "Leads" ||
      journey.qualificationStatus !== "qualified"
    ) {
      throw new ConversionError("Journey is not eligible for conversion");
    }
    const defaults = normalizeControlledDefaults(controlledDefaultsInput);
    const plan = await loadAuthoritativePlan(crm, request, defaults);
    const previewFingerprint = fingerprint(plan);
    const stored = await store.createPreview({
      journeyKey: request.journeyKey,
      leadId: request.leadId,
      operatorUserId: journey.operatorUserId,
      previewFingerprint,
    });
    if (
      stored?.previewFingerprint !== previewFingerprint ||
      !Number.isSafeInteger(stored?.revision) ||
      stored.revision < 1
    ) {
      throw reconciliationError("Conversion preview readback is inconsistent");
    }
    return Object.freeze({
      previewFingerprint,
      revision: stored.revision,
      sanitizedPreview: Object.freeze({
        accountAction: plan.accountId ? "associate_one_verified_match" : "create_from_conversion_mapping",
        contactAction: plan.contactId ? "associate_one_verified_match" : "create_from_conversion_mapping",
        dealAction: "create_free_revenue_leak_test_deal",
        mandatoryDealFields: MANDATORY_DEAL_FIELDS,
        noEmailOrRoutingEffect: true,
      }),
    });
  }

  async function confirmConversion(input, journey, operator, controlledDefaultsInput) {
    const confirmation = normalizeConfirmation(input);
    assertOperatorBound(journey, operator);
    if (journey.moduleApiName !== "Leads" || journey.qualificationStatus !== "qualified") {
      throw new ConversionError("Journey is not eligible for conversion");
    }
    const defaults = normalizeControlledDefaults(controlledDefaultsInput);
    const claimRequest = {
      journeyKey: journey.journeyKey,
      operatorUserId: journey.operatorUserId,
      previewFingerprint: confirmation.previewFingerprint,
      revision: confirmation.revision,
    };
    const claim = await store.claimConversion(claimRequest);
    if (
      claim?.status === "completed" &&
      claim.previewFingerprint === confirmation.previewFingerprint &&
      claim.revision === confirmation.revision
    ) {
      return Object.freeze({ ok: true, replay: true, status: "conversion_readback_confirmed" });
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
      started.sideEffectFingerprint !== currentFingerprint
    ) {
      throw reconciliationError();
    }
    // Keep the post-boundary receipt digest-only. It is safe to persist and safe to pass to the store.
    const writeReceipt = Object.freeze({
      journeyKey: claimRequest.journeyKey,
      operatorUserId: claimRequest.operatorUserId,
      previewFingerprint: claimRequest.previewFingerprint,
      revision: claimRequest.revision,
      sideEffectFingerprint: currentFingerprint,
    });

    try {
      const response = normalizeResponseIds(await crm.convertLead(plan));
      // This lookup is intentionally keyed by the source Lead, not by trusting response IDs.
      const readback = await crm.readConversionResult(plan.leadId);
      assertConversionReadback(readback, response, plan);
      const completed = await store.completeConversion(writeReceipt, {
        outcomeFingerprint: fingerprint(readback),
      });
      if (
        completed?.status !== "completed" ||
        completed.previewFingerprint !== confirmation.previewFingerprint ||
        completed.revision !== confirmation.revision
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
    return Object.freeze({ ok: true, replay: false, status: "conversion_readback_confirmed" });
  }

  return Object.freeze({ buildPreview, confirmConversion });
}

module.exports = {
  ConversionError,
  MANDATORY_DEAL_FIELDS,
  createFieldSetupConversionService,
  fingerprint,
};
