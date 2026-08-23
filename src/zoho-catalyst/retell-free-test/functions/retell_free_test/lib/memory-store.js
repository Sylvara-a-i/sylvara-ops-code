'use strict';

const crypto = require('node:crypto');
const { CONTRACT } = require('./contracts');
const { FreeTestError, invariant } = require('./errors');
const {
  validateDeployment,
  validateConfiguration,
  validateNumberAssignment,
} = require('./validation');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function configurationKey(deploymentId, version) {
  return `${deploymentId}\0${version}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function intervalContains(assignment, atMs) {
  return Date.parse(assignment.effectiveFrom) <= atMs
    && (!assignment.effectiveTo || atMs < Date.parse(assignment.effectiveTo));
}

function isCurrentlyEffective(assignment, atMs) {
  return assignment.status === 'Active' && intervalContains(assignment, atMs);
}

/**
 * Deterministic Development store. All compound state transitions are serialized so
 * acceptance tests exercise the same atomicity contract required from Catalyst.
 */
class MemoryStore {
  constructor(seed = {}, options = {}) {
    this.deployments = new Map();
    this.configurations = new Map();
    this.configurationFingerprints = new Map();
    this.assignments = new Map();
    this.admissionSlots = new Map();
    this.admissions = new Map();
    this.receipts = new Map();
    this.calls = new Map();
    this.notifications = new Map();
    this.outbox = new Map();
    this._tail = Promise.resolve();
    this._now = options.now || Date.now;

    for (const raw of seed.deployments || []) {
      const deployment = validateDeployment(raw);
      invariant(!this.deployments.has(deployment.deploymentId), 'SEED_CONFLICT', 'Duplicate deployment seed.');
      this.deployments.set(deployment.deploymentId, clone(deployment));
      this.admissionSlots.set(deployment.deploymentId, Array.from(
        { length: CONTRACT.admission_limit },
        (_, index) => ({ slot: index + 1, admissionId: null, admittedAt: null }),
      ));
    }
    for (const raw of seed.configurations || []) {
      const configuration = validateConfiguration(raw);
      const key = configurationKey(configuration.deploymentId, configuration.configurationVersion);
      invariant(!this.configurations.has(key), 'SEED_CONFLICT', 'Duplicate configuration seed.');
      this.configurations.set(key, clone(configuration));
      this.configurationFingerprints.set(key, fingerprint(configuration));
    }
    for (const raw of seed.assignments || []) {
      const assignment = validateNumberAssignment(raw);
      invariant(!this.assignments.has(assignment.assignmentId), 'SEED_CONFLICT', 'Duplicate number-assignment seed.');
      this.assignments.set(assignment.assignmentId, clone(assignment));
    }
    this._validateSeedLinks();
  }

  _validateSeedLinks() {
    for (const deployment of this.deployments.values()) {
      const configuration = this.configurations.get(configurationKey(deployment.deploymentId, deployment.configurationVersion));
      invariant(configuration, 'SEED_CONFLICT', 'Deployment configuration is missing.');
      invariant(configuration.clientId === deployment.clientId
        && configuration.coverageMode === deployment.coverageMode,
      'SEED_CONFLICT', 'Deployment and configuration do not agree.');
    }
    for (const assignment of this.assignments.values()) {
      const deployment = this.deployments.get(assignment.deploymentId);
      invariant(deployment, 'SEED_CONFLICT', 'Number assignment deployment is missing.');
      invariant(assignment.clientId === deployment.clientId
        && assignment.configurationVersion === deployment.configurationVersion
        && assignment.agentId === deployment.monitorAgentId,
      'SEED_CONFLICT', 'Number assignment ownership does not agree with deployment.');
    }
  }

  _serialized(operation) {
    const result = this._tail.then(operation, operation);
    this._tail = result.catch(() => undefined);
    return result;
  }

  async findCurrentAssignmentsByNumber(toNumber, atMs) {
    return this._serialized(() => clone([...this.assignments.values()].filter(
      (assignment) => assignment.toNumber === toNumber && isCurrentlyEffective(assignment, atMs),
    )));
  }

  async findHistoricalAssignmentsByNumber(toNumber, atMs) {
    return this._serialized(() => clone([...this.assignments.values()].filter(
      (assignment) => assignment.toNumber === toNumber && intervalContains(assignment, atMs),
    )));
  }

  async findHistoricalAssignmentsByDeployment(deploymentId, agentId, atMs) {
    return this._serialized(() => clone([...this.assignments.values()].filter(
      (assignment) => assignment.deploymentId === deploymentId
        && assignment.agentId === agentId
        && intervalContains(assignment, atMs),
    )));
  }

  async findEligibleDeploymentsByAgent(agentId, atMs) {
    return this._serialized(() => {
      const eligible = [...this.deployments.values()].filter((deployment) => {
        if (deployment.monitorAgentId !== agentId) return false;
        if (deployment.testStatus !== CONTRACT.active_test_status
          || deployment.goLiveApprovalStatus !== CONTRACT.approved_go_live_status) return false;
        if (atMs < Date.parse(deployment.approvedStartAt)) return false;
        if (deployment.expiresAt && atMs >= Date.parse(deployment.expiresAt)) return false;
        return deployment.admittedCallCount < deployment.admissionLimit;
      });
      return clone(eligible);
    });
  }

  async getDeployment(deploymentId) {
    return this._serialized(() => clone(this.deployments.get(deploymentId)));
  }

  async getConfiguration(deploymentId, version) {
    return this._serialized(() => {
      const key = configurationKey(deploymentId, version);
      const configuration = this.configurations.get(key);
      if (configuration) {
        invariant(fingerprint(configuration) === this.configurationFingerprints.get(key),
          'CONFIGURATION_IMMUTABILITY_FAILURE', 'Configuration version was modified in place.');
      }
      return clone(configuration);
    });
  }

  async getAssignment(assignmentId) {
    return this._serialized(() => clone(this.assignments.get(assignmentId)));
  }

  async getAdmission(admissionId) {
    return this._serialized(() => clone(this.admissions.get(admissionId)));
  }

  async findUnboundAdmissionsByAssignment(assignmentId, callStartedAtMs, toleranceMs = 600_000) {
    return this._serialized(() => clone([...this.admissions.values()].filter((admission) => {
      const delta = callStartedAtMs - Date.parse(admission.admittedAt);
      return admission.assignmentId === assignmentId
        && admission.state === 'Reserved'
        && admission.callKey === null
        && delta >= 0
        && delta <= toleranceMs;
    })));
  }

  async claimAdmission(request) {
    return this._serialized(() => {
      invariant(typeof request.correlationId === 'string' && /^corr_[0-9a-f]{32}$/.test(request.correlationId),
        'ADMISSION_CONFLICT', 'Admission correlation ID is invalid.');
      const nowMs = Date.parse(request.now);
      const deployment = this.deployments.get(request.deploymentId);
      const slots = this.admissionSlots.get(request.deploymentId);
      const existing = this.admissions.get(request.admissionId);
      if (existing) {
        invariant(existing.assignmentId === request.assignmentId
          && existing.correlationId === request.correlationId
          && existing.assignmentVersion === request.assignmentVersion
          && existing.deploymentId === request.deploymentId
          && existing.configurationVersion === request.configurationVersion,
        'ADMISSION_CONFLICT', 'Admission identity is already bound to different ownership.');
        invariant(existing.state !== 'ReleasedNoCall', 'ADMISSION_RELEASED_NO_CALL',
          'Authoritatively released admission cannot be revived.');
        return clone({ accepted: true, replay: true, admission: existing, deployment: this.deployments.get(existing.deploymentId) });
      }
      const assignment = this.assignments.get(request.assignmentId);
      const configuration = this.configurations.get(configurationKey(request.deploymentId, request.configurationVersion));
      invariant(deployment && assignment && configuration, 'CONFIGURATION_UNAVAILABLE', 'Required deployment state is missing.');
      invariant(deployment.clientId === request.clientId
        && deployment.configurationVersion === request.configurationVersion
        && assignment.clientId === request.clientId
        && assignment.deploymentId === request.deploymentId
        && assignment.configurationVersion === request.configurationVersion
        && assignment.assignmentVersion === request.assignmentVersion
        && configuration.clientId === request.clientId
        && configuration.approved,
      'CONFIGURATION_UNAVAILABLE', 'Deployment ownership or version is inconsistent.');
      invariant(isCurrentlyEffective(assignment, nowMs), 'CONFIGURATION_UNAVAILABLE', 'Number assignment is not effective.');
      invariant(deployment.testStatus === CONTRACT.active_test_status
        && deployment.goLiveApprovalStatus === CONTRACT.approved_go_live_status,
      'DEPLOYMENT_INACTIVE', 'Deployment is not approved and active.');
      invariant(nowMs >= Date.parse(deployment.approvedStartAt), 'DEPLOYMENT_NOT_STARTED', 'Approved test start has not arrived.');

      invariant(deployment.actualStartAt && deployment.expiresAt,
        'CONFIGURATION_UNAVAILABLE', 'Active deployments require explicit activation timestamps.');
      invariant(nowMs >= Date.parse(deployment.actualStartAt),
        'DEPLOYMENT_NOT_STARTED', 'Actual test start has not arrived.');
      if (nowMs >= Date.parse(deployment.expiresAt)) {
        deployment.testStatus = 'Completed';
        deployment.stopReason = 'seven_day_limit_reached';
        throw new FreeTestError('TEST_EXPIRED', 'The seven-day test has ended.');
      }
      const slot = slots.find((candidate) => candidate.admissionId === null);
      if (!slot || deployment.admittedCallCount >= deployment.admissionLimit) {
        if (deployment.handledCallCount >= deployment.admissionLimit) {
          deployment.testStatus = 'Completed';
          deployment.stopReason = 'call_limit_reached';
          throw new FreeTestError('CALL_LIMIT_REACHED', 'The 25-call test limit has been reached.');
        }
        throw new FreeTestError('ADMISSION_CAPACITY_RESERVED', 'All remaining call capacity is reserved.');
      }
      slot.admissionId = request.admissionId;
      slot.admittedAt = request.now;
      deployment.admittedCallCount += 1;
      const admission = {
        admissionId: request.admissionId,
        correlationId: request.correlationId,
        sourceRevision: request.sourceRevision,
        sourceEnvironment: request.sourceEnvironment,
        slot: slot.slot,
        clientId: request.clientId,
        deploymentId: request.deploymentId,
        configurationVersion: request.configurationVersion,
        assignmentId: request.assignmentId,
        assignmentVersion: request.assignmentVersion,
        admittedAt: request.now,
        callKey: null,
        state: 'Reserved',
        reconciliationState: 'NotRequested',
        reconciliationAttempts: 0,
        reconciliationLeaseToken: 0,
        reconciliationLeaseExpiresAt: null,
        reconciliationEvidenceKey: null,
        reconciliationEvidenceFingerprint: null,
        reconciliationBindingFingerprint: null,
        reconciliationProviderCode: null,
        reconciliationLastErrorCode: null,
        reconciliationObservedAt: null,
        releasedAt: null,
      };
      this.admissions.set(admission.admissionId, admission);
      return clone({ accepted: true, replay: false, admission, deployment });
    });
  }

  async listAdmissionReconciliationCandidates(atIso) {
    return this._serialized(() => {
      const atMs = Date.parse(atIso);
      return clone([...this.admissions.values()].filter((admission) => {
        if (admission.state !== 'Reserved' || admission.callKey !== null
          || admission.reconciliationState === 'CallObserved') return false;
        if (admission.reconciliationState !== 'Checking') return true;
        return Date.parse(admission.reconciliationLeaseExpiresAt) <= atMs;
      }));
    });
  }

  async claimAdmissionReconciliation(admissionId, startedAt) {
    return this._serialized(() => {
      const admission = this.admissions.get(admissionId);
      if (!admission || admission.state !== 'Reserved' || admission.callKey !== null
        || admission.reconciliationState === 'CallObserved') return null;
      if (admission.reconciliationState === 'Checking'
        && Date.parse(startedAt) < Date.parse(admission.reconciliationLeaseExpiresAt)) return null;
      admission.reconciliationAttempts += 1;
      admission.reconciliationLeaseToken = admission.reconciliationAttempts;
      admission.reconciliationState = 'Checking';
      admission.reconciliationLeaseExpiresAt = new Date(
        Date.parse(startedAt) + CONTRACT.admission_reconciliation_lease_ms,
      ).toISOString();
      admission.reconciliationLastErrorCode = null;
      return clone(admission);
    });
  }

  async finishAdmissionReconciliation(admissionId, leaseToken, result) {
    return this._serialized(() => {
      const admission = this.admissions.get(admissionId);
      invariant(admission && admission.state === 'Reserved' && admission.callKey === null
        && admission.reconciliationState === 'Checking'
        && admission.reconciliationLeaseToken === leaseToken,
      'ADMISSION_RECONCILIATION_LEASE_LOST', 'Admission reconciler no longer owns the lease.');
      invariant(result.state === 'RetryRequired' || result.state === 'ReconciliationRequired'
        || result.state === 'CallObserved',
      'INVALID_ADMISSION_RECONCILIATION_EVIDENCE', 'Admission reconciliation result is invalid.');
      admission.reconciliationState = result.state;
      admission.reconciliationLeaseExpiresAt = null;
      admission.reconciliationEvidenceKey = result.evidenceKey || null;
      admission.reconciliationEvidenceFingerprint = result.evidenceFingerprint || null;
      admission.reconciliationBindingFingerprint = result.bindingFingerprint || null;
      admission.reconciliationProviderCode = result.providerResponseCode || null;
      admission.reconciliationLastErrorCode = result.errorCode || null;
      admission.reconciliationObservedAt = result.observedAt || null;
      return clone(admission);
    });
  }

  async releaseAdmissionNoCall(admissionId, leaseToken, evidence, releasedAt) {
    return this._serialized(() => {
      const admission = this.admissions.get(admissionId);
      invariant(admission, 'ADMISSION_RECONCILIATION_CONFLICT', 'Admission does not exist.');
      const evidenceFingerprint = fingerprint(evidence);
      if (admission.state === 'ReleasedNoCall') {
        invariant(admission.reconciliationEvidenceKey === evidence.evidenceKey
          && admission.reconciliationEvidenceFingerprint === evidenceFingerprint
          && admission.reconciliationBindingFingerprint === evidence.bindingFingerprint,
        'ADMISSION_RECONCILIATION_CONFLICT', 'Released admission evidence cannot change.');
        return clone({ replay: true, admission, deployment: this.deployments.get(admission.deploymentId) });
      }
      invariant(admission.state === 'Reserved' && admission.callKey === null
        && admission.reconciliationState === 'Checking'
        && admission.reconciliationLeaseToken === leaseToken,
      'ADMISSION_RECONCILIATION_LEASE_LOST', 'Admission reconciler no longer owns the release lease.');
      invariant(evidence.decision === 'NoCallCreated' && evidence.authoritative === true && evidence.final === true,
        'INVALID_ADMISSION_RECONCILIATION_EVIDENCE', 'Only final provider-authoritative no-call evidence can release capacity.');
      const deployment = this.deployments.get(admission.deploymentId);
      const slots = this.admissionSlots.get(admission.deploymentId);
      const slot = slots && slots.find((candidate) => candidate.slot === admission.slot);
      invariant(deployment && slot && slot.admissionId === admission.admissionId
        && deployment.admittedCallCount > deployment.handledCallCount,
      'ADMISSION_RECONCILIATION_CONFLICT', 'Admission capacity state is inconsistent.');
      slot.admissionId = null;
      slot.admittedAt = null;
      deployment.admittedCallCount -= 1;
      admission.state = 'ReleasedNoCall';
      admission.reconciliationState = 'ReleasedNoCall';
      admission.reconciliationLeaseExpiresAt = null;
      admission.reconciliationEvidenceKey = evidence.evidenceKey;
      admission.reconciliationEvidenceFingerprint = evidenceFingerprint;
      admission.reconciliationBindingFingerprint = evidence.bindingFingerprint;
      admission.reconciliationProviderCode = evidence.providerResponseCode;
      admission.reconciliationLastErrorCode = null;
      admission.reconciliationObservedAt = evidence.observedAt;
      admission.releasedAt = releasedAt;
      return clone({ replay: false, admission, deployment });
    });
  }

  async beginEvent(receipt) {
    return this._serialized(() => {
      const existing = this.receipts.get(receipt.receiptKey);
      if (existing) {
        invariant(existing.fingerprint === receipt.fingerprint, 'EVENT_REPLAY_CONFLICT', 'Event identity was replayed with different content.');
        if (existing.status === 'Completed' || existing.status === 'TerminalFailure') {
          return clone({ duplicate: true, inProgress: false, receipt: existing });
        }
        if (existing.status === 'Processing') {
          if (Date.parse(receipt.receivedAt) < Date.parse(existing.leaseExpiresAt)) {
            return clone({ duplicate: false, inProgress: true, receipt: existing });
          }
          existing.attempts += 1;
          existing.leaseToken = existing.attempts;
          existing.receivedAt = receipt.receivedAt;
          existing.leaseExpiresAt = receipt.leaseExpiresAt;
          return clone({ duplicate: false, inProgress: false, resumed: true, receipt: existing });
        }
        invariant(existing.status === 'RetryRequired' || existing.status === 'ReconciliationRequired',
          'EVENT_STATE_INVALID', 'Event receipt state cannot resume.');
        existing.status = 'Processing';
        existing.attempts += 1;
        existing.leaseToken = existing.attempts;
        existing.receivedAt = receipt.receivedAt;
        existing.leaseExpiresAt = receipt.leaseExpiresAt;
        return clone({ duplicate: false, inProgress: false, resumed: true, receipt: existing });
      }
      const created = {
        ...clone(receipt), status: 'Processing', attempts: 1, leaseToken: 1, lastErrorCode: null,
      };
      this.receipts.set(receipt.receiptKey, created);
      return clone({ duplicate: false, inProgress: false, resumed: false, receipt: created });
    });
  }

  async finishEvent(receiptKey, leaseToken, status, errorCode = null) {
    return this._serialized(() => {
      const receipt = this.receipts.get(receiptKey);
      invariant(receipt, 'EVENT_RECEIPT_MISSING', 'Event receipt is missing.');
      invariant(receipt.status === 'Processing' && receipt.leaseToken === leaseToken,
        'EVENT_LEASE_LOST', 'Event worker no longer owns the processing lease.');
      receipt.status = status;
      receipt.lastErrorCode = errorCode;
      receipt.leaseExpiresAt = null;
      return clone(receipt);
    });
  }

  async updateEventOwnership(receiptKey, leaseToken, ownership) {
    return this._serialized(() => {
      const receipt = this.receipts.get(receiptKey);
      invariant(receipt, 'EVENT_RECEIPT_MISSING', 'Event receipt is missing.');
      invariant(receipt.status === 'Processing' && receipt.leaseToken === leaseToken,
        'EVENT_LEASE_LOST', 'Event worker no longer owns the processing lease.');
      if (receipt.correlationId) {
        invariant(receipt.correlationId === ownership.correlationId
          && receipt.deploymentId === ownership.deploymentId,
        'EVENT_OWNERSHIP_CONFLICT', 'Event receipt ownership cannot change.');
      }
      Object.assign(receipt, clone(ownership));
      return clone(receipt);
    });
  }

  async getCall(callKey) {
    return this._serialized(() => clone(this.calls.get(callKey)));
  }

  async bindCall(callRecord) {
    return this._serialized(() => {
      const existing = this.calls.get(callRecord.callKey);
      if (existing) {
        invariant(existing.clientId === callRecord.clientId
          && existing.deploymentId === callRecord.deploymentId
          && existing.configurationVersion === callRecord.configurationVersion
          && existing.assignmentId === callRecord.assignmentId
          && existing.assignmentVersion === callRecord.assignmentVersion
          && existing.admissionId === callRecord.admissionId,
        'CALL_OWNERSHIP_CONFLICT', 'Existing call ownership cannot be changed.');
        return clone(existing);
      }
      const admission = callRecord.admissionId ? this.admissions.get(callRecord.admissionId) : null;
      invariant(admission, 'CALL_OWNERSHIP_CONFLICT', 'Canonical call requires a durable admission.');
      invariant(admission.state === 'Reserved'
        || (admission.state === 'Handled' && admission.callKey === callRecord.callKey),
      'CALL_OWNERSHIP_CONFLICT', 'Admission is not eligible for call finalization.');
      invariant(admission.deploymentId === callRecord.deploymentId
        && admission.configurationVersion === callRecord.configurationVersion,
      'CALL_OWNERSHIP_CONFLICT', 'Admission and call ownership do not agree.');
      invariant(!admission.callKey || admission.callKey === callRecord.callKey,
        'CALL_OWNERSHIP_CONFLICT', 'Admission is already bound to another call.');
      const deployment = this.deployments.get(callRecord.deploymentId);
      invariant(deployment
        && deployment.handledCallCount < deployment.admissionLimit
        && deployment.handledCallCount < deployment.admittedCallCount,
      'CALL_LIMIT_REACHED', 'Handled-call capacity is unavailable.');
      admission.callKey = callRecord.callKey;
      admission.state = 'Handled';
      admission.reconciliationState = 'CallBound';
      admission.reconciliationLeaseExpiresAt = null;
      const record = { ...clone(callRecord), handledCounted: true };
      this.calls.set(record.callKey, record);
      deployment.handledCallCount += 1;
      if (deployment.handledCallCount >= deployment.admissionLimit) {
        deployment.testStatus = 'Completed';
        deployment.stopReason = 'call_limit_reached';
      }
      return clone(record);
    });
  }

  async updateCall(callKey, patch) {
    return this._serialized(() => {
      const call = this.calls.get(callKey);
      invariant(call, 'CALL_MISSING', 'Canonical call is missing.');
      Object.assign(call, clone(patch));
      return clone(call);
    });
  }

  async updateCallEnd(callKey, endedAt) {
    return this._serialized(() => {
      const call = this.calls.get(callKey);
      invariant(call, 'CALL_MISSING', 'Canonical call is missing.');
      invariant(!call.endedAt || call.endedAt === endedAt,
        'CALL_EVENT_CONFLICT', 'Call end timestamp conflicts with canonical state.');
      call.endedAt = endedAt;
      if (call.processingState !== 'FinalizingWithoutAnalysis') {
        call.processingState = call.analysisReady ? 'Complete' : 'AwaitingAnalysis';
      }
      return clone(call);
    });
  }

  async applyCallAnalysis(callKey, patch) {
    return this._serialized(() => {
      const call = this.calls.get(callKey);
      invariant(call, 'CALL_MISSING', 'Canonical call is missing.');
      invariant(call.processingState !== 'FinalizingWithoutAnalysis'
        && (!call.analysisFinalized || call.analysisSource === 'retell'),
      'LATE_ANALYSIS_AFTER_FINALIZATION', 'Call analysis lost the bounded finalization race.');
      Object.assign(call, clone(patch));
      return clone(call);
    });
  }

  async listIncompleteCallsDue(cutoffIso) {
    return this._serialized(() => clone([...this.calls.values()].filter((call) => call.endedAt
      && (call.processingState === 'AwaitingAnalysis' || call.processingState === 'FinalizingWithoutAnalysis')
      && Date.parse(call.endedAt) <= Date.parse(cutoffIso))));
  }

  async claimIncompleteCall(callKey, cutoffIso, startedAt) {
    return this._serialized(() => {
      const call = this.calls.get(callKey);
      if (!call || !call.endedAt || Date.parse(call.endedAt) > Date.parse(cutoffIso)) return null;
      if (call.processingState === 'FinalizingWithoutAnalysis') {
        if (Date.parse(startedAt) < Date.parse(call.finalizationLeaseExpiresAt)) return null;
      } else if (call.processingState !== 'AwaitingAnalysis') return null;
      call.processingState = 'FinalizingWithoutAnalysis';
      call.finalizationStartedAt = startedAt;
      call.finalizationLeaseExpiresAt = new Date(Date.parse(startedAt) + CONTRACT.event_processing_lease_ms).toISOString();
      return clone(call);
    });
  }

  async finalizeCallWithoutAnalysis(callKey) {
    return this._serialized(() => {
      const call = this.calls.get(callKey);
      invariant(call && call.processingState === 'FinalizingWithoutAnalysis',
      'CALL_FINALIZATION_CONFLICT', 'Call acquired analysis before unresolved finalization.');
      if (call.analysisFinalized && call.analysisSource === 'bounded_no_analysis') return clone(call);
      invariant(!call.analysisReady && !call.analysisFinalized,
        'CALL_FINALIZATION_CONFLICT', 'Call acquired analysis before unresolved finalization.');
      call.outcome = 'unresolved';
      call.analysisFinalized = true;
      call.analysisSource = 'bounded_no_analysis';
      return clone(call);
    });
  }

  async ensureNotification(record) {
    return this._serialized(() => {
      const existing = this.notifications.get(record.notificationId);
      if (existing) {
        invariant(existing.clientId === record.clientId
          && existing.deploymentId === record.deploymentId
          && existing.configurationVersion === record.configurationVersion
          && existing.callKey === record.callKey
          && existing.correlationId === record.correlationId
          && existing.recipientId === record.recipientId
          && existing.sourceRevision === record.sourceRevision
          && existing.sourceEnvironment === record.sourceEnvironment
          && fingerprint(existing.payload) === fingerprint(record.payload),
          'NOTIFICATION_OWNERSHIP_CONFLICT', 'Notification ownership cannot change.');
        return clone(existing);
      }
      this.notifications.set(record.notificationId, clone(record));
      return clone(record);
    });
  }

  async updateNotification(notificationId, patch) {
    return this._serialized(() => {
      const notification = this.notifications.get(notificationId);
      invariant(notification, 'NOTIFICATION_MISSING', 'Notification is missing.');
      Object.assign(notification, clone(patch));
      return clone(notification);
    });
  }

  async ensureOutbox(record) {
    return this._serialized(() => {
      const existing = this.outbox.get(record.outboxId);
      if (existing) {
        invariant(existing.clientId === record.clientId
          && existing.deploymentId === record.deploymentId
          && existing.configurationVersion === record.configurationVersion
          && existing.callKey === record.callKey
          && existing.correlationId === record.correlationId
          && existing.sourceRevision === record.sourceRevision
          && existing.sourceEnvironment === record.sourceEnvironment
          && fingerprint(existing.projection) === fingerprint(record.projection),
        'OUTBOX_OWNERSHIP_CONFLICT', 'Reporting outbox ownership or projection cannot change.');
        return clone(existing);
      }
      this.outbox.set(record.outboxId, clone(record));
      return clone(record);
    });
  }

  async getOutbox(outboxId) {
    return this._serialized(() => clone(this.outbox.get(outboxId)));
  }

  async updateOutbox(outboxId, patch) {
    return this._serialized(() => {
      const outbox = this.outbox.get(outboxId);
      invariant(outbox, 'OUTBOX_MISSING', 'Reporting outbox record is missing.');
      Object.assign(outbox, clone(patch));
      return clone(outbox);
    });
  }

  async retireAndAssignNumber({ retiredAssignmentId, retiredAt, replacement }) {
    return this._serialized(() => {
      const retired = this.assignments.get(retiredAssignmentId);
      invariant(retired && retired.status === 'Active', 'ASSIGNMENT_NOT_ACTIVE', 'Prior number assignment is not active.');
      const next = validateNumberAssignment(replacement);
      invariant(!this.assignments.has(next.assignmentId), 'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement assignment ID already exists.');
      invariant(new Date(Date.parse(retiredAt)).toISOString() === retiredAt
        && Date.parse(retiredAt) === this._now()
        && Date.parse(retiredAt) > Date.parse(retired.effectiveFrom),
      'ASSIGNMENT_REPLACEMENT_INVALID', 'Number reassignment must execute at a current non-zero cutover.');
      const targetDeployment = this.deployments.get(next.deploymentId);
      const targetConfiguration = this.configurations.get(configurationKey(next.deploymentId, next.configurationVersion));
      const maxVersion = Math.max(...[...this.assignments.values()]
        .filter((assignment) => assignment.toNumber === retired.toNumber)
        .map((assignment) => assignment.assignmentVersion));
      invariant(next.toNumber === retired.toNumber
        && Date.parse(next.effectiveFrom) === Date.parse(retiredAt)
        && next.assignmentVersion === maxVersion + 1
        && next.status === 'Active'
        && next.effectiveTo === null,
      'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement must atomically continue the same number with a newer version.');
      invariant(targetDeployment && targetConfiguration
        && targetDeployment.clientId === next.clientId
        && targetDeployment.configurationVersion === next.configurationVersion
        && targetDeployment.monitorAgentId === next.agentId
        && targetConfiguration.clientId === next.clientId
        && targetConfiguration.approved,
      'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement target deployment/configuration is inconsistent.');
      invariant(targetDeployment.testStatus === CONTRACT.active_test_status
        && targetDeployment.goLiveApprovalStatus === CONTRACT.approved_go_live_status
        && targetDeployment.actualStartAt
        && targetDeployment.expiresAt
        && this._now() >= Date.parse(targetDeployment.approvedStartAt)
        && this._now() >= Date.parse(targetDeployment.actualStartAt)
        && this._now() < Date.parse(targetDeployment.expiresAt)
        && targetDeployment.stopReason === null
        && targetDeployment.admittedCallCount < targetDeployment.admissionLimit
        && targetDeployment.handledCallCount < targetDeployment.admissionLimit,
      'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement target deployment is not currently eligible for admission.');
      const existingTargetNumber = [...this.assignments.values()].some((assignment) => assignment.assignmentId !== retiredAssignmentId
        && assignment.deploymentId === next.deploymentId
        && assignment.status === 'Active');
      invariant(!existingTargetNumber, 'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement target already has an active number assignment.');
      const nextStart = Date.parse(next.effectiveFrom);
      const overlap = [...this.assignments.values()].some((assignment) => {
        if (assignment.assignmentId === retiredAssignmentId || assignment.toNumber !== next.toNumber) return false;
        const existingStart = Date.parse(assignment.effectiveFrom);
        const existingEnd = assignment.effectiveTo ? Date.parse(assignment.effectiveTo) : Infinity;
        return existingStart < Infinity && nextStart < existingEnd;
      });
      invariant(!overlap, 'ASSIGNMENT_REPLACEMENT_INVALID', 'Replacement overlaps another number assignment.');
      retired.status = 'Retired';
      retired.effectiveTo = retiredAt;
      this.assignments.set(next.assignmentId, clone(next));
      return clone(next);
    });
  }

  async snapshot() {
    return this._serialized(() => clone({
      deployments: [...this.deployments.values()],
      configurations: [...this.configurations.values()],
      assignments: [...this.assignments.values()],
      admissions: [...this.admissions.values()],
      receipts: [...this.receipts.values()],
      calls: [...this.calls.values()],
      notifications: [...this.notifications.values()],
      outbox: [...this.outbox.values()],
    }));
  }
}

module.exports = { MemoryStore, intervalContains, isCurrentlyEffective };
