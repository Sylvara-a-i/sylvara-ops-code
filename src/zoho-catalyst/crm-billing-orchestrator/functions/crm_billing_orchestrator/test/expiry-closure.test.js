"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./expiry-closure-fixture");
const { digest, keys, isExpiryClosurePredecessor } = require("../lib/expiry-closure");
const contract = require("../../../config/expiry-closure-contract.json");

test("disabled closure contract has no public action, credentials or native authority", async () => {
  assert.equal(contract.enabled, false); assert.equal(contract.reportCompatibilityEnabled, false);
  assert.equal(contract.publicActionAdded, false); assert.equal(contract.newCredentialsOrGrants, false);
  assert.equal(contract.unchangedStage, true); assert.equal(contract.expectedStageApiValue, null);
  const h = fixture(); h.policy.enabled = false;
  await assert.rejects(h.service().run()); assert.equal(h.counts.crmGets, 0); assert.equal(h.rows.size, 0);
});

test("metadata-bound Stage API value can differ from its display label without changing Stage", async () => {
  const h = fixture(); const stageMetadata = { actual_value: "Value Proposition", display_value: "Test Live" };
  h.config.reportMutableStageValue = stageMetadata.actual_value;
  h.policy.expectedStageApiValue = stageMetadata.actual_value; h.policy.metadataSha256 = digest(stageMetadata);
  h.deal.Stage = stageMetadata.actual_value; h.policy.beforeDealSha256 = digest(h.deal);
  let written;
  h.hooks.write = patch => { written = structuredClone(patch); Object.assign(h.deal, patch); };
  assert.equal((await h.service().run()).state, "EXPIRY_ONLY_CRM_CLOSED");
  assert.equal(h.deal.Stage, "Value Proposition"); assert.equal(h.counts.crmPuts, 1);
  assert.deepEqual(Object.keys(written).sort(), ["Test_End_At", "Test_End_Reason", "Test_Status"]);
});

test("missing or mismatched Stage API binding stops before claim and CRM write", async t => {
  for (const [name, change] of [
    ["missing policy", h => { delete h.policy.expectedStageApiValue; }],
    ["null policy", h => { h.policy.expectedStageApiValue = null; }],
    ["empty policy", h => { h.policy.expectedStageApiValue = ""; }],
    ["policy differs from config", h => { h.policy.expectedStageApiValue = "Test Live"; }],
    ["config differs from policy", h => { h.config.reportMutableStageValue = "Test Live"; }],
    ["record differs from binding", h => { h.deal.Stage = "Test Live"; }],
    ["policy and config use display label", h => {
      h.config.reportMutableStageValue = "Test Live"; h.policy.expectedStageApiValue = "Test Live";
    }],
  ]) await t.test(name, async () => {
    const h = fixture(); h.config.reportMutableStageValue = "Value Proposition";
    h.policy.expectedStageApiValue = "Value Proposition"; h.deal.Stage = "Value Proposition";
    change(h); h.policy.beforeDealSha256 = digest(h.deal);
    await assert.rejects(h.service().run()); assert.equal(h.counts.inserts, 0); assert.equal(h.counts.crmPuts, 0);
  });
});

test("ordinary or drifted SDK transport cannot dispatch this operation", async () => {
  for (const field of ["expiryClosureTransportQualified", "assertExpiryClosureTransport"]) {
    const h = fixture(); delete h.store[field];
    await assert.rejects(h.service().run()); assert.equal(h.counts.inserts, 0); assert.equal(h.counts.crmGets, 0);
  }
  const h = fixture(); h.store.assertExpiryClosureTransport = async () => false;
  await assert.rejects(h.service().run()); assert.equal(h.counts.inserts, 0);
});

test("expiry only changes three CRM fields; immutable proof preserves exact milliseconds and reporting exceptions", async () => {
  const h = fixture(); const before = structuredClone(h.deal); const retired = structuredClone(h.retired);
  const result = await h.service().run();
  assert.equal(result.state, "EXPIRY_ONLY_CRM_CLOSED"); assert.equal(result.reportSettlementReady, false);
  assert.equal(result.reportDeliveryAuthorized, false); assert.equal(h.counts.crmPuts, 1); assert.equal(h.rows.size, 2);
  assert.deepEqual(Object.keys(h.deal).filter(key => JSON.stringify(h.deal[key]) !== JSON.stringify(before[key])).sort(),
    ["Modified_Time", "Test_End_At", "Test_End_Reason", "Test_Status"]);
  assert.deepEqual(h.retired, retired); assert.equal(h.deal.Stage, "Test Live"); assert.equal(h.deal.Call_Totals_Reconciled, false);
  const proof = JSON.parse([...h.rows.values()].find(row => row.STATUS === "completed").OPERATION_PAYLOAD_JSON);
  assert.equal(proof.originalEndAt, "2026-09-08T00:00:00.246Z"); assert.equal(h.deal.Test_End_At, "2026-09-08T00:00:00+00:00");
  await assert.rejects(h.service().run()); assert.equal(h.counts.crmPuts, 1);
});

