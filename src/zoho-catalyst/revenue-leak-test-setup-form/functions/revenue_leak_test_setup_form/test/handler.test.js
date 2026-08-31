"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { destinationDigest } = require("../lib/destinations");
const { CLIENT_KEYS } = require("../lib/form-contract");
const issueCallerContract = require("../../../config/issue-caller-contract.json");
const {
  ControllerError,
  buildAccessUrl,
  buildConfigurationReference,
  buildFormUrl,
  handleForm2Request,
} = require("../lib/handler");
const {
  deriveAccessToken,
  deriveIssueRequestKey,
  hashAccessToken,
  prefillBindingDigest,
} = require("../lib/security");

const NOW_MS = Date.parse("2026-08-14T18:00:00.000Z");
const FORM2_PUBLIC_URL =
  "https://forms.zohopublic.com/synthetic/form/perma/synthetic";
const FORM2_DESTINATION_SHA256 = destinationDigest(FORM2_PUBLIC_URL);
const ISSUE_REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const PREFILL_ID = "20000000-0000-4000-8000-000000000002";
const LEASE_OWNER = "30000000-0000-4000-8000-000000000003";
const CONSUMPTION_OWNER = "40000000-0000-4000-8000-000000000004";
const CONFIGURATION_REFERENCE =
  `form2cfgv1:7200000000001:${"a".repeat(40)}`;
const IDS = Object.freeze({
  contact: `${"9".repeat(17)}1`,
  account: `${"9".repeat(17)}2`,
  deal: `${"9".repeat(17)}3`,
});

function config() {
  return Object.freeze({
    issuePath: "/form2/session/issue",
    accessPath: "/form2/session/access",
    otpRequestPath: "/form2/session/otp/request",
    otpVerifyPath: "/form2/session/otp/verify",
    prefillPath: "/form2/session/prefill",
    submissionPath: "/form2/session/submit",
    issueHeaderName: "x-sylvara-issue-key",
    formsHeaderName: "x-sylvara-forms-key",
    issueHeaderSecret: "I".repeat(43),
    prefillHeaderSecret: "F".repeat(43),
    submissionHeaderSecret: "S".repeat(43),
    tokenPepper: "P".repeat(43),
    workflowKeyMaterial: "W".repeat(43),
    form2AccessPublicUrl:
      `https://synthetic.development.catalystserverless.com/sylvara-dev/${"B".repeat(43)}`,
    form2PublicUrl: FORM2_PUBLIC_URL,
    form2DestinationSha256: FORM2_DESTINATION_SHA256,
    form2PrefillHandleFieldAlias: "prefill_handle",
    form2FormVersion: "form2-v1",
    form2EntryOfferValue: "Synthetic Free Test",
    form2PhoneSystemProviders: Object.freeze([
      "Synthetic PBX",
      "Different Synthetic PBX",
    ]),
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
    prefillHandleTtlSeconds: 600,
    crmOrganizationHash: "c".repeat(64),
    formIdentityHash: FORM2_DESTINATION_SHA256,
    sourceRevision: "a".repeat(40),
    deploymentEnvironment: "development",
    maxBodyBytes: 32768,
    inboundBodyTimeoutMs: 5000,
  });
}

test("form links are fail-closed to the exact approved Zoho Forms host", () => {
  const prefillHandle = Buffer.alloc(32, 0x41).toString("base64url");
  for (const form2PublicUrl of [
    "https://forms.zohopublic.evil.com/synthetic/form",
    "https://forms.example.invalid/synthetic/form",
    "https://example.invalid/synthetic/form",
    "https://forms.zohopublic.com/other/form/perma/synthetic",
  ]) {
    assert.throws(
      () => buildFormUrl({ ...config(), form2PublicUrl }, prefillHandle),
      (error) =>
        error instanceof ControllerError &&
        error.publicCode === "configuration_invalid" &&
        !error.message.includes(prefillHandle),
    );
  }
});

test("configuration evidence references use the durable receipt revision", () => {
  const durableRevision = "b".repeat(40);
  assert.equal(
    buildConfigurationReference({
      rowId: "7200000000001",
      sourceRevision: durableRevision,
    }),
    `form2cfgv1:7200000000001:${durableRevision}`,
  );
  assert.equal(
    buildConfigurationReference({
      rowId: 7200000000001,
      sourceRevision: durableRevision,
    }),
    `form2cfgv1:7200000000001:${durableRevision}`,
  );
  for (const receipt of [
    { rowId: "7200000000001" },
    { rowId: "7200000000001", sourceRevision: "B".repeat(40) },
    { rowId: "7200000000001", sourceRevision: "a".repeat(39) },
    { rowId: "0", sourceRevision: durableRevision },
    { rowId: "07200000000001", sourceRevision: durableRevision },
    { rowId: Number.MAX_SAFE_INTEGER + 1, sourceRevision: durableRevision },
  ]) {
    assert.throws(
      () => buildConfigurationReference(receipt),
      (error) => error instanceof ControllerError &&
        error.publicCode === "configuration_invalid",
    );
  }
});

