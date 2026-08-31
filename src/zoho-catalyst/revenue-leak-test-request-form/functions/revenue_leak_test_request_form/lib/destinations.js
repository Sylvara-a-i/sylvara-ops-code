"use strict";

// API Gateway source URLs and Advanced I/O runtime paths are separate provider
// identifiers. The public URL is accepted only when it is one canonical,
// private Development Gateway endpoint; the internal ACCESS_PATH remains the
// request-dispatch authority inside the function.
const CATALYST_DEVELOPMENT_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/;
const CATALYST_GATEWAY_SOURCE_PATH_PATTERN = /^\/[a-z][a-z0-9-]{2,31}\/[A-Za-z0-9_-]{32,64}$/;

function normalizeApprovedCatalystDevelopmentGatewayUrl(raw) {
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    raw !== parsed.href ||
    raw.includes("?") ||
    raw.includes("#") ||
    parsed.search ||
    parsed.hash ||
    !CATALYST_DEVELOPMENT_HOST_PATTERN.test(parsed.hostname) ||
    !CATALYST_GATEWAY_SOURCE_PATH_PATTERN.test(parsed.pathname)
  ) {
    return null;
  }
  return parsed.href;
}

module.exports = {
  normalizeApprovedCatalystDevelopmentGatewayUrl,
};
