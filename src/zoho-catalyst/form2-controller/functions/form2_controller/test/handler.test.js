"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CLIENT_KEYS } = require("../lib/form-contract");
const { ControllerError, buildFormUrl, handleForm2Request } = require("../lib/handler");
const { deriveAccessToken, hashAccessToken, hashIssueRequestId } = require("../lib/security");

const NOW_MS = Date.parse("2026-08-14T18:00:00.000Z");
const ISSUE_REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const PREFILL_ID = "20000000-0000-4000-8000-000000000002";
const LEASE_OWNER = "30000000-0000-4000-8000-000000000003";
const CONSUMPTION_OWNER = "40000000-0000-4000-8000-000000000004";
const IDS = Object.freeze({
  contact: `${"9".repeat(17)}1`,
  account: `${"9".repeat(17)}2`,
  deal: `${"9".repeat(17)}3`,
});

function config() {
  return Object.freeze({
    issuePath: "/form2/session/issue",
    prefillPath: "/form2/session/prefill",
    submissionPath: "/form2/session/submit",
    issueHeaderName: "x-sylvara-issue-key",
    formsHeaderName: "x-sylvara-forms-key",
    issueHeaderSecret: "I".repeat(43),
    prefillHeaderSecret: "F".repeat(43),
    submissionHeaderSecret: "S".repeat(43),
    tokenPepper: "P".repeat(43),
    form2PublicUrl: "https://forms.zohopublic.com/synthetic/form/perma/synthetic",
    form2TokenFieldAlias: "access_token",
    form2FormVersion: "form2-v1",
    form2EntryOfferValue: "Synthetic Free Test",
    form2AccessStatuses: Object.freeze({
      initial: "Synthetic Initial",
      issued: "Synthetic Issued",
      verified: "Synthetic Verified",
      submitted: "Synthetic Submitted",
    }),
    form2FieldTeamSizeBands: Object.freeze([
      "Synthetic Approved Band",
      "Different Private Band",
    ]),
    maxVerificationAttempts: 3,
    maxBodyBytes: 32768,
    inboundBodyTimeoutMs: 5000,
  });
}

test("form links are fail-closed to the exact approved Zoho Forms host", () => {
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  for (const form2PublicUrl of [
    "https://forms.zohopublic.evil.com/synthetic/form",
    "https://forms.example.invalid/synthetic/form",
    "https://example.invalid/synthetic/form",
  ]) {
    assert.throws(
      () => buildFormUrl({ ...config(), form2PublicUrl }, setupToken),
      (error) =>
        error instanceof ControllerError &&
        error.publicCode === "configuration_invalid" &&
        !error.message.includes(setupToken),
    );
  }
});

