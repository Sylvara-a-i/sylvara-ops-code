"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createCrmClient } = require("../lib/crm-client");
const { createConnectionAuthorizationProvider } = require("../lib/connection-boundary");

const RECORD_ID = "4000000001";
const EXISTING_JOURNEY = "journey_synthetic_001";
const RACE_WINNER = "journey_public_winner_002";
const MODIFIED = "2026-08-29T11:59:00.000Z";
const ZGID = "123456789";

function response(status, value) {
  const body = value === null ? null : Buffer.from(JSON.stringify(value), "utf8");
  return {
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length" && body
          ? String(body.length) : null;
      },
    },
    body: body ? Readable.from([body]) : null,
  };
}

function record(journeyId, modified = MODIFIED) {
  return {
    data: [{ id: RECORD_ID, Modified_Time: modified, Intake_Submission_ID: journeyId }],
  };
}

function fixture(fetchImpl, options = {}) {
  const token = `Zoho-oauthtoken ${"a".repeat(32)}`;
  return createCrmClient({
    crmApiBaseUrl: "https://www.zohoapis.com/crm/v8",
    crmOrganizationHash: crypto.createHash("sha256").update(ZGID).digest("hex"),
    outboundTimeoutMs: 1_000,
    outboundMaxBytes: 32_768,
  }, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl,
    ...options,
  });
}

test("existing CRM journey is authoritative and is never rewritten", async () => {
  const requests = [];
  const crm = fixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
    return response(200, record(EXISTING_JOURNEY));
  });
  const result = await crm.getOrInitializeJourney("Leads", RECORD_ID);
  assert.equal(result.journeyId, EXISTING_JOURNEY);
  assert.equal(result.initialized, false);
  assert.deepEqual(requests.map(({ options }) => options.method), ["GET", "GET"]);
});

test("blank CRM journey is initialized once with a version-fenced write and exact readback", async () => {
  const requests = [];
  let journey = "";
  const crm = fixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
    if (options.method === "PUT") {
      const payload = JSON.parse(options.body);
      assert.equal(options.headers["If-Unmodified-Since"], MODIFIED);
      assert.deepEqual(payload.trigger, []);
      journey = payload.data[0].Intake_Submission_ID;
      return response(200, { data: [{ status: "success", code: "SUCCESS",
        details: { id: RECORD_ID } }] });
    }
    return response(200, record(journey));
  });
  const result = await crm.getOrInitializeJourney("Leads", RECORD_ID);
  assert.match(result.journeyId, /^f1a_[a-f0-9]{40}$/);
  assert.equal(result.initialized, true);
  assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 1);
});

test("a concurrent canonical journey wins a 412 race without a second write", async () => {
  const requests = [];
  let reads = 0;
  const crm = fixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
    if (options.method === "PUT") return response(412, { data: [] });
    reads += 1;
    return response(200, record(reads === 1 ? "" : RACE_WINNER,
      reads === 1 ? MODIFIED : "2026-08-29T12:00:00.000Z"));
  });
  const result = await crm.getOrInitializeJourney("Leads", RECORD_ID);
  assert.equal(result.journeyId, RACE_WINNER);
  assert.equal(result.initialized, false);
  assert.equal(requests.filter(({ options }) => options.method === "PUT").length, 1);
});

test("a stale blank record fails closed when no canonical winner is readable", async () => {
  const crm = fixture(async (url, options) => {
    if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
    if (options.method === "PUT") return response(412, { data: [] });
    return response(200, record(""));
  });
  await assert.rejects(crm.getOrInitializeJourney("Leads", RECORD_ID),
    { publicCode: "record_stale", status: 409 });
});

test("only typed CRM receipts compare equivalent supported timestamps", () => {
  const crm = fixture(async () => assert.fail("comparison must not access CRM"));
  const expected = "2026-08-29T12:00:00+00:00";
  const equivalent = "2026-08-29T07:00:00-05:00";
  for (const field of ["Free_Test_Contact_Consent_At", "Free_Test_Request_Submitted_At"]) {
    assert.equal(crm.recordMatches({ [field]: equivalent }, { [field]: expected }), true);
    assert.equal(crm.recordMatches({ [field]: "2026-08-29T17:30:00+05:30" },
      { [field]: expected }), true);
    assert.equal(crm.recordMatches({ [field]: "2026-08-29T07:00:01-05:00" },
      { [field]: expected }), false);
    for (const invalid of [
      null, undefined, "", "2026-08-29T12:00:00", "2026-08-29T12:00:00Z",
      "2026-08-29T12:00:00.000+00:00", "2026-08-29T12:00:00+00:00 ",
      "2026-02-29T12:00:00+00:00", "2026-02-30T12:00:00+00:00",
      "2026-13-01T12:00:00+00:00", "2026-08-29T24:00:00+00:00",
      "2026-08-29T12:60:00+00:00", "2026-08-29T12:00:60+00:00",
      "2026-08-29T12:00:00+24:00", "2026-08-29T12:00:00+00:60",
      "0000-01-01T00:00:00+00:00", "+010000-01-01T00:00:00+00:00",
    ]) {
      assert.equal(crm.recordMatches({ [field]: invalid }, { [field]: expected }), false);
      assert.equal(crm.recordMatches({ [field]: invalid }, { [field]: invalid }), false);
    }
  }
  for (const field of ["Source_Page", "Modified_Time"]) {
    assert.equal(crm.recordMatches({ [field]: equivalent }, { [field]: expected }), false);
  }
});

