"use strict";

const LAUNCH_STORE_METHODS = Object.freeze([
  "issueLaunch",
  "consumeLaunch",
  "readBySessionDigest",
  "compareAndSetJourney",
]);
const CONVERSION_STORE_METHODS = Object.freeze([
  "claimConversion",
  "completeConversion",
  "createPreview",
  "markReconciliationRequired",
  "markWriteStarted",
]);

class FieldSetupStoreCompositionError extends Error {
  constructor(message) {
    super(message);
    this.name = "FieldSetupStoreCompositionError";
    this.status = 503;
    this.publicCode = "configuration_invalid";
  }
}

function scopedStore(adapter, methods, label) {
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) {
    throw new FieldSetupStoreCompositionError(`${label} adapter is unavailable`);
  }
  const scoped = Object.create(null);
  for (const method of methods) {
    if (typeof adapter[method] !== "function") {
      throw new FieldSetupStoreCompositionError(`${label} adapter is missing ${method}`);
    }
    // The wrapper prevents either service from reaching an unreviewed method on the
    // eventual Catalyst adapter and preserves the adapter's receiver explicitly.
    scoped[method] = (...args) => adapter[method](...args);
  }
  return Object.freeze(scoped);
}

function createDefaultDeniedFieldSetupStoreComposition() {
  return Object.freeze({
    status: "NOT_READY",
    catalystMapping: "NOT_READY_INJECTED_ONLY",
    deploymentAuthorized: false,
    launchStore: null,
    conversionStore: null,
  });
}

function createInjectedFieldSetupStoreComposition({ launchStore, conversionStore } = {}) {
  return Object.freeze({
    status: "NOT_READY",
    catalystMapping: "NOT_READY_INJECTED_ONLY",
    deploymentAuthorized: false,
    launchStore: scopedStore(launchStore, LAUNCH_STORE_METHODS, "Field-setup launch store"),
    conversionStore: conversionStore === undefined
      ? null
      : scopedStore(conversionStore, CONVERSION_STORE_METHODS, "Field-setup conversion store"),
  });
}

module.exports = {
  CONVERSION_STORE_METHODS,
  FieldSetupStoreCompositionError,
  LAUNCH_STORE_METHODS,
  createDefaultDeniedFieldSetupStoreComposition,
  createInjectedFieldSetupStoreComposition,
};
