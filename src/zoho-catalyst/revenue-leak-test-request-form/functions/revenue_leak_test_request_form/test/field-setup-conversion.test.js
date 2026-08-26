"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MANDATORY_DEAL_FIELDS,
  createFieldSetupConversionService,
} = require("../lib/field-setup-conversion");

const JOURNEY = "00000000-0000-4000-8000-000000000001";
const LEAD = "100000000000001";
const ACCOUNT = "100000000000002";
const CONTACT = "100000000000003";
const DEAL = "100000000000004";
const SESSION_DIGEST = "a".repeat(64);
const DEAL_RESUME_BINDING_DIGEST = "b".repeat(64);

function operator(overrides = {}) {
  return {
    authenticated: true,
    environment: "development",
    operatorUserId: "100000000000005",
    role: "field_setup_operator",
    ...overrides,
  };
}

function journey(overrides = {}) {
  return {
    conversionPreviewFingerprint: null,
    conversionStatus: "not_started",
    environment: "development",
    journeyKey: JOURNEY,
    moduleApiName: "Leads",
    operatorUserId: "100000000000005",
    qualificationStatus: "qualified",
    recordId: LEAD,
    revision: 7,
    sessionDigest: SESSION_DIGEST,
    state: "lead_conversion_preview",
    ...overrides,
  };
}

function defaults() {
  return {
    closingDate: "2026-09-01",
    pipeline: "Revenue Desk Sales",
    stage: "Setup and Authorization",
    type: "Initial Sale",
  };
}

function permissions(overrides = {}) {
  return {
    associateAccount: true,
    associateContact: true,
    convertLead: true,
    createAccount: true,
    createContact: true,
    createDeal: true,
    ...overrides,
  };
}

function metadata(overrides = {}) {
  const fields = MANDATORY_DEAL_FIELDS.map((apiName) => ({ apiName, writable: true }));
  for (const field of fields) {
    if (field.apiName === "Deal_Name") field.maxLength = 200;
    if (field.apiName === "Pipeline") field.allowedValues = ["Revenue Desk Sales"];
    if (field.apiName === "Stage") field.allowedValues = ["Setup and Authorization"];
    if (field.apiName === "Type") field.allowedValues = ["Initial Sale"];
    Object.assign(field, overrides[field.apiName] ?? {});
  }
  return { sourceLeadId: LEAD, fields };
}

function candidates(overrides = {}) {
  return {
    sourceLeadId: LEAD,
    accounts: [],
    contacts: [],
    deals: [],
    ...overrides,
  };
}

function authoritativeReadback({
  accountId = ACCOUNT,
  contactId = CONTACT,
  dealId = DEAL,
  requestedAccountId = null,
  requestedContactId = null,
  overrides = {},
} = {}) {
  const value = {
    account: { id: accountId, sourceLeadId: LEAD },
    authorizationStatus: "Not Sent",
    contact: { accountId, id: contactId, sourceLeadId: LEAD },
    conversionMappings: {
      accountId,
      contactId,
      dealId,
      leadId: LEAD,
      requestedAccountId,
      requestedContactId,
    },
    converted: true,
    deal: {
      accountId,
      contactId,
      fields: {
        Account_Name: accountId,
        Closing_Date: "2026-09-01",
        Deal_Name: "ZZZ SYNTHETIC Plumbing — Free Revenue Leak Test",
        Pipeline: "Revenue Desk Sales",
        Stage: "Setup and Authorization",
        Type: "Initial Sale",
      },
      id: dealId,
      sourceLeadId: LEAD,
    },
    emailSent: false,
    leadId: LEAD,
    routingStarted: false,
    testStatus: "Not Started",
  };
  return { ...value, ...overrides };
}

class Store {
  constructor({ failCompletion = false, failWriteBoundary = false } = {}) {
    this.audit = [];
    this.failCompletion = failCompletion;
    this.failWriteBoundary = failWriteBoundary;
    this.preview = null;
    this.reconciliation = [];
    this.status = "not_started";
  }

