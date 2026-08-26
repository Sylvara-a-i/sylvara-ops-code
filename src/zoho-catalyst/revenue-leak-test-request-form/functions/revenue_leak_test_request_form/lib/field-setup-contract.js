"use strict";

const rawProtocol = require("./field-setup-protocol");
const {
  APPROVED_FORMS_PUBLIC_HOSTS,
  isApprovedFormsPublicHostname,
} = require("./destinations");

const CRM_MODULES = new Set(["Leads", "Deals"]);
const RECORD_ID_PATTERN = /^[0-9]{1,30}$/;
const USER_ID_PATTERN = /^[0-9]{1,30}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OUTCOME_PATTERN = /^[a-z0-9:_-]{1,80}$/;
const RECEIPT_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const FINGERPRINT_FIELDS = Object.freeze([
  "conversionPreviewFingerprint",
  "conversionSideEffectFingerprint",
  "conversionOutcomeFingerprint",
  "configVersionFingerprint",
  "dealResumeBindingDigest",
]);
const SERVER_RECEIPT_FIELDS = Object.freeze([
  "actionId",
  "authoritative",
  "environment",
  "fingerprintPatch",
  "journeyKey",
  "moduleApiName",
  "navigationIntent",
  "operatorUserId",
  "receiptType",
  "recordId",
  "revision",
  "sessionDigest",
  "state",
  "statusPatch",
]);
const FORM_NAVIGATION_TARGET_BY_ACTION = Object.freeze({
  open_form1: "form1",
  open_form2: "form2",
  resume_form1: "form1",
  resume_form2: "form2",
});
const FORM_NAVIGATION_TARGETS = Object.freeze([
  ...new Set(Object.values(FORM_NAVIGATION_TARGET_BY_ACTION)),
]);
const FORM_QUERY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORM_QUERY_VALUE_PATTERN = /^(?=.*[A-Za-z_-])[A-Za-z0-9_-]{16,256}$/;
const PROHIBITED_FORM_QUERY_KEY_PATTERN = /(?:redirect|return|next|url|email|phone|crm|record|lead|deal|account|contact|user)/i;

class FieldSetupContractError extends Error {
  constructor(message, publicCode = "field_setup_invalid") {
    super(message);
    this.name = "FieldSetupContractError";
    this.status = publicCode === "field_setup_not_found"
      ? 404
      : publicCode === "stale_revision"
        ? 409
        : 422;
    this.publicCode = publicCode;
  }
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldSetupContractError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new FieldSetupContractError(`${label} does not match the approved contract`);
  }
}

