"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { handleRequest } = require("../lib/handler");
const { generateToken, hashToken } = require("../lib/security");
const { INTAKE_ID, LEAD_ID, lead } = require("./helpers");

const ISSUE_SECRET = "i".repeat(43);
const PREFILL_SECRET = "p".repeat(43);
const PEPPER = "t".repeat(43);
const ASSISTED_CONSTANTS = Object.freeze({
  assistedBy: "Synthetic assisted flow",
  entryOffer: "Synthetic test offer",
  intakeFormVersion: "test-version",
  leadStatus: "Synthetic requested status",
  sourcePage: "synthetic-assisted",
  submissionChannel: "Synthetic In Person",
});

function config() {
  return {
    assistedConstants: ASSISTED_CONSTANTS,
    form1PublicUrl:
      "https://forms.zohopublic.com/sylvara/form/FreeTest/formperma/example",
    form1TokenFieldAlias: "assisted_token",
    issuePath: "/form1/issue-test",
    prefillPath: "/form1/prefill-test",
    issueHeaderName: "x-sylvara-issue-test",
    prefillHeaderName: "x-sylvara-prefill-test",
    issueHeaderSecret: ISSUE_SECRET,
    prefillHeaderSecret: PREFILL_SECRET,
    tokenPepper: PEPPER,
    maxBodyBytes: 4096,
    inboundBodyTimeoutMs: 5000,
  };
}

function request(path, secretName, secret, body) {
  return {
    method: "POST",
    url: path,
    headers: {
      "content-type": "application/json",
      [secretName]: secret,
    },
    rawBody: Buffer.from(JSON.stringify(body), "utf8"),
  };
}

test("issue always rotates the intake identity and returns only an opaque Form URL", async () => {
  const events = [];
  const oldIntakeId = "f1a_00000000-0000-4000-8000-000000000000";
  const freshIntakeId = "f1a_22222222-2222-4222-8222-222222222222";
  let pending;
  const result = await handleRequest(
    request("/form1/issue-test", "x-sylvara-issue-test", ISSUE_SECRET, { leadId: LEAD_ID }),
    {
      config: config(),
      now: () => Date.parse("2026-08-21T23:00:00.000Z"),
      randomBytes: () => Buffer.alloc(32, 9),
      randomUUID: () => "22222222-2222-4222-8222-222222222222",
      crmClient: {
        getLead: async () => {
          events.push("crm-read");
          return lead({ Intake_Submission_ID: oldIntakeId });
        },
        updateIntakeSubmissionId: async (_record, intakeSubmissionId) => {
          events.push("crm-update");
          assert.equal(intakeSubmissionId, freshIntakeId);
          assert.notEqual(intakeSubmissionId, oldIntakeId);
          return lead({ Intake_Submission_ID: intakeSubmissionId });
        },
      },
      sessionStore: {
        createSession: async (input) => {
          events.push("session-create");
          pending = {
            ...input,
            status: "issuing",
            expiresAt: "2026-08-21T23:15:00.000Z",
          };
          return pending;
        },
        markIssued: async (input) => {
          events.push("session-issued");
          return { ...input, status: "issued" };
        },
        markFailed: async () => assert.fail("must not mark failed"),
        markReconciliationRequired: async () => assert.fail("must not reconcile"),
      },
    },
  );

  assert.deepEqual(events, ["crm-read", "session-create", "crm-update", "session-issued"]);
  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  assert.equal(Object.hasOwn(result.body, "leadId"), false);
  assert.equal(JSON.stringify(result.body).includes("Synthetic"), false);
  const url = new URL(result.body.formUrl);
  assert.equal(url.hostname, "forms.zohopublic.com");
  assert.equal(url.searchParams.size, 1);
  assert.equal(url.searchParams.get("assisted_token").length, 43);
  assert.equal(pending.intakeSubmissionId, freshIntakeId);
});

test("prefill reserves disclosure before CRM read and excludes consent and internal notes", async () => {
  const token = generateToken(() => Buffer.alloc(32, 5));
  const events = [];
  const session = {
    rowId: "1",
    leadId: LEAD_ID,
    intakeSubmissionId: INTAKE_ID,
    tokenHash: hashToken(token, PEPPER),
    status: "issued",
    expiresAt: "2026-08-21T23:15:00.000Z",
  };
  const reserved = { ...session, status: "prefilling", prefillCount: 1, maxPrefills: 10 };
  const result = await handleRequest(
    request("/form1/prefill-test", "x-sylvara-prefill-test", PREFILL_SECRET, { token }),
    {
      config: config(),
      now: () => Date.parse("2026-08-21T23:00:00.000Z"),
      randomUUID: () => "33333333-3333-4333-8333-333333333333",
      crmClient: {
        getLead: async () => {
          events.push("crm-read");
          return lead();
        },
      },
      sessionStore: {
        readByTokenHash: async (value) => {
          assert.equal(value, session.tokenHash);
          events.push("session-read");
          return session;
        },
        reservePrefill: async (_input, owner) => {
          events.push("reserve");
          assert.equal(owner, "33333333-3333-4333-8333-333333333333");
          return reserved;
        },
        completePrefill: async () => {
          events.push("complete");
          return { ...reserved, status: "prefilled" };
        },
        cancelPrefill: async () => assert.fail("must not cancel"),
        markExpired: async () => assert.fail("must not expire"),
      },
    },
  );

  assert.deepEqual(events, ["session-read", "reserve", "crm-read", "complete"]);
  assert.equal(result.status, 200);
  assert.equal(result.body.first_name, "Synthetic");
  assert.equal(result.body.intake_submission_id, INTAKE_ID);
  assert.equal(result.body.submission_channel, "Synthetic In Person");
  assert.equal(result.body.lead_source, "Synthetic original source");
  assert.equal(Object.hasOwn(result.body, "additional_notes"), false);
  assert.equal(Object.keys(result.body).some((key) => /consent/i.test(key)), false);
  assert.equal(JSON.stringify(result.body).includes("internal-only-note"), false);
});

