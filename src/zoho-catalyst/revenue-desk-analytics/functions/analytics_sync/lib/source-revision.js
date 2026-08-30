'use strict';

// The release builder replaces this sentinel only in an isolated artifact exported
// from the exact reviewed Git commit. An unstamped checkout therefore fails closed.
const ARTIFACT_SOURCE_REVISION = '__SYLVARA_UNSTAMPED_SOURCE_REVISION__';

module.exports = { ARTIFACT_SOURCE_REVISION };