function isFormNavigationAction(actionId) {
  return Object.hasOwn(FORM_NAVIGATION_TARGET_BY_ACTION, actionId);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateProtocol(protocol) {
  if (
    protocol?.schemaVersion !== 1 ||
    protocol.protocolId !== "free_revenue_leak_test_field_setup_v1" ||
    !protocol.formNavigation ||
    !Array.isArray(protocol.formNavigation.approvedPublicHosts) ||
    protocol.formNavigation.approvedPublicHosts.length !== APPROVED_FORMS_PUBLIC_HOSTS.length ||
    protocol.formNavigation.approvedPublicHosts.some(
      (hostname, index) => hostname !== APPROVED_FORMS_PUBLIC_HOSTS[index],
    ) ||
    !Array.isArray(protocol.states) ||
    protocol.states.length !== 22
  ) {
    throw new Error("Canonical field-setup protocol is invalid");
  }
  const stateIds = new Set(protocol.states.map((state) => state.id));
  if (
    stateIds.size !== 22 ||
    !stateIds.has(protocol.initialState) ||
    !stateIds.has(protocol.blockedState) ||
    stateIds.has("activate_test")
  ) {
    throw new Error("Canonical field-setup state inventory is invalid");
  }
  const actionIds = new Set();
  for (const state of protocol.states) {
    if (
      !state.name ||
      typeof state.serverOutcomeRequired !== "boolean" ||
      !state.primaryAction ||
      !Array.isArray(state.secondaryActions)
    ) {
      throw new Error("Canonical field-setup state definition is incomplete");
    }
    for (const action of [state.primaryAction, ...state.secondaryActions]) {
      if (
        actionIds.has(action.id) ||
        !stateIds.has(action.nextState) ||
        action.browserIntentAllowed !== true ||
        (action.serverCoordinator !== undefined && action.serverCoordinator !== "conversion")
      ) {
        throw new Error("Canonical field-setup transition definition is invalid");
      }
      actionIds.add(action.id);
    }
  }
  for (const action of protocol.globalActions ?? []) {
    if (
      actionIds.has(action.id) ||
      !stateIds.has(action.nextState) ||
      action.browserIntentAllowed !== true ||
      action.authoritativeSideEffect !== true
    ) {
      throw new Error("Canonical global field-setup transition is invalid");
    }
    actionIds.add(action.id);
  }
  if (
    protocol.qualification?.factors?.length !== 6 ||
    new Set(protocol.qualification.factors.map((factor) => factor.id)).size !== 6 ||
    protocol.qualification?.decisions?.length !== 3
  ) {
    throw new Error("Canonical qualification contract is invalid");
  }
  const rowFields = protocol.persistence?.rowFields ?? [];
  const mandatoryFields = protocol.persistence?.mandatoryFields ?? [];
  const statusValues = protocol.persistence?.statusValues;
  const prerequisites = protocol.serverPrerequisites;
  const globalPrerequisites = protocol.globalServerPrerequisites;
  const stateStatusRequirements = protocol.persistence?.stateStatusRequirements;
  if (
    rowFields.length === 0 ||
    new Set(rowFields).size !== rowFields.length ||
    mandatoryFields.some((field) => !rowFields.includes(field)) ||
    protocol.persistence.initialValues.state !== protocol.initialState ||
    !statusValues ||
    typeof statusValues !== "object" ||
    Array.isArray(statusValues) ||
    !prerequisites ||
    typeof prerequisites !== "object" ||
    Array.isArray(prerequisites) ||
    !globalPrerequisites ||
    typeof globalPrerequisites !== "object" ||
    Array.isArray(globalPrerequisites) ||
    !stateStatusRequirements ||
    typeof stateStatusRequirements !== "object" ||
    Array.isArray(stateStatusRequirements)
  ) {
    throw new Error("Canonical field-setup persistence contract is invalid");
  }
  const statusFields = Object.keys(statusValues);
  function validatePrerequisite(prerequisite) {
    const fields = prerequisite && typeof prerequisite === "object" && !Array.isArray(prerequisite)
      ? Object.keys(prerequisite).sort()
      : [];
    if (
      fields.length !== 3 ||
      fields[0] !== "receiptType" ||
      fields[1] !== "requiredFingerprintFields" ||
      fields[2] !== "statusPatch" ||
      !RECEIPT_TYPE_PATTERN.test(prerequisite.receiptType ?? "") ||
      !prerequisite.statusPatch ||
      typeof prerequisite.statusPatch !== "object" ||
      Array.isArray(prerequisite.statusPatch) ||
      Object.keys(prerequisite.statusPatch).length === 0 ||
      !Array.isArray(prerequisite.requiredFingerprintFields) ||
      new Set(prerequisite.requiredFingerprintFields).size
        !== prerequisite.requiredFingerprintFields.length ||
      prerequisite.requiredFingerprintFields.some((field) => !FINGERPRINT_FIELDS.includes(field))
    ) {
      throw new Error("Canonical server prerequisite definition is invalid");
    }
    for (const [field, value] of Object.entries(prerequisite.statusPatch)) {
      if (!statusFields.includes(field) || !statusValues[field].includes(value)) {
        throw new Error("Canonical server prerequisite status is invalid");
      }
    }
  }
  const prerequisiteStates = new Set(Object.keys(prerequisites));
  for (const state of protocol.states) {
    const actionIdsForState = [state.primaryAction, ...state.secondaryActions]
      .map((action) => action.id);
    const statePrerequisites = prerequisites[state.id];
    if (state.serverOutcomeRequired === true) {
      if (
        !statePrerequisites ||
        typeof statePrerequisites !== "object" ||
        Array.isArray(statePrerequisites) ||
        Object.keys(statePrerequisites).length !== actionIdsForState.length ||
        actionIdsForState.some((actionId) => !Object.hasOwn(statePrerequisites, actionId))
      ) {
        throw new Error("Canonical server prerequisite coverage is invalid");
      }
      prerequisiteStates.delete(state.id);
    } else if (statePrerequisites !== undefined) {
      throw new Error("Canonical server prerequisite is attached to a browser-only state");
    }
    for (const prerequisite of Object.values(statePrerequisites ?? {})) {
      validatePrerequisite(prerequisite);
    }
  }
  if (prerequisiteStates.size !== 0) {
    throw new Error("Canonical server prerequisite references an unknown state");
  }
  const globalActions = protocol.globalActions ?? [];
  if (
    Object.keys(globalPrerequisites).length !== globalActions.length ||
    globalActions.some((action) => !Object.hasOwn(globalPrerequisites, action.id))
  ) {
    throw new Error("Canonical global server prerequisite coverage is invalid");
  }
  for (const prerequisite of Object.values(globalPrerequisites)) {
    validatePrerequisite(prerequisite);
  }
  if (
    Object.keys(stateStatusRequirements).length !== stateIds.size ||
    [...stateIds].some((stateId) => !Object.hasOwn(stateStatusRequirements, stateId))
  ) {
    throw new Error("Canonical state/status invariant coverage is invalid");
  }
  for (const requirements of Object.values(stateStatusRequirements)) {
    if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
      throw new Error("Canonical state/status invariant is invalid");
    }
    for (const [field, values] of Object.entries(requirements)) {
      if (
        !statusFields.includes(field) ||
        !Array.isArray(values) ||
        values.length === 0 ||
        new Set(values).size !== values.length ||
        values.some((value) => !statusValues[field].includes(value))
      ) {
        throw new Error("Canonical state/status invariant is invalid");
      }
    }
  }
  return deepFreeze(protocol);
}