test("simultaneous invocations have one immutable claim winner and at most one CRM write", async () => {
  const h = fixture(); const results = await Promise.allSettled([h.service().run(), h.service().run()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(h.counts.crmPuts, 1); assert.equal(h.rows.size, 2);
});

test("lost claim acknowledgement preserves the attempt and prevents a CRM write", async () => {
  const h = fixture(); h.hooks.insert = () => ({ inserted: false });
  await assert.rejects(h.service().run()); assert.equal(h.rows.size, 1); assert.equal(h.counts.crmPuts, 0);
  await assert.rejects(h.service().run()); assert.equal(h.rows.size, 1); assert.equal(h.counts.crmPuts, 0);
});

test("lost CRM acknowledgement is resolved only by exact readback without a retry", async () => {
  const h = fixture(); h.hooks.write = patch => { Object.assign(h.deal, patch); throw Error("synthetic lost acknowledgement"); };
  const result = await h.service().run(); assert.equal(result.acknowledgementReconciled, true); assert.equal(h.counts.crmPuts, 1);
});

test("unknown write, unrelated changes or outcome-insert failure remain uncompleted and never rearm", async t => {
  for (const kind of ["no_effect", "wrong_field", "paid_field", "outcome_failure"]) await t.test(kind, async () => {
    const h = fixture();
    if (kind === "no_effect") h.hooks.write = () => { throw Error("synthetic timeout"); };
    if (kind === "wrong_field") h.hooks.read = n => { if (n === 3) h.deal.Call_Totals_Reconciled = true; };
    if (kind === "paid_field") h.hooks.read = n => { if (n === 3) h.deal.Monthly_Recurring_Revenue = 1; };
    if (kind === "outcome_failure") h.hooks.insert = (_row, n) => n === 2 ? { inserted: false } : { inserted: true };
    await assert.rejects(h.service().run()); assert.equal(h.counts.crmPuts, 1);
    await assert.rejects(h.service().run()); assert.equal(h.counts.crmPuts, 1);
  });
});

test("wrong identity, stale prestate, future expiry and unqualified metadata stop before a claim", async t => {
  for (const change of [h => { h.policy.binding.accountId = "10000004"; }, h => { h.deal.Modified_Time = "2026-09-08T00:02:00+00:00"; },
    h => { h.retired.EXPIRES_AT = "2027-09-08T00:00:00.246Z"; }, h => { h.policy.metadataSha256 = null; },
    h => { h.policy.reportCompatibilityQualified = false; }, h => { h.deal.Results_Review_At = "2026-09-08T00:00:00+00:00"; }]) {
    await t.test(String(change), async () => { const h = fixture(); change(h); await assert.rejects(h.service().run());
      assert.equal(h.counts.inserts, 0); assert.equal(h.counts.crmPuts, 0); });
  }
});

test("even a pinned Deal cannot close with a conflicting approved deployment pointer", async () => {
  const h = fixture(); h.deal.Approved_Deployment_Record_ID = "other_deployment"; h.policy.beforeDealSha256 = digest(h.deal);
  await assert.rejects(h.service().run()); assert.equal(h.counts.inserts, 0); assert.equal(h.counts.crmPuts, 0);
});

test("fresh account/deal scope and retired state are rechecked after claim and after PUT", async t => {
  for (const n of [2, 3]) for (const owner of ["deal", "account"]) await t.test(`${owner}-${n}`, async () => {
    const h = fixture(); h.hooks.read = (count, context) => { if (count === n) {
      context[owner][owner === "deal" ? "Deal_Name" : "Account_Name"] = "Renamed outside synthetic scope";
    } };
    await assert.rejects(h.service().run()); assert.equal(h.counts.crmPuts, n === 2 ? 0 : 1);
    assert.equal([...h.rows.values()].filter(row => row.STATUS === "completed").length, 0);
  });
  const h = fixture(); h.hooks.retired = n => { if (n === 2) h.retired.COUNT_VERSION += 1; };
  await assert.rejects(h.service().run()); assert.equal(h.counts.crmPuts, 0);
});

test("only fixed-binding authenticated closure proof permits a future first terminal summary", async () => {
  const h = fixture(); await h.service().run();
  const config = { ...h.config, expiryClosureCompatibility: { enabled: true, bindingSha256: digest(h.binding) } };
  const summary = { schemaVersion: 3, dealId: h.deal.id, deploymentId: h.binding.deploymentId,
    configurationVersion: h.binding.configurationVersion, testStatus: "Completed", testEndReason: "Seven-Day Limit Reached",
    testStartAt: h.retired.ACTUAL_START_AT, testEndAt: h.retired.EXPIRES_AT };
  const check = (cfg = config, selected = summary) => isExpiryClosurePredecessor(cfg, h.store, { deal: h.deal, accountId: h.account.id }, selected);
  assert.equal(await check(), true);
  assert.equal(await check(h.config), false);
  assert.equal(await check({ ...config, expiryClosureCompatibility: { enabled: true, bindingSha256: "0".repeat(64) } }), false);
  assert.equal(await check(config, { ...summary, testEndAt: "2026-09-08T00:00:00.000Z" }), false);
  const key = keys(config, h.binding).outcome; const original = structuredClone(h.rows.get(key));
  h.rows.get(key).OPERATION_PAYLOAD_JSON = h.rows.get(key).OPERATION_PAYLOAD_JSON.replace('"reportSettlementReady":false', '"reportSettlementReady":true');
  assert.equal(await check(), false); h.rows.set(key, original);
  h.deal.Test_Data_Confidence_Notes = "tampered"; assert.equal(await check(), false);
});