  async createPreview(value) {
    this.audit.push({ method: "createPreview", value });
    const createsInitialPreview =
      this.preview === null &&
      this.status === "not_started" &&
      value.expectedConversionStatus === "not_started" &&
      value.expectedPreviewFingerprint === null;
    const refreshesCurrentPreview =
      this.preview !== null &&
      this.status === "preview_ready" &&
      value.expectedConversionStatus === this.status &&
      value.expectedPreviewFingerprint === this.preview.previewFingerprint &&
      value.expectedRevision === this.preview.revision &&
      value.expectedState === this.preview.state &&
      value.environment === this.preview.environment &&
      value.journeyKey === this.preview.journeyKey &&
      value.leadId === this.preview.leadId &&
      value.operatorUserId === this.preview.operatorUserId &&
      value.sessionDigest === this.preview.sessionDigest;
    if (!createsInitialPreview && !refreshesCurrentPreview) {
      return {
        previewFingerprint: this.preview?.previewFingerprint ?? null,
        revision: this.preview?.revision ?? value.expectedRevision,
        state: this.preview?.state ?? value.expectedState,
        status: this.status,
      };
    }
    this.preview = {
      ...value,
      revision: value.expectedRevision + 1,
      state: value.nextState,
    };
    this.status = "preview_ready";
    return {
      previewFingerprint: value.previewFingerprint,
      revision: this.preview.revision,
      state: this.preview.state,
      status: this.status,
    };
  }

  async claimConversion(value) {
    this.audit.push({ method: "claimConversion", value });
    if (!this.preview) return { status: "reconciliation_required" };
    const receipt = {
      previewFingerprint: this.preview.previewFingerprint,
      revision: this.preview.revision,
    };
    if (
      value.environment !== this.preview.environment ||
      value.expectedState !== this.preview.state ||
      value.journeyKey !== this.preview.journeyKey ||
      value.previewFingerprint !== this.preview.previewFingerprint ||
      value.revision !== this.preview.revision ||
      value.operatorUserId !== this.preview.operatorUserId ||
      value.sessionDigest !== this.preview.sessionDigest
    ) return { status: "reconciliation_required" };
    if (this.status === "completed") {
      return { ...receipt, revision: this.completed.revision, status: "completed" };
    }
    if (["write_started", "reconciliation_required"].includes(this.status)) {
      return { ...receipt, status: this.status };
    }
    return { ...receipt, status: "claimed" };
  }

  async markWriteStarted(value) {
    this.audit.push({ method: "markWriteStarted", value });
    if (
      this.status !== "preview_ready" ||
      value.previewFingerprint !== this.preview.previewFingerprint ||
      value.revision !== this.preview.revision
    ) {
      return {
        sideEffectFingerprint: value.sideEffectFingerprint,
        startedNow: false,
        status: this.status,
      };
    }
    this.status = "write_started";
    if (this.failWriteBoundary) throw new Error("synthetic ambiguous write-boundary persistence");
    return {
      revision: value.revision + 1,
      sideEffectFingerprint: value.sideEffectFingerprint,
      startedNow: true,
      status: "write_started",
    };
  }

  async markReconciliationRequired(value, reason) {
    this.audit.push({ method: "markReconciliationRequired", reason, value });
    this.reconciliation.push(reason);
    this.status = "reconciliation_required";
    return { status: this.status };
  }

  async completeConversion(receipt, outcome) {
    this.audit.push({ method: "completeConversion", outcome, receipt });
    if (this.failCompletion) throw new Error("synthetic completion failure");
    this.status = "completed";
    this.completed = {
      dealResumeBindingDigest: outcome.dealResumeBindingDigest,
      outcomeFingerprint: outcome.outcomeFingerprint,
      previewFingerprint: receipt.previewFingerprint,
      revision: receipt.revision + 1,
      sideEffectFingerprint: receipt.sideEffectFingerprint,
      state: outcome.nextState,
      status: "completed",
    };
    return this.completed;
  }
}

function crm(overrides = {}) {
  return {
    getLead: async () => ({
      id: LEAD,
      company: "ZZZ SYNTHETIC Plumbing",
      contactDisplayName: "ZZZ SYNTHETIC Contact",
      locked: false,
    }),
    getConversionOptions: async () => ({
      ambiguous: false,
      nativeV8: true,
      permissions: permissions(),
      permitted: true,
      sourceLeadId: LEAD,
    }),
    getDealFieldMetadata: async () => metadata(),
    findConversionCandidates: async () => candidates(),
    convertLead: async (plan) => ({
      accountId: plan.accountId ?? ACCOUNT,
      contactId: plan.contactId ?? CONTACT,
      dealId: DEAL,
    }),
    readConversionResult: async () => authoritativeReadback(),
    ...overrides,
  };
}