const FIELD_SETUP_PROTOCOL = validateProtocol(rawProtocol);
const FIELD_SETUP_STATES = Object.freeze(FIELD_SETUP_PROTOCOL.states.map((state) => state.id));
const STATE_BY_ID = new Map(FIELD_SETUP_PROTOCOL.states.map((state) => [state.id, state]));
const QUALIFICATION_FACTORS = Object.freeze(
  FIELD_SETUP_PROTOCOL.qualification.factors.map((factor) => factor.id),
);
const QUALIFICATION_DECISIONS = Object.freeze(
  FIELD_SETUP_PROTOCOL.qualification.decisions.map((decision) => decision.id),
);
const QUALIFICATION_DECISION_BY_ACTION = new Map(
  FIELD_SETUP_PROTOCOL.qualification.decisions.map((decision) => [decision.actionId, decision]),
);
const BROWSER_ACTIONS = Object.freeze([
  ...FIELD_SETUP_PROTOCOL.states.flatMap((state) => [state.primaryAction, ...state.secondaryActions]),
  ...FIELD_SETUP_PROTOCOL.globalActions,
].filter((action) => action.browserIntentAllowed).map((action) => action.id));
const COORDINATED_BROWSER_ACTIONS = Object.freeze(
  FIELD_SETUP_PROTOCOL.states.flatMap((state) => [state.primaryAction, ...state.secondaryActions])
    .filter((action) => action.serverCoordinator === "conversion")
    .map((action) => action.id),
);
const PROHIBITED_BROWSER_ACTIONS = Object.freeze(
  [...FIELD_SETUP_PROTOCOL.browserAuthority.prohibitedOperations],
);

function normalizeBoundedIdentifier(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new FieldSetupContractError(`${label} is invalid`);
  }
  return value;
}

