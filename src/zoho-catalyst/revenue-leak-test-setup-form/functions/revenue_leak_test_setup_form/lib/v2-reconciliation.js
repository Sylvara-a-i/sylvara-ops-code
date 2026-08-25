"use strict";

const crypto = require("node:crypto");

const SESSION_STATUS_SET = new Set([
  "issuing",
  "issued",
  "verified",
  "submitting",
  "submitted",
  "expired",
  "revoked",
  "failed",
  "reconciliation_required",
]);
const PREFILL_STATUS_SET = new Set(["ready", "submitted", "reconciliation_required"]);
const SUBMISSION_STATUS_SET = new Set([
  "processing",
  "succeeded",
  "failed",
  "reconciliation_required",
]);

class V2ReconciliationError extends Error {
  constructor(message) {
    super(message);
    this.name = "V2ReconciliationError";
  }
}

function safeRows(value, name, statuses) {
  if (!Array.isArray(value)) throw new V2ReconciliationError(`${name} must be an array`);
  const normalized = value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new V2ReconciliationError(`${name} contains an invalid row`);
    }
    const reference = String(row.reference ?? "");
    const status = String(row.status ?? "");
    if (!/^[a-f0-9]{64}$/.test(reference) || !statuses.has(status)) {
      throw new V2ReconciliationError(`${name} contains unsafe reconciliation metadata`);
    }
    return Object.freeze({ reference, status });
  });
  if (new Set(normalized.map((row) => row.reference)).size !== normalized.length) {
    throw new V2ReconciliationError(`${name} references must be unique`);
  }
  return normalized;
}

function referenceDigest(references) {
  return crypto.createHash("sha256")
    .update("sylvara.form2.v2-reconciliation.v1\0", "utf8")
    .update([...new Set(references)].sort().join("\n"), "utf8")
    .digest("hex");
}

function reconcileV2({ legacySessions, targetSessions, legacyPrefills, targetPrefills,
  legacySubmissions, targetSubmissions, destinationCounts }) {
  const destinationKeys = Object.keys(destinationCounts ?? {}).sort();
  const destinationValues = Object.values(destinationCounts ?? {});
  if (
    JSON.stringify(destinationKeys) !== JSON.stringify([
      "prefills",
      "proofs",
      "sessions",
      "submissions",
    ]) ||
    destinationValues.some((value) => !Number.isSafeInteger(value) || value !== 0)
  ) {
    throw new V2ReconciliationError("The exact four additive version-3 destinations must be empty");
  }
  const legacy = safeRows(legacySessions, "legacySessions", SESSION_STATUS_SET);
  const target = safeRows(targetSessions, "targetSessions", SESSION_STATUS_SET);
  const legacyPrefillRows = safeRows(legacyPrefills, "legacyPrefills", PREFILL_STATUS_SET);
  const targetPrefillRows = safeRows(targetPrefills, "targetPrefills", PREFILL_STATUS_SET);
  const legacySubmissionRows = safeRows(
    legacySubmissions,
    "legacySubmissions",
    SUBMISSION_STATUS_SET,
  );
  const targetSubmissionRows = safeRows(
    targetSubmissions,
    "targetSubmissions",
    SUBMISSION_STATUS_SET,
  );
  const legacyByReference = new Map(legacy.map((row) => [row.reference, row]));
  const targetByReference = new Map(target.map((row) => [row.reference, row]));
  const counts = {
    promoted_sessions: 0,
    promoted_prefills: 0,
    promoted_submissions: 0,
    retained_terminal_sessions: 0,
    quarantined_reconciliation_sessions: 0,
    quarantined_state_conflicts: 0,
    quarantined_missing_prefills: 0,
    retained_v2_prefills: 0,
    retained_v2_submissions: 0,
  };
  for (const reference of new Set([...legacyByReference.keys(), ...targetByReference.keys()])) {
    const left = legacyByReference.get(reference);
    const right = targetByReference.get(reference);
    if (!left || !right || left.status !== right.status) {
      counts.quarantined_state_conflicts += 1;
    } else if (new Set(["expired", "revoked", "failed", "submitted"]).has(left.status)) {
      counts.retained_terminal_sessions += 1;
    } else if (left.status === "reconciliation_required") {
      counts.quarantined_reconciliation_sessions += 1;
    } else {
      // Even matching active rows lack the stable v3 ISSUE_REQUEST_KEY and remain in v2.
      counts.quarantined_state_conflicts += 1;
    }
  }
  const targetPrefillSet = new Set(targetPrefillRows.map((row) => row.reference));
  counts.quarantined_missing_prefills = legacyPrefillRows.filter(
    (row) => !targetPrefillSet.has(row.reference),
  ).length;
  counts.retained_v2_prefills = targetPrefillRows.length;
  counts.retained_v2_submissions = Math.max(
    legacySubmissionRows.length,
    targetSubmissionRows.length,
  );
  return Object.freeze({
    strategy: "additive-v3-zero-promotion",
    counts: Object.freeze(counts),
    sourceReferenceDigest: referenceDigest([
      ...legacy,
      ...target,
      ...legacyPrefillRows,
      ...targetPrefillRows,
      ...legacySubmissionRows,
      ...targetSubmissionRows,
    ].map((row) => row.reference)),
  });
}

module.exports = { V2ReconciliationError, reconcileV2 };
