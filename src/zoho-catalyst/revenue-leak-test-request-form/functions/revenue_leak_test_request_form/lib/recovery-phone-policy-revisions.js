"use strict";

// Canonical-policy predecessors require independent source/artifact review.
// A recovery artifact is already required to differ from the failed original.
// Add only a reviewed predecessor, with its exact policy/handler Git-file hashes;
// tools/verify-recovery-phone-policy.js verifies those hashes against Git.
// There are no published canonical-policy predecessors for this candidate yet.
module.exports = Object.freeze([]);
