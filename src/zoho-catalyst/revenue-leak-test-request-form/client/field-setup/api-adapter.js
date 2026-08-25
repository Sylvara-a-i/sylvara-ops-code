(function exposeFieldSetupApi(root, factory) {
  const contract = factory(root && root.FieldSetupStateModel);

  if (typeof module === "object" && module.exports) {
    module.exports = contract;
  }

  if (root) {
    root.FieldSetupApi = contract;
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createFieldSetupApiContract(browserStateModel) {
  "use strict";

  const SYNTHETIC_MODE = "synthetic_source_preview";
  const STORAGE_KEY = "sylvara_field_setup_preview_state";

  function resolveStateModel(override) {
    const stateModel = override || browserStateModel;
    if (!stateModel || typeof stateModel.getState !== "function") {
      throw new Error("Field setup state model is unavailable.");
    }
    return stateModel;
  }

  function createSyntheticApi(options = {}) {
    const stateModel = resolveStateModel(options.stateModel);
    const storage = options.storage || null;

    function persistSafeState(stateId) {
      const canonical = stateModel.getState(stateId);
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(STORAGE_KEY, canonical.id);
      }
      return canonical.id;
    }

    function readSafeState() {
      if (!storage || typeof storage.getItem !== "function") {
        return "session-validation";
      }

      const stored = storage.getItem(STORAGE_KEY);
      return stored ? stateModel.getState(stored).id : "session-validation";
    }

    function syntheticOutcome(actionId, requestedNextState) {
      const nextState = persistSafeState(requestedNextState);
      return Promise.resolve(Object.freeze({
        mode: SYNTHETIC_MODE,
        actionId,
        nextState,
        authoritative: false
      }));
    }

    return Object.freeze({
      mode: SYNTHETIC_MODE,

      loadJourney({ launchNonce, previewState } = {}) {
        if (launchNonce) {
          return syntheticOutcome("launch-exchange-unavailable", "recoverable-blocked");
        }

        const requestedState = previewState || readSafeState();
        return syntheticOutcome("load-source-preview", stateModel.getState(requestedState).id);
      },

      completeStep({ stateId, actionId }) {
        const state = stateModel.getState(stateId);
        if (state.primaryAction.id !== actionId) {
          return syntheticOutcome("invalid-primary-action", "recoverable-blocked");
        }
        return syntheticOutcome(actionId, state.primaryAction.syntheticNextState);
      },

      submitOperatorDecision({ stateId, actionId }) {
        const state = stateModel.getState(stateId);
        const permittedAction = [state.primaryAction, ...state.secondaryActions]
          .find((candidate) => candidate.id === actionId);

        if (!permittedAction || state.id !== "operator-qualification-review") {
          return syntheticOutcome("invalid-operator-decision", "recoverable-blocked");
        }
        return syntheticOutcome(actionId, permittedAction.syntheticNextState);
      },

      requestStop() {
        return syntheticOutcome("stop-source-preview", "stop-rollback-status");
      }
    });
  }

  return Object.freeze({
    SYNTHETIC_MODE,
    createSyntheticApi
  });
});