function initialRecords() {
  return {
    contact: {
      id: IDS.contact,
      Modified_Time: "2026-08-14T12:00:00-05:00",
      Account_Name: { id: IDS.account, name: "Synthetic Plumbing" },
      First_Name: "Casey",
      Last_Name: "Tester",
      Decision_Maker_Role: "Owner / Founder",
      Title: "Owner",
      Decision_Authority: "Authorized Signer",
      Email: "casey@example.invalid",
      Mobile: "+1 (555) 010-2000",
    },
    account: {
      id: IDS.account,
      Modified_Time: "2026-08-14T12:00:00-05:00",
      Primary_Contact: { id: IDS.contact, name: "Casey Tester" },
      Account_Name: "Synthetic Plumbing",
      Legal_Business_Name: "Synthetic Plumbing LLC",
      Phone: "+1 (555) 010-2100",
      Phone_System_Provider: "Synthetic PBX",
      Primary_Service_Area: "Synthetic County",
      Normal_Business_Hours: "Monday-Friday 08:00-17:00",
      Field_Team_Size_Band: "Synthetic Approved Band",
      Services_Handled: ["Drain Cleaning"],
      Other_Service_Details: null,
    },
    deal: {
      id: IDS.deal,
      Modified_Time: "2026-08-14T12:00:00-05:00",
      Account_Name: { id: IDS.account, name: "Synthetic Plumbing" },
      Contact_Name: { id: IDS.contact, name: "Casey Tester" },
      Entry_Offer: "Synthetic Free Test",
      Current_Call_Handling: "Office Staff / Dispatcher",
      Requested_Test_Route: "No Answer / Overflow Only",
      Approved_Test_Route: "No Answer / Overflow Only",
      Setup_Form_Submission_ID: null,
      Setup_Form_Submitted_At: null,
      Setup_Access_Status: "Synthetic Initial",
      Setup_Access_Issued_At: null,
      Setup_Access_Verified_At: null,
      Target_Start_Date: null,
      Test_Phone_Number: null,
      No_Answer_Delay: null,
      Forwarding_Administrator_Name: null,
      Forwarding_Administrator_Mobile: null,
      Approved_Fallback_Destination: null,
      Approved_Fallback_Number: null,
      Rollback_Contact_Name: null,
      Rollback_Contact_Mobile: null,
      Urgent_Call_Handling: null,
      Existing_Customer_Call_Handling: null,
      Alert_Recipient_Name: null,
      Alert_Recipient_Mobile: null,
      Alert_Recipient_Email: null,
      Test_Duration_Days: 7,
      Test_Call_Limit: 25,
      Test_Scope_Version: "scope-v1",
      Submission_Channel: "Website",
      Free_Test_Request_Submitted_At: "2026-08-14T11:00:00-05:00",
      Intake_Submission_ID: "synthetic-intake-0001",
      Free_Test_Request_Notes: "Synthetic request",
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRequest(path, body, secret, overrides = {}) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    method: "POST",
    url: path,
    headers: {
      "content-type": "application/json",
      "content-length": String(rawBody.length),
      [path === config().issuePath ? config().issueHeaderName : config().formsHeaderName]: secret,
    },
    rawBody,
    ...overrides,
  };
}

function issueBody() {
  return { dealId: IDS.deal, issueRequestId: ISSUE_REQUEST_ID };
}

function validSubmission(prefillBody, overrides = {}) {
  const values = Object.fromEntries(CLIENT_KEYS.map((key) => [key, prefillBody[key]]));
  return {
    setupToken: deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper),
    prefillId: prefillBody.prefillId,
    submissionId: "10001",
    ...values,
    requestedStartDate: "2026-08-20",
    testPhoneNumber: "555-010-2200",
    noAnswerDelay: "5 Rings",
    forwardingAdministratorName: "Synthetic Administrator",
    forwardingAdministratorMobile: "555-010-2300",
    approvedFallbackDestination: "On-Call Mobile",
    approvedFallbackNumber: "555-010-2400",
    rollbackContactName: "Synthetic Rollback Contact",
    rollbackContactMobile: "555-010-2500",
    urgentCallHandling: "Alert + Capture Callback",
    existingCustomerCallHandling: "Capture Callback Only",
    alertRecipientName: "Synthetic Alert Recipient",
    alertRecipientMobile: "555-010-2600",
    alertRecipientEmail: null,
    authorizedRepresentativeConfirmed: true,
    testScopeAccepted: true,
    ...overrides,
  };
}

