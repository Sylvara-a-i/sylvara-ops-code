"use strict";

const { HttpBoundaryError, validateJsonPost } = require("./http");
const { SecurityError, verifySharedSecret } = require("./security");

const RESPONSE_STAGES = new Set(["issue", "prefill"]);
const OUTCOME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

class ControllerError extends Error {
  constructor(message, { status = 503, publicCode = "service_unavailable" } = {}) {
    super(message);
    this.name = "ControllerError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function response(status, body, stage, outcome) {
  if (!RESPONSE_STAGES.has(stage) || !OUTCOME_PATTERN.test(outcome)) {
    throw new ControllerError("Response metadata is invalid", {
      publicCode: "configuration_invalid",
    });
  }
  return Object.freeze({ status, body: Object.freeze(body), stage, outcome });
}

function normalizePublicError(error) {
  if (error instanceof ControllerError) return error;
  if (error instanceof HttpBoundaryError) {
    return new ControllerError("HTTP boundary rejected the request", {
      status: error.status,
      publicCode: error.publicCode,
    });
  }
  if (error instanceof SecurityError) {
    const configuration = error.publicCode === "configuration_invalid";
    return new ControllerError("Security boundary rejected the request", {
      status: configuration ? 503 : 422,
      publicCode: configuration ? "configuration_invalid" : "request_invalid",
    });
  }
  if (error?.publicCode === "configuration_invalid") {
    return new ControllerError("Controller configuration is invalid", {
      status: 503,
      publicCode: "configuration_invalid",
    });
  }
  return new ControllerError("A required dependency is unavailable", {
    status: 503,
    publicCode: "service_unavailable",
  });
}

async function handleRequest(request, dependencies) {
  try {
    const config = dependencies?.config;
    const allowedPaths = new Set([config?.issuePath, config?.prefillPath]);
    const path = validateJsonPost(request, allowedPaths);
    const issueRoute = path === config.issuePath;
    const headerName = issueRoute ? config.issueHeaderName : config.prefillHeaderName;
    const headerSecret = issueRoute ? config.issueHeaderSecret : config.prefillHeaderSecret;
    if (!verifySharedSecret(request?.headers, headerName, headerSecret)) {
      throw new ControllerError("Route authentication failed", {
        status: 401,
        publicCode: "authentication_failed",
      });
    }

    // Both assisted routes are containment sentinels. Return before touching
    // request payloads, Catalyst SDK, Data Store, Connections, CRM, or network.
    return response(
      503,
      { ok: false, code: "configuration_invalid" },
      issueRoute ? "issue" : "prefill",
      "assisted_route_disabled",
    );
  } catch (error) {
    throw normalizePublicError(error);
  }
}

module.exports = {
  ControllerError,
  handleRequest,
  normalizePublicError,
};
