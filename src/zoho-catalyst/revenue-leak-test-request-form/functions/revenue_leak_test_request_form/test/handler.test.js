"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { handleRequest } = require("../lib/handler");
const { createSessionStore } = require("../lib/session-store");
const { REVISION, environment } = require("./helpers");

const RECORD_ID = "4000000001";
const OTHER_RECORD_ID = "4000000002";
const JOURNEY_ID = "journey_synthetic_001";
const NOW = Date.parse("2026-08-29T12:00:00.000Z");

function formData(overrides = {}) {
  return {
    firstName: "ZZZ",
    lastName: "Synthetic",
    company: "ZZZ SYNTHETIC Plumbing",
    decisionMakerRole: "Owner",
    jobTitle: "",
    email: "synthetic@example.invalid",
    mobilePhone: "+15555550101",
    companyPhone: "+15555550102",
    currentCallHandling: "Voicemail",
    preferredTestRoute: "After Hours",
    phoneSystemProvider: "Synthetic Provider",
    primaryServiceArea: "ZZZ SYNTHETIC",
    fieldTeamSizeBand: "1-5",
    additionalNotes: "",
    contactConsent: true,
    leadSource: "Other",
    sourcePage: "",
    utmSource: "synthetic",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    ...overrides,
  };
}

function memoryAdapter() {
  const rows = [];
  let nextRowId = 1;
  const selected = (predicate) => rows.filter(predicate).map((row) => ({ ...row }));
  return {
    rows,
    async findRowsByJourneyId(_table, value) {
      return selected((row) => row.INTAKE_SUBMISSION_ID === value);
    },
    async findRowsByRowId(_table, value) {
      return selected((row) => row.ROWID === String(value));
    },
    async findRowsByTokenHash(_table, value) {
      return selected((row) => row.TOKEN_HASH === value);
    },
    async insertRow(_table, row) {
      if (rows.some((candidate) =>
        candidate.TOKEN_HASH === row.TOKEN_HASH ||
        candidate.INTAKE_SUBMISSION_ID === row.INTAKE_SUBMISSION_ID)) {
        throw new Error("duplicate");
      }
      rows.push({ ROWID: String(nextRowId++), ...row });
    },
    async updateRow(_table, update, expected) {
      const row = rows.find((candidate) => candidate.ROWID === String(update.ROWID));
      if (!row || Object.entries(expected).some(([key, value]) =>
        (typeof value === "number" ? Number(row[key]) !== value : row[key] !== value))) return [];
      Object.assign(row, Object.fromEntries(
        Object.entries(update).filter(([key]) => key !== "ROWID"),
      ));
      return [];
    },
  };
}

