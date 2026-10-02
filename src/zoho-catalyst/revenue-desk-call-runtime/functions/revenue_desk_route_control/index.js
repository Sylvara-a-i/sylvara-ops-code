'use strict';

const { createRequestListener } = require('./lib/http-boundary');

const catalyst = {
  initialize(context) {
    return require('zcatalyst-sdk-node').initialize(context);
  },
};

const { createProtectedRuntimeContext } = require('./lib/report-runtime-context');
const { createProtectedStorageQualification } = require('./lib/report-storage-qualification');
const { createProtectedSenderQualification } = require('./lib/report-sender-qualification');
const { createProtectedReportController } = require('./lib/report-bootstrap');
module.exports = createRequestListener({ catalystSdk: catalyst, factories: {
  runtimeContext: createProtectedRuntimeContext(),
  reportDelivery: createProtectedReportController(),
  storageQualification: createProtectedStorageQualification(),
  senderQualification: createProtectedSenderQualification(),
} });
