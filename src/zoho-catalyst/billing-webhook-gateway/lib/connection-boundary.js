"use strict";

const { withOperationTimeout } = require("./operation-timeout");

class ConnectionAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectionAuthorizationError";
    this.publicCode = "connection_unavailable";
  }
}

function isPlainObject(candidate) {
  return Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate);
}

function createConnectionAuthorizationProvider(app, config) {
  return async function getAuthorizationHeader() {
    let credentials;
    try {
      credentials = await withOperationTimeout(
        () => app.connections().getConnectionCredentials(config.creatorConnectionLinkName),
        config.platformOperationTimeoutMs,
      );
    } catch {
      throw new ConnectionAuthorizationError("Catalyst Connection credentials are unavailable");
    }
    if (!isPlainObject(credentials?.headers) || !isPlainObject(credentials?.parameters)) {
      throw new ConnectionAuthorizationError("Catalyst Connection response is incomplete");
    }
    if (Object.keys(credentials.parameters).length !== 0) {
      throw new ConnectionAuthorizationError("Query-parameter credentials are prohibited");
    }
    const authorizationEntries = Object.entries(credentials.headers)
      .filter(([name]) => name.toLowerCase() === "authorization");
    if (authorizationEntries.length !== 1 || Object.keys(credentials.headers).length !== 1) {
      throw new ConnectionAuthorizationError("Connection must expose only Authorization");
    }
    const authorization = authorizationEntries[0][1];
    if (
      typeof authorization !== "string" ||
      !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(authorization)
    ) {
      throw new ConnectionAuthorizationError("Connection Authorization is invalid");
    }
    return authorization;
  };
}

module.exports = {
  ConnectionAuthorizationError,
  createConnectionAuthorizationProvider,
};
