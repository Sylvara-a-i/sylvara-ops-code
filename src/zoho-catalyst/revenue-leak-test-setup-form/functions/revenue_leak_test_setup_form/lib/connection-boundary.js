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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createConnectionAuthorizationProvider(app, linkName, timeoutMs) {
  return async function getAuthorizationHeader() {
    let credentials;
    try {
      credentials = await withOperationTimeout(
        () => app.connections().getConnectionCredentials(linkName),
        timeoutMs,
      );
    } catch {
      throw new ConnectionAuthorizationError("Catalyst Connection is unavailable");
    }
    if (!isPlainObject(credentials?.headers) || !isPlainObject(credentials?.parameters)) {
      throw new ConnectionAuthorizationError("Catalyst Connection response is incomplete");
    }
    if (Object.keys(credentials.parameters).length !== 0) {
      throw new ConnectionAuthorizationError("Query-parameter credentials are prohibited");
    }
    const entries = Object.entries(credentials.headers)
      .filter(([name]) => name.toLowerCase() === "authorization");
    if (entries.length !== 1 || Object.keys(credentials.headers).length !== 1) {
      throw new ConnectionAuthorizationError("Connection must expose only Authorization");
    }
    const authorization = entries[0][1];
    if (
      typeof authorization !== "string" ||
      !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(authorization)
    ) {
      throw new ConnectionAuthorizationError("Connection Authorization is invalid");
    }
    return authorization;
  };
}

module.exports = { ConnectionAuthorizationError, createConnectionAuthorizationProvider };
