'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');

function withTimeout(operation, timeoutMs, options = {}) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AnalyticsSyncError(
        options.code || 'PLATFORM_TIMEOUT', 'Bounded platform operation timed out.',
        { retryable: options.retryable === true, ambiguous: options.ambiguous === true },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createConnectionAuthorizationProvider(app, linkName, timeoutMs) {
  invariant(app && typeof app.connections === 'function', 'CONNECTION_UNAVAILABLE',
    'Catalyst Connections interface is unavailable.');
  return async function connectionAuthorization() {
    let credentials;
    try {
      credentials = await withTimeout(
        () => app.connections().getConnectionCredentials(linkName), timeoutMs,
        { code: 'CONNECTION_TIMEOUT', retryable: true },
      );
    } catch (error) {
      if (error instanceof AnalyticsSyncError) throw error;
      throw new AnalyticsSyncError('CONNECTION_UNAVAILABLE',
        'Catalyst Connection is unavailable.', { cause: error, retryable: true });
    }
    invariant(credentials && typeof credentials === 'object' && !Array.isArray(credentials),
      'CONNECTION_INVALID', 'Catalyst Connection response is invalid.');
    const parameters = credentials.parameters || {};
    invariant(Object.keys(parameters).length === 0, 'CONNECTION_INVALID',
      'Query-parameter credentials are prohibited.');
    const headers = credentials.headers;
    invariant(headers && typeof headers === 'object' && !Array.isArray(headers),
      'CONNECTION_INVALID', 'Catalyst Connection headers are missing.');
    const entries = Object.entries(headers);
    invariant(entries.length === 1 && entries[0][0].toLowerCase() === 'authorization',
      'CONNECTION_INVALID', 'Connection must expose exactly one Authorization header.');
    const value = entries[0][1];
    invariant(typeof value === 'string' && /^Zoho-oauthtoken [A-Za-z0-9._-]{20,4096}$/.test(value),
      'CONNECTION_INVALID', 'Connection Authorization is invalid.');
    return value;
  };
}

module.exports = { createConnectionAuthorizationProvider, withTimeout };