async function preview(service) {
  return service.buildPreview(
    { journeyKey: JOURNEY, leadId: LEAD },
    journey(),
    operator(),
    defaults(),
  );
}

function confirmation(result) {
  return { confirm: true, previewFingerprint: result.previewFingerprint, revision: result.revision };
}

function confirmationJourney(result, overrides = {}) {
  return journey({
    conversionPreviewFingerprint: result.previewFingerprint,
    conversionStatus: "preview_ready",
    revision: result.revision,
    state: "lead_conversion_confirmation",
    ...overrides,
  });
}

function dealResumeBindingDigest(value) {
  assert.deepEqual(value, { dealId: DEAL, environment: "development" });
  return DEAL_RESUME_BINDING_DIGEST;
}

test("proposed storage has digest-only conversion evidence and the one-way write state", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, "../../../config/field-setup-datastore-schema.proposed.json"),
    "utf8",
  ));
  const columns = new Map(schema.table.columns.map((column) => [column.api_name, column]));
  for (const apiName of [
    "CONVERSION_PREVIEW_FINGERPRINT",
    "CONVERSION_SIDE_EFFECT_FINGERPRINT",
    "CONVERSION_OUTCOME_FINGERPRINT",
  ]) {
    assert.deepEqual(
      { maxLength: columns.get(apiName)?.max_length, private: columns.get(apiName)?.private, type: columns.get(apiName)?.type },
      { maxLength: 64, private: true, type: "varchar" },
    );
  }
  assert.deepEqual(
    schema.conversion_persistence_contract.one_way_states,
    ["preview_ready", "write_started", "reconciliation_required", "completed"],
  );
  assert.ok(schema.data_policy.prohibited.includes("private conversion plan"));
  assert.ok(!columns.has("CONVERSION_PRIVATE_PLAN"));
  assert.ok(!columns.has("DEAL_NAME"));
  assert.deepEqual(
    {
      maxLength: columns.get("DEAL_RESUME_BINDING_DIGEST")?.max_length,
      private: columns.get("DEAL_RESUME_BINDING_DIGEST")?.private,
      unique: columns.get("DEAL_RESUME_BINDING_DIGEST")?.unique,
    },
    { maxLength: 64, private: true, unique: true },
  );
});

async function confirm(service, result, operatorInput = operator()) {
  return service.confirmConversion(
    confirmation(result),
    confirmationJourney(result),
    operatorInput,
    defaults(),
    dealResumeBindingDigest,
  );
}

test("preview requires current record-bound mandatory Deal fields and validation-required Type", async () => {
  assert.deepEqual(MANDATORY_DEAL_FIELDS, [
    "Deal_Name",
    "Stage",
    "Pipeline",
    "Account_Name",
    "Closing_Date",
    "Type",
  ]);
  const service = createFieldSetupConversionService({ crm: crm(), store: new Store() });
  const result = await preview(service);
  assert.deepEqual(result.sanitizedPreview, {
    account: {
      action: "create_from_conversion_mapping",
      displayName: "ZZZ SYNTHETIC Plumbing",
    },
    contact: {
      action: "create_from_conversion_mapping",
      displayName: "ZZZ SYNTHETIC Contact",
    },
    deal: {
      closingDate: "2026-09-01",
      dealName: "ZZZ SYNTHETIC Plumbing — Free Revenue Leak Test",
      mandatoryDealFields: MANDATORY_DEAL_FIELDS,
      pipeline: "Revenue Desk Sales",
      stage: "Setup and Authorization",
      type: "Initial Sale",
    },
    noEmailOrRoutingEffect: true,
  });
  assert.equal(8, result.revision);

  const missingType = createFieldSetupConversionService({
    crm: crm({ getDealFieldMetadata: async () => metadata({ Type: { writable: false } }) }),
    store: new Store(),
  });
  await assert.rejects(() => preview(missingType), /Mandatory Deal field Type/);
});

