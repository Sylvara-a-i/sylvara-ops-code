"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CatalystDataStoreAdapterError,
  createCatalystDataStoreAdapter,
} = require("../lib/catalyst-datastore-adapter");

const TABLE = "RevenueLeakTestRequestFormSessions";

function fixture() {
  const statements = [];
  const app = {
    datastore() {
      return { table() { return {}; } };
    },
    zcql() {
      return {
        async executeZCQLQuery(statement) {
          statements.push(statement);
          return [];
        },
      };
    },
  };
  return {
    adapter: createCatalystDataStoreAdapter(app, {
      sessionTableName: TABLE,
      platformOperationTimeoutMs: 1000,
    }),
    statements,
  };
}

test("conditional UPDATE uses ROWID plus no more than four explicit predicates", async () => {
  const selected = fixture();
  await selected.adapter.updateRow(TABLE, {
    ROWID: "42",
    SESSION_VERSION: 8,
    STATUS: "issued",
  }, {
    SESSION_VERSION: 7,
    STATUS: "handle_issued",
    TOKEN_HASH: "a".repeat(64),
    UPDATED_AT: "2026-08-31T12:00:00.000Z",
  });

  assert.equal(selected.statements.length, 1);
  const statement = selected.statements[0];
  const conditions = statement.split(" WHERE ")[1].split(" AND ");
  assert.equal(conditions.length, 5);
  assert.equal(conditions[0], "ROWID = 42");
  assert.equal(conditions[1], "SESSION_VERSION = 7");
  assert.match(statement, /SET SESSION_VERSION = 8, STATUS = 'issued'/);
});

test("conditional UPDATE rejects oversized or versionless predicate maps before ZCQL", async () => {
  const selected = fixture();
  const update = { ROWID: "42", SESSION_VERSION: 8, STATUS: "issued" };
  const oversized = {
    SESSION_VERSION: 7,
    STATUS: "handle_issued",
    TOKEN_HASH: "a".repeat(64),
    UPDATED_AT: "2026-08-31T12:00:00.000Z",
    CRM_MODULE: "Leads",
  };

  await assert.rejects(
    () => selected.adapter.updateRow(TABLE, update, oversized),
    (error) => error instanceof CatalystDataStoreAdapterError &&
      error.publicCode === "datastore_input_invalid",
  );
  await assert.rejects(
    () => selected.adapter.updateRow(TABLE, update, {
      STATUS: "handle_issued",
      TOKEN_HASH: "a".repeat(64),
    }),
    (error) => error instanceof CatalystDataStoreAdapterError &&
      error.publicCode === "datastore_input_invalid",
  );
  assert.deepEqual(selected.statements, []);
});
