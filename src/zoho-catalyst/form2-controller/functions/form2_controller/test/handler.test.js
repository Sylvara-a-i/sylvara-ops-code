"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { CLIENT_KEYS } = require("../lib/form-contract");
const { ControllerError, buildFormUrl, handleForm2Request } = require("../lib/handler");
const { deriveAccessToken, hashAccessToken } = require("../lib/security");

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
      expired: "Synthetic Expired",
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

function dealIssuanceKey(kind, dealId, generationTokenHash = "") {
  return crypto
    .createHash("sha256")
    .update(`sylvara-form2:development:deal-${kind}\0`, "utf8")
    .update(dealId, "utf8")
    .update(kind === "generation" ? `\0${generationTokenHash}` : "", "utf8")
    .digest("hex");
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
  const sessions = [];
  let nextSessionRowId = 7000000000001n;
  let prefill = null;
  let receipt = null;
  let forceClaimOutcome = null;
  let compositeError = null;
  let crmReadError = null;
  let mintError = null;
  let verifyError = null;
  let compositeReplay = false;

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
      return { ...clone(records), replayed: compositeReplay };
    },
  };

  const sessionStore = {
    async readActiveByCrmDealId(dealId) {
      events.push("session.deal.active.read");
      const activeKey = dealIssuanceKey("active", dealId);
      const matches = sessions.filter(
        (candidate) => candidate.dealIssuanceKey === activeKey,
      );
      assert.ok(matches.length <= 1, "the Deal issuance key must be unique");
      return matches[0] ? Object.freeze({ ...matches[0] }) : null;
    },
    async issue(input) {
      events.push("session.issue");
      let match = sessions.find((candidate) => input.tokenHash === candidate.tokenHash);
      if (!match) {
        const activeKey = dealIssuanceKey("active", input.crmDealId);
        if (sessions.some((candidate) => candidate.dealIssuanceKey === activeKey)) {
          const error = new Error("synthetic Deal issuance uniqueness conflict");
          error.publicCode = "reconciliation_required";
          throw error;
        }
        match = {
          rowId: String(nextSessionRowId++),
          tokenHash: input.tokenHash,
          crmContactId: input.crmContactId,
          crmAccountId: input.crmAccountId,
          crmDealId: input.crmDealId,
          dealIssuanceKey: activeKey,
          status: "issuing",
          issuedAt: "2026-08-14T18:00:00.000Z",
          expiresAt: "2026-08-14T19:00:00.000Z",
          attemptCount: 0,
          maxAttempts: selectedConfig.maxVerificationAttempts,
          verifiedAt: "",
          submittedAt: "",
          expiredAt: "",
          lastOutcome: "issuing",
        };
        sessions.push(match);
      } else {
        assert.equal(input.tokenHash, match.tokenHash);
      }
      session = match;
      return Object.freeze({ ...match });
    },
    async verify(tokenHash) {
      events.push("session.verify");
      const match = sessions.find((candidate) => tokenHash === candidate.tokenHash);
      if (!match) return { outcome: "not_found", session: null };
      session = match;
      if (verifyError) throw verifyError;
      if (!new Set(["issued", "verified"]).has(match.status)) {
        return { outcome: match.status, session: Object.freeze({ ...match }) };
      }
      if (Date.parse(match.expiresAt) <= NOW_MS) {
        match.status = "expired";
        match.expiredAt = new Date(NOW_MS).toISOString();
        match.lastOutcome = "crm_expiry_pending";
        return { outcome: "expired", session: Object.freeze({ ...match }) };
      }
      if (match.attemptCount >= match.maxAttempts) {
        match.status = "failed";
        return { outcome: "failed", session: Object.freeze({ ...match }) };
      }
      match.status = "verified";
      match.lastOutcome = "verified";
      match.attemptCount += 1;
      match.verifiedAt ||= "2026-08-14T18:00:00.000Z";
      return { outcome: "verified", session: Object.freeze({ ...match }) };
    },
    async readByTokenHash(tokenHash) {
      events.push("session.read");
      const match = sessions.find((candidate) => tokenHash === candidate.tokenHash);
      return match ? Object.freeze({ ...match }) : null;
    },
    async readByRowId(rowId) {
      events.push("session.row.read");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      return match
        ? Object.freeze({ ...match })
        : null;
    },
    async beginSubmission(rowId, submissionFingerprint) {
      events.push("session.submitting");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      const outcome = `submitting_${submissionFingerprint}`;
      if (match.status === "submitting" && match.lastOutcome === outcome) {
        return Object.freeze({ ...match });
      }
      if (match.status !== "verified") {
        const error = new Error("synthetic session submission conflict");
        error.publicCode = match.status === "submitting"
          ? "submission_conflict"
          : "session_state_invalid";
        throw error;
      }
      session = match;
      match.status = "submitting";
      match.lastOutcome = outcome;
      return Object.freeze({ ...match });
    },
    async releaseSubmission(rowId, submissionFingerprint) {
      events.push("session.submission.released");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      const expected = `submitting_${submissionFingerprint}`;
      if (match.status === "verified" && match.lastOutcome === "submission_released") {
        return Object.freeze({ ...match });
      }
      if (match.status !== "submitting" || match.lastOutcome !== expected) {
        const error = new Error("synthetic session release conflict");
        error.publicCode = "session_state_invalid";
        throw error;
      }
      session = match;
      match.status = "verified";
      match.lastOutcome = "submission_released";
      return Object.freeze({ ...match });
    },
    async markSubmitted(rowId, submissionFingerprint) {
      events.push("session.submitted");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      if (match.status === "submitted") return Object.freeze({ ...match });
      if (
        match.status !== "verified" &&
        !(
          match.status === "submitting" &&
          match.lastOutcome === `submitting_${submissionFingerprint}`
        )
      ) {
        const error = new Error("synthetic session submission conflict");
        error.publicCode = "session_state_invalid";
        throw error;
      }
      session = match;
      match.status = "submitted";
      match.lastOutcome = "submitted";
      match.submittedAt = new Date(NOW_MS).toISOString();
      return Object.freeze({ ...match });
    },
    async markIssued(rowId) {
      events.push("session.issued");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      session = match;
      if (match.status === "issuing") {
        match.status = "issued";
        match.lastOutcome = "issued";
      }
      return Object.freeze({ ...match });
    },
    async markExpirySynced(rowId) {
      events.push("session.expiry.synced");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      session = match;
      if (match.status === "expired" && match.lastOutcome === "crm_expiry_synced") {
        return Object.freeze({ ...match });
      }
      if (
        match.status !== "expired" ||
        !new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(match.lastOutcome)
      ) {
        throw new Error("synthetic expiry synchronization conflict");
      }
      match.lastOutcome = "crm_expiry_synced";
      match.dealIssuanceKey = dealIssuanceKey(
        "generation",
        match.crmDealId,
        match.tokenHash,
      );
      return Object.freeze({ ...match });
    },
    async markIssuingExpiryPending(rowId) {
      events.push("session.issuing.expiry.pending");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      session = match;
      if (
        match.status === "expired" &&
        new Set(["issuing_expiry_pending", "crm_expiry_synced"]).has(match.lastOutcome)
      ) {
        return Object.freeze({ ...match });
      }
      if (match.status !== "issuing" || match.lastOutcome !== "issuing") {
        const error = new Error("synthetic stale issuing expiry conflict");
        error.publicCode = "session_state_invalid";
        throw error;
      }
      match.status = "expired";
      match.lastOutcome = "issuing_expiry_pending";
      match.expiredAt = new Date(NOW_MS).toISOString();
      return Object.freeze({ ...match });
    },
    async markExpiryReconciliationRequired(rowId) {
      events.push("session.reconciliation");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      session = match;
      if (
        match.status !== "expired" ||
        !new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(match.lastOutcome)
      ) {
        throw new Error("synthetic expiry reconciliation conflict");
      }
      match.status = "reconciliation_required";
      match.lastOutcome = "crm_expiry_outcome_unknown";
      return Object.freeze({ ...match });
    },
    async markReconciliationRequired(rowId, outcome = "outcome_unknown") {
      events.push("session.reconciliation");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      if (match.status === "submitted") {
        const error = new Error("synthetic submitted reconciliation conflict");
        error.publicCode = "session_state_invalid";
        throw error;
      }
      session = match;
      match.status = "reconciliation_required";
      match.lastOutcome = outcome;
      return Object.freeze({ ...match });
    },
    async markSubmittedReconciliationRequired(
      rowId,
      outcome = "succeeded_receipt_crm_mismatch",
    ) {
      events.push("session.submitted.reconciliation");
      const match = sessions.find((candidate) => String(rowId) === String(candidate.rowId));
      assert.ok(match);
      if (match.status !== "submitted") {
        const error = new Error("synthetic submitted reconciliation conflict");
        error.publicCode = "session_state_invalid";
        throw error;
      }
      session = match;
      match.status = "reconciliation_required";
      match.lastOutcome = outcome;
      return Object.freeze({ ...match });
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
    async readSubmission(input) {
      events.push("workflow.submission.read");
      if (!receipt || input.submissionId !== receipt.submissionId) return null;
      if (
        input.prefillId !== receipt.prefillId ||
        String(input.sessionRowId) !== String(receipt.sessionRowId) ||
        input.submissionFingerprint !== receipt.submissionFingerprint
      ) {
        const error = new Error("synthetic submission binding conflict");
        error.publicCode = "submission_conflict";
        throw error;
      }
      return Object.freeze({ ...receipt });
    },
    async claimSubmission(input) {
      events.push("workflow.submission.claim");
      if (forceClaimOutcome === "unresolved") {
        return { outcome: "unresolved", receipt: Object.freeze({ ...(receipt ?? {}) }) };
      }
      if (receipt) {
        assert.equal(input.submissionId, receipt.submissionId);
        assert.equal(input.prefillId, receipt.prefillId);
        assert.equal(String(input.sessionRowId), String(receipt.sessionRowId));
        assert.equal(input.submissionFingerprint, receipt.submissionFingerprint);
        if (receipt.status === "failed" && receipt.lastOutcome === "retryable_precommit") {
          receipt.status = "processing";
          receipt.leaseOwner = LEASE_OWNER;
          receipt.attemptCount += 1;
          receipt.failedAt = "";
          receipt.lastOutcome = "processing";
          return { outcome: "claimed", receipt: Object.freeze({ ...receipt }) };
        }
        return {
          outcome: receipt.status === "succeeded" ? "succeeded" : "unresolved",
          receipt: Object.freeze({ ...receipt }),
        };
      }
      receipt = {
        rowId: "7200000000001",
        leaseOwner: LEASE_OWNER,
        leaseExpiresAt: "2026-08-14T19:00:00.000Z",
        claimedAt: "2026-08-14T18:00:00.000Z",
        submissionId: input.submissionId,
        submissionKey: input.submissionId,
        prefillId: input.prefillId,
        prefillKey: input.prefillId,
        sessionRowId: input.sessionRowId,
        submissionFingerprint: input.submissionFingerprint,
        status: "processing",
        attemptCount: 1,
        succeededAt: "",
        failedAt: "",
        reconciliationRequiredAt: "",
        updatedAt: "2026-08-14T18:00:00.000Z",
        lastOutcome: "processing",
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
      receipt.succeededAt = new Date(NOW_MS).toISOString();
      receipt.updatedAt = receipt.succeededAt;
      receipt.lastOutcome = "succeeded";
      return Object.freeze({ ...receipt });
    },
    async markSubmissionFailed(reference, outcome) {
      events.push("workflow.submission.failed");
      assert.equal(reference.rowId, receipt.rowId);
      receipt.status = "failed";
      receipt.failedAt = new Date(NOW_MS).toISOString();
      receipt.updatedAt = receipt.failedAt;
      receipt.lastOutcome = outcome;
      return Object.freeze({ ...receipt });
    },
    async markSubmissionReconciliationRequired(reference) {
      events.push("workflow.submission.reconciliation");
      assert.equal(reference.rowId, receipt.rowId);
      receipt.status = "reconciliation_required";
      receipt.reconciliationRequiredAt = new Date(NOW_MS).toISOString();
      receipt.updatedAt = receipt.reconciliationRequiredAt;
      receipt.lastOutcome = "crm_outcome_unknown";
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
    get sessions() { return sessions; },
    clearPrefill() { prefill = null; },
    setForceClaimOutcome(value) { forceClaimOutcome = value; },
    setCompositeError(value) { compositeError = value; },
    setCompositeReplay(value) { compositeReplay = value; },
    setCrmReadError(value) { crmReadError = value; },
    setMintError(value) { mintError = value; },
    setVerifyError(value) { verifyError = value; },
  };
}

async function issue(fixtureValue, body = issueBody()) {
  return handleForm2Request(
    createRequest(
      fixtureValue.dependencies.config.issuePath,
      body,
      fixtureValue.dependencies.config.issueHeaderSecret,
    ),
    fixtureValue.dependencies,
  );
}

async function seedIssuingSession(fixtureValue, issueRequestId = ISSUE_REQUEST_ID) {
  const setupToken = deriveAccessToken(
    issueRequestId,
    fixtureValue.dependencies.config.tokenPepper,
  );
  return fixtureValue.dependencies.sessionStore.issue({
    tokenHash: hashAccessToken(
      setupToken,
      fixtureValue.dependencies.config.tokenPepper,
    ),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
  });
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

test("an exact issuing row plus CRM Issued readback finalizes after a crash", async () => {
  const selected = fixture();
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  const pending = await selected.dependencies.sessionStore.issue({
    tokenHash: hashAccessToken(setupToken, config().tokenPepper),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
  });
  Object.assign(selected.records.deal, {
    Setup_Access_Status: "Synthetic Issued",
    Setup_Access_Issued_At: pending.issuedAt,
    Setup_Access_Verified_At: null,
  });
  selected.events.length = 0;

  const recovered = await issue(selected);

  assert.equal(recovered.status, 200);
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.sessions.length, 1);
  assert.equal(selected.events.includes("session.issued"), true);
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("two concurrent distinct issuance identities leave exactly one usable token", async () => {
  for (const startingStatus of ["Synthetic Initial", "Synthetic Expired"]) {
    const selected = fixture();
    selected.records.deal.Setup_Access_Status = startingStatus;
    if (startingStatus === "Synthetic Expired") {
      selected.records.deal.Setup_Access_Issued_At = "2026-08-14T17:00:00.000Z";
    }
    const results = await Promise.all([
      issue(selected, {
        ...issueBody(),
        issueRequestId: "10000000-0000-4000-8000-000000000011",
      }),
      issue(selected, {
        ...issueBody(),
        issueRequestId: "10000000-0000-4000-8000-000000000012",
      }),
    ]);

    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(
      results.filter((result) => new Set([409, 503]).has(result.status)).length,
      1,
    );
    assert.equal(results.filter((result) => Object.hasOwn(result.body, "formUrl")).length, 1);
    assert.deepEqual(selected.sessions.map((candidate) => candidate.status), ["issued"]);
  }
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

test("a forged CRM Expired label cannot bypass a live Deal issuance lock", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  selected.records.deal.Setup_Access_Status = "Synthetic Expired";
  selected.events.length = 0;

  const blocked = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000099",
  });

  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.sessions.length, 1);
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.events.includes("session.issue"), false);

  selected.records.deal.Setup_Access_Status = "Synthetic Issued";
  assert.equal((await prefill(selected)).status, 200);
});

test("token-pepper rotation cannot bypass the stable active Deal lock", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  selected.dependencies.config = Object.freeze({
    ...selected.dependencies.config,
    tokenPepper: "Q".repeat(43),
  });
  selected.events.length = 0;

  const blocked = await issue(selected);

  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.sessions.length, 1);
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
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
  assert.equal(selected.session.lastOutcome, "crm_expiry_synced");
  assert.deepEqual(selected.events, [
    "session.read",
    "session.verify",
    "crm.get.Deals",
    "crm.update.Deals",
    "session.expiry.synced",
  ]);
});

