"use strict";

const { withOperationTimeout } = require("./operation-timeout");

class ConnectionAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectionAuthorizationError";
    this.status = 503;
    this.publicCode = "connection_unavailable";
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
    } catch {
      throw new ConnectionAuthorizationError("Catalyst CRM Connection is unavailable");
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

module.exports = { ConnectionAuthorizationError, createConnectionAuthorizationProvider };
