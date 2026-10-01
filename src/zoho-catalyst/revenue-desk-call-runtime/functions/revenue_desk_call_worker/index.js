'use strict';

const { createWorkerJobHandler } = require('revenue_desk_call_gateway/lib/job-handler');
const { createSafeConsoleLogger } = require('revenue_desk_call_gateway/lib/logging');

const { createProtectedWorkerReportOptions } = require('./lib/report-bootstrap');
module.exports = createWorkerJobHandler({ logger: createSafeConsoleLogger(console),
  ...createProtectedWorkerReportOptions(),
});