test("access links preserve the Gateway source path and append only the setup fragment", () => {
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  const result = new URL(buildAccessUrl(config(), setupToken));
  assert.equal(result.origin, "https://synthetic.development.catalystserverless.com");
  assert.equal(result.pathname, `/sylvara-dev/${"B".repeat(43)}`);
  assert.equal(result.search, "");
  assert.equal(result.hash, `#setupToken=${setupToken}`);
  assert.notEqual(result.pathname, config().accessPath);

  for (const form2AccessPublicUrl of [
    "https://controller.example.invalid/form2/session/access",
    "https://synthetic.catalystserverless.com/form2/session/access",
    "https://synthetic.development.catalystserverless.com/form2/session/access",
    "https://synthetic.development.catalystserverless.com/server/revenue_leak_test_setup_form/form2/session/access",
  ]) {
    assert.throws(
      () => buildAccessUrl({ ...config(), form2AccessPublicUrl }, setupToken),
      (error) => error instanceof ControllerError &&
        error.publicCode === "configuration_invalid" &&
        !error.message.includes(setupToken),
    );
  }
});

test("serves the email-verification access page with a locked browser boundary", async () => {
  const selected = fixture();
  const result = await handleForm2Request({
    method: "GET",
    url: selected.dependencies.config.accessPath,
    headers: {},
  }, selected.dependencies);
  assert.equal(result.status, 200);
  assert.equal(result.stage, "access");
  assert.equal(result.headers["Content-Type"], "text/html; charset=utf-8");
  assert.equal(result.headers["Cache-Control"], "no-store, max-age=0");
  assert.match(result.headers["Content-Security-Policy"], /default-src 'none'/);
  assert.match(result.body, /Verify your email/);
  assert.equal(result.body.includes(IDS.contact), false);
  assert.equal(result.body.includes(IDS.account), false);
  assert.equal(result.body.includes(IDS.deal), false);
});

test("OTP request and verify need no browser-held shared secret and expose no CRM IDs", async () => {
  const selected = fixture();
  await issue(selected);
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  const requestBody = Buffer.from(JSON.stringify({ setupToken }));
  const requested = await handleForm2Request({
    method: "POST",
    url: selected.dependencies.config.otpRequestPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(requestBody.length),
    },
    rawBody: requestBody,
  }, selected.dependencies);
  assert.equal(requested.status, 202);
  assert.equal(requested.body.ok, true);
  assert.equal(requested.body.state, "sent_confirmed");
  assert.match(requested.body.verificationId, /^[a-f0-9]{64}$/);
  assert.equal(selected.events.includes("verification.email.request"), true);

  const verifyBody = Buffer.from(JSON.stringify({
    verificationId: requested.body.verificationId,
    code: "12345678",
  }));
  const verified = await handleForm2Request({
    method: "POST",
    url: selected.dependencies.config.otpVerifyPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(verifyBody.length),
    },
    rawBody: verifyBody,
  }, selected.dependencies);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.ok, true);
  assert.match(verified.body.formUrl, /^https:\/\/forms\.zohopublic\.com\//);
  assert.equal(JSON.stringify(verified.body).includes(IDS.contact), false);
  assert.equal(JSON.stringify(verified.body).includes(IDS.account), false);
  assert.equal(JSON.stringify(verified.body).includes(IDS.deal), false);
});

test("an already verified token resumes at the exact stamped Form without another send", async () => {
  const selected = fixture();
  await issue(selected);
  selected.dependencies.verificationService.requestEmailOtp = async () => ({
    state: "already_verified",
  });
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  const rawBody = Buffer.from(JSON.stringify({ setupToken }));
  const result = await handleForm2Request({
    method: "POST",
    url: selected.dependencies.config.otpRequestPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(rawBody.length),
    },
    rawBody,
  }, selected.dependencies);
  assert.equal(result.status, 200);
  assert.equal(result.outcome, "already_verified");
  assert.match(result.body.formUrl, /^https:\/\/forms\.zohopublic\.com\//);
});

test("OTP delivery states never imply a send without provider evidence", async () => {
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  for (const [state, status] of [
    ["sent_confirmed", 202],
    ["in_flight", 202],
    ["retryable_failure", 503],
    ["delivery_disabled", 503],
    ["terminal_failure", 503],
  ]) {
    const selected = fixture();
    await issue(selected);
    selected.dependencies.verificationService.requestEmailOtp = async () => ({ state });
    const rawBody = Buffer.from(JSON.stringify({ setupToken }));
    const result = await handleForm2Request({
      method: "POST",
      url: selected.dependencies.config.otpRequestPath,
      headers: {
        "content-type": "application/json",
        "content-length": String(rawBody.length),
      },
      rawBody,
    }, selected.dependencies);
    assert.equal(result.status, status);
    assert.equal(result.body.state, state);
    assert.equal(result.outcome, state);
  }
});

