"use strict";

const crypto = require("node:crypto");

// This controller is intentionally bound to Sylvara's reviewed US data-center
// destinations. Expanding either list requires a source review; accepting a
// hostname suffix or a runtime-provided custom domain would turn configuration
// into an authorization or bearer-token exfiltration primitive.
const APPROVED_CRM_API_HOSTS = Object.freeze(["www.zohoapis.com"]);
const APPROVED_FORMS_PUBLIC_HOSTS = Object.freeze(["forms.zohopublic.com"]);
const CATALYST_DEVELOPMENT_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/;
const CATALYST_GATEWAY_SOURCE_PATH_PATTERN = /^\/[a-z][a-z0-9-]{2,31}\/[A-Za-z0-9_-]{32,64}$/;

function isApprovedCrmApiHostname(hostname) {
  return APPROVED_CRM_API_HOSTS.includes(hostname);
}

function isApprovedFormsPublicHostname(hostname) {
  return APPROVED_FORMS_PUBLIC_HOSTS.includes(hostname);
}

function isApprovedCatalystDevelopmentHostname(hostname) {
  return CATALYST_DEVELOPMENT_HOST_PATTERN.test(hostname ?? "");
}

// A Gateway source endpoint and an Advanced I/O target path are distinct
// provider identifiers. Keep the public bearer-bearing link confined to one
// canonical private Development Gateway source URL.
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
    !isApprovedCatalystDevelopmentHostname(parsed.hostname) ||
    !CATALYST_GATEWAY_SOURCE_PATH_PATTERN.test(parsed.pathname)
  ) {
    return null;
  }
  return parsed.href;
}

function normalizeApprovedFormUrl(raw) {
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
    !isApprovedFormsPublicHostname(parsed.hostname) ||
    parsed.pathname === "/" ||
    parsed.pathname.includes("//") ||
    !/^\/[A-Za-z0-9._~/-]+$/.test(parsed.pathname) ||
    parsed.pathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  return parsed.href;
}

function destinationDigest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function isArtifactBoundFormUrl(raw, approvedDigest) {
  const normalized = normalizeApprovedFormUrl(raw);
  if (!normalized || !/^[a-f0-9]{64}$/.test(String(approvedDigest ?? ""))) {
    return false;
  }
  const actual = Buffer.from(destinationDigest(normalized), "hex");
  const approved = Buffer.from(approvedDigest, "hex");
  return actual.length === approved.length && crypto.timingSafeEqual(actual, approved);
}

module.exports = {
  APPROVED_CRM_API_HOSTS,
  APPROVED_FORMS_PUBLIC_HOSTS,
  isApprovedCatalystDevelopmentHostname,
  destinationDigest,
  isApprovedCrmApiHostname,
  isApprovedFormsPublicHostname,
  isArtifactBoundFormUrl,
  normalizeApprovedCatalystDevelopmentGatewayUrl,
  normalizeApprovedFormUrl,
};
