"use strict";

const { PHONE_POLICY } = require("./phone-contract");
const VERIFIED_CANONICAL_ARTIFACTS = require("./recovery-phone-policy-revisions");
const LEGACY_MANIFEST_KEYS = Object.freeze(["schemaVersion", "mode", "originalSourceRevision",
  "claimBindingSha256", "assistedConstantsSha256", "originalSessionVersion",
  "originalUpdatedAt", "originalLastOutcome"]);
const CANONICAL_MANIFEST_KEYS = Object.freeze([...LEGACY_MANIFEST_KEYS,
  "phonePolicy", "phonePolicySourceRevision"]);

function recoveryManifestKeys(manifest) {
  if (manifest?.schemaVersion === 1) return LEGACY_MANIFEST_KEYS;
  const entries = VERIFIED_CANONICAL_ARTIFACTS;
  const validRegistry = Array.isArray(entries) && entries.length <= 100 &&
    new Set(entries.map(entry => entry?.sourceRevision)).size === entries.length &&
    entries.every(entry => entry && Object.keys(entry).sort().join(",") ===
      "handlerModuleSha256,normalizerModuleSha256,phonePolicy,policyModuleSha256,sourceRevision" &&
      /^[a-f0-9]{40}$/.test(entry.sourceRevision) && entry.phonePolicy === PHONE_POLICY.id &&
      /^[a-f0-9]{64}$/.test(entry.policyModuleSha256) &&
      /^[a-f0-9]{64}$/.test(entry.handlerModuleSha256) &&
      /^[a-f0-9]{64}$/.test(entry.normalizerModuleSha256));
  if (manifest?.schemaVersion === 2 && manifest.phonePolicy === PHONE_POLICY.id &&
      /^[a-f0-9]{40}$/.test(manifest.phonePolicySourceRevision ?? "") &&
      manifest.phonePolicySourceRevision === manifest.originalSourceRevision && validRegistry &&
      entries.some(entry => entry.sourceRevision === manifest.originalSourceRevision &&
        entry.phonePolicy === manifest.phonePolicy)) {
    return CANONICAL_MANIFEST_KEYS;
  }
  return null;
}

// The reviewed registry establishes original artifact/profile provenance.
// The private manifest must pin that same artifact. assertClaim binds the revision and full
// stored fingerprint before any CRM access. Never infer policy from digits,
// current runtime revision, or the appearance of an old entry.
module.exports = { recoveryManifestKeys };