function normalizeTrustedLaunchContext(value) {
  requireExactKeys(
    value,
    ["environment", "moduleApiName", "operatorUserId", "recordId"],
    "Launch context",
  );
  if (value.environment !== "development" || !CRM_MODULES.has(value.moduleApiName)) {
    throw new FieldSetupContractError("Launch context is outside the Development allowlist");
  }
  return Object.freeze({
    environment: value.environment,
    moduleApiName: value.moduleApiName,
    operatorUserId: normalizeBoundedIdentifier(value.operatorUserId, USER_ID_PATTERN, "Operator"),
    recordId: normalizeBoundedIdentifier(value.recordId, RECORD_ID_PATTERN, "Record"),
  });
}

function normalizeAuthenticatedOperator(value) {
  requireExactKeys(value, ["authenticated", "environment", "operatorUserId", "role"], "Operator");
  if (
    value.authenticated !== true ||
    value.environment !== "development" ||
    value.role !== "field_setup_operator"
  ) {
    throw new FieldSetupContractError("Authenticated field-setup operator is required", "authentication_failed");
  }
  return Object.freeze({
    authenticated: true,
    environment: value.environment,
    operatorUserId: normalizeBoundedIdentifier(value.operatorUserId, USER_ID_PATTERN, "Operator"),
    role: value.role,
  });
}

function normalizeQualificationBody(value) {
  requireExactKeys(value, [...QUALIFICATION_FACTORS, "decision"], "Qualification decision");
  for (const key of QUALIFICATION_FACTORS) {
    if (typeof value[key] !== "boolean") {
      throw new FieldSetupContractError(`Qualification factor ${key} must be boolean`);
    }
  }
  const decision = FIELD_SETUP_PROTOCOL.qualification.decisions.find(
    (candidate) => candidate.id === value.decision,
  );
  if (!decision) {
    throw new FieldSetupContractError("Qualification decision is invalid");
  }
  if (decision.requiresAllFactors && QUALIFICATION_FACTORS.some((key) => !value[key])) {
    throw new FieldSetupContractError("A qualified decision requires every approved factor");
  }
  return Object.freeze(Object.fromEntries(Object.entries(value)));
}

function normalizeQualificationForAction(actionId, value) {
  const decision = QUALIFICATION_DECISION_BY_ACTION.get(actionId);
  if (!decision) {
    throw new FieldSetupContractError("Qualification action is invalid");
  }
  const normalized = normalizeQualificationBody(value);
  if (normalized.decision !== decision.id) {
    throw new FieldSetupContractError("Qualification action and decision do not match");
  }
  return normalized;
}

function assertOperatorBound(journey, operator) {
  const normalized = normalizeAuthenticatedOperator(operator);
  if (
    journey?.environment !== normalized.environment ||
    journey?.operatorUserId !== normalized.operatorUserId
  ) {
    throw new FieldSetupContractError("Operator is not bound to this journey", "authentication_failed");
  }
  return normalized;
}

function resolveTransition(stateId, actionId) {
  const state = STATE_BY_ID.get(stateId);
  const transition = state
    ? [state.primaryAction, ...state.secondaryActions].find((action) => action.id === actionId)
    : null;
  const globalTransition = FIELD_SETUP_PROTOCOL.globalActions.find((action) => action.id === actionId);
  if (!transition && !globalTransition) {
    throw new FieldSetupContractError("State transition is invalid");
  }
  return transition ?? globalTransition;
}

function getServerPrerequisite(stateId, actionId) {
  const state = STATE_BY_ID.get(stateId);
  if (!state) {
    throw new FieldSetupContractError("State transition is invalid");
  }
  const localAction = [state.primaryAction, ...state.secondaryActions]
    .some((action) => action.id === actionId);
  if (!localAction) {
    const globalAction = FIELD_SETUP_PROTOCOL.globalActions.find(
      (action) => action.id === actionId,
    );
    if (globalAction?.authoritativeSideEffect === true) {
      const prerequisite = FIELD_SETUP_PROTOCOL.globalServerPrerequisites[actionId];
      if (!prerequisite) {
        throw new FieldSetupContractError(
          "Global server prerequisite is unavailable",
          "configuration_invalid",
        );
      }
      return prerequisite;
    }
    throw new FieldSetupContractError("State transition is invalid");
  }
  const transition = [state.primaryAction, ...state.secondaryActions]
    .find((action) => action.id === actionId);
  if (transition?.serverCoordinator === "conversion") {
    throw new FieldSetupContractError(
      "Conversion action requires the conversion coordinator",
      "server_outcome_required",
    );
  }
  if (state.serverOutcomeRequired !== true) return null;
  const prerequisite = FIELD_SETUP_PROTOCOL.serverPrerequisites[stateId]?.[actionId];
  if (!prerequisite) {
    throw new FieldSetupContractError(
      "Server prerequisite is unavailable",
      "configuration_invalid",
    );
  }
  return prerequisite;
}

