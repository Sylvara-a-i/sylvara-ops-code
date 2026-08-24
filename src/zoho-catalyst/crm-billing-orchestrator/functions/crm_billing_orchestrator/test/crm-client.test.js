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
    id: "100000000000001",
    Modified_Time: "2026-08-21T10:00:00-05:00",
    Deal_Name: "ZZZ SYNTHETIC Revenue Desk Acceptance",
    Account_Name: { id: "100000000000002", name: "Synthetic Account" },
    Plan: "Option 2",
    Billing_Customer_ID: null,
    Billing_Subscription_ID: null,
    Subscription_Status: null,
    Billing_Automation_Status: null,
    Billing_Last_Sync_At: null,
    Billing_Automation_Error: "Synthetic prior error",
  };
  const account = {
    id: "100000000000002",
    Modified_Time: "2026-08-21T10:00:00-05:00",
    Account_Name: "ZZZ SYNTHETIC Account",
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
      Billing_Customer_ID: "200000000000001",
      Billing_Subscription_ID: "300000000000001",
      Subscription_Status: "Active",
      Billing_Automation_Status: "Paid Verified",
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
  assert.equal(context.deal.Plan, "Growth");
  await client.updateDealIntegration(context.deal, {
    Billing_Customer_ID: "200000000000001",
    Billing_Subscription_ID: "300000000000001",
    Subscription_Status: "Active",
    Billing_Automation_Status: "Paid Verified",
    Billing_Last_Sync_At: "2026-08-21T15:01:00.000Z",
    Billing_Automation_Error: null,
  });
  assert.equal(calls.length, 4);
  const write = calls[2];
  assert.equal(write.options.headers["If-Unmodified-Since"], deal.Modified_Time);
  const writeBody = JSON.parse(write.options.body);
  assert.deepEqual(writeBody.trigger, []);
  assert.deepEqual(writeBody.skip_feature_execution, [{ name: "cadences" }]);
  assert.match(calls[3].url, /\/Deals\/100000000000001\?/);
  assert.doesNotMatch(calls[0].url, /Billing_Evaluation_/);
  assert.match(calls[0].url, /Connected_AI_Minute_Rate/);
  assert.match(calls[0].url, /Setup_Fee/);
  assert.match(calls[0].url, /MRR/);
  assert.match(calls[0].url, /Subscription_Acceptance_Status/);
  assert.match(calls[0].url, /Subscription_Accepted_At/);
  assert.match(calls[0].url, /Subscription_Acceptance_Version/);
  assert.match(calls[0].url, /Results_Review_At/);
  assert.match(calls[0].url, /Deal_Name/);
});

test("CRM plan API values normalize exactly and unknown values fail closed", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const baseDeal = {
    id: "100000000000001",
    Modified_Time: "2026-08-21T10:00:00-05:00",
  };
  for (const [apiValue, canonical] of [
    ["Option 1", "Launch"],
    ["Option 2", "Growth"],
    ["Pro", "Scale"],
  ]) {
    const client = createCrmClient(config, {
      readAuthorizationProvider: async () => token,
      writeAuthorizationProvider: async () => token,
      fetchImpl: async () => jsonResponse(200, { data: [{ ...baseDeal, Plan: apiValue }] }),
    });
    assert.equal((await client.getDeal(baseDeal.id)).Plan, canonical);
  }

  const unknown = createCrmClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl: async () => jsonResponse(200, { data: [{ ...baseDeal, Plan: "Launch" }] }),
  });
  await assert.rejects(unknown.getDeal(baseDeal.id), /outside the approved catalog/);
});

test("safe CRM reads retry once on a transient provider response", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const responses = [
    jsonResponse(503, { code: "SYNTHETIC_TRANSIENT" }),
    jsonResponse(200, { data: [{
      id: "100000000000001",
      Modified_Time: "2026-08-21T10:00:00-05:00",
      Plan: "Option 1",
    }] }),
  ];
  let attempts = 0;
  const client = createCrmClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl: async () => {
      attempts += 1;
      return responses.shift();
    },
  });
  assert.equal((await client.getDeal("100000000000001")).Plan, "Launch");
  assert.equal(attempts, 2);
});

test("an unresolved CRM write response requires reconciliation after authoritative readback", async () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const deal = {
    id: "100000000000001",
    Modified_Time: "2026-08-21T10:00:00-05:00",
    Deal_Name: "ZZZ SYNTHETIC Revenue Desk Acceptance",
    Plan: "Option 2",
    Billing_Customer_ID: null,
  };
  const client = createCrmClient(config, {
    readAuthorizationProvider: async () => token,
    writeAuthorizationProvider: async () => token,
    fetchImpl: async () => responses.shift(),
  });
  const responses = [
    jsonResponse(400, { code: "SYNTHETIC_REJECTION" }),
    jsonResponse(200, { data: [deal] }),
  ];
  await assert.rejects(client.updateDealIntegration(deal, {
    Billing_Customer_ID: "200000000000001",
  }), (error) => (
    error?.ambiguous === true && error?.publicCode === "reconciliation_required"
  ));
});
