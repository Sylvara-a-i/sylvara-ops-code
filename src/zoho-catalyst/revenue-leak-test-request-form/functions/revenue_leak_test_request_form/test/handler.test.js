"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { normalizeFormData } = require("../lib/form-contract");
const { ControllerError, buildAccessUrl, handleRequest } = require("../lib/handler");
const { submissionFingerprint } = require("../lib/security");
const { createSessionStore } = require("../lib/session-store");
const { assistedConstantsSha256, recoveryClaimBindingSha256 } = require("../lib/submission-recovery");
const { REVISION, environment } = require("./helpers");

const RECORD_ID = "4000000001";
const OTHER_RECORD_ID = "4000000002";
const JOURNEY_ID = "journey_synthetic_001";
const NOW = Date.parse("2026-08-29T12:00:00.000Z");

test("access links preserve the Gateway source path and append only the credential fragment", () => {
  const config = loadConfig(environment(), REVISION);
  const journeyToken = Buffer.alloc(32, 0x41).toString("base64url");
  const result = new URL(buildAccessUrl(config, journeyToken));
  assert.equal(result.origin, "https://synthetic.development.catalystserverless.com");
  assert.equal(result.pathname, `/sylvara-dev/${"A".repeat(43)}`);
  assert.equal(result.search, "");
  assert.equal(result.hash, `#journeyToken=${journeyToken}`);
  assert.notEqual(result.pathname, config.accessPath);

  assert.throws(
    () => buildAccessUrl({
      ...config,
      form1AccessPublicUrl:
        "https://synthetic.development.catalystserverless.com/form1/access-test",
    }, journeyToken),
    (error) => error instanceof ControllerError &&
      error.publicCode === "configuration_invalid" &&
      !error.message.includes(journeyToken),
  );
});

function formData(overrides = {}) {
  return {
    firstName: "ZZZ", lastName: "Synthetic", company: "ZZZ SYNTHETIC Plumbing",
    decisionMakerRole: "Owner", jobTitle: "", email: "synthetic@example.invalid",
    mobilePhone: "+15555550101", companyPhone: "+15555550102",
    currentCallHandling: "Voicemail", preferredTestRoute: "After Hours",
    phoneSystemProvider: "Synthetic Provider", primaryServiceArea: "ZZZ SYNTHETIC",
    fieldTeamSizeBand: "1-5", additionalNotes: "", contactConsent: true,
    leadSource: "Other", sourcePage: "", utmSource: "synthetic", utmMedium: "",
    utmCampaign: "", utmTerm: "", utmContent: "", ...overrides,
  };
}

function memoryAdapter() {
  const rows = [];
  let nextRowId = 1;
  const mandatoryUniqueColumns = ["TOKEN_HASH", "INTAKE_SUBMISSION_ID"];
  const selected = (predicate) => rows.filter(predicate).map((row) => ({ ...row }));
  const assertProviderShape = (candidate, currentRowId = null) => {
    if (mandatoryUniqueColumns.some((column) =>
      typeof candidate[column] !== "string" || candidate[column].length === 0)) {
      throw new Error("mandatory");
    }
    if (rows.some((row) => row.ROWID !== currentRowId &&
        mandatoryUniqueColumns.some((column) => row[column] === candidate[column]))) {
      throw new Error("duplicate");
    }
  };
  return {
    rows,
    findRowsByJourneyId: async (_table, value) =>
      selected((row) => row.INTAKE_SUBMISSION_ID === value),
    findRowsByPrefillHandleHash: async (_table, value) =>
      selected((row) => row.PREFILL_HANDLE_HASH === value),
    findRowsByPrefillId: async (_table, value) => selected((row) => row.PREFILL_ID === value),
    findRowsByRowId: async (_table, value) => selected((row) => row.ROWID === String(value)),
    findRowsByTokenHash: async (_table, value) => selected((row) => row.TOKEN_HASH === value),
    async insertRow(_table, row) {
      assertProviderShape(row);
      rows.push({ ROWID: String(nextRowId++), ...row });
    },
    async updateRow(_table, update, expected) {
      const row = rows.find((candidate) => candidate.ROWID === String(update.ROWID));
      if (!row || Object.entries(expected).some(([key, value]) =>
        (typeof value === "number" ? Number(row[key]) !== value : row[key] !== value))) return [];
      const patch = Object.fromEntries(
        Object.entries(update).filter(([key]) => key !== "ROWID"),
      );
      assertProviderShape({ ...row, ...patch }, row.ROWID);
      Object.assign(row, patch);
      return [];
    },
  };
}