test("a persisted expiry-pending session repairs CRM after a process restart", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  assert.equal((await prefill(selected)).status, 200);
  selected.session.status = "expired";
  selected.session.expiredAt = "2026-08-14T18:00:00.000Z";
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.session.lastOutcome = "crm_expiry_pending";
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 404);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
  assert.equal(selected.session.status, "expired");
  assert.equal(selected.session.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.events.includes("session.verify"), false);
  assert.ok(
    selected.events.indexOf("crm.update.Deals") <
      selected.events.indexOf("session.expiry.synced"),
  );
});

test("expiry never acknowledges 404 after the durable row becomes reconciliation-required", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  assert.equal((await prefill(selected)).status, 200);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    const result = await originalUpdate(...argumentsList);
    selected.session.status = "reconciliation_required";
    selected.session.lastOutcome = "synthetic_concurrent_reconciliation";
    return result;
  };

  const result = await prefill(selected);

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.session.status, "reconciliation_required");
});

test("moves an expired session to reconciliation when the CRM terminal state cannot converge", async () => {
  const selected = fixture();
  await issue(selected);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    if (argumentsList[2].Setup_Access_Status === "Synthetic Expired") {
      const error = new Error("synthetic CRM expiry update unavailable");
      error.ambiguous = true;
      throw error;
    }
    return originalUpdate(...argumentsList);
  };
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(selected.events.includes("session.reconciliation"), true);
});

