(function exposeFieldSetupStateModel(root, factory) {
  const protocol = root && root.FieldSetupProtocol
    ? root.FieldSetupProtocol
    : typeof module === "object" && module.exports
      ? require("./protocol.generated.js")
      : null;
  const model = factory(protocol);

  if (typeof module === "object" && module.exports) {
    module.exports = model;
  }

  if (root) {
    root.FieldSetupStateModel = model;
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createFieldSetupStateModel(protocol) {
  "use strict";

  if (!protocol || protocol.schemaVersion !== 1 || !Array.isArray(protocol.states)) {
    throw new Error("Canonical field-setup protocol is unavailable.");
  }

  const SUPPORTED_VIEWPORTS = Object.freeze([
    Object.freeze({ width: 768, height: 1024 }),
    Object.freeze({ width: 1024, height: 1366 })
  ]);

  const QUALIFICATION_FACTORS = Object.freeze(protocol.qualification.factors.map((factor) => Object.freeze({
    id: factor.id,
    label: factor.label
  })));
  const QUALIFICATION_CRITERIA = Object.freeze(QUALIFICATION_FACTORS.map((factor) => factor.label));

  const PRESENTATION_STATES = Object.freeze([
    defineState({
      id: "session-validation",
      name: "Loading and session validation",
      audience: "Operator",
      kicker: "Secure setup",
      status: "Validation required",
      description: "Check the short-lived operator session before any workflow information is shown.",
      notice: "This local source preview does not exchange a live launch nonce or open a customer record.",
      details: ["Launch fragments are removed before the page renders.", "A future installed client must require authenticated operator context."],
      primaryAction: action("validate-session", "Validate session", "company-progress-summary")
    }),
    defineState({
      id: "company-progress-summary",
      name: "Company and progress summary",
      audience: "Operator",
      kicker: "Review",
      status: "Source preview",
      description: "Review only the bounded company and setup progress needed for the next step.",
      notice: "No unrelated CRM data or platform identifiers are displayed.",
      details: ["Company details: withheld in source preview", "Journey progress: no live record connected", "Next audience: client"],
      primaryAction: action("review-summary", "Continue to handoff", "handoff-to-client-request")
    }),
    defineState({
      id: "handoff-to-client-request",
      name: "Hand-iPad-to-client instruction",
      audience: "Operator",
      kicker: "Client handoff",
      status: "Ready for handoff",
      description: "Hand the iPad to the client only after confirming they can review the request and consent themselves.",
      notice: "Do not explain away or preselect consent. The client must confirm their own information.",
      details: ["Keep the client on this single-purpose journey.", "Remain available for process questions, not consent answers."],
      primaryAction: action("confirm-request-handoff", "I handed over the iPad", "form-one-open-resume")
    }),
    defineState({
      id: "form-one-open-resume",
      name: "Open or resume Form 1",
      audience: "Client",
      kicker: "Request and consent",
      status: "Not submitted",
      description: "Open or resume the existing Free Revenue Leak Test request form in a top-level page.",
      notice: "Form 1 does not activate call routing or paid service. Contact consent is never prechecked.",
      details: ["Confirm your contact information.", "Review every consent choice yourself.", "Return here after the form reports success."],
      primaryAction: action("open-form-one", "Open Form 1", "form-one-completion-confirmation"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "form-one-completion-confirmation",
      name: "Form 1 completion confirmation",
      audience: "Client",
      kicker: "Request and consent",
      status: "Confirmation required",
      description: "Confirm that Form 1 showed a successful submission before returning the iPad.",
      notice: "This confirmation is not routing approval and does not create a paid service.",
      details: ["Use the form's success result as the completion signal.", "Do not submit a second request if the result is uncertain."],
      primaryAction: action("confirm-form-one", "Form 1 showed success", "return-to-operator-after-request"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "return-to-operator-after-request",
      name: "Return-iPad-to-Gabriel instruction",
      audience: "Client",
      kicker: "Operator handoff",
      status: "Return device",
      description: "Please return the iPad to Gabriel. The next screens contain operator-only decisions.",
      notice: "Do not continue into qualification or conversion review as the client.",
      details: ["The request is not a promise of service.", "No forwarding or call handling has started."],
      primaryAction: action("confirm-request-return", "Gabriel has the iPad", "operator-qualification-review")
    }),
    defineState({
      id: "operator-qualification-review",
      name: "Operator qualification review",
      audience: "Gabriel only",
      kicker: "Qualification",
      status: "Decision required",
      description: "Review each qualification condition and submit one explicit operator decision.",
      notice: "The browser sends decision intent only. Server-side operator authorization and readback must control the authoritative result.",
      details: ["Use current evidence, not assumptions.", "Not-ready and disqualified outcomes must not convert the Lead."],
      qualificationCriteria: QUALIFICATION_CRITERIA,
      primaryAction: action("qualification-qualified", "Qualified — Continue Setup", "lead-conversion-preview"),
      secondaryActions: [
        action("qualification-not-ready", "Not Ready — Save And Follow Up", "recoverable-blocked"),
        action("qualification-disqualified", "Disqualified", "recoverable-blocked")
      ],
      serverOutcomeRequired: true
    }),
    defineState({
      id: "lead-conversion-preview",
      name: "Lead-conversion preview",
      audience: "Gabriel only",
      kicker: "CRM preview",
      status: "Readback required",
      description: "Review a sanitized conversion plan after current options, mandatory fields, and duplicate candidates are checked.",
      notice: "Stop on ambiguity, missing required data, a duplicate candidate, a lock, or a permission failure.",
      details: ["Account association: awaiting authoritative preview", "Contact association: awaiting authoritative preview", "Deal requirements: awaiting authoritative preview"],
      primaryAction: action("accept-conversion-preview", "Preview is correct", "conversion-confirmation"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "conversion-confirmation",
      name: "Explicit conversion confirmation",
      audience: "Gabriel only",
      kicker: "CRM confirmation",
      status: "Confirmation required",
      description: "Confirm the exact sanitized conversion plan once, then wait for authoritative reconciliation.",
      notice: "This source preview performs no CRM write. An ambiguous future write must never be repeated automatically.",
      details: ["No email is sent from conversion.", "No number is reserved.", "No call route is activated."],
      primaryAction: action("confirm-conversion", "Confirm conversion", "handoff-to-client-setup"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "handoff-to-client-setup",
      name: "Hand-iPad-to-client instruction",
      audience: "Operator",
      kicker: "Client handoff",
      status: "Ready for handoff",
      description: "Hand the iPad to the authorized representative for email proof and Form 2 review.",
      notice: "Physical presence does not bypass the required email-verification proof.",
      details: ["The client reviews operating rules and limited test scope.", "Both authorization choices remain unselected until the client acts."],
      primaryAction: action("confirm-setup-handoff", "I handed over the iPad", "form-two-email-verification")
    }),
    defineState({
      id: "form-two-email-verification",
      name: "Email verification for Form 2",
      audience: "Client",
      kicker: "Identity proof",
      status: "Verification required",
      description: "Complete the existing email-verification step before the setup authorization form opens.",
      notice: "No verification value is displayed, stored, or logged by this source preview.",
      details: ["Use only the current verification message.", "Ask Gabriel for help if the proof cannot be completed."],
      primaryAction: action("verify-form-two-email", "Continue verification", "form-two-open-resume"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "form-two-open-resume",
      name: "Open or resume Form 2",
      audience: "Client",
      kicker: "Review and authorize",
      status: "Not submitted",
      description: "Review company routing, operating rules, and the limited free-test scope in the existing setup form.",
      notice: "Submission records authorization evidence but does not approve or activate routing.",
      details: ["Review the approved call gap and fallback destination.", "Confirm both authorization choices yourself.", "Return here only after the form reports success."],
      primaryAction: action("open-form-two", "Open Form 2", "form-two-completion-confirmation"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "form-two-completion-confirmation",
      name: "Form 2 completion confirmation",
      audience: "Client",
      kicker: "Review and authorize",
      status: "Confirmation required",
      description: "Confirm that Form 2 showed a successful submission before returning the iPad.",
      notice: "Routing remains off after submission. Final approval happens separately in CRM.",
      details: ["Both required authorization choices must be affirmative.", "Do not submit again when the result is uncertain."],
      primaryAction: action("confirm-form-two", "Form 2 showed success", "return-to-operator-after-setup"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "return-to-operator-after-setup",
      name: "Return-iPad-to-Gabriel instruction",
      audience: "Client",
      kicker: "Operator handoff",
      status: "Return device",
      description: "Please return the iPad to Gabriel. Remaining steps control number, route, and rollback preparation.",
      notice: "No calls are being handled by this setup journey.",
      details: ["Authorization evidence is subject to authoritative readback.", "Final start approval remains a separate operator action."],
      primaryAction: action("confirm-setup-return", "Gabriel has the iPad", "test-number-reservation")
    }),
    defineState({
      id: "test-number-reservation",
      name: "Test-number reservation status",
      audience: "Gabriel only",
      kicker: "Number isolation",
      status: "Awaiting reservation",
      description: "Reserve only one already-approved available test number for the exact client deployment.",
      notice: "This browser cannot reserve or activate a live number. Source preview uses no telephone value.",
      details: ["Reservation must be concurrency-safe.", "An active number cannot be reused.", "Cross-client reuse must fail closed."],
      primaryAction: action("refresh-number-reservation", "Check reservation status", "forwarding-instructions"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "forwarding-instructions",
      name: "Forwarding instructions",
      audience: "Gabriel only",
      kicker: "Controlled route",
      status: "Instructions pending",
      description: "Show provider-specific instructions only after the authoritative reservation and approved coverage are reconciled.",
      notice: "Unknown providers use a manual instruction path. No private number is present in this bundle.",
      details: ["Confirm the exact approved call gap.", "Keep the existing business route recoverable.", "Do not infer that forwarding succeeded."],
      primaryAction: action("acknowledge-forwarding", "Forwarding step complete", "rollback-instructions"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "rollback-instructions",
      name: "Rollback instructions",
      audience: "Gabriel only",
      kicker: "Containment",
      status: "Rollback proof required",
      description: "Document the exact provider rollback steps before opening route verification.",
      notice: "Rollback is separate from human handoff and infrastructure fallback.",
      details: ["Confirm who can reverse forwarding.", "Keep the prior route available.", "Stop if rollback cannot be proven."],
      primaryAction: action("confirm-rollback-ready", "Rollback is prepared", "route-verification"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "route-verification",
      name: "Route-verification status",
      audience: "Gabriel only",
      kicker: "Verification only",
      status: "Not verified",
      description: "Review a bounded verification window and wait for an authoritative route receipt.",
      notice: "Verification must not start normal intake, increment handled-call count, or send a call notification.",
      details: ["Bind the approved QA caller.", "Reject expired or replayed verification.", "Reject cross-client evidence."],
      primaryAction: action("refresh-route-verification", "Check verification status", "ready-for-approval"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "ready-for-approval",
      name: "Ready for approval",
      audience: "Gabriel only",
      kicker: "Separate final gate",
      status: "Browser cannot approve",
      description: "Review readiness, then return to the Deal in CRM for the separate final approval action.",
      notice: "The web client does not expose final activation. Approval must be Gabriel-only and independently reconciled.",
      details: ["Authorization readback: required", "Route verification: required", "Rollback readiness: required"],
      primaryAction: action("refresh-approval-readiness", "Refresh readiness", "ready-for-approval"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "live-status",
      name: "Live status",
      audience: "Gabriel only",
      kicker: "Status only",
      status: "Not live in source preview",
      description: "Display read-only live progress only after a separately authorized CRM approval and authoritative readback.",
      notice: "This state cannot start, extend, or broaden a test.",
      details: ["Current source preview has no traffic.", "Connected-call and expiry facts require server evidence.", "Use the separate stop control when containment is required."],
      primaryAction: action("refresh-live-status", "Refresh status", "live-status"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "stop-rollback-status",
      name: "Stop/rollback status",
      audience: "Gabriel only",
      kicker: "Containment",
      status: "Stop requested in preview",
      description: "Review stop, route rollback, and containment evidence without assuming completion.",
      notice: "A browser request is not proof that forwarding is reversed or traffic has stopped.",
      details: ["Read back runtime state.", "Read back the provider route.", "Preserve the evidence needed for reconciliation."],
      primaryAction: action("refresh-stop-status", "Refresh rollback status", "stop-rollback-status"),
      serverOutcomeRequired: true
    }),
    defineState({
      id: "recoverable-blocked",
      name: "Specific recoverable blocked/error state",
      audience: "Operator",
      kicker: "Setup paused safely",
      status: "Blocked",
      description: "The setup cannot continue until the specific failed check is corrected and read back.",
      notice: "No routing, conversion, or approval is attempted while the state is unresolved.",
      details: ["Keep the existing route unchanged.", "Correct the named issue outside this preview.", "Retry only after authoritative evidence is available."],
      primaryAction: action("retry-blocked-step", "Retry validation", "session-validation")
    })
  ]);

  if (PRESENTATION_STATES.length !== protocol.states.length) {
    throw new Error("Field-setup presentation inventory does not match the canonical protocol.");
  }
  const FIELD_SETUP_STATES = Object.freeze(protocol.states.map((contract, index) => {
    const presentation = PRESENTATION_STATES[index];
    return Object.freeze({
      ...presentation,
      id: contract.id,
      name: contract.name,
      primaryAction: actionFromContract(contract.primaryAction),
      qualificationFactors: Object.freeze(
        contract.id === "operator_qualification_review" ? [...QUALIFICATION_FACTORS] : []
      ),
      qualificationCriteria: Object.freeze(
        contract.id === "operator_qualification_review" ? [...QUALIFICATION_CRITERIA] : []
      ),
      secondaryActions: Object.freeze(contract.secondaryActions.map(actionFromContract)),
      serverOutcomeRequired: contract.serverOutcomeRequired
    });
  }));
  const STATE_BY_ID = Object.freeze(Object.fromEntries(FIELD_SETUP_STATES.map((state) => [state.id, state])));

  function actionFromContract(contract) {
    return Object.freeze({
      id: contract.id,
      label: contract.label,
      qualificationDecision: contract.qualificationDecision || null,
      syntheticNextState: contract.nextState
    });
  }

  function action(id, label, syntheticNextState) {
    return Object.freeze({ id, label, syntheticNextState });
  }

  function defineState(definition) {
    return Object.freeze({
      secondaryActions: Object.freeze([]),
      qualificationFactors: Object.freeze([]),
      qualificationCriteria: Object.freeze([]),
      serverOutcomeRequired: false,
      ...definition,
      details: Object.freeze([...definition.details]),
      secondaryActions: Object.freeze([...(definition.secondaryActions || [])]),
      qualificationCriteria: Object.freeze([...(definition.qualificationCriteria || [])])
    });
  }

  function getState(stateId) {
    return STATE_BY_ID[stateId] || STATE_BY_ID[protocol.blockedState];
  }

  function getStateIndex(stateId) {
    const index = FIELD_SETUP_STATES.findIndex((state) => state.id === stateId);
    return index < 0 ? FIELD_SETUP_STATES.length - 1 : index;
  }

  function normalizeQualificationPayload(actionId, payload) {
    const state = STATE_BY_ID.operator_qualification_review;
    const action = [state.primaryAction, ...state.secondaryActions]
      .find((candidate) => candidate.id === actionId);
    const expectedKeys = [...QUALIFICATION_FACTORS.map((factor) => factor.id), "decision"].sort();
    const actualKeys = payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload).sort()
      : [];
    if (
      !action ||
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index]) ||
      payload.decision !== action.qualificationDecision
    ) {
      throw new Error("Qualification payload does not match the canonical protocol.");
    }
    for (const factor of QUALIFICATION_FACTORS) {
      if (typeof payload[factor.id] !== "boolean") {
        throw new Error("Every qualification factor must be an explicit boolean.");
      }
    }
    if (
      action.qualificationDecision === "qualified_continue_setup" &&
      QUALIFICATION_FACTORS.some((factor) => payload[factor.id] !== true)
    ) {
      throw new Error("Qualified requires all six factors.");
    }
    return Object.freeze(Object.fromEntries(expectedKeys.map((key) => [key, payload[key]])));
  }

  return Object.freeze({
    FIELD_SETUP_STATES,
    QUALIFICATION_CRITERIA,
    QUALIFICATION_FACTORS,
    PROTOCOL_ID: protocol.protocolId,
    PROTOCOL_SCHEMA_VERSION: protocol.schemaVersion,
    SUPPORTED_VIEWPORTS,
    getState,
    getStateIndex,
    normalizeQualificationPayload
  });
});