test("a successful CRM update reconciles normalized receipt offsets without another write", async () => {
  let puts = 0;
  const diagnostics = [];
  const original = record(EXISTING_JOURNEY).data[0];
  let stored = { ...original };
  const patch = {
    Intake_Submission_ID: EXISTING_JOURNEY,
    Free_Test_Contact_Consent_At: "2026-08-29T12:00:00+00:00",
    Free_Test_Request_Submitted_At: "2026-08-29T12:00:00+00:00",
  };
  const crm = fixture(async (url, options) => {
    if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
    if (options.method === "PUT") {
      puts += 1;
      assert.equal(options.headers["If-Unmodified-Since"], MODIFIED);
      assert.deepEqual(JSON.parse(options.body).data, [{ id: RECORD_ID, ...patch }]);
      stored = {
        ...original, ...patch, Modified_Time: "2026-08-29T07:00:02-05:00",
        Free_Test_Contact_Consent_At: "2026-08-29T07:00:00-05:00",
        Free_Test_Request_Submitted_At: "2026-08-29T07:00:00-05:00",
      };
      return response(200, { data: [{ status: "success", code: "SUCCESS",
        details: { id: RECORD_ID } }] });
    }
    return response(200, { data: [stored] });
  }, {
    onDiagnostic(event) {
      diagnostics.push(event);
      throw new Error("synthetic diagnostic callback failure");
    },
  });
  const completed = await crm.completeAssistedSubmission("Leads", original, patch, MODIFIED);
  assert.equal(completed.replayed, false);
  const replay = await crm.completeAssistedSubmission("Leads", completed.record, patch,
    completed.record.Modified_Time);
  assert.equal(replay.replayed, true);
  assert.equal(puts, 1);
  assert.equal(diagnostics.some(({ stage }) => stage === "writer_organization"), true);
  assert.equal(diagnostics.some(({ stage }) => stage === "crm_write"), true);
  assert.equal(diagnostics.some(({ stage }) => stage === "crm_readback"), true);
  await assert.rejects(() => crm.completeAssistedSubmission("Leads", original, patch,
    "2026-08-29T11:59:00+00:00"), { status: 409, publicCode: "record_stale" });
  assert.equal(puts, 1);
});

test("writer preflight performs only an organization GET and ignores callback rejection", async () => {
  const methods = [];
  let writerCredentials = 0;
  const crm = fixture(async (url, options) => {
    assert.equal(url, "https://www.zohoapis.com/crm/v8/org");
    methods.push(options.method);
    return response(200, { org: [{ zgid: ZGID }] });
  }, {
    readAuthorizationProvider: async () => assert.fail("preflight must use the writer"),
    writeAuthorizationProvider: async () => {
      writerCredentials += 1;
      return `Zoho-oauthtoken ${"a".repeat(32)}`;
    },
    onDiagnostic: async () => { throw new Error("synthetic callback rejection"); },
  });
  assert.deepEqual(await crm.preflightAssistedWrite(), { ok: true });
  assert.deepEqual(await crm.preflightAssistedWrite(), { ok: true });
  assert.deepEqual(methods, ["GET"]);
  assert.equal(writerCredentials, 1);
});