test("an ambiguous expiry write returns 404 only after exact independent CRM convergence", async () => {
  const selected = fixture();
  await issue(selected);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    const readback = await originalUpdate(...argumentsList);
    if (argumentsList[2].Setup_Access_Status === "Synthetic Expired") {
      throw new Error("synthetic expiry acknowledgment lost after commit");
    }
    return readback;
  };
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, code: "setup_not_found" });
  assert.equal(selected.session.status, "expired");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
  assert.equal(selected.events.filter((event) => event === "crm.get.Deals").length, 2);
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("a fresh issuance identity reissues an exact expired Deal without reviving the old token", async () => {
  const selected = fixture();
  const first = await issue(selected);
  const firstToken = new URL(first.body.formUrl).searchParams.get(
    selected.dependencies.config.form2TokenFieldAlias,
  );
  selected.session.issuedAt = "2026-08-14T17:00:00.000Z";
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.records.deal.Setup_Access_Issued_At = selected.session.issuedAt;
  assert.equal((await prefill(selected)).status, 404);
  const expiredSession = selected.session;

  const reissued = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000002",
  });

  assert.equal(reissued.status, 200);
  const secondToken = new URL(reissued.body.formUrl).searchParams.get(
    selected.dependencies.config.form2TokenFieldAlias,
  );
  assert.notEqual(secondToken, firstToken);
  assert.notEqual(selected.session.rowId, expiredSession.rowId);
  assert.equal(expiredSession.status, "expired");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
  assert.equal(selected.records.deal.Setup_Access_Issued_At, "2026-08-14T18:00:00.000Z");
  assert.equal(selected.records.deal.Setup_Access_Verified_At, null);

  const oldTokenResult = await prefill(selected);
  assert.equal(oldTokenResult.status, 404);
  assert.deepEqual(oldTokenResult.body, { ok: false, code: "setup_not_found" });
});

