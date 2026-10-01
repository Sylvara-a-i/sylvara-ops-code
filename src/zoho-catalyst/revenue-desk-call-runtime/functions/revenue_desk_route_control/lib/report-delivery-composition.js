'use strict';

// Packaged fixed source; qualified private binding is supplied only by trusted
// installation. index.js remains unbound until actual access/acceptance.
const {createReportDeliveryFactory}=require('../reporting/revenue-desk-analytics/tools/create-report-delivery-factory');
module.exports={createReportDeliveryFactory};
