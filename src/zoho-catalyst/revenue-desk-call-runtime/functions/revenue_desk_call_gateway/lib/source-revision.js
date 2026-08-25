'use strict';

const { invariant } = require('./errors');

// The release builder replaces the marker below only in an isolated artifact tree.
// Keeping the checkout unstamped prevents a mutable environment variable from
// falsely claiming that source and the deployed package are identical.
const ARTIFACT_SOURCE_REVISION = '__REVENUE_DESK_SOURCE_REVISION__';
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;

function assertArtifactSourceRevision(configuredRevision, artifactRevision = ARTIFACT_SOURCE_REVISION) {
  invariant(SOURCE_REVISION_PATTERN.test(artifactRevision),
    'UNSTAMPED_ARTIFACT', 'Revenue Desk runtime artifact has not been release-stamped.',
    { httpStatus: 503 });
  invariant(configuredRevision === artifactRevision,
    'SOURCE_REVISION_MISMATCH', 'Configured source revision does not match the runtime artifact.',
    { httpStatus: 503 });
  return artifactRevision;
}

module.exports = Object.freeze({
  ARTIFACT_SOURCE_REVISION,
  SOURCE_REVISION_PATTERN,
  assertArtifactSourceRevision,
});