test("the issue route expires an unused issued generation and requires a fresh UUID", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  const oldSession = selected.session;
  oldSession.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const oldUuidRetry = await issue(selected);

  assert.equal(oldUuidRetry.status, 409);
  assert.deepEqual(oldUuidRetry.body, { ok: false, code: "setup_conflict" });
  assert.equal(oldSession.status, "expired");
  assert.equal(oldSession.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
  assert.equal(selected.sessions.length, 1);

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000021",
  });
  assert.equal(fresh.status, 200);
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.session.status, "issued");
  assert.equal((await prefill(selected)).status, 404);
});

test("the issue route expires an unused verified generation before reissue", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  assert.equal((await prefill(selected)).status, 200);
  const oldSession = selected.session;
  oldSession.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000022",
  });

  assert.equal(fresh.status, 200);
  assert.equal(oldSession.status, "expired");
  assert.equal(oldSession.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
  assert.equal(selected.records.deal.Setup_Access_Verified_At, null);
});

test("the issue route resumes a persisted pending expiry before reissue", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  const oldSession = selected.session;
  oldSession.status = "expired";
  oldSession.lastOutcome = "crm_expiry_pending";
  oldSession.expiredAt = "2026-08-14T18:00:00.000Z";
  oldSession.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000023",
  });

  assert.equal(fresh.status, 200);
  assert.equal(oldSession.status, "expired");
  assert.equal(oldSession.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.events.includes("session.expiry.synced"), true);
});

