"use strict";

const { FieldSetupDispatchError, createFieldSetupDispatcher } = require("./field-setup-dispatcher");
const { createFieldSetupConversionService } = require("./field-setup-conversion");
const { createFieldSetupLaunchService, resumeBindingDigest } = require("./field-setup-launch");
const {
  createDefaultDeniedFieldSetupStoreComposition,
  createInjectedFieldSetupStoreComposition,
} = require("./field-setup-store");

function createDefaultDeniedFieldSetupComposition() {
  const stores = createDefaultDeniedFieldSetupStoreComposition();
  return Object.freeze({
    status: "NOT_READY",
    catalystHeaderMapping: "NOT_READY_INJECTED_ONLY",
    catalystIdentityMapping: "NOT_READY_INJECTED_ONLY",
    catalystStoreMapping: stores.catalystMapping,
    deploymentAuthorized: false,
    runtimeAuthority: false,
    assertNoRouteCollision() {},
    claimsRequest() { return false; },
    async dispatch() {
      throw new FieldSetupDispatchError("Field-setup routes are not registered", {
        status: 404,
        publicCode: "route_not_found",
      });
    },
  });
}

function createInjectedFieldSetupComposition({
  authenticatedOperatorResolver,
  controlledConversionDefaults,
  conversionCrm,
  conversionStore,
  dispatcherConfig,
  launchConfig,
  launchStore,
  now,
  randomBytes,
  randomUUID,
  serverPrerequisiteResolver,
} = {}) {
  if (launchStore !== conversionStore) {
    throw new FieldSetupDispatchError(
      "Field-setup launch and conversion must use one authoritative journey store",
      { publicCode: "configuration_invalid" },
    );
  }
  const stores = createInjectedFieldSetupStoreComposition({ launchStore, conversionStore });
  const launchService = createFieldSetupLaunchService({
    config: launchConfig,
    store: stores.launchStore,
    now,
    randomBytes,
    randomUUID,
    serverPrerequisiteResolver,
  });
  const conversionService = createFieldSetupConversionService({
    crm: conversionCrm,
    store: stores.conversionStore,
  });
  const dispatcher = createFieldSetupDispatcher({
    authenticatedOperatorResolver,
    config: dispatcherConfig,
    controlledConversionDefaults,
    conversionService,
    dealResumeBindingDigest: ({ dealId, environment }) => resumeBindingDigest({
      environment,
      moduleApiName: "Deals",
      recordId: dealId,
    }, launchConfig.digestPepper),
    launchService,
  });
  return Object.freeze({
    ...dispatcher,
    catalystStoreMapping: stores.catalystMapping,
  });
}

module.exports = {
  createDefaultDeniedFieldSetupComposition,
  createInjectedFieldSetupComposition,
};
