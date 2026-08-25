'use strict';

const { RevenueDeskError, invariant } = require('./errors');

function readRawBody(request, options) {
  const { maximumBytes, timeoutMs } = options;
  invariant(Number.isSafeInteger(maximumBytes) && maximumBytes > 0,
    'INVALID_RUNTIME_CONFIGURATION', 'Raw-body size limit is invalid.', { httpStatus: 503 });
  invariant(Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    'INVALID_RUNTIME_CONFIGURATION', 'Raw-body timeout is invalid.', { httpStatus: 503 });
  if (Buffer.isBuffer(request?.rawBody) || typeof request?.rawBody === 'string') {
    const raw = Buffer.isBuffer(request.rawBody) ? request.rawBody : Buffer.from(request.rawBody, 'utf8');
    invariant(raw.length <= maximumBytes, 'REQUEST_TOO_LARGE',
      'Request body exceeds the configured limit.', { httpStatus: 413 });
    return Promise.resolve(raw);
  }
  invariant(request && typeof request.on === 'function', 'REQUEST_STREAM_ERROR',
    'Raw request stream is unavailable.', { httpStatus: 400 });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('aborted', onAborted);
      request.removeListener('error', onError);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new RevenueDeskError(
      'REQUEST_BODY_TIMEOUT', 'Request body was not received in time.', { httpStatus: 408 },
    )), timeoutMs);
    const onData = (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > maximumBytes) {
        finish(reject, new RevenueDeskError('REQUEST_TOO_LARGE', 'Request body exceeds the configured limit.', { httpStatus: 413 }));
        if (typeof request.resume === 'function') request.resume();
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks, length));
    const onAborted = () => finish(reject, new RevenueDeskError('REQUEST_ABORTED', 'Request was aborted.', { httpStatus: 400 }));
    const onError = (error) => finish(reject, new RevenueDeskError(
      'REQUEST_STREAM_ERROR', 'Request body could not be read.', { cause: error, httpStatus: 400 },
    ));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('aborted', onAborted);
    request.once('error', onError);
  });
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    throw new RevenueDeskError('INVALID_JSON', 'Request body must be valid JSON.', { cause: error, httpStatus: 400 });
  }
}

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(body));
}

module.exports = { readRawBody, parseJson, json };
