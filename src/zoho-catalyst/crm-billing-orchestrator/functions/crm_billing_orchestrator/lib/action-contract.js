"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = "crm-billing-lifecycle-v2";
const ACTIONS = Object.freeze([
  "sync_report_summary",
  "prepare_paid_subscription",
  "reconcile",
]);
const ACTION_SET = new Set(ACTIONS);

class RequestContractError extends Error {
  constructor(message, status = 400, publicCode = "request_invalid") {
    super(message);
    this.name = "RequestContractError";
    this.status = status;
    this.publicCode = publicCode;
  }
}

function getHeader(request, name) {
  const entries = Object.entries(request?.headers ?? {})
    .filter(([candidate]) => candidate.toLowerCase() === name.toLowerCase());
  if (entries.length !== 1 || typeof entries[0][1] !== "string") return "";
  return entries[0][1];
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left), "utf8");
  const b = Buffer.from(String(right), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readBody(request, maximumBytes) {
  if (Buffer.isBuffer(request?.body)) {
    if (request.body.length > maximumBytes) throw new RequestContractError("Body is too large", 413);
    return request.body;
  }
  if (typeof request?.body === "string") {
    const body = Buffer.from(request.body, "utf8");
    if (body.length > maximumBytes) throw new RequestContractError("Body is too large", 413);
    return body;
  }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maximumBytes) throw new RequestContractError("Body is too large", 413);
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof RequestContractError) throw error;
    throw new RequestContractError("Body is unavailable");
  }
  return Buffer.concat(chunks);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestContractError("JSON body must be an object");
  }
  const reportAction = payload.action === "sync_report_summary";
  const expectedKeys = reportAction
    ? ["action", "dealId", "operationKey", "schemaVersion"]
    : ["action", "dealId", "schemaVersion"];
  const keys = Object.keys(payload).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new RequestContractError("JSON body fields do not match the contract");
  }
  if (payload.schemaVersion !== SCHEMA_VERSION || !ACTION_SET.has(payload.action)) {
    throw new RequestContractError("Lifecycle version or action is unsupported", 422);
  }
  if (typeof payload.dealId !== "string" || !/^[1-9][0-9]{7,29}$/.test(payload.dealId)) {
    throw new RequestContractError("Deal identifier is invalid", 422);
  }
  if (reportAction && (typeof payload.operationKey !== "string"
    || !/^[a-f0-9]{64}$/.test(payload.operationKey))) {
    throw new RequestContractError("Report operation key is invalid", 422);
  }
  return Object.freeze({
    schemaVersion: payload.schemaVersion,
    action: payload.action,
    dealId: payload.dealId,
    ...(reportAction ? { operationKey: payload.operationKey } : {}),
  });
}

async function parseActionRequest(request, config) {
  if (String(request?.method ?? "").toUpperCase() !== "POST") {
    throw new RequestContractError("Method is not allowed", 405, "method_not_allowed");
  }
  let url;
  try {
    url = new URL(String(request.url ?? request.originalUrl ?? ""), "https://gateway.invalid");
  } catch {
    throw new RequestContractError("Route is invalid", 404, "route_not_found");
  }
  if (url.pathname !== config.allowedPath || url.search || url.hash) {
    throw new RequestContractError("Route is not allowed", 404, "route_not_found");
  }
  const contentType = getHeader(request, "content-type").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestContractError("Content type is not allowed", 415, "content_type_not_allowed");
  }
  const declaredLength = getHeader(request, "content-length").trim();
  if (declaredLength && (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > config.maxBodyBytes)) {
    throw new RequestContractError("Content length is invalid", 413, "body_too_large");
  }
  const suppliedCredential = getHeader(request, config.sharedHeaderName);
  const paidCredential = safeEqual(suppliedCredential, config.sharedHeaderValue);
  const reportCredential = safeEqual(suppliedCredential, config.reportSummaryHeaderValue);
  if (!paidCredential && !reportCredential) {
    throw new RequestContractError("Request authentication failed", 401, "authentication_failed");
  }
  const raw = await readBody(request, config.maxBodyBytes);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new RequestContractError("Body is not valid UTF-8 JSON");
  }
  const validated = validatePayload(payload);
  if ((validated.action === "sync_report_summary") !== reportCredential) {
    throw new RequestContractError("Caller is not authorized for this action", 401,
      "authentication_failed");
  }
  return validated;
}

module.exports = { ACTIONS, RequestContractError, SCHEMA_VERSION, parseActionRequest, validatePayload };
