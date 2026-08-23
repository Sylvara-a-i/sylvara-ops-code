'use strict';

const {
  CONTRACT,
  COVERAGE_TRIGGERS,
  VALUE_EVIDENCE_CLASSES,
  ADMISSION_RECONCILIATION_DECISIONS,
} = require('./contracts');
const { FreeTestError, invariant } = require('./errors');
const {
  validateDeployment,
  validateConfiguration,
  validateNumberAssignment,
  validateInboundPayload,
  validateEventEnvelope,
  validateOutcome,
  isPlainObject,
  optionalString,
  e164,
  integer,
  identifier,
  exactKeys,
  boolean,
  timestamp,
  enumValue,
} = require('./validation');
const {
  admissionId: createAdmissionId,
  eventReceiptKey,
  callLookupKey,
  payloadFingerprint,
  publicCorrelationId,
  keyedDigest,
} = require('./security');
const { intervalContains } = require('./memory-store');

const OWNERSHIP_FIELDS = Object.freeze([
  'resolver_status',
  'client_id',
  'deployment_id',
  'configuration_version',
  'engagement_type',
  'capability_profile',
  'coverage_mode',
  'admission_id',
  'number_assignment_id',
  'number_assignment_version',
  'correlation_id',
]);

function nowIso(now) {
  return new Date(now()).toISOString();
}

function admissionReconciliationBinding(config, admission) {
  return keyedDigest(config.eventSecret, 'free-test-admission-reconciliation-v1', [
    admission.admissionId,
    admission.correlationId,
    admission.clientId,
    admission.deploymentId,
    admission.configurationVersion,
    admission.assignmentId,
    admission.assignmentVersion,
    admission.admittedAt,
  ]);
}

function validateAdmissionReconciliationEvidence(input, expectedBinding, observedAt) {
  invariant(isPlainObject(input), 'INVALID_ADMISSION_RECONCILIATION_EVIDENCE',
    'Admission reconciliation evidence must be a plain object.');
  exactKeys(input, [
    'decision', 'authoritative', 'final', 'evidenceKey', 'bindingFingerprint',
    'observedAt', 'providerResponseCode',
  ], 'admission reconciliation evidence');
  const decision = enumValue(input.decision, ADMISSION_RECONCILIATION_DECISIONS,
    'admission reconciliation evidence.decision');
  const authoritative = boolean(input.authoritative, 'admission reconciliation evidence.authoritative');
  const final = boolean(input.final, 'admission reconciliation evidence.final');
  const evidenceKey = identifier(input.evidenceKey, 'admission reconciliation evidence.evidenceKey');
  const bindingFingerprint = identifier(
    input.bindingFingerprint, 'admission reconciliation evidence.bindingFingerprint',
  );
  invariant(/^[0-9a-f]{64}$/.test(bindingFingerprint) && bindingFingerprint === expectedBinding,
    'INVALID_ADMISSION_RECONCILIATION_EVIDENCE', 'Admission evidence ownership binding is invalid.');
  const evidenceObservedAt = timestamp(input.observedAt, 'admission reconciliation evidence.observedAt');
  invariant(evidenceObservedAt === observedAt, 'INVALID_ADMISSION_RECONCILIATION_EVIDENCE',
    'Admission evidence observation time is not current.');
  const providerResponseCode = identifier(
    input.providerResponseCode, 'admission reconciliation evidence.providerResponseCode',
  );
  const validDecision = (decision === 'NoCallCreated' && authoritative && final)
    || (decision === 'CallObserved' && authoritative && !final)
    || (decision === 'Ambiguous' && !authoritative && !final);
  invariant(validDecision, 'INVALID_ADMISSION_RECONCILIATION_EVIDENCE',
    'Admission evidence authority/finality is inconsistent.');
  return Object.freeze({
    decision,
    authoritative,
    final,
    evidenceKey,
    bindingFingerprint,
    observedAt: evidenceObservedAt,
    providerResponseCode,
  });
}

function unavailable(config, reasonCode) {
  const gate = Object.freeze({
    resolver_status: CONTRACT.configuration_unavailable_status,
    client_id: '',
    deployment_id: '',
    configuration_version: '',
    engagement_type: '',
    capability_profile: '',
    coverage_mode: '',
    admission_id: '',
    number_assignment_id: '',
    number_assignment_version: '',
    correlation_id: '',
  });
  return Object.freeze({
    status: CONTRACT.configuration_unavailable_status,
    reasonCode,
    response: Object.freeze({
      call_inbound: Object.freeze({
        override_agent_id: config.sharedAgentId,
        override_agent_version: config.sharedAgentVersion,
        dynamic_variables: gate,
        metadata: gate,
      }),
    }),
  });
}

function gateRecords(deploymentInput, configurationInput, assignmentInput, config) {
  const deployment = validateDeployment(deploymentInput);
  const configuration = validateConfiguration(configurationInput);
  const assignment = validateNumberAssignment(assignmentInput);
  invariant(deployment.clientId === configuration.clientId
    && deployment.clientId === assignment.clientId
    && deployment.deploymentId === configuration.deploymentId
    && deployment.deploymentId === assignment.deploymentId
    && deployment.configurationVersion === configuration.configurationVersion
    && deployment.configurationVersion === assignment.configurationVersion,
  'CONFIGURATION_UNAVAILABLE', 'Client, deployment, or configuration ownership is inconsistent.');
  invariant(deployment.coverageMode === configuration.coverageMode,
    'CONFIGURATION_UNAVAILABLE', 'Coverage mode is inconsistent.');
  invariant(configuration.approved && configuration.notificationRecipient.approved,
    'CONFIGURATION_UNAVAILABLE', 'Configuration or notification destination is not approved.');
  invariant(deployment.environment === 'development'
    && deployment.engagementType === CONTRACT.engagement_type
    && deployment.capabilityProfile === CONTRACT.capability_profile,
  'CONFIGURATION_UNAVAILABLE', 'Deployment capability contract is invalid.');
  invariant(deployment.monitorAgentId === config.sharedAgentId
    && assignment.agentId === config.sharedAgentId
    && deployment.monitorAgentVersion === config.sharedAgentVersion,
  'CONFIGURATION_UNAVAILABLE', 'Shared agent binding is inconsistent.');
  return { deployment, configuration, assignment };
}

