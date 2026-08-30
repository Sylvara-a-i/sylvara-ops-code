'use strict';

const { createRequestListener } = require('./lib/http-boundary');

const catalyst = {
  initialize(context) {
    return require('zcatalyst-sdk-node').initialize(context);
  },
};

module.exports = createRequestListener({ catalystSdk: catalyst });
