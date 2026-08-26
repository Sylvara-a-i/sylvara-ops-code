(function startFieldSetupJourney(root, documentLike) {
  "use strict";

  if (!root || !documentLike || !root.FieldSetupStateModel || !root.FieldSetupApi || !root.FieldSetupLaunch) {
    return;
  }

  const model = root.FieldSetupStateModel;
  const storage = safeSessionStorage(root);
  let apiConfigurationError = false;
  let api;
  try {
    api = root.FieldSetupApi.createApi({
      fetchImpl: typeof root.fetch === "function" ? root.fetch.bind(root) : undefined,
      runtime: root.FieldSetupRuntimeConfig,
      stateModel: model,
      storage
    });
  } catch (_error) {
    apiConfigurationError = true;
    api = root.FieldSetupApi.createSyntheticApi({ stateModel: model, storage });
  }
  const elements = readElements(documentLike);
  let currentState = model.getState("loading_session_validation");
  let currentStepReady = true;
  let busy = false;

  render(currentState, false);
  bindActions();
  loadInitialState();

  function safeSessionStorage(windowLike) {
    try {
      return windowLike.sessionStorage;
    } catch (_error) {
      return null;
    }
  }

  function readElements(doc) {
    return Object.freeze({
      progressCopy: doc.getElementById("progress-copy"),
      progressTrack: doc.getElementById("progress-track"),
      progressFill: doc.getElementById("progress-fill"),
      sourceBadge: doc.getElementById("source-badge"),
      audienceBadge: doc.getElementById("audience-badge"),
      stepStatus: doc.getElementById("step-status"),
      stepKicker: doc.getElementById("step-kicker"),
      title: doc.getElementById("step-title"),
      description: doc.getElementById("step-description"),
      notice: doc.getElementById("step-notice"),
      details: doc.getElementById("step-details"),
      qualification: doc.getElementById("qualification-panel"),
      error: doc.getElementById("error-message"),
      primary: doc.getElementById("primary-action"),
      decisions: doc.getElementById("decision-actions"),
      stop: doc.getElementById("stop-action"),
      announcer: doc.getElementById("live-announcer")
    });
  }

  function previewStateFromQuery(locationLike) {
    const parameters = new URLSearchParams(locationLike.search || "");
    const requested = parameters.get("preview");
    return requested ? model.getState(requested).id : null;
  }

  async function loadInitialState() {
    if (apiConfigurationError) {
      render(model.getState("recoverable_blocked"), false);
      showRecoverableError("Authenticated source wiring is invalid. No journey request was sent.");
      return;
    }
    setBusy(true, api.mode === root.FieldSetupApi.AUTHENTICATED_MODE
      ? "Checking secure setup session"
      : "Checking source preview");
    const launchNonce = root.FieldSetupLaunch.consumeLaunchNonce();

    try {
      const outcome = api.mode === root.FieldSetupApi.AUTHENTICATED_MODE
        ? await api.loadJourney({ launchNonce })
        : await api.loadJourney({
          launchNonce,
          previewState: previewStateFromQuery(root.location)
        });
      await renderOutcome(outcome, false);
    } catch (error) {
      showRequestError(
        error,
        "The source preview could not initialize. Retry validation or stop setup safely."
      );
    } finally {
      setBusy(false);
    }
  }

  function bindActions() {
    elements.primary.addEventListener("click", () => runStateAction(currentState.primaryAction));
    elements.stop.addEventListener("click", requestStop);
  }

  async function runStateAction(action) {
    if (busy) {
      return;
    }

    setBusy(true, "Saving source-preview progress");
    clearError();

    try {
      const isQualification = currentState.id === "operator_qualification_review";
      const outcome = isQualification
        ? await api.submitOperatorDecision({
          stateId: currentState.id,
          actionId: action.id,
          qualification: collectQualificationPayload(action)
        })
        : await api.completeStep({ stateId: currentState.id, actionId: action.id });
      await renderOutcome(outcome, true);
      followNavigationIntent(outcome.navigationIntent);
    } catch (error) {
      showRequestError(
        error,
        "The step outcome could not be confirmed. Retry the same action or stop setup safely."
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestStop() {
    if (busy) {
      return;
    }

    setBusy(true, "Recording a source-preview stop request");
    clearError();

    try {
      const outcome = await api.requestStop();
      await renderOutcome(outcome, true);
    } catch (error) {
      showRequestError(
        error,
        "The stop outcome could not be confirmed. Retry Stop Setup to reconcile authoritative state; use controlled rollback only if instructed."
      );
    } finally {
      setBusy(false);
    }
  }

  function render(state, moveFocus) {
    currentState = state;
    const stepNumber = model.getStateIndex(state.id) + 1;
    const percent = (stepNumber / model.FIELD_SETUP_STATES.length) * 100;

    elements.progressCopy.textContent = `Step ${stepNumber} of ${model.FIELD_SETUP_STATES.length}`;
    elements.progressTrack.setAttribute("aria-valuenow", String(stepNumber));
    elements.progressFill.style.width = `${percent.toFixed(2)}%`;
    elements.audienceBadge.textContent = state.audience;
    elements.sourceBadge.textContent = api.mode === root.FieldSetupApi.AUTHENTICATED_MODE
      ? "Authenticated candidate"
      : "Source preview";
    elements.stepStatus.textContent = state.status;
    elements.stepKicker.textContent = state.kicker;
    elements.title.textContent = state.name;
    elements.description.textContent = state.description;
    elements.notice.textContent = state.notice;
    elements.primary.textContent = state.primaryAction.label;

    replaceListItems(elements.details, state.details);
    renderQualification(state.qualificationFactors);
    renderSecondaryActions(state.secondaryActions);
    clearError();

    elements.announcer.textContent = `${state.name}. ${state.status}.`;
    if (moveFocus) {
      elements.title.focus();
    }
  }

  async function renderOutcome(outcome, moveFocus) {
    const state = model.getState(outcome.nextState);
    currentStepReady = false;
    render(state, moveFocus);
    const stepData = await api.loadStepData({ stateId: state.id });
    if (stepData !== null) {
      if (
        typeof stepData !== "object" ||
        stepData.ready !== true ||
        !Array.isArray(stepData.details) ||
        typeof stepData.status !== "string"
      ) {
        throw new Error("Authoritative step data is invalid.");
      }
      replaceListItems(elements.details, stepData.details);
      elements.stepStatus.textContent = stepData.status;
    }
    currentStepReady = true;
  }

  function followNavigationIntent(intent) {
    if (!intent) return;
    if (
      intent.mode !== "top_level" ||
      typeof intent.url !== "string" ||
      !root.location ||
      typeof root.location.assign !== "function"
    ) {
      throw new Error("Approved top-level navigation is unavailable.");
    }
    root.location.assign(intent.url);
  }

  function replaceListItems(listElement, values) {
    listElement.replaceChildren(...values.map((value) => {
      const item = documentLike.createElement("li");
      item.textContent = value;
      return item;
    }));
  }

  function renderQualification(factors) {
    if (factors.length === 0) {
      elements.qualification.hidden = true;
      elements.qualification.replaceChildren();
      return;
    }

    const fieldset = documentLike.createElement("fieldset");
    fieldset.className = "qualification-fieldset";
    const legend = documentLike.createElement("legend");
    legend.textContent = "Qualification conditions";
    const options = documentLike.createElement("div");
    options.className = "qualification-list";
    for (const factor of factors) {
      const option = documentLike.createElement("div");
      option.className = "qualification-option";
      const checkbox = documentLike.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `qualification-${factor.id}`;
      checkbox.setAttribute("data-qualification-factor", factor.id);
      checkbox.addEventListener("change", syncQualificationPrimary);
      const label = documentLike.createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = factor.label;
      option.append(checkbox, label);
      options.append(option);
    }
    fieldset.append(legend, options);
    elements.qualification.replaceChildren(fieldset);
    elements.qualification.hidden = false;
    syncQualificationPrimary();
  }

  function collectQualificationPayload(action) {
    const payload = {};
    for (const factor of model.QUALIFICATION_FACTORS) {
      const input = elements.qualification.querySelector(
        `input[data-qualification-factor="${factor.id}"]`
      );
      payload[factor.id] = input ? input.checked === true : false;
    }
    payload.decision = action.qualificationDecision;
    return payload;
  }

  function syncQualificationPrimary() {
    if (busy || currentState.id !== "operator_qualification_review") {
      return;
    }
    const inputs = elements.qualification.querySelectorAll("input[data-qualification-factor]");
    elements.primary.disabled = inputs.length !== model.QUALIFICATION_FACTORS.length ||
      [...inputs].some((input) => input.checked !== true);
  }

  function renderSecondaryActions(actions) {
    const buttons = actions.map((action) => {
      const button = documentLike.createElement("button");
      button.type = "button";
      button.className = "button button-secondary";
      button.textContent = action.label;
      button.addEventListener("click", () => runStateAction(action));
      return button;
    });
    elements.decisions.replaceChildren(...buttons);
  }

  function setBusy(nextBusy, statusText) {
    busy = nextBusy;
    elements.primary.disabled = nextBusy || !currentStepReady;
    elements.stop.disabled = nextBusy;
    for (const button of elements.decisions.querySelectorAll("button")) {
      button.disabled = nextBusy || !currentStepReady;
    }
    if (!nextBusy) {
      syncQualificationPrimary();
      if (!currentStepReady) elements.primary.disabled = true;
    }
    if (statusText) {
      elements.announcer.textContent = statusText;
    }
  }

  function clearError() {
    elements.error.textContent = "";
    elements.error.hidden = true;
  }

  function showRecoverableError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
    elements.error.focus?.();
    elements.announcer.textContent = message;
  }

  function showRequestError(error, fallbackMessage) {
    if (
      error &&
      error.operatorStop === true &&
      typeof error.operatorMessage === "string" &&
      error.operatorMessage.length > 0
    ) {
      currentStepReady = false;
      showRecoverableError(error.operatorMessage);
      elements.primary.disabled = true;
      for (const button of elements.decisions.querySelectorAll("button")) {
        button.disabled = true;
      }
      return;
    }
    showRecoverableError(fallbackMessage);
  }
})(typeof window === "object" ? window : undefined, typeof document === "object" ? document : undefined);
