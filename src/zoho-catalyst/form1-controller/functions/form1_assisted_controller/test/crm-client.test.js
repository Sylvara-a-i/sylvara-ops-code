"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { READ_FIELDS, createCrmClient } = require("../lib/crm-client");
const { INTAKE_ID, LEAD_ID, lead } = require("./helpers");

test("CRM reads and updates use separate least-privilege Connection credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    const method = options.method;
    if (method === "PUT") {
      return new Response(JSON.stringify({
        data: [{ status: "success", code: "SUCCESS", details: { id: LEAD_ID } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: [lead()] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createCrmClient(
    {
      crmApiBaseUrl: "https://www.zohoapis.com/crm/v8",
      outboundTimeoutMs: 5000,
      outboundMaxBytes: 131072,
    },
    {
      readAuthorizationProvider: async () => `Zoho-oauthtoken ${"r".repeat(32)}`,
      writeAuthorizationProvider: async () => `Zoho-oauthtoken ${"w".repeat(32)}`,
      fetchImpl,
    },
  );

  const initial = await client.getLead(LEAD_ID);
  await client.updateIntakeSubmissionId(initial, INTAKE_ID);
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "PUT", "GET"]);
  assert.equal(calls[0].options.headers.Authorization, `Zoho-oauthtoken ${"r".repeat(32)}`);
  assert.equal(calls[1].options.headers.Authorization, `Zoho-oauthtoken ${"w".repeat(32)}`);
  assert.equal(calls[2].options.headers.Authorization, `Zoho-oauthtoken ${"r".repeat(32)}`);
  assert.equal(calls[1].options.headers["If-Unmodified-Since"], initial.Modified_Time);
  const updateBody = JSON.parse(calls[1].options.body);
  assert.deepEqual(updateBody.trigger, []);
  assert.equal(updateBody.data[0].Intake_Submission_ID, INTAKE_ID);
});

test("CRM prefill read allowlist excludes notes and consent fields", () => {
  assert.equal(READ_FIELDS.includes("Free_Test_Request_Notes"), false);
  assert.equal(READ_FIELDS.some((field) => /consent/i.test(field)), false);
  assert.equal(READ_FIELDS.includes("Intake_Submission_ID"), true);
  assert.equal(READ_FIELDS.includes("Lead_Source"), true);
});