function resolverMetadata(records, admission) {
  const { deployment, assignment } = records;
  return Object.freeze({
    resolver_status: CONTRACT.resolved_status,
    client_id: deployment.clientId,
    deployment_id: deployment.deploymentId,
    configuration_version: deployment.configurationVersion,
    engagement_type: deployment.engagementType,
    capability_profile: deployment.capabilityProfile,
    coverage_mode: deployment.coverageMode,
    admission_id: admission.admissionId,
    number_assignment_id: assignment.assignmentId,
    number_assignment_version: String(assignment.assignmentVersion),
    correlation_id: admission.correlationId,
  });
}

function conversationVariables(records, metadata) {
  const configuration = records.configuration;
  return Object.freeze({
    ...metadata,
    company_name: configuration.companyName,
    company_description: configuration.companyDescription || '',
    business_hours: configuration.businessHours,
    services_handled_json: JSON.stringify(configuration.servicesHandled),
    unsupported_services_json: JSON.stringify(configuration.unsupportedServices),
    service_area_json: JSON.stringify(configuration.serviceArea),
    urgent_conditions_json: JSON.stringify(configuration.urgentConditions),
    callback_expectation: configuration.callbackExpectation,
  });
}

function metadataOwnsCall(metadata) {
  if (!isPlainObject(metadata)) return false;
  return OWNERSHIP_FIELDS.some((field) => Object.hasOwn(metadata, field));
}

function requireOwnershipMetadata(metadata) {
  invariant(isPlainObject(metadata), 'CALL_OWNERSHIP_UNRESOLVED', 'Call metadata is invalid.');
  for (const field of OWNERSHIP_FIELDS) {
    invariant(typeof metadata[field] === 'string' && metadata[field].length > 0,
      'CALL_OWNERSHIP_UNRESOLVED', 'Call ownership metadata is incomplete.');
  }
  invariant(metadata.resolver_status === CONTRACT.resolved_status
    && metadata.engagement_type === CONTRACT.engagement_type
    && metadata.capability_profile === CONTRACT.capability_profile,
  'CALL_OWNERSHIP_UNRESOLVED', 'Call ownership gate metadata is invalid.');
  const assignmentVersion = Number(metadata.number_assignment_version);
  invariant(Number.isSafeInteger(assignmentVersion) && assignmentVersion > 0,
    'CALL_OWNERSHIP_UNRESOLVED', 'Number assignment version is invalid.');
  return { ...metadata, assignmentVersion };
}

function sanitizeText(value, name, maximum) {
  return optionalString(value, name, { maximum });
}