test("stale intake binding fails closed and consumes no response disclosure", async () => {
  const token = generateToken(() => Buffer.alloc(32, 4));
  const events = [];
  const session = {
    rowId: "1",
    leadId: LEAD_ID,
    intakeSubmissionId: INTAKE_ID,
    tokenHash: hashToken(token, PEPPER),
    status: "issued",
    expiresAt: "2026-08-21T23:15:00.000Z",
  };
  const reserved = { ...session, status: "prefilling", prefillCount: 1, maxPrefills: 10 };
  await assert.rejects(
    () => handleRequest(
      request("/form1/prefill-test", "x-sylvara-prefill-test", PREFILL_SECRET, { token }),
      {
        config: config(),
        now: () => Date.parse("2026-08-21T23:00:00.000Z"),
        randomUUID: () => "44444444-4444-4444-8444-444444444444",
        crmClient: {
          getLead: async () => lead({ Intake_Submission_ID: "f1a_stale" }),
        },
        sessionStore: {
          readByTokenHash: async () => session,
          reservePrefill: async () => reserved,
          cancelPrefill: async () => events.push("cancel"),
          completePrefill: async () => assert.fail("must not complete"),
          markExpired: async () => assert.fail("must not expire"),
        },
      },
    ),
    (error) => error.status === 409 && error.publicCode === "context_conflict",
  );
  assert.deepEqual(events, ["cancel"]);
});

test("expired assisted sessions are contained before any CRM disclosure", async () => {
  const token = generateToken(() => Buffer.alloc(32, 6));
  const events = [];
  const session = {
    rowId: "1",
    leadId: LEAD_ID,
    intakeSubmissionId: INTAKE_ID,
    tokenHash: hashToken(token, PEPPER),
    status: "issued",
    expiresAt: "2026-08-21T22:59:59.000Z",
  };

  await assert.rejects(
    () => handleRequest(
      request("/form1/prefill-test", "x-sylvara-prefill-test", PREFILL_SECRET, { token }),
      {
        config: config(),
        now: () => Date.parse("2026-08-21T23:00:00.000Z"),
        crmClient: {
          getLead: async () => assert.fail("expired sessions must not read CRM"),
        },
        sessionStore: {
          readByTokenHash: async () => session,
          markExpired: async (value) => {
            events.push("expired");
            assert.equal(value, session);
          },
          reservePrefill: async () => assert.fail("expired sessions must not reserve disclosure"),
        },
      },
    ),
    (error) => error.status === 404 && error.publicCode === "session_not_found",
  );
  assert.deepEqual(events, ["expired"]);
});

test("issue rejects a CRM response for the wrong Lead before creating a session", async () => {
  await assert.rejects(
    () => handleRequest(
      request("/form1/issue-test", "x-sylvara-issue-test", ISSUE_SECRET, { leadId: LEAD_ID }),
      {
        config: config(),
        crmClient: {
          getLead: async () => lead({ id: "8".repeat(19) }),
        },
        sessionStore: {
          createSession: async () => assert.fail("wrong Lead context must not create a session"),
        },
      },
    ),
    (error) => error.status === 409 && error.publicCode === "context_conflict",
  );
});

test("route secret and exact body contract are checked before business work", async () => {
  const dependencies = {
    config: config(),
    crmClient: { getLead: async () => assert.fail("CRM must not be called") },
    sessionStore: {},
  };
  await assert.rejects(
    () => handleRequest(
      request("/form1/issue-test", "x-sylvara-issue-test", "wrong", { leadId: LEAD_ID }),
      dependencies,
    ),
    (error) => error.status === 401 && error.publicCode === "authentication_failed",
  );
  await assert.rejects(
    () => handleRequest(
      request("/form1/issue-test", "x-sylvara-issue-test", ISSUE_SECRET, {
        leadId: LEAD_ID,
        extra: true,
      }),
      dependencies,
    ),
    (error) => error.status === 422 && error.publicCode === "request_invalid",
  );

  const malformed = request(
    "/form1/issue-test",
    "x-sylvara-issue-test",
    ISSUE_SECRET,
    { leadId: LEAD_ID },
  );
  malformed.rawBody = Buffer.from("{", "utf8");
  await assert.rejects(
    () => handleRequest(malformed, dependencies),
    (error) => error.status === 400 && error.publicCode === "body_invalid",
  );

  const queried = request(
    "/form1/issue-test?leadId=forbidden",
    "x-sylvara-issue-test",
    ISSUE_SECRET,
    { leadId: LEAD_ID },
  );
  await assert.rejects(
    () => handleRequest(queried, dependencies),
    (error) => error.status === 404 && error.publicCode === "route_not_found",
  );
});