function fixture() {
  const selectedConfig = config();
  const records = initialRecords();
  const events = [];
  let modifiedSequence = 0;
  let session = null;
  let prefill = null;
  let receipt = null;
  let forceClaimOutcome = null;
  let compositeError = null;
  let crmReadError = null;
  let mintError = null;
  let verifyError = null;

  function nextModifiedTime() {
    modifiedSequence += 1;
    return `2026-08-14T18:00:${String(modifiedSequence).padStart(2, "0")}.000Z`;
  }

  const crmClient = {
    async getRecord(module, id) {
      events.push(`crm.get.${module}`);
      if (crmReadError) throw crmReadError;
      const key = { Contacts: "contact", Accounts: "account", Deals: "deal" }[module];
      assert.equal(id, records[key].id);
      return clone(records[key]);
    },
    async updateRecord(module, id, update, options) {
      events.push(`crm.update.${module}`);
      assert.equal(module, "Deals");
      assert.equal(id, IDS.deal);
      assert.equal(options.ifUnmodifiedSince, records.deal.Modified_Time);
      Object.assign(records.deal, clone(update), { Modified_Time: nextModifiedTime() });
      return clone(records.deal);
    },
    async updateForm2Composite(existing, updates) {
      events.push("crm.composite");
      if (compositeError) throw compositeError;
      assert.equal(existing.contact.id, IDS.contact);
      assert.equal(updates.contactUpdate.Email, undefined);
      assert.equal(updates.contactUpdate.Mobile, undefined);
      Object.assign(records.contact, clone(updates.contactUpdate), { Modified_Time: nextModifiedTime() });
      Object.assign(records.account, clone(updates.accountUpdate), { Modified_Time: nextModifiedTime() });
      Object.assign(records.deal, clone(updates.dealUpdate), { Modified_Time: nextModifiedTime() });
      return clone(records);
    },
  };

  const sessionStore = {
    async readByIssueKey(issueKey) {
      events.push("session.issue.read");
      return session && issueKey === session.issueKey ? Object.freeze({ ...session }) : null;
    },
    async issue(input) {
      events.push("session.issue");
      if (!session) {
        session = {
          rowId: "7000000000001",
          issueKey: input.issueKey,
          tokenHash: input.tokenHash,
          crmContactId: input.crmContactId,
          crmAccountId: input.crmAccountId,
          crmDealId: input.crmDealId,
          status: "issued",
          issuedAt: "2026-08-14T18:00:00.000Z",
          expiresAt: "2026-08-14T19:00:00.000Z",
          attemptCount: 0,
          maxAttempts: selectedConfig.maxVerificationAttempts,
          verifiedAt: "",
          expiredAt: "",
        };
      } else {
        assert.equal(input.issueKey, session.issueKey);
        assert.equal(input.tokenHash, session.tokenHash);
      }
      return Object.freeze({ ...session });
    },
    async verify(tokenHash) {
      events.push("session.verify");
      if (!session || tokenHash !== session.tokenHash) return { outcome: "not_found", session: null };
      if (verifyError) throw verifyError;
      if (!new Set(["issued", "verified"]).has(session.status)) {
        return { outcome: session.status, session: Object.freeze({ ...session }) };
      }
      if (Date.parse(session.expiresAt) <= NOW_MS) {
        session.status = "expired";
        session.expiredAt = new Date(NOW_MS).toISOString();
        return { outcome: "expired", session: Object.freeze({ ...session }) };
      }
      if (session.attemptCount >= session.maxAttempts) {
        session.status = "failed";
        return { outcome: "failed", session: Object.freeze({ ...session }) };
      }
      session.status = "verified";
      session.attemptCount += 1;
      session.verifiedAt ||= "2026-08-14T18:00:00.000Z";
      return { outcome: "verified", session: Object.freeze({ ...session }) };
    },
    async readByTokenHash(tokenHash) {
      events.push("session.read");
      return session && tokenHash === session.tokenHash ? Object.freeze({ ...session }) : null;
    },
    async readByRowId(rowId) {
      events.push("session.row.read");
      return session && String(rowId) === String(session.rowId)
        ? Object.freeze({ ...session })
        : null;
    },
    async markSubmitted(rowId) {
      events.push("session.submitted");
      assert.equal(rowId, session.rowId);
      session.status = "submitted";
      return Object.freeze({ ...session });
    },
    async markReconciliationRequired(rowId) {
      events.push("session.reconciliation");
      assert.equal(rowId, session.rowId);
      session.status = "reconciliation_required";
      return Object.freeze({ ...session });
    },
  };

  const workflowStore = {
    async mintPrefill(binding) {
      events.push("workflow.prefill.mint");
      if (mintError) throw mintError;
      prefill = {
        rowId: "7100000000001",
        prefillKey: "a".repeat(64),
        status: "ready",
        consumptionOwner: "",
        ...binding,
      };
      return { prefillId: PREFILL_ID, revision: Object.freeze({ ...prefill }) };
    },
    async readPrefill(input) {
      events.push("workflow.prefill.read");
      if (!prefill || input.prefillId !== PREFILL_ID) return null;
      assert.equal(String(input.sessionRowId), String(prefill.sessionRowId));
      return Object.freeze({ ...prefill });
    },
    async claimSubmission(input) {
      events.push("workflow.submission.claim");
      if (forceClaimOutcome === "unresolved") {
        return { outcome: "unresolved", receipt: Object.freeze({ ...(receipt ?? {}) }) };
      }
      if (receipt) {
        assert.equal(input.submissionId, receipt.submissionId);
        return {
          outcome: receipt.status === "succeeded" ? "succeeded" : "unresolved",
          receipt: Object.freeze({ ...receipt }),
        };
      }
      receipt = {
        rowId: "7200000000001",
        leaseOwner: LEASE_OWNER,
        submissionId: input.submissionId,
        status: "processing",
      };
      return { outcome: "claimed", receipt: Object.freeze({ ...receipt }) };
    },
    async consumePrefill(input) {
      events.push("workflow.prefill.consume");
      assert.equal(input.prefillId, PREFILL_ID);
      assert.equal(input.snapshotFingerprint, prefill.snapshotFingerprint);
      prefill.status = "submitted";
      prefill.consumptionOwner = CONSUMPTION_OWNER;
      return Object.freeze({ ...prefill });
    },
    async markSubmissionSucceeded(reference) {
      events.push("workflow.submission.succeeded");
      assert.equal(reference.rowId, receipt.rowId);
      receipt.status = "succeeded";
      return Object.freeze({ ...receipt });
    },
    async markSubmissionFailed(reference, outcome) {
      events.push("workflow.submission.failed");
      assert.equal(reference.rowId, receipt.rowId);
      receipt.status = "failed";
      receipt.lastOutcome = outcome;
      return Object.freeze({ ...receipt });
    },
    async markSubmissionReconciliationRequired(reference) {
      events.push("workflow.submission.reconciliation");
      assert.equal(reference.rowId, receipt.rowId);
      receipt.status = "reconciliation_required";
      return Object.freeze({ ...receipt });
    },
    async markPrefillReconciliationRequired(reference) {
      events.push("workflow.prefill.reconciliation");
      assert.equal(reference.rowId, prefill.rowId);
      prefill.status = "reconciliation_required";
      return Object.freeze({ ...prefill });
    },
  };

  const dependencies = {
    config: selectedConfig,
    crmClient,
    sessionStore,
    workflowStore,
    now: () => NOW_MS,
  };
  return {
    dependencies,
    events,
    records,
    get prefill() { return prefill; },
    get receipt() { return receipt; },
    get session() { return session; },
    setForceClaimOutcome(value) { forceClaimOutcome = value; },
    setCompositeError(value) { compositeError = value; },
    setCrmReadError(value) { crmReadError = value; },
    setMintError(value) { mintError = value; },
    setVerifyError(value) { verifyError = value; },
  };
}