function post(path, body, header, secret) {
  return {
    method: "POST", url: path,
    headers: { "content-type": "application/json", ...(header ? { [header]: secret } : {}) },
    rawBody: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

function fixture() {
  let currentTime = NOW;
  let entropy = 1;
  let uuidSequence = 1;
  const config = loadConfig(environment(), REVISION);
  const adapter = memoryAdapter();
  const records = new Map([
    [RECORD_ID, {
      id: RECORD_ID, Modified_Time: "2026-08-29T11:59:00.000Z",
      Intake_Submission_ID: JOURNEY_ID, First_Name: "ZZZ", Last_Name: "Synthetic",
      Company: "ZZZ SYNTHETIC Plumbing", Email: "synthetic@example.invalid",
      Decision_Maker_Role: "Owner", Mobile: "+15555550101",
      Main_Business_Phone: "+15555550102", Current_Call_Handling: "Voicemail",
      Requested_Test_Route: "After Hours",
    }],
    [OTHER_RECORD_ID, {
      id: OTHER_RECORD_ID, Modified_Time: "2026-08-29T11:59:00.000Z",
      Intake_Submission_ID: "journey_synthetic_002",
    }],
  ]);
  const events = [];
  const crmClient = {
    async getRecord(module, recordId) {
      events.push(["get", module, recordId]);
      return { ...records.get(recordId) };
    },
    async getOrInitializeJourney(module, recordId) {
      const record = await this.getRecord(module, recordId);
      return { record, journeyId: record.Intake_Submission_ID, initialized: false };
    },
    assertJourney(record, journeyId) {
      if (record?.Intake_Submission_ID !== journeyId) {
        const error = new Error("mismatch");
        error.publicCode = "context_conflict";
        error.status = 409;
        throw error;
      }
    },
    recordMatches(record, patch) {
      return Object.entries(patch).every(([key, value]) => record[key] === value);
    },
    recordVersion(record) { return record.Modified_Time; },
    async completeAssistedSubmission(module, record, patch, expectedVersion) {
      if (record.Modified_Time !== expectedVersion) {
        const error = new Error("stale");
        error.publicCode = "record_stale";
        error.status = 409;
        throw error;
      }
      events.push(["update", module, record.id]);
      Object.assign(records.get(record.id), patch);
      return { record: { ...records.get(record.id) }, replayed: false };
    },
  };
  const now = () => currentTime;
  const nextUuid = () => `00000000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`;
  return {
    adapter, config, events, records,
    setNow(value) { currentTime = value; },
    dependencies: {
      config, crmClient, now,
      randomBytes(size) { return Buffer.alloc(size, entropy++); },
      randomUUID: nextUuid,
      sessionStore: createSessionStore(adapter, config, { now, randomUUID: nextUuid }),
    },
  };
}

async function launch(selected, overrides = {}) {
  return handleRequest(post(
    selected.config.issuePath,
    { crmModule: "Leads", recordId: RECORD_ID, ...overrides },
    selected.config.issueHeaderName,
    selected.config.issueHeaderSecret,
  ), selected.dependencies);
}

function journeyTokenFrom(result) {
  const url = new URL(result.body.accessUrl);
  assert.equal(url.search, "");
  assert.deepEqual([...new URLSearchParams(url.hash.slice(1)).keys()], ["journeyToken"]);
  const token = new URLSearchParams(url.hash.slice(1)).get("journeyToken");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.body.accessUrl.includes(RECORD_ID), false);
  assert.equal(result.body.accessUrl.includes("synthetic@example.invalid"), false);
  return token;
}

async function exchange(selected, journeyToken) {
  const result = await handleRequest(post(selected.config.exchangePath, { journeyToken }),
    selected.dependencies);
  const url = new URL(result.body.formUrl);
  assert.deepEqual([...url.searchParams.keys()], [selected.config.form1PrefillHandleFieldAlias]);
  const prefillHandle = url.searchParams.get(selected.config.form1PrefillHandleFieldAlias);
  assert.match(prefillHandle, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.body.formUrl.includes(journeyToken), false);
  return { result, prefillHandle };
}

async function prefill(selected, prefillHandle) {
  return handleRequest(post(
    selected.config.prefillPath,
    { prefillHandle },
    selected.config.prefillHeaderName,
    selected.config.prefillHeaderSecret,
  ), selected.dependencies);
}

async function prepare(selected) {
  const issue = await launch(selected);
  const journeyToken = journeyTokenFrom(issue);
  const exchanged = await exchange(selected, journeyToken);
  const prepared = await prefill(selected, exchanged.prefillHandle);
  return {
    issue, journeyToken, prefillHandle: exchanged.prefillHandle,
    prefillId: prepared.body.prefillId,
    configurationRevision: prepared.body.configurationRevision,
  };
}

async function submit(selected, prepared, submissionId = "submission_001", extra = {}) {
  return handleRequest(post(
    selected.config.submissionPath,
    {
      prefillId: prepared.prefillId,
      configurationRevision: prepared.configurationRevision,
      submissionId,
      formData: formData(),
      ...extra,
    },
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
  ), selected.dependencies);
}

function providerSubmissionBody({
  prefillId = "",
  configurationRevision = "",
  submissionId = "provider_submission_001",
  formOverrides = {},
  extra = {},
} = {}) {
  return {
    prefillId,
    configurationRevision,
    submissionId,
    ...formData(formOverrides),
    ...extra,
  };
}

async function submitProvider(selected, options = {}) {
  return handleRequest(post(
    selected.config.submissionPath,
    providerSubmissionBody(options),
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
  ), selected.dependencies);
}

test("launch keeps the journey credential in a Catalyst fragment and stores only its digest", async () => {
  const selected = fixture();
  const issue = await launch(selected);
  assert.equal(issue.status, 201);
  const token = journeyTokenFrom(issue);
  const [row] = selected.adapter.rows;
  assert.equal(selected.adapter.rows.length, 1);
  assert.match(row.TOKEN_HASH, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes(token), false);
  assert.equal(row.CRM_LEAD_ID, RECORD_ID);
  assert.equal(row.INTAKE_SUBMISSION_ID, JOURNEY_ID);
  assert.equal(row.EXPECTED_STAGE, "form1");
  assert.match(row.FORM_IDENTITY_HASH, /^[a-f0-9]{64}$/);
  assert.equal(row.PREFILL_HANDLE_HASH, null);
  assert.equal(row.PREFILL_ID, null);
});

test("access page removes the fragment and posts the journey credential once", async () => {
  const selected = fixture();
  const result = await handleRequest({ method: "GET", url: selected.config.accessPath },
    selected.dependencies);
  assert.equal(result.status, 200);
  assert.match(result.body, /history\.replaceState\(null, "", location\.pathname\)/);
  assert.match(result.body, /const body = JSON\.stringify\(\{ journeyToken \}\)/);
  assert.match(result.body, /journeyToken = ""/);
  assert.doesNotMatch(result.body, /CRM_LEAD_ID|recordId|synthetic@example/);
});

test("exchange creates a distinct digest-only one-time prefill handle", async () => {
  const selected = fixture();
  const journeyToken = journeyTokenFrom(await launch(selected));
  const { prefillHandle } = await exchange(selected, journeyToken);
  const [row] = selected.adapter.rows;
  assert.equal(row.STATUS, "handle_issued");
  assert.match(row.PREFILL_HANDLE_HASH, /^[a-f0-9]{64}$/);
  assert.match(row.PREFILL_ID, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.stringify(row).includes(prefillHandle), false);
  assert.notEqual(prefillHandle, journeyToken);
  await assert.rejects(() => exchange(selected, journeyToken), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
});

test("duplicate prefill-handle lookup results fail closed", async () => {
  const selected = fixture();
  const journeyToken = journeyTokenFrom(await launch(selected));
  const { prefillHandle } = await exchange(selected, journeyToken);
  const [source] = selected.adapter.rows;
  selected.adapter.rows.push({
    ...source,
    ROWID: "2",
    TOKEN_HASH: "d".repeat(64),
    PREFILL_ID: "10000000-0000-4000-8000-000000000099",
    INTAKE_SUBMISSION_ID: "journey_synthetic_duplicate_handle",
  });

  await assert.rejects(
    () => prefill(selected, prefillHandle),
    (error) => error.status === 503 && error.publicCode === "service_unavailable" &&
      error.ambiguous === true,
  );
  assert.equal(selected.events.filter(([name]) => name === "get").length, 1);
});

test("duplicate prefill-identifier lookup results fail closed", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const [source] = selected.adapter.rows;
  selected.adapter.rows.push({
    ...source,
    ROWID: "2",
    TOKEN_HASH: "d".repeat(64),
    PREFILL_HANDLE_HASH: "e".repeat(64),
    INTAKE_SUBMISSION_ID: "journey_synthetic_duplicate_prefill_id",
  });

  const writes = selected.events.filter(([name]) => name === "update").length;
  await assert.rejects(
    () => submit(selected, prepared),
    (error) => error.status === 503 && error.publicCode === "service_unavailable" &&
      error.ambiguous === true,
  );
  assert.equal(selected.events.filter(([name]) => name === "update").length, writes);
});

test("missing, tampered, expired, and consumed handles fail closed", async () => {
  const selected = fixture();
  const token = journeyTokenFrom(await launch(selected));
  const { prefillHandle } = await exchange(selected, token);
  await assert.rejects(() => prefill(selected, ""), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  const tampered = `${prefillHandle.slice(0, -1)}${prefillHandle.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(() => prefill(selected, tampered), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  await prefill(selected, prefillHandle);
  await assert.rejects(() => prefill(selected, prefillHandle), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  assert.equal(selected.adapter.rows[0].PREFILL_COUNT, 1);

  const expired = fixture();
  const expiredToken = journeyTokenFrom(await launch(expired));
  const expiredHandle = (await exchange(expired, expiredToken)).prefillHandle;
  expired.setNow(NOW + 601_000);
  await assert.rejects(() => prefill(expired, expiredHandle), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
});

test("two concurrent uses of one prefill handle disclose the record exactly once", async () => {
  const selected = fixture();
  const token = journeyTokenFrom(await launch(selected));
  const { prefillHandle } = await exchange(selected, token);
  const originalGet = selected.dependencies.crmClient.getRecord;
  let arrivals = 0;
  let release;
  const bothReady = new Promise((resolve) => { release = resolve; });
  selected.dependencies.crmClient.getRecord = async (...args) => {
    const record = await originalGet(...args);
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    return record;
  };

  const results = await Promise.allSettled([
    prefill(selected, prefillHandle),
    prefill(selected, prefillHandle),
  ]);
  const successes = results.filter(({ status }) => status === "fulfilled");
  const failures = results.filter(({ status }) => status === "rejected");
  assert.equal(successes.length, 1);
  assert.equal(successes[0].value.status, 200);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.ambiguous, true);
  assert.equal(selected.adapter.rows[0].PREFILL_COUNT, 1);
  assert.match(
    selected.adapter.rows[0].PREFILL_CONSUMPTION_OWNER,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("prefill returns minimum mapped data plus non-secret binding and never consent", async () => {
  const selected = fixture();
  const token = journeyTokenFrom(await launch(selected));
  const { prefillHandle } = await exchange(selected, token);
  const result = await prefill(selected, prefillHandle);
  assert.equal(result.body.firstName, "ZZZ");
  assert.equal(result.body.company, "ZZZ SYNTHETIC Plumbing");
  assert.match(result.body.prefillId, /^[0-9a-f-]{36}$/);
  assert.equal(result.body.configurationRevision, REVISION);
  assert.equal(Object.hasOwn(result.body, "contactConsent"), false);
  assert.equal(JSON.stringify(result.body).includes(RECORD_ID), false);
  assert.equal(JSON.stringify(result.body).includes(JOURNEY_ID), false);
});

test("assisted submission resolves CRM server-side and contains no bearer", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const result = await submit(selected, prepared);
  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, false);
  assert.equal(selected.records.get(RECORD_ID).Submission_Channel, "CRM Assisted");
  assert.equal(selected.records.get(OTHER_RECORD_ID).Submission_Channel, undefined);
  await assert.rejects(
    () => submit(selected, prepared, "submission_cross", { recordId: OTHER_RECORD_ID }),
    (error) => error.status === 422 && error.publicCode === "request_invalid",
  );
});

test("same assisted submission replays while changed identity, payload, or revision conflicts", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  await submit(selected, prepared);
  const updates = selected.events.filter(([name]) => name === "update").length;
  assert.equal((await submit(selected, prepared)).body.replayed, true);
  assert.equal(selected.events.filter(([name]) => name === "update").length, updates);
  await assert.rejects(() => submit(selected, prepared, "submission_002"), (error) =>
    error.status === 409 && error.publicCode === "submission_conflict");
  await assert.rejects(() => submit(selected, prepared, "submission_001", {
    formData: formData({ company: "ZZZ SYNTHETIC Different Plumbing" }),
  }), (error) => error.status === 409 && error.publicCode === "submission_conflict");
  await assert.rejects(() => submit(selected, {
    ...prepared, configurationRevision: "b".repeat(40),
  }), (error) => error.status === 404 && error.publicCode === "session_not_found");
});

test("concurrent identical submissions cross the CRM boundary once", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const originalGet = selected.dependencies.crmClient.getRecord;
  let arrivals = 0;
  let release;
  const bothReady = new Promise((resolve) => { release = resolve; });
  selected.dependencies.crmClient.getRecord = async (...args) => {
    const record = await originalGet(...args);
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    return record;
  };
  const results = await Promise.allSettled([
    submit(selected, prepared), submit(selected, prepared),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(selected.events.filter(([name]) => name === "update").length, 1);
  assert.equal(selected.adapter.rows[0].STATUS, "consumed");
  const replay = await submit(selected, prepared);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(selected.events.filter(([name]) => name === "update").length, 1);
});

test("public Form 1 remains tokenless and cannot manufacture assisted binding", async () => {
  const selected = fixture();
  const result = await handleRequest(post(
    selected.config.submissionPath,
    { submissionId: "public_submission_001" },
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
  ), selected.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, binding: "public_unbound" });
  assert.equal(selected.adapter.rows.length, 0);
  await assert.rejects(() => handleRequest(post(
    selected.config.submissionPath,
    { submissionId: "public_submission_002", recordId: RECORD_ID },
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
  ), selected.dependencies), (error) => error.status === 422);
});

test("flat Zoho Forms public envelope derives only the canonical public acknowledgment", async () => {
  const selected = fixture();
  const result = await submitProvider(selected, {
    submissionId: "provider_public_001",
    formOverrides: { contactConsent: "true" },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, binding: "public_unbound" });
  assert.equal(selected.adapter.rows.length, 0);
  assert.deepEqual(selected.events, []);

  const nullBinding = await submitProvider(selected, {
    prefillId: null,
    configurationRevision: null,
    submissionId: "provider_public_002",
  });
  assert.equal(nullBinding.status, 200);
  assert.deepEqual(nullBinding.body, { ok: true, binding: "public_unbound" });
  assert.equal(selected.adapter.rows.length, 0);
  assert.deepEqual(selected.events, []);
});

test("flat Zoho Forms assisted envelope derives the nested allowlisted submission", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const submission = {
    prefillId: prepared.prefillId,
    configurationRevision: prepared.configurationRevision,
    submissionId: "provider_assisted_001",
  };
  const result = await submitProvider(selected, submission);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, replayed: false });
  assert.equal(selected.records.get(RECORD_ID).Submission_Channel, "CRM Assisted");
  const updates = selected.events.filter(([name]) => name === "update").length;
  assert.equal(updates, 1);

  const replay = await submitProvider(selected, submission);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { ok: true, replayed: true });
  assert.equal(selected.events.filter(([name]) => name === "update").length, updates);

  await assert.rejects(
    () => submitProvider(selected, {
      ...submission,
      formOverrides: { company: "ZZZ SYNTHETIC Different Plumbing" },
    }),
    (error) => error.status === 409 && error.publicCode === "submission_conflict",
  );
  assert.equal(selected.events.filter(([name]) => name === "update").length, updates);
});

test("flat Zoho Forms envelope rejects partial assisted binding", async () => {
  const selected = fixture();
  const cases = [
    {
      prefillId: "00000000-0000-4000-8000-000000000001",
      configurationRevision: "",
    },
    { prefillId: "", configurationRevision: REVISION },
    {
      prefillId: "00000000-0000-4000-8000-000000000001",
      configurationRevision: null,
    },
    { prefillId: null, configurationRevision: REVISION },
  ];
  for (const binding of cases) {
    await assert.rejects(
      () => submitProvider(selected, binding),
      (error) => error.status === 422 && error.publicCode === "request_invalid",
    );
  }
  assert.equal(selected.adapter.rows.length, 0);
  assert.deepEqual(selected.events, []);
});

test("flat Zoho Forms string consent becomes the same typed idempotent command", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const submission = {
    prefillId: prepared.prefillId,
    configurationRevision: prepared.configurationRevision,
    submissionId: "provider_string_consent_001",
  };
  const result = await submitProvider(selected, {
    ...submission,
    formOverrides: { contactConsent: "true" },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, replayed: false });
  assert.equal(selected.records.get(RECORD_ID).Free_Test_Contact_Consent, true);
  assert.equal(selected.adapter.rows[0].STATUS, "consumed");
  assert.equal(selected.adapter.rows[0].SUBMISSION_STARTED_AT, new Date(NOW).toISOString());
  assert.equal(selected.adapter.rows[0].SUBMISSION_FINGERPRINT, submissionFingerprint(
    submission.submissionId, prepared.prefillId, prepared.configurationRevision,
    normalizeFormData(formData()), selected.config.tokenPepper,
  ));

  const replay = await submit(selected, prepared, submission.submissionId);
  assert.deepEqual(replay.body, { ok: true, replayed: true });
  assert.equal(selected.events.filter(([name]) => name === "update").length, 1);
});

test("flat string-consent claim crosses only the exact approved recovery boundary", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const submission = {
    prefillId: prepared.prefillId,
    configurationRevision: prepared.configurationRevision,
    submissionId: "provider_recovery_consent_001",
    formOverrides: { contactConsent: "true" },
  };
  assert.equal(Object.keys(providerSubmissionBody(submission)).length, 25);
  const originalStore = selected.dependencies.sessionStore;
  const originalComplete = selected.dependencies.crmClient.completeAssistedSubmission;
  // Reproduce a durable original claim whose writer dependency failed before PUT.
  selected.dependencies.crmClient.completeAssistedSubmission = async () => {
    throw Object.assign(new Error("Synthetic writer unavailable"), {
      publicCode: "connection_unavailable", status: 503,
    });
  };
  await assert.rejects(() => submitProvider(selected, submission), (error) =>
    error.status === 503 && error.publicCode === "service_unavailable");
  const original = await originalStore.readByPrefillId(prepared.prefillId);
  assert.equal(original.status, "submitting");
  assert.equal(original.lastOutcome, "submission_started");
  assert.equal(original.submissionFingerprint, submissionFingerprint(
    submission.submissionId, prepared.prefillId, REVISION,
    normalizeFormData(formData()), selected.config.tokenPepper,
  ));
  assert.equal(selected.events.some(([name]) => name === "update"), false);
  const originalRaw = structuredClone(selected.adapter.rows[0]);
  selected.events.length = 0;

  const currentRevision = "b".repeat(40);
  const manifest = {
    schemaVersion: 1, mode: "inspect", originalSourceRevision: REVISION,
    claimBindingSha256: recoveryClaimBindingSha256(original),
    assistedConstantsSha256: assistedConstantsSha256(selected.config.assistedConstants),
    originalSessionVersion: original.sessionVersion, originalUpdatedAt: original.updatedAt,
    originalLastOutcome: original.lastOutcome,
  };
  const currentConfig = (recoveryManifest = null) => loadConfig(environment({
    SOURCE_REVISION: currentRevision,
    FORM1_RECOVERY_MANIFEST_JSON: recoveryManifest ? JSON.stringify(recoveryManifest) : "",
  }), currentRevision);
  selected.dependencies.config = currentConfig();
  selected.dependencies.sessionStore = createSessionStore(selected.adapter,
    selected.dependencies.config, {
      now: selected.dependencies.now, randomUUID: selected.dependencies.randomUUID,
    });
  // Installing a new runtime alone must not admit or migrate the old submission.
  await assert.rejects(() => submitProvider(selected, submission), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  assert.deepEqual(selected.adapter.rows[0], originalRaw);
  assert.deepEqual(selected.events, []);

  selected.dependencies.crmClient.completeAssistedSubmission = originalComplete;
  selected.dependencies.crmClient.preflightAssistedWrite = async () => {
    selected.events.push(["preflight"]);
    return { ok: true };
  };
  selected.dependencies.recoverySessionStore = {
    ...originalStore,
    async reserveRecoveryAttempt(...args) {
      selected.events.push(["reserve"]);
      return originalStore.reserveRecoveryAttempt(...args);
    },
    async consume(...args) {
      selected.events.push(["consume"]);
      return originalStore.consume(...args);
    },
  };
  selected.dependencies.config = currentConfig(manifest);
  const inspected = await submitProvider(selected, submission);
  assert.equal(inspected.status, 503);
  assert.equal(inspected.outcome, "recovery_inspected");
  assert.deepEqual(inspected.body, {
    ok: false, inspected: true, poststateMatches: false,
    originalVersionMatches: true, recoveryReady: true,
  });
  assert.deepEqual(selected.events.map(([name]) => name), ["get", "preflight"]);
  assert.deepEqual(selected.adapter.rows[0], originalRaw);

  selected.events.length = 0;
  selected.setNow(NOW + 1000);
  selected.dependencies.config = currentConfig({ ...manifest, mode: "complete" });
  const completed = await submitProvider(selected, submission);
  assert.equal(completed.status, 200);
  assert.deepEqual(completed.body, { ok: true, recovered: true, replayed: false });
  assert.deepEqual(selected.events.map(([name]) => name),
    ["get", "preflight", "reserve", "update", "consume"]);
  const consumed = await originalStore.readByPrefillId(prepared.prefillId);
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.sessionVersion, original.sessionVersion + 2);
  assert.match(consumed.lastOutcome, new RegExp(`^r1_${currentRevision}_[a-f0-9]{32}$`));
  for (const [key, value] of Object.entries(original)) {
    if (!["status", "lastOutcome", "sessionVersion", "updatedAt", "consumedAt"].includes(key)) {
      assert.deepEqual(consumed[key], value, key);
    }
  }
  assert.equal(selected.records.get(RECORD_ID).Free_Test_Contact_Consent, true);
  assert.equal(selected.records.get(OTHER_RECORD_ID).Submission_Channel, undefined);
});

test("provider consent normalization does not accept internal string consent", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const before = structuredClone(selected.adapter.rows[0]);
  const eventsBefore = selected.events.length;
  await assert.rejects(
    () => submit(selected, prepared, "internal_string_consent_001", {
      formData: formData({ contactConsent: "true" }),
    }),
    (error) => error.status === 422 && error.publicCode === "form_data_invalid",
  );
  assert.deepEqual(selected.adapter.rows[0], before);
  assert.equal(selected.events.length, eventsBefore);
});

test("flat consent normalization still requires authentication before session access", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const before = structuredClone(selected.adapter.rows[0]);
  const eventsBefore = selected.events.length;
  selected.dependencies.sessionStore = {
    ...selected.dependencies.sessionStore,
    async readByPrefillId() {
      assert.fail("unauthenticated submission must not read the session");
    },
  };
  await assert.rejects(
    () => handleRequest(post(selected.config.submissionPath, providerSubmissionBody({
      prefillId: prepared.prefillId,
      configurationRevision: prepared.configurationRevision,
      formOverrides: { contactConsent: "true" },
    })), selected.dependencies),
    (error) => error.status === 401 && error.publicCode === "authentication_failed",
  );
  assert.deepEqual(selected.adapter.rows[0], before);
  assert.equal(selected.events.length, eventsBefore);
});

test("flat Zoho Forms envelope rejects extra identity and non-affirmative consent", async () => {
  const selected = fixture();
  await assert.rejects(
    () => submitProvider(selected, { extra: { recordId: RECORD_ID } }),
    (error) => error.status === 422 && error.publicCode === "request_invalid",
  );
  const prepared = await prepare(selected);
  const before = structuredClone(selected.adapter.rows[0]);
  const eventsBefore = selected.events.length;
  for (const contactConsent of [
    false, "false", "True", "TRUE", " true", "true ", "1", "yes", "I agree", "",
    1, 0, null, ["true"], [true], { checked: true },
  ]) {
    await assert.rejects(
      () => submitProvider(selected, {
        prefillId: prepared.prefillId,
        configurationRevision: prepared.configurationRevision,
        formOverrides: { contactConsent },
      }),
      (error) => error.status === 422 && error.publicCode === "form_data_invalid",
    );
    assert.deepEqual(selected.adapter.rows[0], before);
    assert.equal(selected.events.length, eventsBefore);
  }
});

test("reissue rotates both credentials without duplicating the journey", async () => {
  const selected = fixture();
  const first = journeyTokenFrom(await launch(selected));
  const firstHandle = (await exchange(selected, first)).prefillHandle;
  const firstPrefillId = selected.adapter.rows[0].PREFILL_ID;
  const second = journeyTokenFrom(await launch(selected));
  assert.notEqual(first, second);
  assert.equal(selected.adapter.rows.length, 1);
  assert.equal(selected.adapter.rows[0].STATUS, "issued");
  assert.equal(selected.adapter.rows[0].PREFILL_HANDLE_HASH, null);
  assert.equal(selected.adapter.rows[0].PREFILL_ID, null);
  await assert.rejects(() => prefill(selected, firstHandle), (error) => error.status === 404);
  await assert.rejects(() => submit(selected, {
    prefillId: firstPrefillId,
    configurationRevision: REVISION,
  }), (error) => error.status === 404 && error.publicCode === "session_not_found");
  const secondHandle = (await exchange(selected, second)).prefillHandle;
  assert.equal((await prefill(selected, secondHandle)).status, 200);
});

test("clean issued reissue adopts the current release and form without duplication", async () => {
  const selected = fixture();
  const first = journeyTokenFrom(await launch(selected));
  const row = selected.adapter.rows[0];
  const originalRowId = row.ROWID;
  const originalCreatedAt = row.CREATED_AT;
  const originalVersion = row.SESSION_VERSION;
  row.SOURCE_REVISION = "b".repeat(40);
  row.FORM_IDENTITY_HASH = "c".repeat(64);

  const second = journeyTokenFrom(await launch(selected));
  assert.notEqual(first, second);
  assert.equal(selected.adapter.rows.length, 1);
  assert.equal(row.ROWID, originalRowId);
  assert.equal(row.CREATED_AT, originalCreatedAt);
  assert.equal(row.SESSION_VERSION, originalVersion + 1);
  assert.equal(row.STATUS, "issued");
  assert.equal(row.LAST_OUTCOME, `binding_reissued_from_${"b".repeat(40)}`);
  assert.equal(row.SOURCE_REVISION, REVISION);
  assert.equal(row.FORM_IDENTITY_HASH, selected.config.formIdentityHash);
  assert.equal(row.ISSUING_ACTOR_HASH, selected.config.issuingActorHash);
  await assert.rejects(() => exchange(selected, first), (error) => error.status === 404);
  assert.equal((await exchange(selected, second)).result.status, 200);
});

test("active prefill cannot move across runtime bindings", async () => {
  const selected = fixture();
  const token = journeyTokenFrom(await launch(selected));
  await exchange(selected, token);
  const row = selected.adapter.rows[0];
  const originalVersion = row.SESSION_VERSION;
  const originalTokenHash = row.TOKEN_HASH;
  row.SOURCE_REVISION = "b".repeat(40);

  await assert.rejects(() => launch(selected), (error) =>
    error.status === 409 && error.publicCode === "session_binding_conflict");
  assert.equal(selected.adapter.rows.length, 1);
  assert.equal(row.SESSION_VERSION, originalVersion);
  assert.equal(row.TOKEN_HASH, originalTokenHash);
  assert.equal(row.STATUS, "handle_issued");
});

test("runtime migration rejects dirty issued rows and immutable actor drift", async () => {
  for (const mutate of [
    (row) => { row.PREFILL_ID = "00000000-0000-4000-8000-000000000001"; },
    (row) => { row.ISSUING_ACTOR_HASH = `operator_${"4".repeat(64)}`; },
  ]) {
    const selected = fixture();
    await launch(selected);
    const row = selected.adapter.rows[0];
    const originalVersion = row.SESSION_VERSION;
    const originalTokenHash = row.TOKEN_HASH;
    row.SOURCE_REVISION = "b".repeat(40);
    mutate(row);

    await assert.rejects(() => launch(selected), (error) =>
      error.status === 409 && error.publicCode === "session_binding_conflict");
    assert.equal(row.SESSION_VERSION, originalVersion);
    assert.equal(row.TOKEN_HASH, originalTokenHash);
  }
});

test("runtime migration rejects expired and revoked rows", async () => {
  for (const status of ["expired", "revoked"]) {
    const selected = fixture();
    await launch(selected);
    const row = selected.adapter.rows[0];
    const originalVersion = row.SESSION_VERSION;
    row.STATUS = status;
    row.SOURCE_REVISION = "b".repeat(40);

    await assert.rejects(() => launch(selected), (error) =>
      error.status === 409 && error.publicCode === "session_binding_conflict");
    assert.equal(row.SESSION_VERSION, originalVersion);
    assert.equal(row.STATUS, status);
  }
});

test("concurrent reissue keeps one version-fenced winner and one durable journey", async () => {
  const selected = fixture();
  await launch(selected);
  const originalFind = selected.adapter.findRowsByJourneyId;
  let arrivals = 0;
  let release;
  const bothReady = new Promise((resolve) => { release = resolve; });
  selected.adapter.findRowsByJourneyId = async (...args) => {
    const rows = await originalFind(...args);
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    return rows;
  };

  const results = await Promise.allSettled([launch(selected), launch(selected)]);
  const successes = results.filter(({ status }) => status === "fulfilled");
  const failures = results.filter(({ status }) => status === "rejected");
  assert.equal(successes.length, 1);
  assert.equal(successes[0].value.status, 201);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.ambiguous, true);
  assert.equal(selected.adapter.rows.length, 1);
  assert.equal(selected.adapter.rows[0].SESSION_VERSION, 2);
  assert.equal(selected.adapter.rows[0].STATUS, "issued");
  assert.equal(selected.adapter.rows[0].LAST_OUTCOME, "reissued");
});

test("exact crash retry resumes while a stale CRM edit remains fenced", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  const session = await selected.dependencies.sessionStore.readByPrefillId(prepared.prefillId);
  const fingerprint = submissionFingerprint(
    "submission_001", prepared.prefillId, prepared.configurationRevision,
    normalizeFormData(formData()), selected.config.tokenPepper,
  );
  await selected.dependencies.sessionStore.beginSubmission(
    session, fingerprint, selected.records.get(RECORD_ID).Modified_Time,
  );
  const resumed = await submit(selected, prepared);
  assert.equal(resumed.body.replayed, true);
  assert.equal(selected.events.filter(([name]) => name === "update").length, 1);

  const stale = fixture();
  const stalePrepared = await prepare(stale);
  stale.records.get(RECORD_ID).Modified_Time = "2026-08-29T12:01:00.000Z";
  stale.records.get(RECORD_ID).Company = "ZZZ SYNTHETIC Operator Edit";
  await assert.rejects(() => submit(stale, stalePrepared), (error) =>
    error.status === 409 && error.publicCode === "record_stale");
  assert.equal(stale.events.filter(([name]) => name === "update").length, 0);
});

test("cross-release binding fails closed", async () => {
  const selected = fixture();
  const prepared = await prepare(selected);
  selected.adapter.rows[0].SOURCE_REVISION = "b".repeat(40);
  await assert.rejects(() => submit(selected, prepared), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  assert.equal(selected.events.filter(([name]) => name === "update").length, 0);
});