test("a stale issuing generation fences CRM Initial before releasing its lock", async () => {
  const selected = fixture();
  await seedIssuingSession(selected);
  const stale = selected.session;
  stale.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000024",
  });

  assert.equal(fresh.status, 200);
  assert.equal(stale.status, "expired");
  assert.equal(stale.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.events.includes("session.issuing.expiry.pending"), true);
  assert.ok(
    selected.events.indexOf("session.issuing.expiry.pending") <
      selected.events.indexOf("session.expiry.synced"),
  );
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
});

test("the issue route resumes stale-issuing expiry pending with CRM Initial", async () => {
  const selected = fixture();
  await seedIssuingSession(selected);
  const stale = selected.session;
  stale.expiresAt = "2026-08-14T17:59:59.000Z";
  await selected.dependencies.sessionStore.markIssuingExpiryPending(stale.rowId);
  assert.equal(stale.lastOutcome, "issuing_expiry_pending");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Initial");
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000028",
  });

  assert.equal(fresh.status, 200);
  assert.equal(stale.status, "expired");
  assert.equal(stale.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("a stale issuing generation finalizes exact CRM Issued before expiry", async () => {
  const selected = fixture();
  await seedIssuingSession(selected);
  const stale = selected.session;
  stale.expiresAt = "2026-08-14T17:59:59.000Z";
  Object.assign(selected.records.deal, {
    Setup_Access_Status: "Synthetic Issued",
    Setup_Access_Issued_At: stale.issuedAt,
    Setup_Access_Verified_At: null,
  });
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000025",
  });

  assert.equal(fresh.status, 200);
  assert.equal(stale.status, "expired");
  assert.equal(stale.lastOutcome, "crm_expiry_synced");
  assert.ok(
    selected.events.indexOf("session.issued") < selected.events.indexOf("session.verify"),
  );
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("a stale issuing CRM mismatch retains the active lock in reconciliation", async () => {
  const selected = fixture();
  await seedIssuingSession(selected);
  const stale = selected.session;
  stale.expiresAt = "2026-08-14T17:59:59.000Z";
  Object.assign(selected.records.deal, {
    Setup_Access_Status: "Synthetic Issued",
    Setup_Access_Issued_At: "2026-08-14T17:00:00.000Z",
    Setup_Access_Verified_At: null,
  });
  selected.events.length = 0;

  const blocked = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000026",
  });

  assert.equal(blocked.status, 503);
  assert.equal(stale.status, "reconciliation_required");
  assert.equal(stale.lastOutcome, "stale_issuing_crm_mismatch");
  assert.equal(selected.sessions.length, 1);
  assert.equal(
    (await selected.dependencies.sessionStore.readActiveByCrmDealId(IDS.deal)).rowId,
    stale.rowId,
  );
});