async function issue(fixtureValue) {
  return handleForm2Request(
    createRequest(
      fixtureValue.dependencies.config.issuePath,
      issueBody(),
      fixtureValue.dependencies.config.issueHeaderSecret,
    ),
    fixtureValue.dependencies,
  );
}

async function prefill(fixtureValue) {
  return handleForm2Request(
    createRequest(
      fixtureValue.dependencies.config.prefillPath,
      { setupToken: deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper) },
      fixtureValue.dependencies.config.prefillHeaderSecret,
    ),
    fixtureValue.dependencies,
  );
}

async function submit(fixtureValue, body) {
  return handleForm2Request(
    createRequest(
      fixtureValue.dependencies.config.submissionPath,
      body,
      fixtureValue.dependencies.config.submissionHeaderSecret,
    ),
    fixtureValue.dependencies,
  );
}

test("rejects a bad route-specific source header before body, stores, or CRM", async () => {
  const selected = fixture();
  let bodyReads = 0;
  const request = createRequest(config().issuePath, issueBody(), "wrong-secret");
  const rawBody = request.rawBody;
  delete request.rawBody;
  Object.defineProperty(request, "rawBody", {
    get() {
      bodyReads += 1;
      return rawBody;
    },
  });

  const result = await handleForm2Request(request, selected.dependencies);
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { ok: false, code: "unauthorized_source" });
  assert.equal(result.stage, "issue");
  assert.equal(result.outcome, "unauthorized_source");
  assert.equal(bodyReads, 0);
  assert.deepEqual(selected.events, []);
});