test("preview atomically binds the confirmation state to the current journey revision and session", async () => {
  const store = new Store();
  const service = createFieldSetupConversionService({ crm: crm(), store });
  const result = await preview(service);
  assert.deepEqual(store.audit[0], {
    method: "createPreview",
    value: {
      environment: "development",
      expectedConversionStatus: "not_started",
      expectedPreviewFingerprint: null,
      expectedRevision: 7,
      expectedState: "lead_conversion_preview",
      journeyKey: JOURNEY,
      leadId: LEAD,
      nextState: "lead_conversion_confirmation",
      operatorUserId: "100000000000005",
      previewFingerprint: result.previewFingerprint,
      sessionDigest: SESSION_DIGEST,
    },
  });
  await assert.rejects(
    () => service.buildPreview(
      { journeyKey: JOURNEY, leadId: LEAD },
      journey({ sessionDigest: "invalid" }),
      operator(),
      defaults(),
    ),
    /state is unavailable or stale/,
  );
});

test("readPreview re-reads mutable CRM evidence and controlled defaults before display", async () => {
  const calls = { candidates: 0, lead: 0, metadata: 0, options: 0 };
  const source = crm({
    findConversionCandidates: async () => { calls.candidates += 1; return candidates(); },
    getConversionOptions: async () => {
      calls.options += 1;
      return {
        ambiguous: false,
        nativeV8: true,
        permissions: permissions(),
        permitted: true,
        sourceLeadId: LEAD,
      };
    },
    getDealFieldMetadata: async () => {
      calls.metadata += 1;
      return metadata({
        Stage: { allowedValues: ["Setup and Authorization", "Qualified"] },
      });
    },
    getLead: async () => {
      calls.lead += 1;
      return {
        company: "ZZZ SYNTHETIC Plumbing",
        contactDisplayName: "ZZZ SYNTHETIC Contact",
        id: LEAD,
        locked: false,
      };
    },
  });
  const store = new Store();
  const service = createFieldSetupConversionService({ crm: source, store });
  const result = await preview(service);
  const readback = await service.readPreview(
    { journeyKey: JOURNEY, leadId: LEAD },
    confirmationJourney(result),
    operator(),
    defaults(),
  );
  assert.deepEqual(readback, result);
  assert.deepEqual(calls, { candidates: 2, lead: 2, metadata: 2, options: 2 });

  const refreshed = await service.readPreview(
    { journeyKey: JOURNEY, leadId: LEAD },
    confirmationJourney(result),
    operator(),
    { ...defaults(), stage: "Qualified" },
  );
  assert.notEqual(refreshed.previewFingerprint, result.previewFingerprint);
  assert.equal(refreshed.revision, result.revision + 1);
  assert.equal(refreshed.sanitizedPreview.deal.stage, "Qualified");
  assert.deepEqual(store.audit.at(-1), {
    method: "createPreview",
    value: {
      environment: "development",
      expectedConversionStatus: "preview_ready",
      expectedPreviewFingerprint: result.previewFingerprint,
      expectedRevision: result.revision,
      expectedState: "lead_conversion_confirmation",
      journeyKey: JOURNEY,
      leadId: LEAD,
      nextState: "lead_conversion_confirmation",
      operatorUserId: "100000000000005",
      previewFingerprint: refreshed.previewFingerprint,
      sessionDigest: SESSION_DIGEST,
    },
  });
  assert.deepEqual(calls, { candidates: 3, lead: 3, metadata: 3, options: 3 });
});

test("preview fails closed on unavailable permission, lock, ambiguous matches, or an existing Deal", async () => {
  const cases = [
    { getConversionOptions: async () => ({
      ambiguous: false,
      nativeV8: true,
      permissions: permissions({ convertLead: false }),
      permitted: true,
      sourceLeadId: LEAD,
    }) },
    { getLead: async () => ({ id: LEAD, company: "ZZZ SYNTHETIC", locked: true }) },
    { findConversionCandidates: async () => candidates({
      accounts: [
        { displayName: "ZZZ SYNTHETIC Plumbing", id: ACCOUNT },
        { displayName: "ZZZ SYNTHETIC Plumbing 2", id: "100000000000009" },
      ],
    }) },
    { findConversionCandidates: async () => candidates({
      deals: [{ displayName: "ZZZ SYNTHETIC Existing Deal", id: DEAL }],
    }) },
  ];
  for (const override of cases) {
    const service = createFieldSetupConversionService({ crm: crm(override), store: new Store() });
    await assert.rejects(() => preview(service));
  }
});