test("a delayed Issue writer is fenced before stale issuing lock release", async () => {
  const selected = fixture();
  await seedIssuingSession(selected);
  const stale = selected.session;
  stale.expiresAt = "2026-08-14T17:59:59.000Z";
  const originalUpdate = selected.dependencies.crmClient.updateRecord.bind(
    selected.dependencies.crmClient,
  );
  let raced = false;
  selected.dependencies.crmClient.updateRecord = async (...argumentsList) => {
    const update = argumentsList[2];
    if (update.Setup_Access_Status === "Synthetic Expired" && !raced) {
      raced = true;
      await originalUpdate(
        "Deals",
        IDS.deal,
        {
          Setup_Access_Status: "Synthetic Issued",
          Setup_Access_Issued_At: stale.issuedAt,
          Setup_Access_Verified_At: null,
        },
        { ifUnmodifiedSince: selected.records.deal.Modified_Time },
      );
    }
    return originalUpdate(...argumentsList);
  };
  selected.events.length = 0;

  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: "10000000-0000-4000-8000-000000000027",
  });

  assert.equal(fresh.status, 200);
  assert.equal(raced, true);
  assert.equal(stale.status, "expired");
  assert.equal(stale.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.sessions.length, 2);
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
    "session.submitting",
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

test("a crash after succeeded receipt preserves submitting ownership and repairs on exact retry", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  const originalMarkSubmitted = selected.dependencies.sessionStore.markSubmitted.bind(
    selected.dependencies.sessionStore,
  );
  selected.dependencies.sessionStore.markSubmitted = async () => {
    selected.events.push("session.submitted");
    throw new Error("synthetic crash before session finalization");
  };
  selected.events.length = 0;

  const interrupted = await submit(selected, body);

  assert.equal(interrupted.status, 503);
  assert.equal(selected.receipt.status, "succeeded");
  assert.equal(selected.session.status, "submitting");
  assert.match(selected.session.lastOutcome, /^submitting_[a-f0-9]{64}$/);
  assert.equal(selected.events.filter((event) => event === "crm.composite").length, 1);
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), false);
  assert.equal(selected.events.includes("workflow.prefill.reconciliation"), false);
  assert.equal(selected.events.includes("session.reconciliation"), false);

  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;
  const stalePrefill = await prefill(selected);
  assert.equal(stalePrefill.status, 404);
  assert.equal(selected.session.status, "submitting");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Submitted");
  assert.equal(selected.events.includes("session.verify"), false);
  assert.equal(selected.events.includes("session.expiry.synced"), false);

  selected.dependencies.sessionStore.markSubmitted = originalMarkSubmitted;
  selected.events.length = 0;
  const repaired = await submit(selected, body);
  assert.equal(repaired.status, 200);
  assert.deepEqual(repaired.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("reports an independently verified CRM uniqueness replay as a duplicate success", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.setCompositeReplay(true);
  selected.events.length = 0;

  const result = await submit(selected, validSubmission(prefillResult.body));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(result.outcome, "duplicate_succeeded");
  assert.equal(selected.events.includes("workflow.submission.succeeded"), true);
  assert.equal(selected.events.includes("session.submitted"), true);
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

test("a failed-receipt write that is not durably proven returns ambiguous 503", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.dependencies.workflowStore.markSubmissionFailed = async () => {
    selected.events.push("workflow.submission.failed");
    throw new Error("synthetic failure result write did not commit");
  };
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, {
      submissionId: "10007",
      authorizedRepresentativeConfirmed: false,
    }),
  );

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.receipt.status, "reconciliation_required");
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(selected.session.lastOutcome, "submission_outcome_unknown");
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), true);
  assert.equal(selected.events.includes("session.reconciliation"), true);
  assert.equal(selected.events.includes("session.submission.released"), false);
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a committed failed receipt with unavailable readback is still ambiguous", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const originalMarkFailed = selected.dependencies.workflowStore.markSubmissionFailed.bind(
    selected.dependencies.workflowStore,
  );
  selected.dependencies.workflowStore.markSubmissionFailed = async (...args) => {
    await originalMarkFailed(...args);
    throw new Error("synthetic timeout after failed receipt commit");
  };
  const originalReadSubmission = selected.dependencies.workflowStore.readSubmission.bind(
    selected.dependencies.workflowStore,
  );
  let readCount = 0;
  selected.dependencies.workflowStore.readSubmission = async (...args) => {
    readCount += 1;
    if (readCount > 1) {
      throw new Error("synthetic failed receipt readback outage");
    }
    return originalReadSubmission(...args);
  };
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, {
      submissionId: "10008",
      authorizedRepresentativeConfirmed: false,
    }),
  );

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.receipt.status, "reconciliation_required");
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), true);
  assert.equal(selected.events.includes("session.submission.released"), false);
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("an exact failed-receipt readback permits the ordinary error and safe release", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const originalMarkFailed = selected.dependencies.workflowStore.markSubmissionFailed.bind(
    selected.dependencies.workflowStore,
  );
  selected.dependencies.workflowStore.markSubmissionFailed = async (...args) => {
    await originalMarkFailed(...args);
    throw new Error("synthetic timeout after failed receipt commit");
  };
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, {
      submissionId: "10009",
      authorizedRepresentativeConfirmed: false,
    }),
  );

  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, code: "form_invalid" });
  assert.equal(selected.receipt.status, "failed");
  assert.equal(selected.receipt.lastOutcome, "form_invalid");
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.session.lastOutcome, "submission_released");
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), false);
  assert.equal(selected.events.includes("session.submission.released"), true);
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
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
});