test("issues one retry-stable URL containing only the opaque token and no CRM IDs", async () => {
  const selected = fixture();
  const first = await issue(selected);
  const retry = await issue(selected);
  assert.equal(first.status, 200);
  assert.equal(first.stage, "issue");
  assert.equal(first.outcome, "issued");
  assert.equal(retry.body.formUrl, first.body.formUrl);
  const formUrl = new URL(first.body.formUrl);
  assert.deepEqual([...formUrl.searchParams.keys()], [config().form2TokenFieldAlias]);
  assert.equal(
    formUrl.searchParams.get(config().form2TokenFieldAlias),
    deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper),
  );
  const serialized = JSON.stringify(first.body);
  for (const id of Object.values(IDS)) assert.equal(serialized.includes(id), false);
  assert.equal(selected.events.filter((event) => event === "session.issue").length, 2);
  assert.equal(selected.events.filter((event) => event === "crm.update.Deals").length, 1);
  assert.equal(
    selected.session.issueKey,
    hashIssueRequestId(ISSUE_REQUEST_ID, config().tokenPepper),
  );
  assert.equal(
    selected.session.tokenHash,
    hashAccessToken(deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper), config().tokenPepper),
  );
});

test("rejects missing locked CRM identity before issuing session or Deal state", async () => {
  for (const field of ["Email", "Mobile"]) {
    const selected = fixture();
    selected.records.contact[field] = null;
    const result = await issue(selected);
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
    assert.equal(selected.session, null);
    assert.equal(selected.events.includes("session.issue"), false);
    assert.equal(selected.events.includes("crm.update.Deals"), false);
  }
});

test("two simultaneous exact issue retries converge without invalidating their shared token", async () => {
  const selected = fixture();
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  let arrivals = 0;
  let releaseFirst;
  const firstCanReadBack = new Promise((resolve) => { releaseFirst = resolve; });
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    arrivals += 1;
    if (arrivals === 1) {
      await firstCanReadBack;
      const error = new Error("synthetic concurrent stale write");
      error.publicCode = "record_stale";
      error.status = 409;
      throw error;
    }
    const result = await originalUpdate(...argumentsList);
    releaseFirst();
    return result;
  };

  const results = await Promise.all([issue(selected), issue(selected)]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.equal(results[0].body.formUrl, results[1].body.formUrl);
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
});

test("rejects a different issuance identity after access is issued", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  selected.events.length = 0;
  const result = await handleForm2Request(
    createRequest(
      selected.dependencies.config.issuePath,
      { ...issueBody(), issueRequestId: "10000000-0000-4000-8000-000000000002" },
      selected.dependencies.config.issueHeaderSecret,
    ),
    selected.dependencies,
  );
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("session.issue"), false);
});

test("an exact issue retry remains valid after verification without downgrading CRM state", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  assert.equal((await prefill(selected)).status, 200);
  selected.events.length = 0;
  const result = await issue(selected);
  assert.equal(result.status, 200);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Verified");
  assert.equal(selected.events.includes("crm.update.Deals"), false);
});

