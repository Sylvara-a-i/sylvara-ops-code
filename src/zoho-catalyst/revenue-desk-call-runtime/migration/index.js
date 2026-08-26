'use strict';

const { computeApprovedInputDigest, createMigrationPlan } = require('./lib/planner');
const { executeFixedTargetMigration } = require('./lib/fixed-target-runner');
const {
  computePrivateTargetBindingDigest,
  parsePrivateTargetBinding,
} = require('./lib/private-binding');
const { MigrationError } = require('./lib/errors');

module.exports = {
  computeApprovedInputDigest,
  computePrivateTargetBindingDigest,
  createMigrationPlan,
  executeFixedTargetMigration,
  parsePrivateTargetBinding,
  MigrationError,
};
