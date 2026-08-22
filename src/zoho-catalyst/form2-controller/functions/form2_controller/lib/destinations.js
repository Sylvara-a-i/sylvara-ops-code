"use strict";

const crypto = require("node:crypto");

// This controller is intentionally bound to Sylvara's reviewed US data-center
// destinations. Expanding either list requires a source review; accepting a
// hostname suffix or a runtime-provided custom domain would turn configuration
// into an authorization or bearer-token exfiltration primitive.
const APPROVED_CRM_API_HOSTS = Object.freeze(["www.zohoapis.com"]);
const APPROVED_FORMS_PUBLIC_HOSTS = Object.freeze(["forms.zohopublic.com"]);

function isApprovedCrmApiHostname(hostname) {
  return APPROVED_CRM_API_HOSTS.includes(hostname);
}

function isApprovedFormsPublicHostname(hostname) {
  return APPROVED_FORMS_PUBLIC_HOSTS.includes(hostname);
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
  destinationDigest,
  isApprovedCrmApiHostname,
  isApprovedFormsPublicHostname,
  isArtifactBoundFormUrl,
  normalizeApprovedFormUrl,
};
