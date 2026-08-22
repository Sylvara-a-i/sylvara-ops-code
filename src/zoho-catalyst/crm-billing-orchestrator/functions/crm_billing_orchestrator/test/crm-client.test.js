"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { createCrmClient } = require("../lib/crm-client");
const { REVISION, baseEnvironment, jsonResponse } = require("./helpers");

const token = `Zoho-oauthtoken ${"t".repeat(24)}`;

test("CRM client re-reads Deal and Account and independently verifies integration fields", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const deal = {
    id: "10000000000000001",
    Modified_Time: "2026-08-21T10:00:00-05:00",
    Account_Name: { id: "10000000000000002", name: "Synthetic Account" },
    Billing_Customer_ID: null,
    Billing_Automation_Status: null,
    Billing_Last_Sync_At: null,
    Billing_Automation_Error: "Synthetic prior error",
  };
  const account = {
    id: "10000000000000002",
    Modified_Time: "2026-08-21T10:00:00-05:00",
    Account_Name: "Synthetic Account",
  };
  const calls = [];
  const responses = [
    jsonResponse(200, { data: [deal] }),
    jsonResponse(200, { data: [account] }),
    jsonResponse(200, { data: [{
      status: "success",
      code: "SUCCESS",
      details: { id: deal.id },
    }] }),
    jsonResponse(200, { data: [{
      ...deal,
      Modified_Time: "2026-08-21T10:01:00-05:00",
      Billing_Customer_ID: "20000000000000001",
      Billing_Automation_Status: "Customer Verified",
      Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
      Billing_Automation_Error: null,
    }] }),
  ];
  const client = createCrmClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    },
  });
  const context = await client.getContext(deal.id);
  await client.updateDealIntegration(context.deal, {
    Billing_Customer_ID: "20000000000000001",
    Billing_Automation_Status: "Customer Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  assert.equal(calls.length, 4);
  const write = calls[2];
  assert.equal(write.options.headers["If-Unmodified-Since"], deal.Modified_Time);
  assert.deepEqual(JSON.parse(write.options.body).trigger, []);
  assert.match(calls[3].url, /\/Deals\/10000000000000001\?/);
  assert.match(calls[0].url, /Billing_Evaluation_Subscription_ID/);
  assert.match(calls[0].url, /Subscription_Acceptance_Status/);
});
