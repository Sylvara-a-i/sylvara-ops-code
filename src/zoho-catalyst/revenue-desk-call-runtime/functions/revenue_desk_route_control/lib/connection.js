'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');

function createAuthorizationProvider(app, linkName, pattern, timeoutMs) {
  return async function authorization() {
    let timer;
    let credentials;
    try {
      credentials = await Promise.race([
        Promise.resolve().then(() => app.connections().getConnectionCredentials(linkName)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
    } catch (error) {
      throw new RevenueDeskError('CONNECTION_UNAVAILABLE',
        'An approved private Connection is unavailable.',
        { cause: error, httpStatus: 503, retryable: true });
    } finally {
      clearTimeout(timer);
    }
    invariant(credentials && typeof credentials.headers === 'object'
      && !Array.isArray(credentials.headers)
      && credentials.parameters && Object.keys(credentials.parameters).length === 0,
    'CONNECTION_INVALID', 'Private Connection credentials are invalid.', { httpStatus: 503 });
    const headers = Object.entries(credentials.headers)
      .filter(([name]) => name.toLowerCase() === 'authorization');
    invariant(headers.length === 1 && Object.keys(credentials.headers).length === 1
      && typeof headers[0][1] === 'string' && pattern.test(headers[0][1]),
    'CONNECTION_INVALID', 'Private Connection authorization is invalid.', { httpStatus: 503 });
    return headers[0][1];
  };
}

module.exports = Object.freeze({ createAuthorizationProvider });