test("one Account and Contact match are sanitized in preview and no private plan is persisted", async () => {
  const store = new Store();
  const service = createFieldSetupConversionService({
    crm: crm({
      findConversionCandidates: async () => candidates({
        accounts: [{ displayName: "ZZZ SYNTHETIC Plumbing", id: ACCOUNT }],
        contacts: [{ displayName: "ZZZ SYNTHETIC Contact", id: CONTACT }],
      }),
    }),
    store,
  });
  const result = await preview(service);
  assert.deepEqual(result.sanitizedPreview.account, {
    action: "associate_one_verified_match",
    displayName: "ZZZ SYNTHETIC Plumbing",
  });
  assert.deepEqual(result.sanitizedPreview.contact, {
    action: "associate_one_verified_match",
    displayName: "ZZZ SYNTHETIC Contact",
  });
  assert.ok(!JSON.stringify(result.sanitizedPreview).includes(ACCOUNT));
  assert.ok(!JSON.stringify(result.sanitizedPreview).includes(CONTACT));
  const stored = JSON.stringify(store.audit);
  assert.ok(!stored.includes("ZZZ SYNTHETIC"));
  assert.ok(!stored.includes("privatePlan"));
  assert.ok(!stored.includes(ACCOUNT));
  assert.ok(!stored.includes(CONTACT));
  assert.ok(!stored.includes(DEAL));
});

test("confirmation requires the bound operator and explicit preview receipt", async () => {
  const store = new Store();
  const service = createFieldSetupConversionService({ crm: crm(), store });
  const result = await preview(service);
  await assert.rejects(
    () => confirm(service, result, operator({ operatorUserId: "100000000000006" })),
    /not bound/,
  );
  await assert.rejects(
    () => service.confirmConversion(
      { ...confirmation(result), confirm: false },
      confirmationJourney(result),
      operator(),
      defaults(),
      dealResumeBindingDigest,
    ),
    /confirmation is invalid/,
  );
});

