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
  let currentState = model.getState("session-validation");
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
      const isQualification = currentState.id === "operator-qualification-review";
      const outcome = isQualification
        ? await api.submitOperatorDecision({ stateId: currentState.id, actionId: action.id })
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
    renderQualification(state.qualificationCriteria);
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

  function renderQualification(criteria) {
    if (criteria.length === 0) {
      elements.qualification.hidden = true;
      elements.qualification.replaceChildren();
      return;
    }

    const heading = documentLike.createElement("h2");
    heading.textContent = "Qualification conditions";
    const list = documentLike.createElement("ul");
    list.className = "qualification-list";
    list.setAttribute("aria-label", "Qualification conditions requiring operator review");
    replaceListItems(list, criteria);
    elements.qualification.replaceChildren(heading, list);
    elements.qualification.hidden = false;
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
