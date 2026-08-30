'use strict';

const { createAnalyticsSyncJobHandler } = require('./lib/job-handler');
const { createSafeConsoleLogger } = require('./lib/logging');

module.exports = createAnalyticsSyncJobHandler({ logger: createSafeConsoleLogger(console) });
