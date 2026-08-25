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
        return "loading_session_validation";
      }

      const stored = storage.getItem(STORAGE_KEY);
      return stored ? stateModel.getState(stored).id : "loading_session_validation";
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
          return syntheticOutcome("launch_exchange_unavailable", "recoverable_blocked");
        }

        const requestedState = previewState || readSafeState();
        return syntheticOutcome("load_source_preview", stateModel.getState(requestedState).id);
      },

      completeStep({ stateId, actionId }) {
        const state = stateModel.getState(stateId);
        if (state.id === "operator_qualification_review" || state.primaryAction.id !== actionId) {
          return syntheticOutcome("invalid_primary_action", "recoverable_blocked");
        }
        return syntheticOutcome(actionId, state.primaryAction.syntheticNextState);
      },

      submitOperatorDecision({ stateId, actionId, qualification }) {
        const state = stateModel.getState(stateId);
        const permittedAction = [state.primaryAction, ...state.secondaryActions]
          .find((candidate) => candidate.id === actionId);

        if (!permittedAction || state.id !== "operator_qualification_review") {
          return syntheticOutcome("invalid_operator_decision", "recoverable_blocked");
        }
        try {
          stateModel.normalizeQualificationPayload(actionId, qualification);
        } catch (_error) {
          return syntheticOutcome("invalid_qualification_payload", "recoverable_blocked");
        }
        return syntheticOutcome(actionId, permittedAction.syntheticNextState);
      },

      requestStop() {
        return syntheticOutcome("stop_source_preview", "stop_rollback_status");
      }
    });
  }

  return Object.freeze({
    SYNTHETIC_MODE,
    createSyntheticApi
  });
});