function normalizeFormNavigationDestinations(value) {
  try {
    requireExactKeys(value, FORM_NAVIGATION_TARGETS, "Form navigation destinations");
  } catch {
    throw new FieldSetupContractError(
      "Form navigation destinations are invalid",
      "configuration_invalid",
    );
  }
  return Object.freeze(Object.fromEntries(FORM_NAVIGATION_TARGETS.map((target) => {
    let destination;
    try {
      destination = new URL(value[target]);
    } catch {
      throw new FieldSetupContractError("Form navigation destination is invalid", "configuration_invalid");
    }
    if (
      destination.protocol !== "https:" ||
      destination.username ||
      destination.password ||
      destination.port ||
      destination.search ||
      destination.hash ||
      destination.pathname === "/" ||
      !isApprovedFormsPublicHostname(destination.hostname) ||
      destination.href.length > 2048
    ) {
      throw new FieldSetupContractError("Form navigation destination is invalid", "configuration_invalid");
    }
    return [target, destination.href];
  })));
}

function validateFormNavigationIntent(value, binding, destinations) {
  const expectedTarget = FORM_NAVIGATION_TARGET_BY_ACTION[binding.actionId] ?? null;
  if (expectedTarget === null) {
    if (value !== null) {
      throw new FieldSetupContractError("Form navigation intent is not permitted for this transition");
    }
    return null;
  }
  requireExactKeys(value, ["mode", "target", "url"], "Form navigation intent");
  if (value.mode !== "top_level" || value.target !== expectedTarget) {
    throw new FieldSetupContractError("Form navigation intent does not match the transition");
  }
  let intended;
  let destination;
  try {
    intended = new URL(value.url);
    destination = new URL(destinations[expectedTarget]);
  } catch {
    throw new FieldSetupContractError("Form navigation intent is invalid");
  }
  const queryEntries = [...intended.searchParams.entries()];
  if (
    intended.protocol !== "https:" ||
    intended.username ||
    intended.password ||
    intended.port ||
    intended.hash ||
    !isApprovedFormsPublicHostname(intended.hostname) ||
    intended.origin !== destination.origin ||
    intended.pathname !== destination.pathname ||
    intended.href.length > 2048 ||
    queryEntries.length > 4 ||
    new Set(queryEntries.map(([key]) => key)).size !== queryEntries.length ||
    queryEntries.some(([key, queryValue]) => (
      !FORM_QUERY_KEY_PATTERN.test(key) ||
      PROHIBITED_FORM_QUERY_KEY_PATTERN.test(key) ||
      !FORM_QUERY_VALUE_PATTERN.test(queryValue)
    ))
  ) {
    throw new FieldSetupContractError("Form navigation intent is outside the approved destination");
  }
  return Object.freeze({
    mode: "top_level",
    target: expectedTarget,
    url: intended.href,
  });
}

