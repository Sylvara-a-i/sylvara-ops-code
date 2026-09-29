'use strict';

// The release builder packages these reviewed sources inside this worker. This
// export is for trusted application composition after separate live acceptance;
// index.js deliberately does not bind it or accept Job-controlled dependencies.
const { createDurableReportComposition } = require('../reporting/revenue-desk-analytics/tools/create-durable-report-composition');
const { createReportingFactory } = require('../reporting/revenue-desk-analytics/tools/create-reporting-factory');

module.exports = { createDurableReportComposition, createReportingFactory };