test("a positive CRM mismatch durably terminalizes an already-submitted session", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.records.deal.Setup_Form_Submission_ID = "different:succeeded:id";
  selected.events.length = 0;

  const mismatch = await submit(selected, body);

  assert.equal(mismatch.status, 503);
  assert.deepEqual(mismatch.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.receipt.status, "succeeded");
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(selected.session.lastOutcome, "succeeded_receipt_crm_mismatch");
  assert.equal(selected.events.includes("session.submitted.reconciliation"), true);
  assert.equal(selected.events.includes("workflow.submission.reconciliation"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a malformed submitted outcome is never acknowledged as a duplicate", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.lastOutcome = "outcome_unknown";
  selected.events.length = 0;

  const malformed = await submit(selected, body);

  assert.equal(malformed.status, 503);
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(selected.session.lastOutcome, "submitted_session_state_invalid");
  assert.equal(selected.events.includes("session.submitted.reconciliation"), true);
  assert.equal(selected.events.includes("crm.get.Deals"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("an exact succeeded duplicate remains recoverable after the setup-token TTL", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const duplicate = await submit(selected, body);

  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("crm.get.Deals"), true);
  assert.equal(selected.events.includes("crm.composite"), false);
  assert.equal(selected.events.includes("session.verify"), false);
});

test("a completed duplicate does not depend on the prefill row remaining available", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.clearPrefill();
  selected.events.length = 0;

  const duplicate = await submit(selected, body);

  assert.equal(duplicate.status, 200);
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.prefill.read"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a verified crash-gap session repairs from its receipt after prefill cleanup", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.status = "verified";
  selected.session.submittedAt = "";
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.clearPrefill();
  selected.events.length = 0;

  const recovered = await submit(selected, body);

  assert.equal(recovered.status, 200);
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.events.includes("workflow.prefill.read"), false);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a succeeded receipt repairs its verified session before duplicate acknowledgment", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.status = "verified";
  selected.session.submittedAt = "";
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const recovered = await submit(selected, body);

  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.session.submittedAt, "2026-08-14T18:00:00.000Z");
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
  assert.equal(selected.events.includes("session.verify"), false);
  assert.ok(
    selected.events.indexOf("crm.get.Deals") < selected.events.indexOf("session.submitted"),
  );
});

