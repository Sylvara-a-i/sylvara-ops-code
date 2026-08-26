(function exposeFieldSetupApi(root, factory) {
  const contract = factory(root && root.FieldSetupStateModel, root);

  if (typeof module === "object" && module.exports) {
    module.exports = contract;
  }

  if (root) {
    root.FieldSetupApi = contract;
  }
})(typeof globalThis === "object" ? globalThis : undefined, function createFieldSetupApiContract(
  browserStateModel,
  browserRoot
) {
  "use strict";

  const SYNTHETIC_MODE = "synthetic_source_preview";
  const AUTHENTICATED_MODE = "authenticated_same_origin_candidate";
  const PREVIEW_STORAGE_KEY = "sylvara_field_setup_preview_state";
  const CSRF_STORAGE_KEY = "sylvara_field_setup_csrf_v1";
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const HEADER_PATTERN = /^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
  const PATH_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/;
  const FORM_TARGET_BY_ACTION = Object.freeze({
    open_form1: "form1",
    open_form2: "form2",
    resume_form1: "form1",
    resume_form2: "form2"
  });
  const GLOBAL_NEXT_STATE_BY_ACTION = Object.freeze({
    stop_setup: "stop_rollback_status"
  });
  const FORM_QUERY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
  const FORM_QUERY_VALUE_PATTERN = /^(?=.*[A-Za-z_-])[A-Za-z0-9_-]{16,256}$/;
  const PROHIBITED_FORM_QUERY_KEY_PATTERN = /(?:redirect|return|next|url|email|phone|crm|record|lead|deal|account|contact|user)/i;
  const REQUEST_TIMEOUT_MS = 10000;
  const PROTOCOL_ID_HEADER = "x-sylvara-field-setup-protocol-id";
  const PROTOCOL_VERSION_HEADER = "x-sylvara-field-setup-protocol-version";
  const OPERATOR_STOP_MESSAGES = Object.freeze({
    reconciliation_required: "Conversion outcome requires controlled reconciliation. Do not retry conversion.",
    technical_setup_required: "Technical Setup Required",
    test_number_required: "Test Number Required — Sylvara Must Assign A Number Before Continuing"
  });
  const ROUTE_KEYS = Object.freeze([
    "conversionConfirmPath",
    "conversionPreviewPath",
    "decisionPath",
    "exchangePath",
    "forwardingInstructionsPath",
    "numberClaimPath",
    "numberStatusPath",
    "routeVerificationWindowPath",
    "setupControlPath",
    "statusPath"
  ]);

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function exactKeys(value, expected, label) {
    if (!isPlainObject(value)) throw new Error(`${label} is invalid.`);
    const actual = Reflect.ownKeys(value);
    if (
      actual.length !== expected.length ||
      actual.some((key) => typeof key !== "string" || !expected.includes(key)) ||
      expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    ) {
      throw new Error(`${label} does not match the approved contract.`);
    }
    return value;
  }

  function resolveStateModel(override) {
    const stateModel = override || browserStateModel;
    if (
      !stateModel ||
      typeof stateModel.getState !== "function" ||
      !Array.isArray(stateModel.FIELD_SETUP_STATES)
    ) {
      throw new Error("Field setup state model is unavailable.");
    }
    return stateModel;
  }

  function normalizeRoute(path, label) {
    if (
      typeof path !== "string" ||
      !PATH_PATTERN.test(path) ||
      path.includes("//") ||
      path.endsWith("/")
    ) {
      throw new Error(`${label} is invalid.`);
    }
    return path;
  }

  function normalizeDestination(value, label, approvedHosts) {
    let destination;
    try {
      destination = new URL(value);
    } catch {
      throw new Error(`${label} is invalid.`);
    }
    if (
      destination.protocol !== "https:" ||
      destination.username ||
      destination.password ||
      destination.port ||
      destination.search ||
      destination.hash ||
      destination.pathname === "/" ||
      !approvedHosts.includes(destination.hostname) ||
      destination.href.length > 2048
    ) {
      throw new Error(`${label} is invalid.`);
    }
    return destination.href;
  }

  function normalizeRuntime(runtime, stateModel) {
    exactKeys(
      runtime,
      ["csrfHeaderName", "formNavigationDestinations", "mode", "routes"],
      "Field setup runtime wiring"
    );
    if (runtime.mode !== AUTHENTICATED_MODE || !HEADER_PATTERN.test(runtime.csrfHeaderName || "")) {
      throw new Error("Field setup runtime wiring is invalid.");
    }
    exactKeys(
      runtime.routes,
      ROUTE_KEYS,
      "Field setup runtime routes"
    );
    const routes = Object.freeze(Object.fromEntries(ROUTE_KEYS.map((key) => [
      key,
      normalizeRoute(runtime.routes[key], `${key} route`)
    ])));
    if (new Set(Object.values(routes)).size !== ROUTE_KEYS.length) {
      throw new Error("Field setup runtime routes must be distinct.");
    }
    exactKeys(
      runtime.formNavigationDestinations,
      ["form1", "form2"],
      "Form navigation destinations"
    );
    return Object.freeze({
      csrfHeaderName: runtime.csrfHeaderName,
      formNavigationDestinations: Object.freeze({
        form1: normalizeDestination(
          runtime.formNavigationDestinations.form1,
          "Form 1 navigation destination",
          stateModel.APPROVED_FORM_HOSTS
        ),
        form2: normalizeDestination(
          runtime.formNavigationDestinations.form2,
          "Form 2 navigation destination",
          stateModel.APPROVED_FORM_HOSTS
        )
      }),
      mode: AUTHENTICATED_MODE,
      routes
    });
  }

  function createSyntheticApi(options = {}) {
    const stateModel = resolveStateModel(options.stateModel);
    const storage = options.storage || null;

    function persistSafeState(stateId) {
      const canonical = stateModel.getState(stateId);
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(PREVIEW_STORAGE_KEY, canonical.id);
      }
      return canonical.id;
    }

    function readSafeState() {
      if (!storage || typeof storage.getItem !== "function") {
        return "loading_session_validation";
      }

      const stored = storage.getItem(PREVIEW_STORAGE_KEY);
      return stored ? stateModel.getState(stored).id : "loading_session_validation";
    }

    function syntheticOutcome(actionId, requestedNextState) {
      const nextState = persistSafeState(requestedNextState);
      return Promise.resolve(Object.freeze({
        mode: SYNTHETIC_MODE,
        actionId,
        nextState,
        authoritative: false,
        navigationIntent: null
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

      loadStepData() {
        return Promise.resolve(null);
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

  function createAuthenticatedApi(options = {}) {
    const stateModel = resolveStateModel(options.stateModel);
    const runtime = normalizeRuntime(options.runtime, stateModel);
    const storage = options.storage || null;
    const fetchImpl = options.fetchImpl || (browserRoot && browserRoot.fetch);
    const AbortControllerType = options.AbortController ||
      (browserRoot && browserRoot.AbortController) ||
      (typeof AbortController === "function" ? AbortController : null);
    if (typeof fetchImpl !== "function" || typeof AbortControllerType !== "function") {
      throw new Error("Authenticated field setup transport is unavailable.");
    }

    let currentJourney = null;
    let currentPreviewDisplayed = false;
    let csrf = readStoredCsrf();

    function readStoredCsrf() {
      if (!storage || typeof storage.getItem !== "function") return null;
      const value = storage.getItem(CSRF_STORAGE_KEY);
      return TOKEN_PATTERN.test(value || "") ? value : null;
    }

    function storeCsrf(value) {
      if (!TOKEN_PATTERN.test(value || "")) {
        throw new Error("Field setup CSRF bootstrap is invalid.");
      }
      csrf = value;
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(CSRF_STORAGE_KEY, value);
      }
    }

    function normalizeJourney(value) {
      exactKeys(value, ["progress", "revision", "state", "totalSteps"], "Journey response");
      const stateIndex = stateModel.FIELD_SETUP_STATES.findIndex((state) => state.id === value.state);
      if (
        stateIndex < 0 ||
        value.progress !== stateIndex + 1 ||
        value.totalSteps !== stateModel.FIELD_SETUP_STATES.length ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 2
      ) {
        throw new Error("Journey response is invalid.");
      }
      return Object.freeze({
        progress: value.progress,
        revision: value.revision,
        state: value.state,
        totalSteps: value.totalSteps
      });
    }

    function normalizeNavigationIntent(value, actionId) {
      const expectedTarget = FORM_TARGET_BY_ACTION[actionId] || null;
      if (expectedTarget === null) {
        if (value !== null) throw new Error("Unexpected form navigation intent.");
        return null;
      }
      exactKeys(value, ["mode", "target", "url"], "Form navigation intent");
      let intended;
      let destination;
      try {
        intended = new URL(value.url);
        destination = new URL(runtime.formNavigationDestinations[expectedTarget]);
      } catch {
        throw new Error("Form navigation intent is invalid.");
      }
      const queryEntries = [...intended.searchParams.entries()];
      if (
        value.mode !== "top_level" ||
        value.target !== expectedTarget ||
        intended.protocol !== "https:" ||
        intended.username ||
        intended.password ||
        intended.port ||
        intended.hash ||
        !stateModel.APPROVED_FORM_HOSTS.includes(intended.hostname) ||
        intended.origin !== destination.origin ||
        intended.pathname !== destination.pathname ||
        intended.href.length > 2048 ||
        queryEntries.length > 4 ||
        new Set(queryEntries.map(([key]) => key)).size !== queryEntries.length ||
        queryEntries.some(([key, queryValue]) => (
          !FORM_QUERY_KEY_PATTERN.test(key) ||
          PROHIBITED_FORM_QUERY_KEY_PATTERN.test(key) ||
          !FORM_QUERY_VALUE_PATTERN.test(queryValue)
        ))
      ) {
        throw new Error("Form navigation intent is outside the approved destination.");
      }
      return Object.freeze({ mode: "top_level", target: expectedTarget, url: intended.href });
    }

    function normalizePreview(value) {
      exactKeys(
        value,
        ["account", "contact", "deal", "noEmailOrRoutingEffect"],
        "Conversion preview"
      );
      if (value.noEmailOrRoutingEffect !== true) {
        throw new Error("Conversion preview is invalid.");
      }
      for (const target of [value.account, value.contact]) {
        exactKeys(target, ["action", "displayName"], "Conversion target");
        if (
          !["associate_one_verified_match", "create_from_conversion_mapping"].includes(target.action) ||
          typeof target.displayName !== "string" ||
          target.displayName.length < 1 ||
          target.displayName.length > 200 ||
          /[\u0000-\u001f\u007f]/.test(target.displayName)
        ) {
          throw new Error("Conversion target is invalid.");
        }
      }
      exactKeys(
        value.deal,
        ["closingDate", "dealName", "mandatoryDealFields", "pipeline", "stage", "type"],
        "Conversion Deal"
      );
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value.deal.closingDate) ||
        !Array.isArray(value.deal.mandatoryDealFields) ||
        value.deal.mandatoryDealFields.length !== 6 ||
        value.deal.mandatoryDealFields.some((field) => typeof field !== "string" || field.length > 64) ||
        [value.deal.dealName, value.deal.pipeline, value.deal.stage, value.deal.type].some(
          (field) => typeof field !== "string" || field.length < 1 || field.length > 200 || /[\u0000-\u001f\u007f]/.test(field)
        )
      ) {
        throw new Error("Conversion Deal is invalid.");
      }
      return Object.freeze({
        details: Object.freeze([
          `Account: ${value.account.displayName} — ${value.account.action === "associate_one_verified_match" ? "associate verified match" : "create from Lead conversion"}`,
          `Contact: ${value.contact.displayName} — ${value.contact.action === "associate_one_verified_match" ? "associate verified match" : "create from Lead conversion"}`,
          `Deal: ${value.deal.dealName}`,
          `Stage / Pipeline / Type: ${value.deal.stage} / ${value.deal.pipeline} / ${value.deal.type}`,
          `Closing date: ${value.deal.closingDate}`,
          `Mandatory fields: ${value.deal.mandatoryDealFields.join(", ")}`,
          "Email and routing effects: none"
        ]),
        ready: true,
        status: "Authoritative preview ready"
      });
    }

    function normalizeInstructionData(payload, expectedView) {
      assertProtocolResponse(
        payload,
        ["color", "ok", "status", "steps", "view"],
        "Forwarding instruction response"
      );
      if (
        payload.ok !== true ||
        payload.view !== expectedView ||
        typeof payload.status !== "string" ||
        typeof payload.color !== "string" ||
        !Array.isArray(payload.steps) ||
        payload.steps.length < 1 ||
        payload.steps.length > 20 ||
        payload.steps.some((step) => typeof step !== "string" || step.length < 1 || step.length > 500)
      ) {
        throw new Error("Forwarding instructions are invalid.");
      }
      return Object.freeze({
        details: Object.freeze([...payload.steps]),
        ready: true,
        status: expectedView === "enable"
          ? "Reviewed enablement instructions loaded"
          : "Reviewed rollback instructions loaded"
      });
    }

    async function requestJson(path, { body, csrfRequired, method }) {
      if (csrfRequired && !TOKEN_PATTERN.test(csrf || "")) {
        throw new Error("Field setup CSRF bootstrap is unavailable.");
      }
      const controller = new AbortControllerType();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const headers = {
        accept: "application/json",
        [PROTOCOL_ID_HEADER]: stateModel.PROTOCOL_ID,
        [PROTOCOL_VERSION_HEADER]: String(stateModel.PROTOCOL_SCHEMA_VERSION)
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (csrfRequired) headers[runtime.csrfHeaderName] = csrf;
      try {
        const response = await fetchImpl(path, {
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          credentials: "same-origin",
          headers,
          method,
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        });
        if (!response || typeof response.json !== "function" || !Number.isInteger(response.status)) {
          throw new Error("Field setup response is unavailable.");
        }
        const payload = await response.json();
        if (!response.ok) {
          const code = isPlainObject(payload) && typeof payload.code === "string"
            ? payload.code
            : "request_failed";
          const error = new Error("Field setup request was not accepted.");
          error.code = code;
          error.status = response.status;
          const setupProtocolMatches = isPlainObject(payload) &&
            payload.protocolId === stateModel.PROTOCOL_ID &&
            payload.schemaVersion === stateModel.PROTOCOL_SCHEMA_VERSION;
          if (
            code === "test_number_required" &&
            setupProtocolMatches &&
            payload.message === OPERATOR_STOP_MESSAGES.test_number_required
          ) {
            error.operatorStop = true;
            error.operatorMessage = OPERATOR_STOP_MESSAGES.test_number_required;
          } else if (
            code === "technical_setup_required" &&
            setupProtocolMatches &&
            payload.status === OPERATOR_STOP_MESSAGES.technical_setup_required
          ) {
            error.operatorStop = true;
            error.operatorMessage = OPERATOR_STOP_MESSAGES.technical_setup_required;
          } else if (code === "reconciliation_required") {
            // The Catalyst error boundary intentionally returns only a redacted
            // public code and request identifier for ambiguous CRM writes.
            error.operatorStop = true;
            error.operatorMessage = OPERATOR_STOP_MESSAGES.reconciliation_required;
          }
          throw error;
        }
        return payload;
      } finally {
        clearTimeout(timeout);
      }
    }

    function outcome(actionId, journey, navigationIntent = null) {
      currentJourney = journey;
      return Object.freeze({
        actionId,
        authoritative: true,
        mode: AUTHENTICATED_MODE,
        navigationIntent,
        nextState: journey.state,
        revision: journey.revision
      });
    }

    function assertProtocolResponse(payload, expectedKeys, label) {
      exactKeys(
        payload,
        [...expectedKeys, "protocolId", "schemaVersion"],
        label
      );
      if (
        payload.protocolId !== stateModel.PROTOCOL_ID ||
        payload.schemaVersion !== stateModel.PROTOCOL_SCHEMA_VERSION
      ) {
        throw new Error("Field setup protocol is incompatible.");
      }
      return payload;
    }

    async function loadJourney({ launchNonce } = {}) {
      if (launchNonce !== undefined && launchNonce !== null) {
        if (!TOKEN_PATTERN.test(launchNonce)) throw new Error("Launch nonce is invalid.");
        const payload = await requestJson(runtime.routes.exchangePath, {
          body: { nonce: launchNonce },
          csrfRequired: false,
          method: "POST"
        });
        assertProtocolResponse(payload, ["csrfToken", "journey", "ok"], "Exchange response");
        if (payload.ok !== true) throw new Error("Exchange response is invalid.");
        storeCsrf(payload.csrfToken);
        return outcome("launch_exchanged", normalizeJourney(payload.journey));
      }
      const payload = await requestJson(runtime.routes.statusPath, {
        csrfRequired: true,
        method: "GET"
      });
      assertProtocolResponse(payload, ["journey", "ok"], "Status response");
      if (payload.ok !== true) throw new Error("Status response is invalid.");
      return outcome("status_read", normalizeJourney(payload.journey));
    }

    async function submitIntent(actionId, qualification) {
      if (!currentJourney) throw new Error("Field setup journey is not loaded.");
      const prior = currentJourney;
      const state = stateModel.getState(prior.state);
      const selectedAction = [state.primaryAction, ...state.secondaryActions]
        .find((candidate) => candidate.id === actionId) ||
        (Object.hasOwn(GLOBAL_NEXT_STATE_BY_ACTION, actionId)
          ? Object.freeze({
            id: actionId,
            syntheticNextState: GLOBAL_NEXT_STATE_BY_ACTION[actionId]
          })
          : null);
      if (!selectedAction) throw new Error("Field setup action is invalid.");
      const requestBody = Object.freeze({
        action: actionId,
        qualification,
        revision: prior.revision
      });
      const payload = await requestMutationWithExactRetry(runtime.routes.decisionPath, {
        body: requestBody,
        csrfRequired: true,
        method: "POST"
      });
      assertProtocolResponse(
        payload,
        ["journey", "navigationIntent", "ok"],
        "Intent response"
      );
      if (payload.ok !== true) throw new Error("Intent response is invalid.");
      const journey = normalizeJourney(payload.journey);
      const navigationIntent = normalizeNavigationIntent(payload.navigationIntent, actionId);
      return outcome(actionId, journey, navigationIntent);
    }

    async function readCurrentStatus() {
      const prior = currentJourney;
      const statusOutcome = await loadJourney({});
      return Object.freeze({ prior, statusOutcome, journey: currentJourney });
    }

    function isMutationRetryCandidate(error) {
      return error?.operatorStop !== true && (
        error?.code === "context_conflict" ||
        error?.status === undefined ||
        error?.status >= 500
      );
    }

    async function requestMutationWithExactRetry(path, requestOptions) {
      try {
        return await requestJson(path, requestOptions);
      } catch (error) {
        if (!isMutationRetryCandidate(error)) throw error;
      }
      return requestJson(path, requestOptions);
    }

    async function setupRequest(path, { body, method }) {
      const payload = await requestJson(path, {
        body,
        csrfRequired: true,
        method
      });
      if (!isPlainObject(payload)) throw new Error("Setup operation response is invalid.");
      if (
        payload.protocolId !== stateModel.PROTOCOL_ID ||
        payload.schemaVersion !== stateModel.PROTOCOL_SCHEMA_VERSION
      ) {
        throw new Error("Field setup protocol is incompatible.");
      }
      return payload;
    }

    async function reconcileSetupAction(actionId, operation) {
      try {
        return await submitIntent(actionId, null);
      } catch (error) {
        if (error?.code !== "context_conflict") throw error;
      }
      const before = currentJourney;
      await readCurrentStatus();
      if (
        !before ||
        currentJourney.state !== before.state ||
        currentJourney.revision !== before.revision
      ) {
        return outcome("status_reconciled", currentJourney);
      }
      await operation();
      try {
        return await submitIntent(actionId, null);
      } catch (error) {
        if (
          !["refresh_number_status", "refresh_route_verification"].includes(actionId) ||
          error?.code !== "context_conflict"
        ) {
          throw error;
        }
        await readCurrentStatus();
        return outcome(
          actionId === "refresh_number_status"
            ? "number_reserved_pending_assignment"
            : "route_verification_window_open",
          currentJourney
        );
      }
    }

    async function loadStepData({ stateId } = {}) {
      if (!currentJourney || currentJourney.state !== stateId) {
        throw new Error("Field setup state is stale.");
      }
      if (stateId === "lead_conversion_confirmation") {
        const payload = await requestJson(runtime.routes.conversionPreviewPath, {
          body: { revision: currentJourney.revision },
          csrfRequired: true,
          method: "POST"
        });
        assertProtocolResponse(payload, ["journey", "ok", "preview"], "Conversion preview response");
        if (payload.ok !== true) throw new Error("Conversion preview response is invalid.");
        const journey = normalizeJourney(payload.journey);
        if (journey.state !== "lead_conversion_confirmation") {
          throw new Error("Conversion preview journey is invalid.");
        }
        currentJourney = journey;
        currentPreviewDisplayed = true;
        return normalizePreview(payload.preview);
      }
      if (stateId === "forwarding_instructions" || stateId === "rollback_instructions") {
        const view = stateId === "forwarding_instructions" ? "enable" : "rollback";
        const payload = await setupRequest(runtime.routes.forwardingInstructionsPath, {
          body: { journeyRevision: currentJourney.revision, view },
          method: "POST"
        });
        return normalizeInstructionData(payload, view);
      }
      if (stateId === "number_reservation_status") {
        const payload = await setupRequest(runtime.routes.numberStatusPath, { method: "GET" });
        assertProtocolResponse(payload, ["color", "ok", "state"], "Number status response");
        if (
          payload.ok !== true ||
          !["Available", "Reserved", "Assigned"].includes(payload.state) ||
          typeof payload.color !== "string"
        ) {
          throw new Error("Number status response is invalid.");
        }
        return Object.freeze({
          details: Object.freeze([`Approved inventory state: ${payload.state}`]),
          ready: true,
          status: payload.state
        });
      }
      return null;
    }

    return Object.freeze({
      mode: AUTHENTICATED_MODE,

      loadJourney,

      loadStepData,

      completeStep({ stateId, actionId }) {
        if (!currentJourney || currentJourney.state !== stateId) {
          return Promise.reject(new Error("Field setup state is stale."));
        }
        const state = stateModel.getState(stateId);
        if (
          state.id === "operator_qualification_review" ||
          ![state.primaryAction, ...state.secondaryActions].some((action) => action.id === actionId)
        ) {
          return Promise.reject(new Error("Field setup action is invalid."));
        }
        if (actionId === "accept_conversion_preview") {
          const revision = currentJourney.revision;
          return requestMutationWithExactRetry(runtime.routes.conversionPreviewPath, {
              body: { revision },
              csrfRequired: true,
              method: "POST"
            }).then((payload) => {
            assertProtocolResponse(payload, ["journey", "ok", "preview"], "Conversion preview response");
            if (payload.ok !== true) throw new Error("Conversion preview response is invalid.");
            const journey = normalizeJourney(payload.journey);
            if (journey.state !== "lead_conversion_confirmation") {
              throw new Error("Conversion preview journey is invalid.");
            }
            normalizePreview(payload.preview);
            // Building the preview is not evidence that the operator saw it.
            // Only loadStepData(), which feeds the rendered confirmation screen,
            // unlocks the separately confirmed CRM write.
            currentPreviewDisplayed = false;
            return outcome(actionId, journey);
          });
        }
        if (actionId === "confirm_conversion_intent") {
          if (!currentPreviewDisplayed) {
            return Promise.reject(new Error("Conversion preview has not been displayed."));
          }
          const revision = currentJourney.revision;
          return requestMutationWithExactRetry(runtime.routes.conversionConfirmPath, {
              body: { confirm: true, revision },
              csrfRequired: true,
              method: "POST"
            }).then((payload) => {
            assertProtocolResponse(
              payload,
              ["journey", "ok", "replayed"],
              "Conversion confirmation response"
            );
            if (payload.ok !== true || typeof payload.replayed !== "boolean") {
              throw new Error("Conversion confirmation response is invalid.");
            }
            currentPreviewDisplayed = false;
            return outcome(actionId, normalizeJourney(payload.journey));
          });
        }
        if (actionId === "refresh_number_status") {
          return reconcileSetupAction(actionId, async () => {
            const status = await setupRequest(runtime.routes.numberStatusPath, { method: "GET" });
            assertProtocolResponse(status, ["color", "ok", "state"], "Number status response");
            if (status.ok !== true) throw new Error("Number status response is invalid.");
            if (["Reserved", "Assigned"].includes(status.state)) return;
            if (status.state !== "Available") throw new Error("Approved number is not claimable.");
            const claimed = await setupRequest(runtime.routes.numberClaimPath, {
              body: { journeyRevision: currentJourney.revision },
              method: "POST"
            });
            assertProtocolResponse(
              claimed,
              ["color", "ok", "replayed", "state"],
              "Number assignment response"
            );
            if (claimed.ok !== true || claimed.state !== "Reserved") {
              throw new Error("Number assignment response is invalid.");
            }
          });
        }
        if (actionId === "view_forwarding_instructions") {
          return reconcileSetupAction(actionId, async () => {
            const changed = await setupRequest(runtime.routes.setupControlPath, {
              body: {
                action: "confirm_forwarding_enabled",
                journeyRevision: currentJourney.revision
              },
              method: "POST"
            });
            if (changed.ok !== true || changed.forwardingState !== "Customer Reported Enabled") {
              throw new Error("Forwarding acknowledgement is invalid.");
            }
          });
        }
        if (actionId === "view_rollback_instructions") {
          return reconcileSetupAction(actionId, async () => {
            const changed = await setupRequest(runtime.routes.setupControlPath, {
              body: {
                action: "confirm_rollback_ready",
                journeyRevision: currentJourney.revision
              },
              method: "POST"
            });
            if (changed.ok !== true || changed.rollbackReady !== true) {
              throw new Error("Rollback acknowledgement is invalid.");
            }
          });
        }
        if (actionId === "refresh_route_verification") {
          return reconcileSetupAction(actionId, async () => {
            const opened = await setupRequest(runtime.routes.routeVerificationWindowPath, {
              body: { journeyRevision: currentJourney.revision },
              method: "POST"
            });
            if (
              opened.ok !== true ||
              opened.status !== "Open" ||
              opened.ttlMs !== 300000 ||
              opened.startsAgent !== false ||
              opened.activatesDeployment !== false
            ) {
              throw new Error("Route verification window response is invalid.");
            }
          });
        }
        return submitIntent(actionId, null);
      },

      submitOperatorDecision({ stateId, actionId, qualification }) {
        if (!currentJourney || currentJourney.state !== stateId || stateId !== "operator_qualification_review") {
          return Promise.reject(new Error("Qualification state is stale."));
        }
        const normalized = stateModel.normalizeQualificationPayload(actionId, qualification);
        return submitIntent(actionId, normalized);
      },

      requestStop() {
        return reconcileSetupAction("stop_setup", async () => {
          const stopped = await setupRequest(runtime.routes.setupControlPath, {
            body: { action: "stop", journeyRevision: currentJourney.revision },
            method: "POST"
          });
          if (
            stopped.ok !== true ||
            stopped.setupStatus !== "stopped" ||
            stopped.mutatesLiveRoute !== false ||
            stopped.activatesDeployment !== false
          ) {
            throw new Error("Setup stop response is invalid.");
          }
        });
      }
    });
  }

  function createApi(options = {}) {
    if (options.runtime === undefined || options.runtime === null) {
      return createSyntheticApi(options);
    }
    return createAuthenticatedApi(options);
  }

  return Object.freeze({
    AUTHENTICATED_MODE,
    CSRF_STORAGE_KEY,
    SYNTHETIC_MODE,
    createApi,
    createAuthenticatedApi,
    createSyntheticApi
  });
});
