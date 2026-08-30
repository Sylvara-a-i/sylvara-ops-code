"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createCrmClient } = require("../lib/crm-client");

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

function fixture(fetchImpl) {
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