test("writer credential failures retain only safe SDK code and numeric HTTP status", async () => {
  const privateText = "synthetic-private-provider-canary";
  for (const [code, statusCode, expectedCode, expectedStatus] of [
    ["INVALID_OAUTHTOKEN", 401, "INVALID_OAUTHTOKEN", 401],
    [privateText, privateText, null, null],
  ]) {
    const diagnostics = [];
    const provider = createConnectionAuthorizationProvider({
      connections: () => ({
        getConnectionCredentials: async () => {
          throw Object.assign(new Error(privateText), { code, statusCode, payload: privateText });
        },
      }),
    }, "synthetic_writer", 1000);
    const crm = fixture(async () => assert.fail("failed credentials must precede HTTP"), {
      writeAuthorizationProvider: provider,
      onDiagnostic: (event) => diagnostics.push(event),
    });
    await assert.rejects(() => crm.preflightAssistedWrite(), (error) => {
      assert.equal(error.publicCode, "connection_unavailable");
      assert.deepEqual(error.diagnostic, {
        stage: "writer_credentials", httpStatus: expectedStatus, providerCode: expectedCode,
      });
      assert.equal(JSON.stringify(error).includes(privateText), false);
      assert.equal(error.message.includes(privateText), false);
      return true;
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(JSON.stringify(diagnostics).includes(privateText), false);
  }
});

test("writer organization rejection exposes only an allowlisted provider code", async () => {
  const privateText = "synthetic-private-organization-canary";
  for (const code of ["OAUTH_SCOPE_MISMATCH", privateText, { code: privateText }]) {
    const diagnostics = [];
    const methods = [];
    const crm = fixture(async (_url, options) => {
      methods.push(options.method);
      return response(401, { code, message: privateText, details: { id: privateText } });
    }, { onDiagnostic: (event) => diagnostics.push(event) });
    await assert.rejects(() => crm.preflightAssistedWrite(), (error) => {
      assert.equal(error.publicCode, "connection_organization_mismatch");
      assert.deepEqual(error.diagnostic, {
        stage: "writer_organization", httpStatus: 401,
        providerCode: code === "OAUTH_SCOPE_MISMATCH" ? code : null,
      });
      assert.equal(JSON.stringify(error).includes(privateText), false);
      return true;
    });
    assert.deepEqual(methods, ["GET"]);
    assert.equal(JSON.stringify(diagnostics).includes(privateText), false);
  }
});

test("malformed credentials and null diagnostic metadata keep the controlled failure", async () => {
  for (const writeAuthorizationProvider of [
    async () => null,
    async () => { throw Object.assign(new Error("synthetic private error"), { diagnostic: null }); },
    createConnectionAuthorizationProvider({
      connections: () => ({
        getConnectionCredentials: async () => ({ headers: {}, parameters: null }),
      }),
    }, "synthetic_writer", 1000),
  ]) {
    const crm = fixture(async () => assert.fail("malformed credentials must precede HTTP"), {
      writeAuthorizationProvider,
    });
    await assert.rejects(() => crm.preflightAssistedWrite(), (error) => {
      assert.equal(error.publicCode, "connection_unavailable");
      assert.deepEqual(error.diagnostic, {
        stage: "writer_credentials", httpStatus: null, providerCode: null,
      });
      return true;
    });
  }
});

test("a local Connection timeout is not reported as a provider HTTP response", async () => {
  const crm = fixture(async () => assert.fail("timed-out credentials must precede HTTP"), {
    writeAuthorizationProvider: createConnectionAuthorizationProvider({
      connections: () => ({ getConnectionCredentials: () => new Promise(() => {}) }),
    }, "synthetic_writer", 1),
  });
  await assert.rejects(() => crm.preflightAssistedWrite(), (error) => {
    assert.equal(error.publicCode, "connection_unavailable");
    assert.deepEqual(error.diagnostic, {
      stage: "writer_credentials", httpStatus: null, providerCode: null,
    });
    return true;
  });
});

test("CRM write rejection keeps safe diagnostics without retrying or leaking its payload", async () => {
  const privateText = "synthetic-private-write-canary";
  for (const code of ["INVALID_DATA", privateText]) {
    let puts = 0;
    const diagnostics = [];
    const crm = fixture(async (url, options) => {
      if (url.endsWith("/org")) return response(200, { org: [{ zgid: ZGID }] });
      if (options.method === "PUT") {
        puts += 1;
        return response(400, { data: [{ code, message: privateText,
          details: { api_name: privateText, value: privateText } }] });
      }
      return response(200, record(EXISTING_JOURNEY));
    }, { onDiagnostic: (event) => diagnostics.push(event) });
    await assert.rejects(() => crm.completeAssistedSubmission("Leads",
      record(EXISTING_JOURNEY).data[0],
      { Intake_Submission_ID: EXISTING_JOURNEY, First_Name: "ZZZ" }, MODIFIED), (error) => {
      assert.equal(error.publicCode, "reconciliation_required");
      assert.equal(error.ambiguous, true);
      assert.deepEqual(error.diagnostic, {
        stage: "crm_write", httpStatus: 400, providerCode: code === "INVALID_DATA" ? code : null,
      });
      assert.equal(JSON.stringify(error).includes(privateText), false);
      return true;
    });
    assert.equal(puts, 1);
    assert.equal(JSON.stringify(diagnostics).includes(privateText), false);
  }
});