test("an issue retry overlapping first prefill never invalidates the shared session", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);

  const originalIssue = selected.dependencies.sessionStore.issue.bind(
    selected.dependencies.sessionStore,
  );
  let announceIssueRetry;
  let releaseIssueRetry;
  const issueRetryReachedStore = new Promise((resolve) => { announceIssueRetry = resolve; });
  const issueRetryMayContinue = new Promise((resolve) => { releaseIssueRetry = resolve; });
  selected.dependencies.sessionStore.issue = async (input) => {
    announceIssueRetry();
    await issueRetryMayContinue;
    return originalIssue(input);
  };

  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  let announcePrefillWrite;
  let releasePrefillWrite;
  const prefillReachedDealWrite = new Promise((resolve) => { announcePrefillWrite = resolve; });
  const prefillWriteMayContinue = new Promise((resolve) => { releasePrefillWrite = resolve; });
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    const update = argumentsList[2];
    if (update.Setup_Access_Status === "Synthetic Verified") {
      announcePrefillWrite();
      await prefillWriteMayContinue;
    }
    return originalUpdate(...argumentsList);
  };

  selected.events.length = 0;
  const issueRetryPromise = issue(selected);
  await issueRetryReachedStore;
  const prefillPromise = prefill(selected);
  await prefillReachedDealWrite;
  releaseIssueRetry();
  const issueRetryResult = await issueRetryPromise;

  assert.equal(issueRetryResult.status, 503);
  assert.deepEqual(issueRetryResult.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.events.includes("session.reconciliation"), false);

  releasePrefillWrite();
  const prefillResult = await prefillPromise;
  assert.equal(prefillResult.status, 200);
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Verified");
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("verifies CRM, mints a bound prefill revision, and returns no IDs or token", async () => {
  const selected = fixture();
  await issue(selected);
  selected.events.length = 0;
  const result = await prefill(selected);
  assert.equal(result.status, 200);
  assert.equal(result.stage, "prefill");
  assert.equal(result.outcome, "prepared");
  assert.deepEqual(Object.keys(result.body), [...CLIENT_KEYS, "prefillId"]);
  assert.equal(result.body.prefillId, PREFILL_ID);
  assert.match(selected.prefill.snapshotFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(selected.prefill.dealModifiedTime, selected.records.deal.Modified_Time);
  const serialized = JSON.stringify(result.body);
  for (const id of Object.values(IDS)) assert.equal(serialized.includes(id), false);
  assert.equal(serialized.includes(deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper)), false);
  assert.ok(selected.events.indexOf("session.verify") < selected.events.indexOf("crm.update.Deals"));
  assert.ok(selected.events.indexOf("crm.update.Deals") < selected.events.indexOf("workflow.prefill.mint"));
});

test("prefill contract defects do not consume verification state", async () => {
  const selected = fixture();
  await issue(selected);
  selected.records.contact.Email = null;
  selected.events.length = 0;
  const result = await prefill(selected);
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
  assert.equal(selected.events.includes("session.verify"), false);
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);
});

test("a post-verification prefill-store failure is recoverable through one bounded retry", async () => {
  const selected = fixture();
  await issue(selected);
  const dependencyError = new Error("synthetic prefill store unavailable");
  dependencyError.publicCode = "workflow_store_unavailable";
  selected.setMintError(dependencyError);
  const failed = await prefill(selected);
  assert.equal(failed.status, 503);
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Verified");

  selected.setMintError(null);
  selected.events.length = 0;
  const recovered = await prefill(selected);
  assert.equal(recovered.status, 200);
  assert.equal(selected.events.includes("session.verify"), true);
  assert.equal(selected.session.attemptCount, 2);
  assert.equal(selected.events.includes("crm.update.Deals"), false);
});

test("durably expires an elapsed prefill session before returning the generic 404", async () => {
  const selected = fixture();
  await issue(selected);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, code: "setup_not_found" });
  assert.equal(selected.session.status, "expired");
  assert.equal(selected.session.expiredAt, "2026-08-14T18:00:00.000Z");
  assert.deepEqual(selected.events, ["session.read", "session.verify"]);
});

test("bounds repeated verified prefill requests with the durable attempt ceiling", async () => {
  const selected = fixture();
  await issue(selected);

  for (let attempt = 1; attempt <= selected.dependencies.config.maxVerificationAttempts; attempt += 1) {
    const result = await prefill(selected);
    assert.equal(result.status, 200);
    assert.equal(selected.session.attemptCount, attempt);
  }

  selected.events.length = 0;
  const exhausted = await prefill(selected);
  assert.equal(exhausted.status, 404);
  assert.deepEqual(exhausted.body, { ok: false, code: "setup_not_found" });
  assert.equal(selected.session.status, "failed");
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);
});

test("does not mint when a failed verified retry did not advance its durable attempt", async () => {
  const selected = fixture();
  await issue(selected);
  assert.equal((await prefill(selected)).status, 200);
  assert.equal(selected.session.attemptCount, 1);

  const verifyFailure = new Error("synthetic conditional write failed before commit");
  verifyFailure.publicCode = "reconciliation_required";
  selected.setVerifyError(verifyFailure);
  selected.events.length = 0;
  const result = await prefill(selected);

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.session.attemptCount, 1);
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);
});