function request(path, header, secret, body) {
  return {
    method: "POST",
    url: path,
    headers: {
      "content-type": "application/json",
      [header]: secret,
    },
    rawBody: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

function fixture() {
  let currentTime = NOW;
  let entropy = 1;
  let claimSequence = 1;
  const config = loadConfig(environment(), REVISION);
  const adapter = memoryAdapter();
  const records = new Map([
    [RECORD_ID, {
      id: RECORD_ID,
      Modified_Time: "2026-08-29T11:59:00.000Z",
      Intake_Submission_ID: JOURNEY_ID,
    }],
    [OTHER_RECORD_ID, {
      id: OTHER_RECORD_ID,
      Modified_Time: "2026-08-29T11:59:00.000Z",
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
    recordVersion(record) {
      return record.Modified_Time;
    },
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
  return {
    adapter,
    config,
    events,
    records,
    setNow(value) { currentTime = value; },
    dependencies: {
      config,
      crmClient,
      now,
      randomBytes() {
        return Buffer.alloc(32, entropy++);
      },
      sessionStore: createSessionStore(adapter, config, {
        now,
        randomUUID() {
          return `00000000-0000-4000-8000-${String(claimSequence++).padStart(12, "0")}`;
        },
      }),
    },
  };
}

async function launch(selected, overrides = {}) {
  return handleRequest(request(
    selected.config.issuePath,
    selected.config.issueHeaderName,
    selected.config.issueHeaderSecret,
    {
      crmModule: "Leads",
      recordId: RECORD_ID,
      ...overrides,
    },
  ), selected.dependencies);
}

function tokenFrom(result) {
  const url = new URL(result.body.formUrl);
  assert.deepEqual([...url.searchParams.keys()], ["AssistedIntakeToken"]);
  const token = url.searchParams.get("AssistedIntakeToken");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.body.formUrl.includes(RECORD_ID), false);
  assert.equal(result.body.formUrl.includes("synthetic@example.invalid"), false);
  return token;
}

async function submit(selected, token, submissionId = "submission_001", extra = {}) {
  return handleRequest(request(
    selected.config.submissionPath,
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
    { token, submissionId, formData: formData(), ...extra },
  ), selected.dependencies);
}

test("valid assisted Form 1 launch stores only a digest-bound CRM journey and returns an opaque URL", async () => {
  const selected = fixture();
  const result = await launch(selected);
  assert.equal(result.status, 201);
  const token = tokenFrom(result);
  assert.equal(selected.adapter.rows.length, 1);
  const [row] = selected.adapter.rows;
  assert.match(row.TOKEN_HASH, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(row).includes(token), false);
  assert.equal(row.CRM_MODULE, "Leads");
  assert.equal(row.CRM_LEAD_ID, RECORD_ID);
  assert.equal(row.INTAKE_SUBMISSION_ID, JOURNEY_ID);
  assert.equal(row.EXPECTED_STAGE, "form1");
  assert.equal(row.STATUS, "issued");
});

test("missing, expired, and tampered assisted tokens fail closed", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  const prefill = (candidate) => handleRequest(request(
    selected.config.prefillPath,
    selected.config.prefillHeaderName,
    selected.config.prefillHeaderSecret,
    { token: candidate },
  ), selected.dependencies);
  await assert.rejects(() => prefill(""), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(() => prefill(tampered), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  selected.setNow(NOW + 1_801_000);
  await assert.rejects(() => prefill(token), (error) =>
    error.status === 404 && error.publicCode === "session_not_found");
  assert.equal(selected.adapter.rows[0].STATUS, "expired");
});

test("assisted submission resolves its CRM target server-side and blocks cross-record input", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  const result = await submit(selected, token);
  assert.deepEqual(result, {
    status: 200,
    body: { ok: true, replayed: false },
    stage: "submission",
    outcome: "submitted",
  });
  assert.equal(selected.records.get(RECORD_ID).Submission_Channel, "CRM Assisted");
  assert.equal(selected.records.get(OTHER_RECORD_ID).Submission_Channel, undefined);
  const updatesBefore = selected.events.filter(([name]) => name === "update").length;
  await assert.rejects(
    () => submit(selected, token, "submission_cross", { recordId: OTHER_RECORD_ID }),
    (error) => error.status === 422 && error.publicCode === "request_invalid",
  );
  assert.equal(selected.events.filter(([name]) => name === "update").length, updatesBefore);
});

test("same assisted submission replays harmlessly while a changed replay conflicts", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  await submit(selected, token);
  const updates = selected.events.filter(([name]) => name === "update").length;
  const replay = await submit(selected, token);
  assert.equal(replay.body.replayed, true);
  assert.equal(selected.events.filter(([name]) => name === "update").length, updates);
  await assert.rejects(
    () => submit(selected, token, "submission_002"),
    (error) => error.status === 409 && error.publicCode === "submission_conflict",
  );
  await assert.rejects(
    () => submit(selected, token, "submission_001", {
      formData: formData({ company: "ZZZ SYNTHETIC Different Plumbing" }),
    }),
    (error) => error.status === 409 && error.publicCode === "submission_conflict",
  );
});

test("concurrent identical submissions cross the CRM write boundary exactly once", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  const originalGetRecord = selected.dependencies.crmClient.getRecord;
  let arrivals = 0;
  let release;
  const bothReady = new Promise((resolve) => { release = resolve; });
  selected.dependencies.crmClient.getRecord = async (...args) => {
    const record = await originalGetRecord(...args);
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    return record;
  };
  const results = await Promise.allSettled([
    submit(selected, token), submit(selected, token),
  ]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(results.filter(({ status }) => status === "rejected").length, 1);
  assert.equal(selected.events.filter(([name]) => name === "update").length, 1);
  assert.equal(selected.adapter.rows[0].STATUS, "consumed");
  assert.match(selected.adapter.rows[0].SUBMISSION_CLAIM_ID,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test("public Form 1 submission without a token remains unbound to assisted CRM state", async () => {
  const selected = fixture();
  const result = await handleRequest(request(
    selected.config.submissionPath,
    selected.config.submissionHeaderName,
    selected.config.submissionHeaderSecret,
    { submissionId: "public_submission_001" },
  ), selected.dependencies);
  assert.deepEqual(result.body, { ok: true, binding: "public_unbound" });
  assert.equal(selected.adapter.rows.length, 0);
  assert.deepEqual(selected.events, []);
});

test("reissuing an interrupted journey rotates the token without duplicating the journey", async () => {
  const selected = fixture();
  const first = tokenFrom(await launch(selected));
  const second = tokenFrom(await launch(selected));
  assert.notEqual(first, second);
  assert.equal(selected.adapter.rows.length, 1);
  assert.equal(selected.adapter.rows[0].SESSION_VERSION, 2);
  await assert.rejects(
    () => handleRequest(request(
      selected.config.prefillPath,
      selected.config.prefillHeaderName,
      selected.config.prefillHeaderSecret,
      { token: first },
    ), selected.dependencies),
    (error) => error.status === 404 && error.publicCode === "session_not_found",
  );
  const resumed = await handleRequest(request(
    selected.config.prefillPath,
    selected.config.prefillHeaderName,
    selected.config.prefillHeaderSecret,
    { token: second },
  ), selected.dependencies);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.assisted, true);
});

test("reissue is blocked while an assisted submission owns the session", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  const tokenHash = selected.adapter.rows[0].TOKEN_HASH;
  const current = await selected.dependencies.sessionStore.readByTokenHash(tokenHash);
  await selected.dependencies.sessionStore.beginSubmission(
    current,
    "9".repeat(64),
    selected.records.get(RECORD_ID).Modified_Time,
  );
  await assert.rejects(
    () => launch(selected),
    (error) => error.status === 409 && error.publicCode === "submission_in_progress"
      && error.ambiguous === true,
  );
});

test("an interrupted submission never overwrites a newer CRM record version", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  const tokenHash = selected.adapter.rows[0].TOKEN_HASH;
  const session = await selected.dependencies.sessionStore.readByTokenHash(tokenHash);
  const normalized = formData();
  const { normalizeFormData } = require("../lib/form-contract");
  const { submissionFingerprint } = require("../lib/security");
  const fingerprint = submissionFingerprint(
    "submission_001",
    tokenHash,
    normalizeFormData(normalized),
    selected.config.tokenPepper,
  );
  await selected.dependencies.sessionStore.beginSubmission(
    session,
    fingerprint,
    selected.records.get(RECORD_ID).Modified_Time,
  );
  selected.records.get(RECORD_ID).Modified_Time = "2026-08-29T12:01:00.000Z";
  selected.records.get(RECORD_ID).Company = "ZZZ SYNTHETIC Operator Edit";
  await assert.rejects(
    () => submit(selected, token),
    (error) => error.status === 409 && error.publicCode === "submission_in_progress"
      && error.ambiguous === true,
  );
  assert.equal(selected.events.filter(([name]) => name === "update").length, 0);
  assert.equal(selected.records.get(RECORD_ID).Company, "ZZZ SYNTHETIC Operator Edit");
});

test("a token bound to another release cannot prefill, submit, or replay", async () => {
  const selected = fixture();
  const token = tokenFrom(await launch(selected));
  selected.adapter.rows[0].SOURCE_REVISION = "b".repeat(40);
  await assert.rejects(
    () => submit(selected, token),
    (error) => error.status === 404 && error.publicCode === "session_not_found",
  );
  assert.equal(selected.events.filter(([name]) => name === "update").length, 0);
});
