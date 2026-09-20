'use strict';

// Fictional evidence only. No provider account, actual setting, credential or
// approval is represented by this fixture's references or content digests.
function providerTimingFixture(configuration, overrides = {}) {
  return {
    schemaVersion: 1, evidenceClass: 'owner_attested_provider_readback',
    clientId: configuration.clientId, crmDealId: configuration.crmDealId,
    deploymentId: configuration.deploymentId,
    configurationVersion: configuration.configurationVersion,
    businessNumber: '+19135550101', phoneSystemProvider: configuration.phoneSystemProvider,
    coverageMode: configuration.coverageMode, submittedPreference: '5 Rings',
    settingName: 'synthetic_no_answer_delay', value: '27.5', unit: 'seconds',
    observedAt: '2026-09-09T11:58:00.000Z', ownerAcceptedAt: '2026-09-09T11:59:00.000Z',
    ownerDecision: 'accept_exact_provider_setting',
    evidenceReference: 'synthetic_provider_readback', evidenceSha256: 'a'.repeat(64),
    documentationReference: 'synthetic_provider_documentation', documentationSha256: 'b'.repeat(64),
    ...overrides,
  };
}

module.exports = { providerTimingFixture };