function containsObviousSensitiveData(values) {
  const text = values.filter((value) => typeof value === 'string').join(' ');
  return /\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b/.test(text)
    || /\b(?:[0-9][ -]?){13,19}\b/.test(text)
    || /\b(?:ssn|social security(?: number)?|bank routing|routing number|bank account|account number)\b\s*(?:is|:)?\s*(?:[0-9][ -]?){4,}/i.test(text)
    || /\b(?:password|passcode|authentication code|verification code|one[- ]time code|otp|routing number|bank account|account number|government id|driver'?s license|passport number|state id)\b\s*(?:is|:)?\s*[A-Za-z0-9-]{4,}/i.test(text)
    || /\b(?:medical|diagnosis|diagnosed|health condition|patient|medication|prescription)\b/i.test(text);
}

function isHighConfidencePaymentCard(value) {
  if (typeof value !== 'string') return false;
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  // A callback-looking E.164 value is minimized only when both a known card BIN
  // pattern and the Luhn checksum match; ordinary callback numbers are not scanned.
  if (!/^(?:4|3[47]|5[1-5]|2(?:2[2-9]|[3-6][0-9]|7[01]|720)|6(?:011|5)|35)/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function validateValueEvidence(data, documentedMethods, source = 'retell') {
  const evidenceClass = data.value_evidence_class || 'unknown';
  invariant(VALUE_EVIDENCE_CLASSES.has(evidenceClass), 'INVALID_ANALYSIS', 'Value evidence class is invalid.');
  const sourceAllowlist = {
    retell: new Set(['unknown', 'customer_supplied_estimate']),
    verified_downstream: new Set(['unknown', 'confirmed_revenue', 'booked_revenue']),
    server_method: new Set(['unknown', 'internal_estimate_with_method']),
  };
  invariant(sourceAllowlist[source] && sourceAllowlist[source].has(evidenceClass),
    'UNAUTHORIZED_VALUE_EVIDENCE', 'Value evidence class is not authorized for this source.');
  const hasValue = data.value_minor_units !== undefined && data.value_minor_units !== null;
  const valueMinorUnits = hasValue ? integer(data.value_minor_units, 'value_minor_units', 0, 1_000_000_000) : null;
  const currency = hasValue ? sanitizeText(data.value_currency, 'value_currency', 3) : null;
  if (currency) invariant(/^[A-Z]{3}$/.test(currency), 'INVALID_ANALYSIS', 'Value currency is invalid.');
  const methodId = sanitizeText(data.value_method_id, 'value_method_id', 100);
  const methodVersion = sanitizeText(data.value_method_version, 'value_method_version', 100);
  if (evidenceClass === 'unknown') {
    invariant(!hasValue && !methodId && !methodVersion, 'INVALID_ANALYSIS', 'Unknown value cannot carry an estimate.');
  } else {
    invariant(hasValue && currency, 'INVALID_ANALYSIS', 'Value evidence requires amount and currency.');
  }
  if (evidenceClass === 'internal_estimate_with_method') {
    invariant(methodId && methodVersion && documentedMethods.has(`${methodId}:${methodVersion}`),
      'UNDOCUMENTED_VALUE_METHOD', 'Internal estimate methodology is not documented.');
  } else {
    invariant(!methodId && !methodVersion, 'INVALID_ANALYSIS', 'Method identifiers are reserved for documented internal estimates.');
  }
  return Object.freeze({ evidenceClass, valueMinorUnits, currency, methodId, methodVersion });
}

function extractAnalysis(call, documentedMethods) {
  const analysis = isPlainObject(call.call_analysis) ? call.call_analysis : {};
  const data = isPlainObject(analysis.custom_analysis_data) ? analysis.custom_analysis_data : {};
  const sensitive = data.sensitive_data_detected === true
    || data.outcome === 'sensitive_data_ended'
    || isHighConfidencePaymentCard(data.callback_number)
    || containsObviousSensitiveData([
      data.caller_name,
      data.caller_intent,
      data.issue_summary,
      data.city_or_zip,
      data.specific_person_requested,
    ]);
  if (sensitive) {
    return Object.freeze({
      outcome: 'sensitive_data_ended',
      coverageTrigger: COVERAGE_TRIGGERS.has(data.coverage_trigger) ? data.coverage_trigger : 'Unknown',
      callerName: null,
      callbackNumber: null,
      customerType: 'unknown',
      callerIntent: null,
      issueSummary: null,
      cityOrZip: null,
      urgency: 'unknown',
      specificPersonRequested: null,
      value: Object.freeze({ evidenceClass: 'unknown', valueMinorUnits: null, currency: null, methodId: null, methodVersion: null }),
      sensitiveDataMinimized: true,
    });
  }
  const outcome = validateOutcome(data.outcome || 'unresolved');
  const coverageTrigger = data.coverage_trigger || 'Unknown';
  invariant(COVERAGE_TRIGGERS.has(coverageTrigger), 'INVALID_ANALYSIS', 'Coverage trigger is invalid.');
  const value = validateValueEvidence(data, documentedMethods);
  const callbackNumber = data.callback_number === undefined || data.callback_number === null || data.callback_number === ''
    ? null : e164(data.callback_number, 'callback_number');
  const customerType = data.customer_type || 'unknown';
  invariant(new Set(['new', 'existing', 'unknown']).has(customerType), 'INVALID_ANALYSIS', 'Customer type is invalid.');
  const urgency = data.urgency || 'unknown';
  invariant(new Set(['routine', 'urgent', 'immediate_danger', 'unknown']).has(urgency), 'INVALID_ANALYSIS', 'Urgency is invalid.');
  return Object.freeze({
    outcome,
    coverageTrigger,
    callerName: sanitizeText(data.caller_name, 'caller_name', 120),
    callbackNumber,
    customerType,
    callerIntent: sanitizeText(data.caller_intent, 'caller_intent', 160),
    issueSummary: sanitizeText(data.issue_summary, 'issue_summary', 500),
    cityOrZip: sanitizeText(data.city_or_zip, 'city_or_zip', 120),
    urgency,
    specificPersonRequested: sanitizeText(data.specific_person_requested, 'specific_person_requested', 120),
    value,
    sensitiveDataMinimized: false,
  });
}

function triggerAllowedForMode(trigger, coverageMode) {
  if (trigger === 'Unknown') return true;
  if (coverageMode === 'AfterHoursOnly') return trigger === 'AfterHours';
  if (coverageMode === 'NoAnswerOverflowOnly') return trigger === 'NoAnswerOverflow';
  return coverageMode === 'AfterHoursAndOverflow'
    && (trigger === 'AfterHours' || trigger === 'NoAnswerOverflow');
}

function makeNotificationPayload(call) {
  return Object.freeze({
    callerName: call.callerName,
    callbackNumber: call.callbackNumber,
    customerType: call.customerType,
    cityOrZip: call.cityOrZip,
    issueSummary: call.issueSummary,
    urgency: call.urgency,
    specificPersonRequested: call.specificPersonRequested,
    safetyFlag: call.urgency === 'immediate_danger',
    callTimestamp: call.startedAt,
    callOutcome: call.outcome,
  });
}

function reportingProjection(call, deployment, eventType) {
  const startMs = Date.parse(deployment.actualStartAt);
  const expiresMs = Date.parse(deployment.expiresAt);
  const eventMs = Date.parse(call.endedAt || call.startedAt);
  return Object.freeze({
    projectionVersion: 1,
    eventType,
    callKey: call.callKey,
    correlationId: call.correlationId,
    clientId: call.clientId,
    deploymentId: call.deploymentId,
    configurationVersion: call.configurationVersion,
    callStartedAt: call.startedAt,
    callEndedAt: call.endedAt,
    outcome: call.outcome,
    urgency: call.urgency,
    safetyFlag: call.urgency === 'immediate_danger',
    coverageMode: deployment.coverageMode,
    coverageTrigger: call.coverageTrigger,
    notificationState: call.notificationState,
    admittedCallCount: deployment.admittedCallCount,
    handledCallCount: deployment.handledCallCount,
    callLimit: deployment.admissionLimit,
    callLimitProgress: deployment.handledCallCount / deployment.admissionLimit,
    testStartedAt: deployment.actualStartAt,
    testExpiresAt: deployment.expiresAt,
    testPeriodProgress: Math.max(0, Math.min(1, (eventMs - startMs) / (expiresMs - startMs))),
    valueEvidenceClass: call.valueEvidenceClass,
    valueMinorUnits: call.valueMinorUnits,
    valueCurrency: call.valueCurrency,
    valueMethodId: call.valueMethodId,
    valueMethodVersion: call.valueMethodVersion,
    sourceRevision: call.sourceRevision,
    sourceEnvironment: call.sourceEnvironment,
  });
}

function createFreeTestService(options) {
  const {
    store,
    config,
    notificationAdapter,
    analyticsAdapter,
    admissionReconciliationAdapter,
    crmSummaryAdapter,
    now = Date.now,
    documentedValueMethods = new Set(),
    logger = { info() {}, warn() {}, error() {} },
  } = options;
  invariant(config.environment === 'development', 'PRODUCTION_BLOCKED', 'Service may run only in Development.', { httpStatus: 503 });
  invariant(config.notificationMaxAttempts === CONTRACT.notification_retry_delays_ms.length + 1,
    'INVALID_RUNTIME_CONFIGURATION', 'Notification attempts and retry schedule are inconsistent.', { httpStatus: 503 });
  invariant(admissionReconciliationAdapter && typeof admissionReconciliationAdapter.inspect === 'function',
    'INVALID_RUNTIME_CONFIGURATION', 'Admission reconciliation adapter is required.', { httpStatus: 503 });

  async function resolveInbound(payload, context = {}) {
    let inbound;
    try {
      inbound = validateInboundPayload(payload);
      if (context.signatureTimestamp !== undefined) {
        invariant(Math.abs(context.signatureTimestamp - inbound.eventTimestamp) <= config.maxSignatureAgeMs,
          'EVENT_TIMESTAMP_MISMATCH', 'Signed-header and event timestamps are inconsistent.');
      }
      if (inbound.agentId) invariant(inbound.agentId === config.sharedAgentId,
        'CONFIGURATION_UNAVAILABLE', 'Inbound agent is not the shared free-test agent.');
      if (inbound.agentVersion !== null) invariant(inbound.agentVersion === config.sharedAgentVersion,
        'CONFIGURATION_UNAVAILABLE', 'Inbound agent version is not the pinned shared-agent version.');
      const assignments = await store.findCurrentAssignmentsByNumber(inbound.toNumber, inbound.eventTimestamp);
      invariant(assignments.length === 1, 'CONFIGURATION_UNAVAILABLE', 'Called number does not resolve uniquely.');
      const assignment = assignments[0];
      const deployment = await store.getDeployment(assignment.deploymentId);
      const configuration = await store.getConfiguration(assignment.deploymentId, assignment.configurationVersion);
      const records = gateRecords(deployment, configuration, assignment, config);
      const admissionId = createAdmissionId(config.admissionSecret, inbound);
      const correlationId = publicCorrelationId(config.eventSecret, [admissionId]);
      const claimed = await store.claimAdmission({
        admissionId,
        correlationId,
        sourceRevision: config.sourceRevision,
        sourceEnvironment: config.environment,
        clientId: records.deployment.clientId,
        deploymentId: records.deployment.deploymentId,
        configurationVersion: records.deployment.configurationVersion,
        assignmentId: records.assignment.assignmentId,
        assignmentVersion: records.assignment.assignmentVersion,
        now: new Date(inbound.eventTimestamp).toISOString(),
      });
      const metadata = resolverMetadata(records, claimed.admission);
      const dynamicVariables = conversationVariables(records, metadata);
      logger.info({ event: 'inbound_resolved', correlationId });
      return Object.freeze({
        status: CONTRACT.resolved_status,
        correlationId,
        response: Object.freeze({
          call_inbound: Object.freeze({
            override_agent_id: config.sharedAgentId,
            override_agent_version: config.sharedAgentVersion,
            dynamic_variables: dynamicVariables,
            metadata,
          }),
        }),
      });
    } catch (error) {
      if (error instanceof FreeTestError) {
        const correlationId = inbound
          ? publicCorrelationId(config.eventSecret, ['unavailable', inbound.eventTimestamp])
          : publicCorrelationId(config.eventSecret, ['unavailable', nowIso(now)]);
        logger.warn({ event: 'inbound_unavailable', correlationId, errorCode: error.code });
        return unavailable(config, error.code);
      }
      throw error;
    }
  }

  async function validatedOwnershipFromMetadata(envelope, callKey) {
    const metadata = requireOwnershipMetadata(envelope.call.metadata);
    const admission = await store.getAdmission(metadata.admission_id);
    const assignment = await store.getAssignment(metadata.number_assignment_id);
    const deployment = await store.getDeployment(metadata.deployment_id);
    const configuration = await store.getConfiguration(metadata.deployment_id, metadata.configuration_version);
    invariant(admission && assignment && deployment && configuration,
      'CALL_OWNERSHIP_UNRESOLVED', 'Durable ownership records are missing.');
    const records = gateRecords(deployment, configuration, assignment, config);
    if (envelope.call.to_number !== undefined && envelope.call.to_number !== null) {
      invariant(e164(envelope.call.to_number, 'event webhook.call.to_number') === assignment.toNumber,
        'CALL_OWNERSHIP_UNRESOLVED', 'Event called number conflicts with ownership metadata.');
    }
    invariant(metadata.client_id === deployment.clientId
      && metadata.configuration_version === deployment.configurationVersion
      && metadata.coverage_mode === deployment.coverageMode
      && metadata.assignmentVersion === assignment.assignmentVersion
      && admission.clientId === deployment.clientId
      && admission.deploymentId === deployment.deploymentId
      && admission.configurationVersion === deployment.configurationVersion
      && admission.assignmentId === assignment.assignmentId
      && admission.correlationId === metadata.correlation_id
      && (admission.state === 'Reserved' || (admission.state === 'Handled' && admission.callKey === callKey))
      && intervalContains(assignment, envelope.startTimestamp),
    'CALL_OWNERSHIP_UNRESOLVED', 'Call metadata conflicts with durable ownership.');
    invariant(!admission.callKey || admission.callKey === callKey,
      'CALL_OWNERSHIP_UNRESOLVED', 'Admission is bound to another call.');
    return { ...records, admissionId: admission.admissionId, correlationId: admission.correlationId,
      ownershipSource: 'validated_deployment_id' };
  }

  async function recoveredOwnership(envelope, callKey) {
    const existing = await store.getCall(callKey);
    if (existing) {
      const deployment = await store.getDeployment(existing.deploymentId);
      const configuration = await store.getConfiguration(existing.deploymentId, existing.configurationVersion);
      const assignment = existing.assignmentId ? await store.getAssignment(existing.assignmentId) : null;
      const admission = existing.admissionId ? await store.getAdmission(existing.admissionId) : null;
      invariant(deployment && configuration && assignment && admission,
        'CALL_OWNERSHIP_UNRESOLVED', 'Durable call binding dependencies are missing.');
      const records = gateRecords(deployment, configuration, assignment, config);
      invariant(existing.clientId === deployment.clientId
        && existing.deploymentId === deployment.deploymentId
        && existing.configurationVersion === deployment.configurationVersion
        && existing.assignmentId === assignment.assignmentId
        && existing.assignmentVersion === assignment.assignmentVersion
        && existing.admissionId === admission.admissionId
        && admission.callKey === callKey
        && admission.state === 'Handled'
        && intervalContains(assignment, envelope.startTimestamp),
      'CALL_OWNERSHIP_UNRESOLVED', 'Durable call binding conflicts with current immutable ownership records.');
      if (envelope.call.to_number !== undefined && envelope.call.to_number !== null) {
        invariant(assignment && e164(envelope.call.to_number, 'event webhook.call.to_number') === assignment.toNumber,
          'CALL_OWNERSHIP_UNRESOLVED', 'Event called number conflicts with durable call ownership.');
      }
      return { ...records,
        admissionId: existing.admissionId, correlationId: existing.correlationId,
        ownershipSource: 'durable_call_binding' };
    }
    let assignments = [];
    if (typeof envelope.call.to_number === 'string') {
      const toNumber = e164(envelope.call.to_number, 'event webhook.call.to_number');
      assignments = await store.findHistoricalAssignmentsByNumber(toNumber, envelope.startTimestamp);
      invariant(assignments.length === 1, 'CALL_OWNERSHIP_UNRESOLVED', 'Called number does not map to one historical assignment.');
    } else {
      const deployments = await store.findEligibleDeploymentsByAgent(envelope.agentId, envelope.startTimestamp);
      invariant(deployments.length === 1, 'CALL_OWNERSHIP_UNRESOLVED', 'Agent does not map to exactly one eligible deployment.');
      assignments = await store.findHistoricalAssignmentsByDeployment(
        deployments[0].deploymentId,
        envelope.agentId,
        envelope.startTimestamp,
      );
      invariant(assignments.length === 1, 'CALL_OWNERSHIP_UNRESOLVED', 'Agent fallback lacks one historical number assignment.');
    }
    const assignment = assignments[0];
    const deployment = await store.getDeployment(assignment.deploymentId);
    const configuration = await store.getConfiguration(assignment.deploymentId, assignment.configurationVersion);
    const records = gateRecords(deployment, configuration, assignment, config);
    const priorAdmissions = await store.findUnboundAdmissionsByAssignment(assignment.assignmentId, envelope.startTimestamp);
    invariant(priorAdmissions.length <= 1, 'CALL_OWNERSHIP_UNRESOLVED', 'Multiple admissions could own this call.');
    let recoveredAdmission = priorAdmissions[0];
    if (!recoveredAdmission) {
      invariant(assignment.status === 'Active', 'CALL_OWNERSHIP_UNRESOLVED', 'Historical assignment has no durable admission.');
      const claimed = await store.claimAdmission({
        admissionId: `adm_recovered_${callKey.slice(5)}`,
        correlationId: publicCorrelationId(config.eventSecret, [`adm_recovered_${callKey.slice(5)}`]),
        sourceRevision: config.sourceRevision,
        sourceEnvironment: config.environment,
        clientId: deployment.clientId,
        deploymentId: deployment.deploymentId,
        configurationVersion: deployment.configurationVersion,
        assignmentId: assignment.assignmentId,
        assignmentVersion: assignment.assignmentVersion,
        now: new Date(envelope.startTimestamp).toISOString(),
      });
      recoveredAdmission = claimed.admission;
    }
    return { ...records, admissionId: recoveredAdmission.admissionId, correlationId: recoveredAdmission.correlationId,
      ownershipSource: typeof envelope.call.to_number === 'string' ? 'unique_validated_to_number' : 'unique_agent_fallback' };
  }

  async function resolveOwnership(envelope, callKey) {
    if (metadataOwnsCall(envelope.call.metadata)) return validatedOwnershipFromMetadata(envelope, callKey);
    return recoveredOwnership(envelope, callKey);
  }

  async function deliverNotification(call, configuration) {
    const notificationId = `${call.callKey}:client_notification_v1`;
    const currentTime = nowIso(now);
    let notification = await store.ensureNotification({
      notificationId,
      callKey: call.callKey,
      correlationId: call.correlationId,
      clientId: call.clientId,
      deploymentId: call.deploymentId,
      configurationVersion: call.configurationVersion,
      recipientId: configuration.notificationRecipient.recipientId,
      payload: makeNotificationPayload(call),
      state: 'Pending',
      attempts: 0,
      providerReference: null,
      providerResponseCode: null,
      lastErrorCode: null,
      createdAt: currentTime,
      updatedAt: currentTime,
      lastAttemptAt: null,
      nextAttemptAt: null,
      sourceRevision: config.sourceRevision,
      sourceEnvironment: config.environment,
    });
    if (notification.state === 'Succeeded' || notification.state === 'TerminalFailure') return notification;
    if (notification.state === 'Sending' || notification.state === 'ReconciliationRequired') {
      const readback = await notificationAdapter.readback(notificationId);
      if (!readback.found) {
        await store.updateNotification(notificationId, {
          state: 'ReconciliationRequired',
          updatedAt: currentTime,
          nextAttemptAt: null,
          lastErrorCode: 'NOTIFICATION_RECONCILIATION_REQUIRED',
        });
        throw new FreeTestError('NOTIFICATION_RECONCILIATION_REQUIRED', 'Notification outcome remains ambiguous.', { ambiguous: true, retryable: true, httpStatus: 503 });
      }
      return store.updateNotification(notificationId, {
        state: 'Succeeded',
        providerReference: readback.result.providerReference,
        providerResponseCode: readback.result.responseCode,
        lastErrorCode: null,
        updatedAt: currentTime,
        nextAttemptAt: null,
      });
    }
    if (notification.state === 'RetryRequired' && notification.nextAttemptAt
      && Date.parse(currentTime) < Date.parse(notification.nextAttemptAt)) {
      throw new FreeTestError('NOTIFICATION_RETRY_NOT_DUE', 'Notification retry backoff has not elapsed.', {
        retryable: true,
        httpStatus: 503,
      });
    }
    notification = await store.updateNotification(notificationId, {
      state: 'Sending',
      attempts: notification.attempts + 1,
      lastAttemptAt: currentTime,
      updatedAt: currentTime,
      nextAttemptAt: null,
    });
    try {
      const result = await notificationAdapter.send({
        idempotencyKey: notificationId,
        recipientId: configuration.notificationRecipient.recipientId,
        recipient: configuration.notificationRecipient,
        payload: notification.payload,
      });
      return store.updateNotification(notificationId, {
        state: 'Succeeded',
        providerReference: result.providerReference,
        providerResponseCode: result.responseCode,
        lastErrorCode: null,
        updatedAt: currentTime,
        nextAttemptAt: null,
      });
    } catch (error) {
      if (error instanceof FreeTestError && error.ambiguous) {
        const readback = await notificationAdapter.readback(notificationId);
        if (readback.found) {
          return store.updateNotification(notificationId, {
            state: 'Succeeded',
            providerReference: readback.result.providerReference,
            providerResponseCode: readback.result.responseCode,
            lastErrorCode: null,
            updatedAt: currentTime,
            nextAttemptAt: null,
          });
        }
        await store.updateNotification(notificationId, {
          state: 'ReconciliationRequired',
          lastErrorCode: error.code,
          updatedAt: currentTime,
          nextAttemptAt: null,
        });
        throw error;
      }
      const retry = error instanceof FreeTestError && error.retryable
        && notification.attempts < config.notificationMaxAttempts;
      const retryDelay = retry ? CONTRACT.notification_retry_delays_ms[notification.attempts - 1] : null;
      await store.updateNotification(notificationId, {
        state: retry ? 'RetryRequired' : 'TerminalFailure',
        lastErrorCode: error instanceof FreeTestError ? error.code : 'NOTIFICATION_PROVIDER_FAILURE',
        updatedAt: currentTime,
        nextAttemptAt: retry ? new Date(Date.parse(currentTime) + retryDelay).toISOString() : null,
      });
      if (retry) throw error;
      return store.ensureNotification(notification);
    }
  }

  async function sendAnalytics(call, deployment) {
    const outboxId = `${call.callKey}:analytics:canonical_v1`;
    const existingOutbox = await store.getOutbox(outboxId);
    // Admission/test progress can change between attempts. A retry must reuse the
    // original immutable call fact bound to this idempotency key.
    const projection = existingOutbox
      ? existingOutbox.projection
      : reportingProjection(call, deployment, 'canonical_final');
    const currentTime = nowIso(now);
    let outbox = await store.ensureOutbox({
      outboxId,
      callKey: call.callKey,
      clientId: call.clientId,
      deploymentId: call.deploymentId,
      configurationVersion: call.configurationVersion,
      state: 'Pending',
      projection,
      correlationId: call.correlationId,
      sourceRevision: config.sourceRevision,
      sourceEnvironment: config.environment,
      attempts: 0,
      createdAt: currentTime,
      updatedAt: currentTime,
      lastAttemptAt: null,
      nextAttemptAt: null,
      providerResponseCode: null,
      lastErrorCode: null,
    });
    if (outbox.state === 'Succeeded' || outbox.state === 'TerminalFailure') return outbox;
    if (outbox.state === 'Sending' || outbox.state === 'ReconciliationRequired') {
      const readback = await analyticsAdapter.readback(outboxId);
      if (!readback.found) {
        await store.updateOutbox(outboxId, {
          state: 'ReconciliationRequired',
          updatedAt: currentTime,
          nextAttemptAt: null,
          lastErrorCode: 'ANALYTICS_RECONCILIATION_REQUIRED',
        });
        throw new FreeTestError('ANALYTICS_RECONCILIATION_REQUIRED', 'Analytics outcome remains ambiguous.', {
          ambiguous: true,
          retryable: true,
          httpStatus: 503,
        });
      }
      return store.updateOutbox(outboxId, {
        state: 'Succeeded',
        providerResponseCode: readback.result.responseCode,
        lastErrorCode: null,
        updatedAt: currentTime,
        nextAttemptAt: null,
      });
    }
    if (outbox.state === 'RetryRequired' && outbox.nextAttemptAt
      && Date.parse(currentTime) < Date.parse(outbox.nextAttemptAt)) {
      throw new FreeTestError('ANALYTICS_RETRY_NOT_DUE', 'Analytics retry backoff has not elapsed.', {
        retryable: true,
        httpStatus: 503,
      });
    }
    outbox = await store.updateOutbox(outboxId, {
      state: 'Sending',
      attempts: outbox.attempts + 1,
      lastAttemptAt: currentTime,
      updatedAt: currentTime,
      nextAttemptAt: null,
    });
    try {
      const result = await analyticsAdapter.upsert({ idempotencyKey: outboxId, projectionKey: call.callKey, projection: outbox.projection });
      return store.updateOutbox(outboxId, {
        state: 'Succeeded', providerResponseCode: result.responseCode, lastErrorCode: null,
        updatedAt: currentTime, nextAttemptAt: null,
      });
    } catch (error) {
      if (error instanceof FreeTestError && error.ambiguous) {
        const readback = await analyticsAdapter.readback(outboxId);
        if (readback.found) {
          return store.updateOutbox(outboxId, {
            state: 'Succeeded', providerResponseCode: readback.result.responseCode, lastErrorCode: null,
            updatedAt: currentTime, nextAttemptAt: null,
          });
        }
        await store.updateOutbox(outboxId, {
          state: 'ReconciliationRequired', lastErrorCode: error.code,
          updatedAt: currentTime, nextAttemptAt: null,
        });
        throw error;
      }
      const maxAttempts = CONTRACT.analytics_retry_delays_ms.length + 1;
      const retry = error instanceof FreeTestError && error.retryable && outbox.attempts < maxAttempts;
      const retryDelay = retry ? CONTRACT.analytics_retry_delays_ms[outbox.attempts - 1] : null;
      await store.updateOutbox(outboxId, {
        state: retry ? 'RetryRequired' : 'TerminalFailure',
        lastErrorCode: error.code || 'ANALYTICS_FAILURE',
        updatedAt: currentTime,
        nextAttemptAt: retry ? new Date(Date.parse(currentTime) + retryDelay).toISOString() : null,
      });
      if (retry) throw error;
      throw new FreeTestError('ANALYTICS_TERMINAL_FAILURE', 'Analytics delivery reached a terminal failure.', {
        httpStatus: 503,
        cause: error,
      });
    }
  }

  async function processEvent(payload, context = {}) {
    invariant(Buffer.isBuffer(context.rawBody), 'INVALID_RAW_BODY', 'Event processing requires raw request bytes.');
    let envelope;
    try {
      envelope = validateEventEnvelope(payload);
    } catch (error) {
      if (isPlainObject(payload) && CONTRACT.retell_events.includes(payload.event)
        && isPlainObject(payload.call) && typeof payload.call.call_id === 'string') {
        const malformedCallId = identifier(payload.call.call_id, 'event webhook.call.call_id');
        const malformedReceiptKey = eventReceiptKey(config.eventSecret, payload.event, malformedCallId);
        const malformedCallKey = callLookupKey(config.eventSecret, malformedCallId);
        const fingerprint = payloadFingerprint(config.eventSecret, context.rawBody);
        const begun = await store.beginEvent({
          receiptKey: malformedReceiptKey,
          callKey: malformedCallKey,
          eventType: payload.event,
          fingerprint,
          receivedAt: nowIso(now),
          leaseExpiresAt: new Date(now() + CONTRACT.event_processing_lease_ms).toISOString(),
          sourceRevision: config.sourceRevision,
          sourceEnvironment: config.environment,
        });
        if (!begun.duplicate && !begun.inProgress) {
          await store.finishEvent(
            malformedReceiptKey, begun.receipt.leaseToken, 'TerminalFailure', error.code || 'INVALID_SCHEMA',
          );
        }
      }
      throw error;
    }
    const receiptKey = eventReceiptKey(config.eventSecret, envelope.event, envelope.callId);
    const callKey = callLookupKey(config.eventSecret, envelope.callId);
    const fingerprint = payloadFingerprint(config.eventSecret, context.rawBody);
    const receivedAt = nowIso(now);
    const begun = await store.beginEvent({
      receiptKey,
      callKey,
      eventType: envelope.event,
      fingerprint,
      receivedAt,
      leaseExpiresAt: new Date(Date.parse(receivedAt) + CONTRACT.event_processing_lease_ms).toISOString(),
      sourceRevision: config.sourceRevision,
      sourceEnvironment: config.environment,
    });
    if (begun.duplicate) return Object.freeze({ status: begun.receipt.status, duplicate: true, callKey });
    if (begun.inProgress) return Object.freeze({ status: 'InProgress', duplicate: true, callKey });
    const leaseToken = begun.receipt.leaseToken;
    let failureCorrelationId = publicCorrelationId(config.eventSecret, ['event-failure', receiptKey]);
    try {
      invariant(envelope.agentId === config.sharedAgentId, 'CALL_OWNERSHIP_UNRESOLVED', 'Event is not from the shared free-test agent.');
      invariant(envelope.agentVersion === config.sharedAgentVersion,
        'CALL_OWNERSHIP_UNRESOLVED', 'Event is not from the pinned shared-agent version.');
      const ownership = await resolveOwnership(envelope, callKey);
      failureCorrelationId = ownership.correlationId;
      await store.updateEventOwnership(receiptKey, leaseToken, {
        correlationId: ownership.correlationId,
        clientId: ownership.deployment.clientId,
        deploymentId: ownership.deployment.deploymentId,
        configurationVersion: ownership.deployment.configurationVersion,
      });
      let call = await store.getCall(callKey);
      if (!call) {
        call = await store.bindCall({
          callKey,
          correlationId: ownership.correlationId,
          sourceRevision: config.sourceRevision,
          sourceEnvironment: config.environment,
          clientId: ownership.deployment.clientId,
          deploymentId: ownership.deployment.deploymentId,
          configurationVersion: ownership.deployment.configurationVersion,
          assignmentId: ownership.assignment ? ownership.assignment.assignmentId : null,
          assignmentVersion: ownership.assignment ? ownership.assignment.assignmentVersion : null,
          admissionId: ownership.admissionId,
          ownershipSource: ownership.ownershipSource,
          startedAt: new Date(envelope.startTimestamp).toISOString(),
          endedAt: null,
          processingState: 'Incomplete',
          analysisReady: false,
          analysisFinalized: false,
          analysisSource: null,
          outcome: 'unresolved',
          coverageTrigger: 'Unknown',
          callerName: null,
          callbackNumber: null,
          customerType: 'unknown',
          callerIntent: null,
          issueSummary: null,
          cityOrZip: null,
          urgency: 'unknown',
          specificPersonRequested: null,
          notificationState: null,
          valueEvidenceClass: 'unknown',
          valueMinorUnits: null,
          valueCurrency: null,
          valueMethodId: null,
          valueMethodVersion: null,
          sensitiveDataMinimized: false,
        });
      } else {
        invariant(call.startedAt === new Date(envelope.startTimestamp).toISOString(),
          'CALL_EVENT_CONFLICT', 'Call start timestamp conflicts with canonical state.');
        if (call.endedAt && envelope.endTimestamp !== null) {
          invariant(call.endedAt === new Date(envelope.endTimestamp).toISOString(),
            'CALL_EVENT_CONFLICT', 'Call end timestamp conflicts with canonical state.');
        }
      }
      if (envelope.event === 'call_analyzed') {
        invariant(!call.analysisFinalized || call.analysisSource === 'retell',
          'LATE_ANALYSIS_AFTER_FINALIZATION', 'Call analysis arrived after bounded unresolved finalization.');
      }
      if (envelope.endTimestamp !== null) {
        call = await store.updateCallEnd(callKey, new Date(envelope.endTimestamp).toISOString());
      }
      if (envelope.event === 'call_analyzed') {
        const analysis = extractAnalysis(envelope.call, documentedValueMethods);
        invariant(triggerAllowedForMode(analysis.coverageTrigger, ownership.deployment.coverageMode),
          'INVALID_ANALYSIS', 'Coverage trigger is not allowed for this deployment mode.');
        call = await store.applyCallAnalysis(callKey, {
          analysisReady: true,
          analysisFinalized: true,
          analysisSource: 'retell',
          processingState: 'Complete',
          outcome: analysis.outcome,
          coverageTrigger: analysis.coverageTrigger,
          callerName: analysis.callerName,
          callbackNumber: analysis.callbackNumber,
          customerType: analysis.customerType,
          callerIntent: analysis.callerIntent,
          issueSummary: analysis.issueSummary,
          cityOrZip: analysis.cityOrZip,
          urgency: analysis.urgency,
          specificPersonRequested: analysis.specificPersonRequested,
          valueEvidenceClass: analysis.value.evidenceClass,
          valueMinorUnits: analysis.value.valueMinorUnits,
          valueCurrency: analysis.value.currency,
          valueMethodId: analysis.value.methodId,
          valueMethodVersion: analysis.value.methodVersion,
          sensitiveDataMinimized: analysis.sensitiveDataMinimized,
        });
        const notification = await deliverNotification(call, ownership.configuration);
        call = await store.updateCall(callKey, { notificationState: notification.state });
        await crmSummaryAdapter.write({ callKey, summary: null });
      }
      if (call.analysisReady && call.endedAt
        && (call.notificationState === 'Succeeded' || call.notificationState === 'TerminalFailure')) {
        const currentDeployment = await store.getDeployment(call.deploymentId);
        await sendAnalytics(call, currentDeployment);
      }
      await store.finishEvent(receiptKey, leaseToken, 'Completed');
      logger.info({ event: 'retell_event_completed', correlationId: call.correlationId, eventType: envelope.event });
      return Object.freeze({ status: 'Completed', duplicate: false, callKey, correlationId: call.correlationId });
    } catch (error) {
      const state = error instanceof FreeTestError && error.ambiguous
        ? 'ReconciliationRequired'
        : error instanceof FreeTestError && error.retryable ? 'RetryRequired' : 'TerminalFailure';
      await store.finishEvent(receiptKey, leaseToken, state, error.code || 'UNEXPECTED_FAILURE');
      logger.error({ event: 'retell_event_failed', correlationId: failureCorrelationId,
        errorCode: error.code || 'UNEXPECTED_FAILURE' });
      throw error;
    }
  }

  async function reconcileIncompleteCalls() {
    const reconciliationStartedAt = nowIso(now);
    const cutoff = new Date(Date.parse(reconciliationStartedAt) - CONTRACT.analysis_grace_ms).toISOString();
    const candidates = await store.listIncompleteCallsDue(cutoff);
    const results = [];
    for (const candidate of candidates) {
      const claimed = await store.claimIncompleteCall(candidate.callKey, cutoff, reconciliationStartedAt);
      if (!claimed) continue;
      try {
        const deployment = await store.getDeployment(claimed.deploymentId);
        const configuration = await store.getConfiguration(claimed.deploymentId, claimed.configurationVersion);
        const assignment = await store.getAssignment(claimed.assignmentId);
        const admission = await store.getAdmission(claimed.admissionId);
        const records = gateRecords(deployment, configuration, assignment, config);
        invariant(admission && admission.callKey === claimed.callKey
          && admission.correlationId === claimed.correlationId
          && claimed.clientId === deployment.clientId,
        'CALL_OWNERSHIP_UNRESOLVED', 'Incomplete call ownership cannot be reconciled.');
        let call = await store.finalizeCallWithoutAnalysis(claimed.callKey);
        const notification = await deliverNotification(call, records.configuration);
        call = await store.updateCall(call.callKey, { notificationState: notification.state });
        await sendAnalytics(call, records.deployment);
        await crmSummaryAdapter.write({ callKey: call.callKey, summary: null });
        await store.updateCall(call.callKey, {
          processingState: 'Complete',
          finalizationLeaseExpiresAt: null,
        });
        results.push({ callKey: call.callKey, status: 'Completed' });
      } catch (error) {
        logger.error({ event: 'incomplete_call_reconciliation_failed', correlationId: claimed.correlationId,
          errorCode: error.code || 'UNEXPECTED_FAILURE' });
        results.push({ callKey: claimed.callKey, status: 'RetryRequired', errorCode: error.code || 'UNEXPECTED_FAILURE' });
      }
    }
    return Object.freeze({ examined: candidates.length, results: Object.freeze(results) });
  }

  async function reconcileOrphanAdmissions() {
    const reconciliationStartedAt = nowIso(now);
    const candidates = await store.listAdmissionReconciliationCandidates(reconciliationStartedAt);
    const results = [];
    for (const candidate of candidates) {
      // Each claim gets a fresh lease origin. A slow provider lookup for an earlier
      // candidate must not make a later candidate's lease stale at acquisition.
      const claimedAt = nowIso(now);
      const claimed = await store.claimAdmissionReconciliation(candidate.admissionId, claimedAt);
      if (!claimed) continue;
      const bindingFingerprint = admissionReconciliationBinding(config, claimed);
      try {
        const evidence = validateAdmissionReconciliationEvidence(
          await admissionReconciliationAdapter.inspect({
            idempotencyKey: `${claimed.admissionId}:authoritative_reconciliation_v1`,
            admissionId: claimed.admissionId,
            correlationId: claimed.correlationId,
            clientId: claimed.clientId,
            deploymentId: claimed.deploymentId,
            configurationVersion: claimed.configurationVersion,
            assignmentId: claimed.assignmentId,
            assignmentVersion: claimed.assignmentVersion,
            admittedAt: claimed.admittedAt,
            bindingFingerprint,
            observedAt: claimedAt,
          }),
          bindingFingerprint,
          claimedAt,
        );
        if (evidence.decision === 'NoCallCreated') {
          await store.releaseAdmissionNoCall(
            claimed.admissionId, claimed.reconciliationLeaseToken, evidence, claimedAt,
          );
          logger.info({ event: 'admission_released_no_call', correlationId: claimed.correlationId });
          results.push({ correlationId: claimed.correlationId, status: 'ReleasedNoCall' });
          continue;
        }
        const state = evidence.decision === 'CallObserved' ? 'CallObserved' : 'ReconciliationRequired';
        const evidenceFingerprint = keyedDigest(config.eventSecret, 'free-test-admission-evidence-v1', [
          evidence.evidenceKey, evidence.bindingFingerprint, evidence.decision,
          evidence.observedAt, evidence.providerResponseCode,
        ]);
        await store.finishAdmissionReconciliation(claimed.admissionId, claimed.reconciliationLeaseToken, {
          state,
          evidenceKey: evidence.evidenceKey,
          evidenceFingerprint,
          bindingFingerprint: evidence.bindingFingerprint,
          providerResponseCode: evidence.providerResponseCode,
          observedAt: evidence.observedAt,
          errorCode: state === 'ReconciliationRequired' ? 'ADMISSION_PROVIDER_AMBIGUOUS' : null,
        });
        results.push({ correlationId: claimed.correlationId, status: state });
      } catch (error) {
        const state = error instanceof FreeTestError && error.retryable && !error.ambiguous
          ? 'RetryRequired' : 'ReconciliationRequired';
        try {
          await store.finishAdmissionReconciliation(claimed.admissionId, claimed.reconciliationLeaseToken, {
            state,
            errorCode: error.code || 'ADMISSION_RECONCILIATION_FAILURE',
          });
          logger.error({ event: 'admission_reconciliation_failed', correlationId: claimed.correlationId,
            errorCode: error.code || 'ADMISSION_RECONCILIATION_FAILURE' });
          results.push({ correlationId: claimed.correlationId, status: state,
            errorCode: error.code || 'ADMISSION_RECONCILIATION_FAILURE' });
        } catch (finishError) {
          if (!(finishError instanceof FreeTestError)
            || finishError.code !== 'ADMISSION_RECONCILIATION_LEASE_LOST') throw finishError;
          results.push({ correlationId: claimed.correlationId, status: 'LeaseLost' });
        }
      }
    }
    return Object.freeze({ examined: candidates.length, results: Object.freeze(results) });
  }

  return Object.freeze({
    resolveInbound,
    processEvent,
    reconcileIncompleteCalls,
    reconcileOrphanAdmissions,
  });
}

module.exports = {
  createFreeTestService,
  extractAnalysis,
  validateValueEvidence,
  reportingProjection,
  triggerAllowedForMode,
  isHighConfidencePaymentCard,
  admissionReconciliationBinding,
  validateAdmissionReconciliationEvidence,
  OWNERSHIP_FIELDS,
};