test("a recovered session repair accepts an exact submitted readback after a write timeout", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.status = "verified";
  selected.session.submittedAt = "";
  const originalMarkSubmitted = selected.dependencies.sessionStore.markSubmitted.bind(
    selected.dependencies.sessionStore,
  );
  selected.dependencies.sessionStore.markSubmitted = async (rowId, submissionFingerprint) => {
    await originalMarkSubmitted(rowId, submissionFingerprint);
    throw new Error("synthetic response lost after session repair");
  };
  selected.events.length = 0;

  const recovered = await submit(selected, body);

  assert.equal(recovered.status, 200);
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.events.includes("session.row.read"), true);
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("an unavailable recovered-session repair preserves the exact retry owner", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.status = "verified";
  selected.session.submittedAt = "";
  const originalMarkSubmitted = selected.dependencies.sessionStore.markSubmitted.bind(
    selected.dependencies.sessionStore,
  );
  selected.dependencies.sessionStore.markSubmitted = async () => {
    selected.events.push("session.submitted");
    throw new Error("synthetic session repair unavailable");
  };
  selected.events.length = 0;

  const recovered = await submit(selected, body);

  assert.equal(recovered.status, 503);
  assert.deepEqual(recovered.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.session.status, "submitting");
  assert.match(selected.session.lastOutcome, /^submitting_[a-f0-9]{64}$/);
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.events.includes("crm.composite"), false);

  selected.dependencies.sessionStore.markSubmitted = originalMarkSubmitted;
  selected.events.length = 0;
  const retry = await submit(selected, body);
  assert.equal(retry.status, 200);
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a succeeded receipt preserves transient CRM retries but terminalizes a positive mismatch", async () => {
  for (const failureMode of ["read_error", "mismatch"]) {
    const selected = fixture();
    await issue(selected);
    const prefillResult = await prefill(selected);
    const body = validSubmission(prefillResult.body);
    assert.equal((await submit(selected, body)).status, 200);
    selected.session.status = "verified";
    selected.session.submittedAt = "";
    if (failureMode === "read_error") {
      selected.setCrmReadError(new Error("synthetic CRM read unavailable"));
    } else {
      selected.records.deal.Setup_Form_Submission_ID = "different:succeeded:id";
    }
    selected.events.length = 0;

    const unresolved = await submit(selected, body);

    assert.equal(unresolved.status, 503);
    assert.equal(
      selected.session.status,
      failureMode === "read_error" ? "submitting" : "reconciliation_required",
    );
    assert.equal(
      selected.events.includes("session.reconciliation"),
      failureMode === "mismatch",
    );
    if (failureMode === "mismatch") {
      assert.equal(selected.session.lastOutcome, "succeeded_receipt_crm_mismatch");
    }
    selected.setCrmReadError(null);
    selected.events.length = 0;

    if (failureMode === "read_error") {
      const repaired = await submit(selected, body);
      assert.equal(repaired.status, 200);
      assert.equal(selected.session.status, "submitted");
      assert.equal(selected.events.includes("crm.composite"), false);
      continue;
    }

    const differentId = await submit(selected, { ...body, submissionId: "19999" });
    assert.equal(differentId.status, 404);
    assert.equal(selected.events.includes("workflow.submission.claim"), false);
  }
});

test("an elapsed verified session without a succeeded receipt expires both stores before 404", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const result = await submit(selected, validSubmission(prefillResult.body));

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, code: "setup_not_found" });
  assert.equal(selected.session.status, "expired");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
  assert.ok(selected.events.indexOf("session.verify") < selected.events.indexOf("crm.update.Deals"));
});

test("a completed submission ID with changed respondent data is rejected before CRM", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const conflicting = await submit(selected, {
    ...body,
    requestedStartDate: "2026-08-21",
  });

  assert.equal(conflicting.status, 409);
  assert.deepEqual(conflicting.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
  assert.equal(selected.events.some((event) => event.startsWith("crm.")), false);
});

test("a new submission ID after session completion creates no receipt claim", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  const completedReceipt = clone(selected.receipt);
  selected.events.length = 0;

  const conflicting = await submit(selected, {
    ...body,
    submissionId: "10002",
  });

  assert.equal(conflicting.status, 409);
  assert.deepEqual(conflicting.body, { ok: false, code: "setup_conflict" });
  assert.deepEqual(selected.receipt, completedReceipt);
  assert.equal(selected.events.includes("workflow.submission.read"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), false);
  assert.equal(selected.events.some((event) => event.startsWith("crm.")), false);
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
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.session.lastOutcome, "submission_released");
  assert.equal(selected.events.includes("session.submission.released"), true);
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);

  selected.setCrmReadError(null);
  selected.events.length = 0;
  const retry = await submit(
    selected,
    validSubmission(prefillResult.body, { submissionId: "10006" }),
  );
  assert.equal(retry.status, 200);
  assert.equal(selected.session.status, "submitted");
  assert.equal(selected.events.includes("session.submitting"), true);
  assert.equal(selected.events.includes("workflow.submission.claim"), true);
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
