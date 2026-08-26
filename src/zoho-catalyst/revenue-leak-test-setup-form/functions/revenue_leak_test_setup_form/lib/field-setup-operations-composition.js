"use strict";

const {
  FieldSetupOperationsDispatchError,
  createFieldSetupOperationsDispatcher,
} = require("./field-setup-operations-dispatcher");

const INJECTED_ONLY = "NOT_READY_INJECTED_ONLY";

function createDefaultDeniedFieldSetupOperationsComposition() {
  return Object.freeze({
    status: "NOT_READY",
    catalystHeaderMapping: INJECTED_ONLY,
    catalystIdentityMapping: INJECTED_ONLY,
    catalystStoreMapping: INJECTED_ONLY,
    deploymentAuthorized: false,
    runtimeAuthority: false,
    assertNoRouteCollision() {},
    claimsRequest() { return false; },
    async dispatch() {
      throw new FieldSetupOperationsDispatchError(
        "Field-setup operation routes are not registered",
        { status: 404, publicCode: "route_not_found" },
      );
    },
  });
}

function bindMethod(owner, name) {
  if (typeof owner?.[name] !== "function") return null;
  return (...argumentsList) => owner[name](...argumentsList);
}

function createInjectedFieldSetupOperationsComposition({
  authenticatedSetupResolver,
  config,
  forwardingRegistry,
  stateCoordinator,
  windowKeyFactory,
  now,
} = {}) {
  // One coordinator owns every state-changing compare-and-set boundary. This
  // makes a committed Stop visible to number claims and verification-window
  // issuance in the same authoritative transaction domain. Provider purchase,
  // live route mutation, activation, and window consumption remain absent.
  const exactStateCoordinator = Object.freeze({
    readNumberReservationStatus: bindMethod(
      stateCoordinator,
      "readNumberReservationStatus",
    ),
    readNumberReservationReceiptByOperationFingerprint: bindMethod(
      stateCoordinator,
      "readNumberReservationReceiptByOperationFingerprint",
    ),
    claimExistingAvailableNumberWithControlFenceAtomically: bindMethod(
      stateCoordinator,
      "claimExistingAvailableNumberWithControlFenceAtomically",
    ),
    issueWindowWithControlFenceAtomically: bindMethod(
      stateCoordinator,
      "issueWindowWithControlFenceAtomically",
    ),
    readLatestWindowByOperationScopeFingerprint: bindMethod(
      stateCoordinator,
      "readLatestWindowByOperationScopeFingerprint",
    ),
    applyControlIntentAtomically: bindMethod(
      stateCoordinator,
      "applyControlIntentAtomically",
    ),
    readControlOperationByOperationFingerprint: bindMethod(
      stateCoordinator,
      "readControlOperationByOperationFingerprint",
    ),
  });

  return createFieldSetupOperationsDispatcher({
    authenticatedSetupResolver,
    config,
    forwardingRegistry,
    stateCoordinator: exactStateCoordinator,
    windowKeyFactory,
    now,
  });
}

module.exports = {
  createDefaultDeniedFieldSetupOperationsComposition,
  createInjectedFieldSetupOperationsComposition,
};