test("access and OTP route variants fail closed", async () => {
  const selected = fixture();
  const query = await handleForm2Request({
    method: "GET",
    url: `${selected.dependencies.config.accessPath}?setupToken=forbidden`,
    headers: {},
  }, selected.dependencies);
  assert.equal(query.status, 404);
  assert.deepEqual(query.body, { ok: false, code: "route_not_found" });

  const wrongMethod = await handleForm2Request({
    method: "POST",
    url: selected.dependencies.config.accessPath,
    headers: { "content-type": "application/json" },
    rawBody: Buffer.from("{}"),
  }, selected.dependencies);
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(wrongMethod.body, { ok: false, code: "method_not_allowed" });
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
      Pipeline: "Revenue Desk Sales",
      Stage: "Setup and Authorization",
      Account_Name: { id: IDS.account, name: "Synthetic Plumbing" },
      Contact_Name: { id: IDS.contact, name: "Casey Tester" },
      Setup_Access_Issue_Request_ID: ISSUE_REQUEST_ID,
      Entry_Offer: "Synthetic Free Test",
      Current_Call_Handling: "Office Staff / Dispatcher",
      Requested_Test_Route: "No Answer / Overflow Only",
      Approved_Test_Route: "No Answer / Overflow Only",
      Setup_Form_Submission_ID: null,
      Setup_Form_Submitted_At: null,
      Setup_Access_Status: "Synthetic Initial",
      Setup_Access_Issued_At: null,
      Setup_Access_Verified_At: null,
      Configuration_Version: null,
      Deployment_Record_ID: null,
      Approved_Deployment_Record_ID: null,
      Approved_Configuration_Version: null,
      Go_Live_Approval_Status: null,
      Go_Live_Approved_At: null,
      Test_Status: null,
      Test_Start_At: null,
      Test_End_At: null,
      Test_End_Reason: null,
      Rollback_Completed_At: null,
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

function dealIssuanceKey(kind, dealId, generationIssueRequestKey = "") {
  return crypto
    .createHash("sha256")
    .update(`sylvara-form2:development:deal-${kind}\0`, "utf8")
    .update(dealId, "utf8")
    .update(kind === "generation" ? `\0${generationIssueRequestKey}` : "", "utf8")
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
    prefillId: prefillBody.prefillId,
    configurationRevision: prefillBody.configurationRevision,
    submissionId: "10001",
    ...values,
    requestedStartDate: "2026-08-20",
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
    alertRecipientEmail: "alerts@example.invalid",
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
  let proofDenied = false;
  let proofDestination = null;
  let changeContactEmailAfterVerifyUpdate = false;
  let compositeReplay = false;
  let entropy = 1;

  function currentJourneyBindingDigest() {
    return prefillBindingDigest({
      crmOrganizationHash: selectedConfig.crmOrganizationHash,
      crmContactId: records.contact.id,
      crmAccountId: records.account.id,
      crmDealId: records.deal.id,
      journeyId: records.deal.Intake_Submission_ID,
      formIdentityHash: selectedConfig.formIdentityHash,
      expectedStage: "form2",
      formVersion: selectedConfig.form2FormVersion,
      configurationRevision: selectedConfig.sourceRevision,
    }, selectedConfig.workflowKeyMaterial);
  }

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
      if (changeContactEmailAfterVerifyUpdate && update.Setup_Access_Status === "Synthetic Verified") {
        records.contact.Email = "changed-after-proof@example.invalid";
        records.contact.Modified_Time = nextModifiedTime();
      }
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
      let match = sessions.find(
        (candidate) => input.issueRequestKey === candidate.issueRequestKey,
      );
      if (!match) {
        const activeKey = dealIssuanceKey("active", input.crmDealId);
        if (sessions.some((candidate) => candidate.dealIssuanceKey === activeKey)) {
          const error = new Error("synthetic Deal issuance uniqueness conflict");
          error.publicCode = "reconciliation_required";
          throw error;
        }
        match = {
          rowId: String(nextSessionRowId++),
          issueRequestKey: input.issueRequestKey,
          tokenHash: input.tokenHash,
          crmContactId: input.crmContactId,
          crmAccountId: input.crmAccountId,
          crmDealId: input.crmDealId,
          journeyBindingDigest: input.journeyBindingDigest,
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
        assert.equal(input.issueRequestKey, match.issueRequestKey);
        assert.equal(input.tokenHash, match.tokenHash);
        assert.equal(input.journeyBindingDigest, match.journeyBindingDigest);
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
    async readByIssueRequestKey(issueRequestKey) {
      events.push("session.issue-request.read");
      const match = sessions.find(
        (candidate) => issueRequestKey === candidate.issueRequestKey,
      );
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
        match.issueRequestKey,
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
      if (prefill?.status === "handle_issued" &&
          prefill.prefillHandleHash !== binding.prefillHandleHash) {
        const error = new Error("synthetic live prefill handle conflict");
        error.publicCode = "prefill_conflict";
        throw error;
      }
      prefill = {
        rowId: "7100000000001",
        prefillKey: "a".repeat(64),
        status: "handle_issued",
        consumptionOwner: "",
        sourceRevision: selectedConfig.sourceRevision,
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
    async readPrefillById(prefillId) {
      events.push("workflow.prefill.read-id");
      return prefill && prefillId === PREFILL_ID ? Object.freeze({ ...prefill }) : null;
    },
    async readPrefillHandle(prefillHandleHash) {
      events.push("workflow.prefill.read-handle");
      if (!prefill || prefill.status !== "handle_issued" ||
          prefill.prefillHandleHash !== prefillHandleHash) return null;
      return Object.freeze({ prefillId: PREFILL_ID, revision: { ...prefill } });
    },
    async consumePrefillHandle(input) {
      events.push("workflow.prefill.consume-handle");
      if (!prefill || prefill.status !== "handle_issued" ||
          prefill.prefillHandleHash !== input.prefillHandleHash ||
          prefill.journeyBindingDigest !== input.journeyBindingDigest ||
          prefill.formIdentityHash !== input.formIdentityHash ||
          input.formIdentityHash !== selectedConfig.formIdentityHash ||
          prefill.expectedStage !== input.expectedStage ||
          input.expectedStage !== "form2" ||
          input.configurationRevision !== selectedConfig.sourceRevision) {
        const error = new Error("synthetic prefill handle missing");
        error.publicCode = "prefill_not_found";
        throw error;
      }
      prefill.status = "ready";
      prefill.consumptionOwner = "50000000-0000-4000-8000-000000000005";
      return Object.freeze({ revision: { ...prefill }, replayed: false });
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
        sourceRevision: selectedConfig.sourceRevision,
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

  const verificationContexts = new Map();
  function verificationBinding(selectedSession) {
    return selectedSession ? {
      sessionRowId: selectedSession.rowId,
      issueRequestKey: selectedSession.issueRequestKey,
      tokenHash: selectedSession.tokenHash,
      crmContactId: selectedSession.crmContactId,
      crmAccountId: selectedSession.crmAccountId,
      crmDealId: selectedSession.crmDealId,
      journeyBindingDigest: selectedSession.journeyBindingDigest,
      issuedAt: selectedSession.issuedAt,
      expiresAt: selectedSession.expiresAt,
    } : null;
  }
  const verificationService = {
    async requestEmailOtp(verificationId) {
      events.push("verification.email.request");
      const selectedSession = verificationContexts.get(verificationId);
      return {
        state: "sent_confirmed",
        verificationId,
        binding: verificationBinding(selectedSession),
      };
    },
    async exchangeSetupToken(setupToken) {
      let tokenHash;
      try {
        tokenHash = hashAccessToken(setupToken, dependencies.config.tokenPepper);
      } catch {
        tokenHash = null;
      }
      const selectedSession = sessions.find((candidate) =>
        candidate.tokenHash === tokenHash &&
        new Set(["issued", "verified"]).has(candidate.status) &&
        Date.parse(candidate.expiresAt) > NOW_MS);
      if (!selectedSession) {
        const error = new Error("synthetic setup access unavailable");
        error.publicCode = "setup_not_found";
        error.status = 404;
        throw error;
      }
      const verificationId = crypto.createHash("sha256")
        .update(`synthetic-verification\0${selectedSession.rowId}`, "utf8")
        .digest("hex");
      verificationContexts.set(verificationId, selectedSession);
      const result = await verificationService.requestEmailOtp(verificationId);
      return {
        ...result,
        verificationId,
        binding: result.binding ?? verificationBinding(selectedSession),
      };
    },
    async verifyEmailOtp(verificationId) {
      events.push("verification.email.verify");
      const selectedSession = verificationContexts.get(verificationId);
      if (!selectedSession) {
        const error = new Error("synthetic setup access unavailable");
        error.publicCode = "setup_not_found";
        error.status = 404;
        throw error;
      }
      return { verified: true, binding: verificationBinding(selectedSession) };
    },
    async consumeVerifiedProof(binding, destinationEmail) {
      events.push("verification.proof.consume");
      if (proofDenied) {
        const error = new Error("synthetic verification required");
        error.publicCode = "verification_required";
        throw error;
      }
      proofDestination ??= destinationEmail;
      if (destinationEmail !== proofDestination) {
        const error = new Error("synthetic proof destination mismatch");
        error.publicCode = "verification_required";
        throw error;
      }
      return Object.freeze({
        status: "consumed",
        proofKey: "1".repeat(64),
        sessionRowId: binding.sessionRowId,
        bindingDigest: "2".repeat(64),
        destinationDigest: "3".repeat(64),
        verifiedAt: "2026-08-14T18:00:00.000Z",
        expiresAt: "2026-08-14T18:30:00.000Z",
      });
    },
  };

  const dependencies = {
    config: selectedConfig,
    crmClient,
    sessionStore,
    verificationService,
    workflowStore,
    now: () => NOW_MS,
    randomBytes: (size) => Buffer.alloc(size, entropy++),
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
    setProofDenied(value) { proofDenied = value; },
    setChangeContactEmailAfterVerifyUpdate(value) {
      changeContactEmailAfterVerifyUpdate = value;
    },
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

function persistIssueIdentity(fixtureValue, issueRequestId) {
  fixtureValue.records.deal.Setup_Access_Issue_Request_ID = issueRequestId;
}

async function seedIssuingSession(fixtureValue, issueRequestId = ISSUE_REQUEST_ID) {
  const setupToken = deriveAccessToken(
    issueRequestId,
    fixtureValue.dependencies.config.tokenPepper,
  );
  return fixtureValue.dependencies.sessionStore.issue({
    issueRequestKey: deriveIssueRequestKey(issueRequestId),
    tokenHash: hashAccessToken(
      setupToken,
      fixtureValue.dependencies.config.tokenPepper,
    ),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
    journeyBindingDigest: prefillBindingDigest({
      crmOrganizationHash: fixtureValue.dependencies.config.crmOrganizationHash,
      crmContactId: IDS.contact,
      crmAccountId: IDS.account,
      crmDealId: IDS.deal,
      journeyId: fixtureValue.records.deal.Intake_Submission_ID,
      formIdentityHash: fixtureValue.dependencies.config.formIdentityHash,
      expectedStage: "form2",
      formVersion: fixtureValue.dependencies.config.form2FormVersion,
      configurationRevision: fixtureValue.dependencies.config.sourceRevision,
    }, fixtureValue.dependencies.config.workflowKeyMaterial),
  });
}

async function prefill(fixtureValue) {
  const setupToken = deriveAccessToken(
    ISSUE_REQUEST_ID,
    fixtureValue.dependencies.config.tokenPepper,
  );
  const exchangeBody = Buffer.from(JSON.stringify({ setupToken }));
  const exchanged = await handleForm2Request({
    method: "POST",
    url: fixtureValue.dependencies.config.otpRequestPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(exchangeBody.length),
    },
    rawBody: exchangeBody,
  }, fixtureValue.dependencies);
  if (!new Set([200, 202]).has(exchanged.status)) return exchanged;
  if (typeof exchanged.body.formUrl === "string") {
    return submitPrefillHandle(fixtureValue, exchanged.body.formUrl);
  }
  const verifyBody = Buffer.from(JSON.stringify({
    verificationId: exchanged.body.verificationId,
    code: "12345678",
  }));
  const verified = await handleForm2Request({
    method: "POST",
    url: fixtureValue.dependencies.config.otpVerifyPath,
    headers: {
      "content-type": "application/json",
      "content-length": String(verifyBody.length),
    },
    rawBody: verifyBody,
  }, fixtureValue.dependencies);
  if (verified.status !== 200 || typeof verified.body.formUrl !== "string") return verified;
  return submitPrefillHandle(fixtureValue, verified.body.formUrl);
}

async function submitPrefillHandle(fixtureValue, formUrl) {
  const url = new URL(formUrl);
  assert.deepEqual([...url.searchParams.keys()], [
    fixtureValue.dependencies.config.form2PrefillHandleFieldAlias,
  ]);
  const prefillHandle = url.searchParams.get(
    fixtureValue.dependencies.config.form2PrefillHandleFieldAlias,
  );
  assert.match(prefillHandle, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(formUrl.includes(IDS.contact), false);
  assert.equal(formUrl.includes(IDS.account), false);
  assert.equal(formUrl.includes(IDS.deal), false);
  return handleForm2Request(
    createRequest(
      fixtureValue.dependencies.config.prefillPath,
      { prefillHandle },
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

test("issues one retry-stable access URL with the opaque token only in its fragment", async () => {
  const selected = fixture();
  const first = await issue(selected);
  const retry = await issue(selected);
  assert.equal(first.status, 200);
  assert.equal(first.stage, "issue");
  assert.equal(first.outcome, "issued");
  // requestId is transport-owned and appended exactly once by the Catalyst adapter.
  assert.deepEqual(
    Object.keys(first.body),
    issueCallerContract.success_response_schema.required.filter((key) => key !== "requestId"),
  );
  assert.equal(retry.body.accessUrl, first.body.accessUrl);
  const accessUrl = new URL(first.body.accessUrl);
  assert.equal(accessUrl.search, "");
  assert.deepEqual([...new URLSearchParams(accessUrl.hash.slice(1)).keys()], ["setupToken"]);
  assert.equal(
    new URLSearchParams(accessUrl.hash.slice(1)).get("setupToken"),
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

test("the typed Issue contract rejects any undeclared request field before side effects", async () => {
  const selected = fixture();
  assert.deepEqual(Object.keys(issueBody()), issueCallerContract.request_schema.required);
  const result = await issue(selected, { ...issueBody(), unexpected: "synthetic" });
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, code: "form_invalid" });
  assert.equal(result.stage, "issue");
  assert.equal(result.outcome, "form_invalid");
  assert.deepEqual(selected.events, []);
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

test("issue requires the exact Deal pipeline, stage, and persisted issue identity", async () => {
  const cases = [
    { Pipeline: "Synthetic Other Pipeline" },
    { Stage: "Synthetic Other Stage" },
    { Setup_Access_Issue_Request_ID: "20000000-0000-4000-8000-000000000002" },
    { Deployment_Record_ID: "synthetic-deployment-reference" },
  ];
  for (const mutation of cases) {
    const selected = fixture();
    Object.assign(selected.records.deal, mutation);

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
  assert.equal(results[0].body.accessUrl, results[1].body.accessUrl);
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
});

test("an exact issuing row plus CRM Issued readback finalizes after a crash", async () => {
  const selected = fixture();
  const setupToken = deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper);
  const pending = await selected.dependencies.sessionStore.issue({
    issueRequestKey: deriveIssueRequestKey(ISSUE_REQUEST_ID),
    tokenHash: hashAccessToken(setupToken, config().tokenPepper),
    crmContactId: IDS.contact,
    crmAccountId: IDS.account,
    crmDealId: IDS.deal,
    journeyBindingDigest: prefillBindingDigest({
      crmOrganizationHash: selected.dependencies.config.crmOrganizationHash,
      crmContactId: IDS.contact,
      crmAccountId: IDS.account,
      crmDealId: IDS.deal,
      journeyId: selected.records.deal.Intake_Submission_ID,
      formIdentityHash: selected.dependencies.config.formIdentityHash,
      expectedStage: "form2",
      formVersion: selected.dependencies.config.form2FormVersion,
      configurationRevision: selected.dependencies.config.sourceRevision,
    }, selected.dependencies.config.workflowKeyMaterial),
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
      issue(selected),
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
    assert.equal(results.filter((result) => Object.hasOwn(result.body, "accessUrl")).length, 1);
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
  assert.deepEqual(Object.keys(result.body), [
    ...CLIENT_KEYS,
    "prefillId",
    "configurationRevision",
  ]);
  assert.equal(result.body.prefillId, PREFILL_ID);
  assert.equal(
    result.body.configurationRevision,
    selected.dependencies.config.sourceRevision,
  );
  assert.match(selected.prefill.snapshotFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(selected.prefill.dealModifiedTime, selected.records.deal.Modified_Time);
  const serialized = JSON.stringify(result.body);
  for (const id of Object.values(IDS)) assert.equal(serialized.includes(id), false);
  assert.equal(serialized.includes(deriveAccessToken(ISSUE_REQUEST_ID, config().tokenPepper)), false);
  assert.ok(selected.events.indexOf("crm.get.Contacts") < selected.events.indexOf("verification.proof.consume"));
  assert.ok(selected.events.indexOf("session.verify") < selected.events.indexOf("crm.update.Deals"));
  assert.ok(selected.events.indexOf("crm.update.Deals") < selected.events.indexOf("workflow.prefill.mint"));
});

test("prefill rejects a Deal whose persisted issue identity changed after issuance", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  selected.records.deal.Setup_Access_Issue_Request_ID =
    "20000000-0000-4000-8000-000000000002";
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);
  assert.equal(selected.events.includes("workflow.prefill.consume-handle"), false);
});

test("a Contact email change after proof consumption blocks prefill minting", async () => {
  const selected = fixture();
  await issue(selected);
  selected.setChangeContactEmailAfterVerifyUpdate(true);
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, code: "service_unavailable" });
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);
  assert.equal(selected.session.status, "reconciliation_required");
  assert.equal(
    selected.events.filter((event) => event === "verification.proof.consume").length,
    2,
  );
});

test("token possession alone cannot establish verified state", async () => {
  const selected = fixture();
  await issue(selected);
  selected.setProofDenied(true);
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { ok: false, code: "verification_required" });
  assert.equal(selected.session.status, "issued");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
  assert.equal(selected.events.includes("verification.proof.consume"), true);
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

test("a verified prefill retry accepts CRM whole-second DateTime precision", async () => {
  const selected = fixture();
  await issue(selected);
  assert.equal((await prefill(selected)).status, 200);

  selected.session.verifiedAt = "2026-08-14T18:00:00.115Z";
  selected.records.deal.Setup_Access_Verified_At = "2026-08-14T18:00:00Z";
  selected.events.length = 0;

  const retried = await prefill(selected);

  assert.equal(retried.status, 200);
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.session.attemptCount, 2);
  assert.equal(selected.events.includes("crm.update.Deals"), false);
  assert.equal(selected.events.includes("session.reconciliation"), false);
});

test("an expired journey credential fails at exchange and Issue owns cleanup", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  const expiredSession = selected.session;
  expiredSession.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const result = await prefill(selected);

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, code: "setup_not_found" });
  assert.equal(expiredSession.status, "issued");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Issued");
  assert.equal(selected.events.includes("crm.update.Deals"), false);
  assert.equal(selected.events.includes("session.verify"), false);
  assert.equal(selected.events.includes("workflow.prefill.mint"), false);

  selected.events.length = 0;
  const oldIdentityRetry = await issue(selected);
  assert.equal(oldIdentityRetry.status, 409);
  assert.deepEqual(oldIdentityRetry.body, { ok: false, code: "setup_conflict" });
  assert.equal(expiredSession.status, "expired");
  assert.equal(expiredSession.lastOutcome, "crm_expiry_synced");
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Expired");
});

test("a fresh issuance identity reissues an exact expired Deal without reviving the old token", async () => {
  const selected = fixture();
  const first = await issue(selected);
  const firstToken = new URLSearchParams(
    new URL(first.body.accessUrl).hash.slice(1),
  ).get("setupToken");
  selected.session.issuedAt = "2026-08-14T17:00:00.000Z";
  selected.session.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.records.deal.Setup_Access_Issued_At = selected.session.issuedAt;
  assert.equal((await prefill(selected)).status, 404);
  const expiredSession = selected.session;

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000002";
  persistIssueIdentity(selected, freshIssueRequestId);
  const reissued = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
  });

  assert.equal(reissued.status, 200);
  const secondToken = new URLSearchParams(
    new URL(reissued.body.accessUrl).hash.slice(1),
  ).get("setupToken");
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000021";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
  });
  assert.equal(fresh.status, 200);
  assert.equal(selected.sessions.length, 2);
  assert.equal(selected.session.status, "issued");
  assert.equal((await prefill(selected)).status, 404);
});

test("pepper rotation cannot reuse an issuance UUID after its tombstone is synchronized", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  const oldSession = selected.session;
  oldSession.expiresAt = "2026-08-14T17:59:59.000Z";
  assert.equal((await prefill(selected)).status, 404);
  assert.equal((await issue(selected)).status, 409);
  assert.equal(oldSession.lastOutcome, "crm_expiry_synced");

  selected.dependencies.config = Object.freeze({
    ...selected.dependencies.config,
    tokenPepper: "Q".repeat(43),
  });
  selected.events.length = 0;
  const blocked = await issue(selected);

  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.sessions.length, 1);
  assert.equal(selected.sessions[0].rowId, oldSession.rowId);
  assert.equal(selected.events.includes("session.issue"), false);
});

test("the issue route expires an unused verified generation before reissue", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  assert.equal((await prefill(selected)).status, 200);
  const oldSession = selected.session;
  oldSession.expiresAt = "2026-08-14T17:59:59.000Z";
  selected.events.length = 0;

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000022";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000023";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000024";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000028";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000025";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000026";
  persistIssueIdentity(selected, freshIssueRequestId);
  const blocked = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

  const freshIssueRequestId = "10000000-0000-4000-8000-000000000027";
  persistIssueIdentity(selected, freshIssueRequestId);
  const fresh = await issue(selected, {
    ...issueBody(),
    issueRequestId: freshIssueRequestId,
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

test("two simultaneous exact prefills produce one one-time handle", async () => {
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
  assert.deepEqual(
    results.map((result) => result.status).sort((left, right) => left - right),
    [200, 503],
  );
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.events.includes("session.reconciliation"), false);
  assert.equal(selected.records.deal.Setup_Access_Status, "Synthetic Verified");
});

test("runs claim, one-time consume, atomic CRM composite, receipt, then session in order", async () => {
  const selected = fixture();
  const immutableDealContext = {
    Pipeline: selected.records.deal.Pipeline,
    Stage: selected.records.deal.Stage,
    Setup_Access_Issue_Request_ID:
      selected.records.deal.Setup_Access_Issue_Request_ID,
  };
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
  assert.equal(
    selected.records.deal.Configuration_Version,
    CONFIGURATION_REFERENCE,
  );
  assert.equal(selected.records.deal.Deployment_Record_ID, null);
  assert.deepEqual(
    {
      Pipeline: selected.records.deal.Pipeline,
      Stage: selected.records.deal.Stage,
      Setup_Access_Issue_Request_ID:
        selected.records.deal.Setup_Access_Issue_Request_ID,
    },
    immutableDealContext,
  );
  assert.equal(selected.records.deal.Free_Test_Authorization_Status, undefined);
  assert.equal(selected.records.deal.Go_Live_Approval_Status, null);
  assert.equal(selected.records.deal.Test_Status, null);
});

test("submission rejects a conflicting preexisting Configuration_Version after its durable claim", async () => {
  const selected = fixture();
  assert.equal((await issue(selected)).status, 200);
  const prefillResult = await prefill(selected);
  selected.records.deal.Configuration_Version =
    `form2cfgv1:7200000000002:${"a".repeat(40)}`;
  selected.events.length = 0;

  const result = await submit(selected, validSubmission(prefillResult.body));

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("workflow.submission.claim"), true);
  assert.equal(selected.events.includes("crm.composite"), false);
  assert.equal(selected.records.deal.Deployment_Record_ID, null);
});

test("submission rejects cross-record, cross-stage, and issue-identity drift before CRM write", async () => {
  const cases = [
    {
      name: "cross-record",
      mutate(selected) {
        selected.records.deal.Contact_Name = {
          id: `${"8".repeat(17)}1`,
          name: "Synthetic Other Contact",
        };
      },
    },
    {
      name: "cross-stage",
      mutate(selected) {
        selected.records.deal.Stage = "Synthetic Other Stage";
      },
    },
    {
      name: "issue-identity",
      mutate(selected) {
        selected.records.deal.Setup_Access_Issue_Request_ID =
          "20000000-0000-4000-8000-000000000002";
      },
    },
  ];

  for (const selectedCase of cases) {
    const selected = fixture();
    assert.equal((await issue(selected)).status, 200);
    const prefillResult = await prefill(selected);
    assert.equal(prefillResult.status, 200);
    selectedCase.mutate(selected);
    selected.events.length = 0;

    const result = await submit(selected, validSubmission(prefillResult.body));

    assert.equal(result.status, 409, selectedCase.name);
    assert.deepEqual(
      result.body,
      { ok: false, code: "setup_conflict" },
      selectedCase.name,
    );
    assert.equal(selected.events.includes("crm.composite"), false, selectedCase.name);
  }
});

test("accepts an exact submission with no requested start date", async () => {
  const selected = fixture();
  selected.records.deal.Target_Start_Date = "2026-08-19";
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, { requestedStartDate: null }),
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, accepted: true, duplicate: false });
  assert.equal(selected.records.deal.Target_Start_Date, null);
  assert.equal(selected.events.includes("crm.composite"), true);
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

test("an unapproved phone-system provider fails before prefill consumption or CRM mutation", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, {
      submissionId: "10010",
      phoneSystemProvider: "Unapproved Synthetic PBX",
    }),
  );

  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, code: "form_invalid" });
  assert.equal(selected.receipt.status, "failed");
  assert.equal(selected.receipt.lastOutcome, "form_invalid");
  assert.equal(selected.events.includes("workflow.submission.failed"), true);
  assert.equal(selected.events.includes("workflow.prefill.consume"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
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
  assert.equal(
    selected.records.deal.Configuration_Version,
    `form2cfgv1:${selected.receipt.rowId}:${selected.dependencies.config.sourceRevision}`,
  );
  assert.equal(selected.records.deal.Deployment_Record_ID, null);
});

test("a durable receipt remains the configuration authority after a runtime source redeploy", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  const durableReference = selected.records.deal.Configuration_Version;
  const newerDependencies = {
    ...selected.dependencies,
    config: {
      ...selected.dependencies.config,
      sourceRevision: "b".repeat(40),
    },
  };
  selected.events.length = 0;

  const duplicate = await handleForm2Request(
    createRequest(
      newerDependencies.config.submissionPath,
      body,
      newerDependencies.config.submissionHeaderSecret,
    ),
    newerDependencies,
  );

  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body, { ok: true, accepted: true, duplicate: true });
  assert.equal(
    durableReference,
    `form2cfgv1:${selected.receipt.rowId}:${selected.receipt.sourceRevision}`,
  );
  assert.equal(selected.records.deal.Configuration_Version, durableReference);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("exact duplicates accept only coherent Journey-core post-submission states", async () => {
  const cases = [
    {
      name: "approved inactive",
      patch(selected) {
        return {
          Stage: "Setup and QA",
          Test_Status: "Scheduled",
          Go_Live_Approval_Status: "Approved",
          Go_Live_Approved_At: "2026-08-14T18:05:00.000Z",
          Approved_Configuration_Version: selected.records.deal.Configuration_Version,
        };
      },
    },
    {
      name: "stopped inactive",
      patch(selected) {
        return {
          Stage: "Closed Lost",
          Test_Status: "Failed",
          Go_Live_Approval_Status: "Revoked",
          Go_Live_Approved_At: "2026-08-14T18:05:00.000Z",
          Approved_Configuration_Version: selected.records.deal.Configuration_Version,
          Test_End_At: "2026-08-14T18:10:00.000Z",
          Test_End_Reason: "Sylvara Stopped",
          Rollback_Completed_At: "2026-08-14T18:10:00.000Z",
        };
      },
    },
  ];
  for (const selectedCase of cases) {
    const selected = fixture();
    await issue(selected);
    const prefillResult = await prefill(selected);
    const body = validSubmission(prefillResult.body);
    assert.equal((await submit(selected, body)).status, 200, selectedCase.name);
    Object.assign(selected.records.deal, selectedCase.patch(selected));
    selected.events.length = 0;

    const duplicate = await submit(selected, body);

    assert.equal(duplicate.status, 200, selectedCase.name);
    assert.deepEqual(
      duplicate.body,
      { ok: true, accepted: true, duplicate: true },
      selectedCase.name,
    );
    assert.equal(selected.events.includes("crm.composite"), false, selectedCase.name);
  }
});

test("exact duplicates reject unrelated post-submission stage, identity, or control drift", async () => {
  const cases = [
    ["unrelated stage", { Stage: "Test Live" }],
    ["stale stop reason", { Test_End_Reason: "Technical Failure" }],
    ["deployment binding", { Deployment_Record_ID: "synthetic-deployment" }],
    ["approved deployment binding", {
      Stage: "Setup and QA",
      Test_Status: "Scheduled",
      Go_Live_Approval_Status: "Approved",
      Go_Live_Approved_At: "2026-08-14T18:05:00.000Z",
      Approved_Deployment_Record_ID: "synthetic-deployment",
    }],
    ["cross-issue identity", {
      Setup_Access_Issue_Request_ID: "10000000-0000-4000-8000-000000000009",
    }],
  ];
  for (const [name, patch] of cases) {
    const selected = fixture();
    await issue(selected);
    const prefillResult = await prefill(selected);
    const body = validSubmission(prefillResult.body);
    assert.equal((await submit(selected, body)).status, 200, name);
    Object.assign(selected.records.deal, patch);
    if (name === "approved deployment binding") {
      selected.records.deal.Approved_Configuration_Version =
        selected.records.deal.Configuration_Version;
    }
    selected.events.length = 0;

    const mismatch = await submit(selected, body);

    assert.equal(mismatch.status, 503, name);
    assert.deepEqual(mismatch.body, { ok: false, code: "service_unavailable" }, name);
    assert.equal(selected.session.status, "reconciliation_required", name);
    assert.equal(selected.events.includes("crm.composite"), false, name);
  }
});

test("a positive submitted-ID or Configuration_Version mismatch terminalizes exact replay", async () => {
  for (const [field, value] of [
    ["Setup_Form_Submission_ID", "different:succeeded:id"],
    [
      "Configuration_Version",
      `form2cfgv1:7200000000002:${"a".repeat(40)}`,
    ],
  ]) {
    const selected = fixture();
    await issue(selected);
    const prefillResult = await prefill(selected);
    const body = validSubmission(prefillResult.body);
    assert.equal((await submit(selected, body)).status, 200);
    selected.records.deal[field] = value;
    selected.events.length = 0;

    const mismatch = await submit(selected, body);

    assert.equal(mismatch.status, 503, field);
    assert.deepEqual(
      mismatch.body,
      { ok: false, code: "service_unavailable" },
      field,
    );
    assert.equal(selected.receipt.status, "succeeded", field);
    assert.equal(selected.session.status, "reconciliation_required", field);
    assert.equal(
      selected.session.lastOutcome,
      "succeeded_receipt_crm_mismatch",
      field,
    );
    assert.equal(
      selected.events.includes("session.submitted.reconciliation"),
      true,
      field,
    );
    assert.equal(
      selected.events.includes("workflow.submission.reconciliation"),
      false,
      field,
    );
    assert.equal(selected.events.includes("crm.composite"), false, field);
  }
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

test("a completed duplicate fails closed when its immutable prefill revision is unavailable", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  const body = validSubmission(prefillResult.body);
  assert.equal((await submit(selected, body)).status, 200);
  selected.clearPrefill();
  selected.events.length = 0;

  const duplicate = await submit(selected, body);

  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.events.includes("workflow.prefill.read-id"), true);
  assert.equal(selected.events.includes("workflow.submission.read"), false);
  assert.equal(selected.events.includes("crm.composite"), false);
});

test("a verified crash-gap session fails closed when its prefill revision is unavailable", async () => {
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

  assert.equal(recovered.status, 409);
  assert.deepEqual(recovered.body, { ok: false, code: "setup_conflict" });
  assert.equal(selected.session.status, "verified");
  assert.equal(selected.events.includes("workflow.prefill.read-id"), true);
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

test("rejects an unsupported decimal form value before fingerprinting or state access", async () => {
  const selected = fixture();
  await issue(selected);
  const prefillResult = await prefill(selected);
  selected.events.length = 0;

  const result = await submit(
    selected,
    validSubmission(prefillResult.body, { noAnswerDelay: 5.5 }),
  );

  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, code: "form_invalid" });
  assert.equal(selected.receipt, null);
  assert.equal(selected.session.status, "verified");
  assert.deepEqual(selected.events, []);
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
