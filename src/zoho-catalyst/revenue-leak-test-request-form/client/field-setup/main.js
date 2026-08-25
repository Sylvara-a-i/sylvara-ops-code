(function startFieldSetupJourney(root, documentLike) {
  "use strict";

  if (!root || !documentLike || !root.FieldSetupStateModel || !root.FieldSetupApi || !root.FieldSetupLaunch) {
    return;
  }

  const model = root.FieldSetupStateModel;
  const api = root.FieldSetupApi.createSyntheticApi({
    stateModel: model,
    storage: safeSessionStorage(root)
  });
  const elements = readElements(documentLike);
  let currentState = model.getState("loading_session_validation");
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
    setBusy(true, "Checking source preview");
    const launchNonce = root.FieldSetupLaunch.consumeLaunchNonce();

    try {
      const outcome = await api.loadJourney({
        launchNonce,
        previewState: previewStateFromQuery(root.location)
      });
      render(model.getState(outcome.nextState), false);
    } catch (_error) {
      showRecoverableError("The source preview could not initialize. Retry validation or stop setup safely.");
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
      render(model.getState(outcome.nextState), true);
    } catch (_error) {
      showRecoverableError("The step was not saved. No authoritative action was assumed complete.");
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
      render(model.getState(outcome.nextState), true);
    } catch (_error) {
      showRecoverableError("The stop request was not saved. Use the separate controlled rollback path.");
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
    elements.primary.disabled = nextBusy;
    elements.stop.disabled = nextBusy;
    for (const button of elements.decisions.querySelectorAll("button")) {
      button.disabled = nextBusy;
    }
    if (!nextBusy) {
      syncQualificationPrimary();
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
})(typeof window === "object" ? window : undefined, typeof document === "object" ? document : undefined);