test("two simultaneous exact prefills converge after one conditional CRM winner", async () => {
  const selected = fixture();
  await issue(selected);
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  let arrivals = 0;
  let releaseFirst;
  const firstCanReadBack = new Promise((resolve) => { releaseFirst = resolve; });
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    arrivals += 1;
    if (arrivals === 1) {
      await firstCanReadBack;
      const error = new Error("synthetic concurrent stale write");
      error.publicCode = "record_stale";
      error.status = 409;
      throw error;
    }
    const result = await originalUpdate(...argumentsList);
    releaseFirst();
    return result;
  };

  const results = await Promise.all([prefill(selected), prefill(selected)]);
  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Verified");
});

test("runs claim, one-time consume, atomic CRM composite, receipt, then session in order", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.events.length = 0;
  const result = await submit(selected, validSubmission(prefillResult.body));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, accepted: true, duplicate: false });
  assert.equal(result.stage, "submission");
  assert.equal(result.outcome, "accepted");
  const order = [
    "workflow.submission.claim",
    "workflow.prefill.consume",
    "crm.composite",
    "workflow.submission.succeeded",
    "session.submitted",
  ].map((event) => selected.events.indexOf(event));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((position) => position >= 0));
  assert.equal(
    selected.records.deal.Setup_Form_Submission_ID,
    "form2-v1:10001",
  );
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Submitted");
});

test("email and mobile changes fail through the contract before consume or CRM mutation", async () => {
  for (const [submissionId, change] of [
    ["10002", { businessEmail: "different@example.invalid" }],
    ["10003", { directMobileNumber: "555-010-2999" }],
  ]) {
    const selected = fixture();
    await issue(selected);
    const prefillResult = await prefill(selected);
    selected.events.length = 0;
    const result = await submit(
      selected,
      validSubmission(prefillResult.body, { submissionId, ...change }),
    );
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
    assert.equal(selected.events.includes("workflow.submission.failed"), true);
    assert.equal(selected.events.includes("workflow.prefill.consume"), false);
    assert.equal(selected.events.includes("crm.composite"), false);
  }
});

test("stale Modified_Time fails after claim without consuming prefill or writing CRM", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.records.account.Modified_Time = "2026-08-14T18:00:59.000Z";
  selected.events.length = 0;
  const result = await submit(selected, validSubmission(prefillResult.body));
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("workflow.submission.claim"), true);
  assert.equal(selected.events.includes("workflow.submission.failed"), true);
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("an exact succeeded duplicate requires matching CRM readback and does not rerun composite", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.events.length = 0;
  const duplicate = await submit(selected, body);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(selected.events.includes("crm.get.Deals"), true);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("an unresolved duplicate is non-successful and never reaches CRM", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.setForceClaimOutcome("unresolved");
  selected.events.length = 0;
  const result = await submit(
    selected,
    validSubmission(prefillResult.body, { submissionId: "10004" }),
  );
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("rejects a decorated Forms Unique ID before a durable submission claim", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.events.length = 0;
  const result = await submit(
    selected,
    validSubmission(prefillResult.body, { submissionId: "customer-10005" }),
  );
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, code: "form_invalid" });
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
});

test("labels an unambiguous pre-consumption dependency failure as safely retryable", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const dependencyError = new Error("synthetic dependency unavailable");
  dependencyError.publicCode = "crm_dependency_failed";
  selected.setCrmReadError(dependencyError);
  selected.events.length = 0;
  const result = await submit(
    selected,
    validSubmission(prefillResult.body, { submissionId: "10006" }),
  );
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.receipt.lastOutcome, "retryable_precommit");
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);
});

test("ambiguous CRM errors reconcile durable state and return only a redacted error", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const secretMessage = `casey@example.invalid ${IDS.deal} ${deriveAccessToken(
    ISSUE_REQUEST_ID,
    config().tokenPepper,
  )}`;
  const error = new Error(secretMessage);
  error.ambiguous = true;
  error.publicCode = "reconciliation_required";
  selected.setCompositeError(error);
  selected.events.length = 0;
  const result = await submit(selected, validSubmission(prefillResult.body));
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("casey@example.invalid"), false);
  assert.equal(serialized.includes(IDS.deal), false);
  assert.equal(serialized.includes("access_token"), false);
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), true);
  assert.equal(selected.events.includes("workflow.prefill.reconciliation"), true);
  assert.equal(selected.events.includes("session.reconciliation"), true);
});
