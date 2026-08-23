'use strict';

const { createRetryJobHandler } = require('retell_free_test/lib/job-handler');
const { createSafeConsoleLogger } = require('retell_free_test/lib/logging');

module.exports = createRetryJobHandler({ logger: createSafeConsoleLogger(console) });