test("confirmation re-reads authoritative evidence, verifies full readback, and replay cannot repeat the write", async () => {
  const store = new Store();
  const calls = { candidates: 0, lead: 0, metadata: 0, options: 0, readbackLead: null, writes: 0 };
  const source = crm({
    findConversionCandidates: async (leadId) => { assert.equal(LEAD, leadId); calls.candidates += 1; return candidates(); },
    getLead: async (leadId) => {
      assert.equal(LEAD, leadId);
      calls.lead += 1;
      return {
        id: LEAD,
        company: "ZZZ SYNTHETIC Plumbing",
        contactDisplayName: "ZZZ SYNTHETIC Contact",
        locked: false,
      };
    },
    getDealFieldMetadata: async (leadId) => { assert.equal(LEAD, leadId); calls.metadata += 1; return metadata(); },
    getConversionOptions: async (leadId) => { assert.equal(LEAD, leadId); calls.options += 1; return {
      ambiguous: false, nativeV8: true, permissions: permissions(), permitted: true, sourceLeadId: LEAD,
    }; },
    convertLead: async (plan) => { calls.writes += 1; return { accountId: plan.accountId ?? ACCOUNT, contactId: plan.contactId ?? CONTACT, dealId: DEAL }; },
    readConversionResult: async (leadId) => { calls.readbackLead = leadId; return authoritativeReadback(); },
  });
  const service = createFieldSetupConversionService({ crm: source, store });
  const result = await preview(service);
  assert.deepEqual(
    await confirm(service, result),
    { ok: true, replay: false, revision: 10, status: "conversion_readback_confirmed" },
  );
  assert.deepEqual(
    await confirm(service, result),
    { ok: true, replay: true, revision: 10, status: "conversion_readback_confirmed" },
  );
  assert.deepEqual(
    { candidates: calls.candidates, lead: calls.lead, metadata: calls.metadata, options: calls.options },
    { candidates: 2, lead: 2, metadata: 2, options: 2 },
  );
  assert.equal(LEAD, calls.readbackLead);
  assert.equal(1, calls.writes);
  const completion = store.audit.find((entry) => entry.method === "completeConversion");
  assert.deepEqual(Object.keys(completion.outcome), [
    "dealResumeBindingDigest",
    "nextState",
    "outcomeFingerprint",
  ]);
  assert.equal(DEAL_RESUME_BINDING_DIGEST, completion.outcome.dealResumeBindingDigest);
  assert.equal("handoff_to_client_form2", completion.outcome.nextState);
  assert.match(completion.outcome.outcomeFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(DEAL_RESUME_BINDING_DIGEST, store.completed.dealResumeBindingDigest);
  assert.equal("handoff_to_client_form2", store.completed.state);
});

test("a stale Lead preview blocks its confirmation, refreshes atomically, and converts once from the new receipt", async () => {
  let changed = false;
  let writes = 0;
  const store = new Store();
  const service = createFieldSetupConversionService({
    crm: crm({
      getLead: async () => ({
        id: LEAD,
        company: changed ? "ZZZ SYNTHETIC Changed" : "ZZZ SYNTHETIC Plumbing",
        contactDisplayName: "ZZZ SYNTHETIC Contact",
        locked: false,
      }),
      convertLead: async () => {
        writes += 1;
        return { accountId: ACCOUNT, contactId: CONTACT, dealId: DEAL };
      },
      readConversionResult: async () => {
        const readback = authoritativeReadback();
        readback.deal.fields.Deal_Name = "ZZZ SYNTHETIC Changed — Free Revenue Leak Test";
        return readback;
      },
    }),
    store,
  });
  const result = await preview(service);
  changed = true;
  await assert.rejects(() => confirm(service, result), /preview is stale/);
  assert.equal(0, writes);

  const refreshed = await service.readPreview(
    { journeyKey: JOURNEY, leadId: LEAD },
    confirmationJourney(result),
    operator(),
    defaults(),
  );
  assert.notEqual(refreshed.previewFingerprint, result.previewFingerprint);
  assert.equal(refreshed.revision, result.revision + 1);
  assert.equal(
    refreshed.sanitizedPreview.deal.dealName,
    "ZZZ SYNTHETIC Changed — Free Revenue Leak Test",
  );
  assert.deepEqual(
    await confirm(service, refreshed),
    { ok: true, replay: false, revision: refreshed.revision + 2, status: "conversion_readback_confirmed" },
  );
  assert.equal(1, writes);
});

test("changed duplicate, picklist, or permission evidence blocks stale confirmation before the write boundary", async () => {
  const cases = [
    {
      changedCandidates: candidates({
        deals: [{ displayName: "ZZZ SYNTHETIC Existing Deal", id: DEAL }],
      }),
      pattern: /existing matching Deal/,
    },
    {
      changedMetadata: metadata({ Type: { allowedValues: ["Renewal"] } }),
      pattern: /not a current picklist option/,
    },
    {
      changedOptions: {
        ambiguous: false,
        nativeV8: true,
        permissions: permissions({ createDeal: false }),
        permitted: true,
        sourceLeadId: LEAD,
      },
      pattern: /createDeal permission/,
    },
  ];
  for (const scenario of cases) {
    let changed = false;
    let writes = 0;
    const source = crm({
      findConversionCandidates: async () => changed && scenario.changedCandidates ? scenario.changedCandidates : candidates(),
      getDealFieldMetadata: async () => changed && scenario.changedMetadata ? scenario.changedMetadata : metadata(),
      getConversionOptions: async () => changed && scenario.changedOptions ? scenario.changedOptions : {
        ambiguous: false, nativeV8: true, permissions: permissions(), permitted: true, sourceLeadId: LEAD,
      },
      convertLead: async () => { writes += 1; throw new Error("must not run"); },
    });
    const service = createFieldSetupConversionService({ crm: source, store: new Store() });
    const result = await preview(service);
    changed = true;
    await assert.rejects(() => confirm(service, result), scenario.pattern);
    assert.equal(0, writes);
  }
});

test("write_started is a durable one-way boundary against concurrent duplicate confirmation", async () => {
  const store = new Store();
  let releaseWrite;
  let signalWrite;
  let writes = 0;
  const writeEntered = new Promise((resolve) => { signalWrite = resolve; });
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  const service = createFieldSetupConversionService({
    crm: crm({
      convertLead: async () => {
        writes += 1;
        signalWrite();
        await writeGate;
        return { accountId: ACCOUNT, contactId: CONTACT, dealId: DEAL };
      },
    }),
    store,
  });
  const result = await preview(service);
  const first = confirm(service, result);
  await writeEntered;
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  releaseWrite();
  await first;
  assert.equal(1, writes);
  assert.equal(1, store.audit.filter((entry) => entry.method === "markWriteStarted").length);
});

test("failed or ambiguous native conversion remains reconciliation-only and is never retried", async () => {
  const store = new Store();
  let writes = 0;
  const service = createFieldSetupConversionService({
    crm: crm({
      convertLead: async () => {
        writes += 1;
        throw new Error("synthetic native conversion failure");
      },
    }),
    store,
  });
  const result = await preview(service);
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  assert.equal(1, writes);
  assert.equal("reconciliation_required", store.status);
});

test("ambiguous write-boundary persistence attempts no CRM write and becomes reconciliation-only", async () => {
  const store = new Store({ failWriteBoundary: true });
  let writes = 0;
  const service = createFieldSetupConversionService({
    crm: crm({ convertLead: async () => { writes += 1; throw new Error("must not run"); } }),
    store,
  });
  const result = await preview(service);
  await assert.rejects(() => confirm(service, result), /write boundary/);
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  assert.equal(0, writes);
  assert.equal("reconciliation_required", store.status);
});

test("association, mandatory-field, and mapping readback mismatches are contained without retry", async () => {
  const mismatches = [
    () => authoritativeReadback({
      requestedAccountId: ACCOUNT,
      requestedContactId: CONTACT,
      overrides: { contact: { accountId: "100000000000099", id: CONTACT, sourceLeadId: LEAD } },
    }),
    () => {
      const value = authoritativeReadback({ requestedAccountId: ACCOUNT, requestedContactId: CONTACT });
      value.deal.fields.Type = "Renewal";
      return value;
    },
    () => {
      const value = authoritativeReadback({ requestedAccountId: ACCOUNT, requestedContactId: CONTACT });
      value.conversionMappings.requestedContactId = null;
      return value;
    },
  ];
  for (const mismatch of mismatches) {
    const store = new Store();
    let writes = 0;
    const service = createFieldSetupConversionService({
      crm: crm({
        findConversionCandidates: async () => candidates({
          accounts: [{ displayName: "ZZZ SYNTHETIC Plumbing", id: ACCOUNT }],
          contacts: [{ displayName: "ZZZ SYNTHETIC Contact", id: CONTACT }],
        }),
        convertLead: async () => { writes += 1; return { accountId: ACCOUNT, contactId: CONTACT, dealId: DEAL }; },
        readConversionResult: async () => mismatch(),
      }),
      store,
    });
    const result = await preview(service);
    await assert.rejects(() => confirm(service, result), /reconciliation/);
    await assert.rejects(() => confirm(service, result), /reconciliation/);
    assert.equal(1, writes);
  }
});

test("completion-store failure retains the write boundary and never repeats convertLead", async () => {
  const store = new Store({ failCompletion: true });
  let writes = 0;
  const service = createFieldSetupConversionService({
    crm: crm({
      convertLead: async () => { writes += 1; return { accountId: ACCOUNT, contactId: CONTACT, dealId: DEAL }; },
    }),
    store,
  });
  const result = await preview(service);
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  await assert.rejects(() => confirm(service, result), /reconciliation/);
  assert.equal(1, writes);
  assert.equal("reconciliation_required", store.status);

  const persisted = JSON.stringify(store.audit);
  assert.ok(!persisted.includes("ZZZ SYNTHETIC"));
  assert.ok(!persisted.includes(ACCOUNT));
  assert.ok(!persisted.includes(CONTACT));
  assert.ok(!persisted.includes(DEAL));
});
