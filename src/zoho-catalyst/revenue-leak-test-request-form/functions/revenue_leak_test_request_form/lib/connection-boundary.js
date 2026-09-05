"use strict";

const { withOperationTimeout } = require("./operation-timeout");

const PROVIDER_CODES = new Set([
  "SUCCESS", "INVALID_DATA", "INVALID_MODULE", "MANDATORY_NOT_FOUND", "DUPLICATE_DATA",
  "NO_PERMISSION", "OAUTH_SCOPE_MISMATCH", "AUTHORIZATION_FAILED", "AUTHENTICATION_FAILURE",
  "INVALID_TOKEN", "INVALID_OAUTHTOKEN", "RECORD_LOCKED", "LIMIT_EXCEEDED",
  "TOO_MANY_REQUESTS", "INTERNAL_ERROR",
]);

/** Retain only known codes and numeric HTTP status, never provider text or payloads. */
function sanitizeProviderDiagnostic(value = {}) {
  const { httpStatus, providerCode } = value && typeof value === "object" ? value : {};
  return Object.freeze({
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
      ? httpStatus : null,
    providerCode: PROVIDER_CODES.has(providerCode) ? providerCode : null,
  });
}

class ConnectionAuthorizationError extends Error {
  constructor(message, diagnostic = {}) {
    super(message);
    this.name = "ConnectionAuthorizationError";
    this.status = 503;
    this.publicCode = "connection_unavailable";
    this.diagnostic = sanitizeProviderDiagnostic(diagnostic);
  }
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createConnectionAuthorizationProvider(app, linkName, timeoutMs) {
  return async function authorizationProvider() {
    let credentials;
    try {
      credentials = await withOperationTimeout(
        () => app.connections().getConnectionCredentials(linkName),
        timeoutMs,
      );
    } catch (error) {
      throw new ConnectionAuthorizationError("Catalyst CRM Connection is unavailable", {
        httpStatus: error?.statusCode,
        providerCode: error?.code ?? error?.errorCode,
      });
    }
    if (!plain(credentials?.headers) || !plain(credentials?.parameters) ||
        Object.keys(credentials.parameters).length !== 0) {
      throw new ConnectionAuthorizationError("Catalyst CRM Connection response is invalid");
    }
    const headers = Object.entries(credentials.headers);
    if (headers.length !== 1 || headers[0][0].toLowerCase() !== "authorization" ||
        typeof headers[0][1] !== "string" ||
        !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(headers[0][1])) {
      throw new ConnectionAuthorizationError("Connection must expose only Zoho Authorization");
    }
    return headers[0][1];
  };
}

module.exports = {
  ConnectionAuthorizationError,
  createConnectionAuthorizationProvider,
  sanitizeProviderDiagnostic,
};