function validateServerPrerequisiteReceipt(value, binding, prerequisite, navigationDestinations) {
  requireExactKeys(value, SERVER_RECEIPT_FIELDS, "Server prerequisite receipt");
  requireExactKeys(
    binding,
    [
      "actionId",
      "environment",
      "journeyKey",
      "moduleApiName",
      "operatorUserId",
      "recordId",
      "revision",
      "sessionDigest",
      "state",
    ],
    "Server prerequisite binding",
  );
  if (
    value.authoritative !== true ||
    value.receiptType !== prerequisite.receiptType ||
    value.actionId !== binding.actionId ||
    value.environment !== binding.environment ||
    value.journeyKey !== binding.journeyKey ||
    value.moduleApiName !== binding.moduleApiName ||
    value.operatorUserId !== binding.operatorUserId ||
    value.recordId !== binding.recordId ||
    value.revision !== binding.revision ||
    value.sessionDigest !== binding.sessionDigest ||
    value.state !== binding.state
  ) {
    throw new FieldSetupContractError("Server prerequisite receipt is not bound to this transition");
  }
  const navigationIntent = validateFormNavigationIntent(
    value.navigationIntent,
    binding,
    navigationDestinations,
  );
  requireExactKeys(
    value.statusPatch,
    Object.keys(prerequisite.statusPatch),
    "Server prerequisite status patch",
  );
  for (const [field, expected] of Object.entries(prerequisite.statusPatch)) {
    if (value.statusPatch[field] !== expected) {
      throw new FieldSetupContractError("Server prerequisite status does not match the transition");
    }
  }
  requireExactKeys(
    value.fingerprintPatch,
    prerequisite.requiredFingerprintFields,
    "Server prerequisite fingerprint patch",
  );
  for (const field of prerequisite.requiredFingerprintFields) {
    if (!SHA256_PATTERN.test(value.fingerprintPatch[field] ?? "")) {
      throw new FieldSetupContractError("Server prerequisite fingerprint is invalid");
    }
  }
  return Object.freeze({
    fingerprintPatch: Object.freeze({ ...value.fingerprintPatch }),
    navigationIntent,
    receiptType: value.receiptType,
    statusPatch: Object.freeze({ ...value.statusPatch }),
  });
}

function authorizeQualification(journey, body, operator) {
  assertOperatorBound(journey, operator);
  const decision = normalizeQualificationBody(body);
  const decisionContract = FIELD_SETUP_PROTOCOL.qualification.decisions.find(
    (candidate) => candidate.id === decision.decision,
  );
  const transition = resolveTransition("operator_qualification_review", decisionContract.actionId);
  return Object.freeze({
    decision: decision.decision,
    factors: Object.freeze(
      Object.fromEntries(QUALIFICATION_FACTORS.map((key) => [key, decision[key]])),
    ),
    nextState: transition.nextState,
    storedStatus: decisionContract.storedStatus,
    conversionAuthorized: false,
  });
}

function assertBrowserAction(action) {
  if (PROHIBITED_BROWSER_ACTIONS.includes(action)) {
    throw new FieldSetupContractError("The browser cannot perform this operator action", "authentication_failed");
  }
  if (!BROWSER_ACTIONS.includes(action)) {
    throw new FieldSetupContractError("Browser action is invalid");
  }
  return action;
}

function canonicalTimestampMilliseconds(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function storedJourneyInvalid() {
  throw new FieldSetupContractError("Stored journey is invalid", "field_setup_not_found");
}

function validateStoredJourney(value) {
  try {
    requireExactKeys(value, FIELD_SETUP_PROTOCOL.persistence.rowFields, "Stored journey");
  } catch {
    storedJourneyInvalid();
  }
  const statusValues = FIELD_SETUP_PROTOCOL.persistence.statusValues;
  const timestamps = Object.fromEntries(
    ["issuedAt", "launchExpiresAt", "absoluteExpiresAt", "updatedAt"]
      .map((key) => [key, canonicalTimestampMilliseconds(value[key])]),
  );
  if (
    !UUID_PATTERN.test(value.journeyKey ?? "") ||
    !SHA256_PATTERN.test(value.launchDigest ?? "") ||
    !(value.sessionDigest === null || SHA256_PATTERN.test(value.sessionDigest ?? "")) ||
    !FIELD_SETUP_STATES.includes(value.state) ||
    // The persisted authority always remains the source Lead. A Deal button can
    // resume only through the independently read-back keyed Deal mapping; it
    // cannot create or transform a journey into a Deal-owned row.
    value.moduleApiName !== "Leads" ||
    !RECORD_ID_PATTERN.test(value.recordId ?? "") ||
    !SHA256_PATTERN.test(value.leadResumeBindingDigest ?? "") ||
    !(value.dealResumeBindingDigest === null || SHA256_PATTERN.test(value.dealResumeBindingDigest ?? "")) ||
    !USER_ID_PATTERN.test(value.operatorUserId ?? "") ||
    value.environment !== "development" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !OUTCOME_PATTERN.test(value.lastOutcome ?? "") ||
    Object.values(timestamps).some((timestamp) => timestamp === null) ||
    timestamps.issuedAt > timestamps.updatedAt ||
    timestamps.issuedAt >= timestamps.launchExpiresAt ||
    timestamps.launchExpiresAt > timestamps.absoluteExpiresAt
  ) {
    storedJourneyInvalid();
  }
  for (const [field, allowed] of Object.entries(statusValues)) {
    if (!allowed.includes(value[field])) storedJourneyInvalid();
  }
  const stateRequirements = FIELD_SETUP_PROTOCOL.persistence.stateStatusRequirements[value.state];
  if (!stateRequirements) storedJourneyInvalid();
  for (const [field, allowed] of Object.entries(stateRequirements)) {
    if (!allowed.includes(value[field])) storedJourneyInvalid();
  }
  for (const field of FINGERPRINT_FIELDS) {
    if (!(value[field] === null || SHA256_PATTERN.test(value[field] ?? ""))) {
      storedJourneyInvalid();
    }
  }
  const conversionFingerprints = [
    value.conversionPreviewFingerprint,
    value.conversionSideEffectFingerprint,
    value.conversionOutcomeFingerprint,
  ];
  if (
    (value.conversionStatus === "not_started" && conversionFingerprints.some((item) => item !== null)) ||
    (["preview_ready", "write_started", "reconciliation_required", "completed"]
      .includes(value.conversionStatus) && value.conversionPreviewFingerprint === null) ||
    (value.conversionStatus === "write_started"
      && value.conversionSideEffectFingerprint === null) ||
    (value.conversionStatus === "completed"
      && conversionFingerprints.some((item) => item === null)) ||
    (value.conversionStatus !== "completed" && value.dealResumeBindingDigest !== null) ||
    (value.conversionStatus === "completed" && value.dealResumeBindingDigest === null) ||
    (["assigned", "live", "cooldown", "retired"].includes(value.numberStatus)
      && value.configVersionFingerprint === null)
  ) {
    storedJourneyInvalid();
  }
  const idleExpiresAt = value.idleExpiresAt === null
    ? null
    : canonicalTimestampMilliseconds(value.idleExpiresAt);
  const launchConsumedAt = value.launchConsumedAt === null
    ? null
    : canonicalTimestampMilliseconds(value.launchConsumedAt);
  if (
    (value.idleExpiresAt !== null && idleExpiresAt === null) ||
    (value.launchConsumedAt !== null && launchConsumedAt === null) ||
    (value.sessionDigest === null) !== (idleExpiresAt === null) ||
    (value.sessionDigest === null) !== (launchConsumedAt === null) ||
    (idleExpiresAt !== null && (
      launchConsumedAt < timestamps.issuedAt ||
      idleExpiresAt <= launchConsumedAt ||
      idleExpiresAt > timestamps.absoluteExpiresAt
    ))
  ) {
    storedJourneyInvalid();
  }
  return value;
}

module.exports = {
  BROWSER_ACTIONS,
  COORDINATED_BROWSER_ACTIONS,
  FIELD_SETUP_PROTOCOL,
  FIELD_SETUP_STATES,
  FieldSetupContractError,
  PROHIBITED_BROWSER_ACTIONS,
  QUALIFICATION_DECISIONS,
  QUALIFICATION_FACTORS,
  assertBrowserAction,
  assertOperatorBound,
  authorizeQualification,
  getServerPrerequisite,
  isFormNavigationAction,
  normalizeAuthenticatedOperator,
  normalizeFormNavigationDestinations,
  normalizeQualificationBody,
  normalizeQualificationForAction,
  normalizeTrustedLaunchContext,
  resolveTransition,
  validateServerPrerequisiteReceipt,
  validateStoredJourney,
};
