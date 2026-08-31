"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CatalystDataStoreAdapterError,
  createCatalystDataStoreAdapter,
} = require("../lib/catalyst-datastore-adapter");
const { OperationTimeoutError } = require("../lib/operation-timeout");

const SESSION_TABLE = "Form2_Sessions";
const PREFILL_TABLE = "Form2_Prefills";
const SUBMISSION_TABLE = "Form2_Submissions";
const PROOF_TABLE = "Form2_Proofs";

function config(overrides = {}) {
  return {
    sessionTableName: SESSION_TABLE,
    prefillTableName: PREFILL_TABLE,
    submissionTableName: SUBMISSION_TABLE,
    proofTableName: PROOF_TABLE,
    platformOperationTimeoutMs: 250,
    ...overrides,
  };
}

function fixture({ insertImpl, queryImpl } = {}) {
  const calls = { datastore: 0, tables: [], inserts: [], queries: [], zcql: 0 };
  const app = {
    datastore() {
      calls.datastore += 1;
      return {
        table(tableName) {
          calls.tables.push(tableName);
          return {
            async insertRow(row) {
              calls.inserts.push({ ...row });
              if (insertImpl) return insertImpl(row);
              return { ...row, ROWID: "1000000000001" };
            },
          };
        },
      };
    },
    zcql() {
      calls.zcql += 1;
      return {
        async executeZCQLQuery(statement) {
          calls.queries.push(statement);
          if (queryImpl) return queryImpl(statement);
          return [];
        },
      };
    },
  };
  return {
    adapter: createCatalystDataStoreAdapter(app, config()),
    app,
    calls,
  };
}

test("inserts a validated row through the allowlisted Catalyst table with a timeout boundary", async () => {
  const { adapter, calls } = fixture();
  const row = {
    ISSUE_REQUEST_KEY: "b".repeat(64),
    ACCESS_TOKEN_HASH: "a".repeat(64),
    STATUS: "issued",
    ATTEMPT_COUNT: 0,
    ACTIVE: true,
    OPTIONAL_VALUE: null,
  };
  const result = await adapter.insertRow(SESSION_TABLE, row);
  assert.equal(result.ROWID, "1000000000001");
  assert.deepEqual(calls.tables, [SESSION_TABLE]);
  assert.deepEqual(calls.inserts, [row]);
  assert.equal(calls.queries.length, 0);
});

test("builds one atomic conditional UPDATE with every expected field and escaped values", async () => {
  const { adapter, calls } = fixture();
  await adapter.updateRow(SESSION_TABLE, {
    ROWID: "1000000000001",
    STATUS: "verified",
    LAST_OUTCOME: "owner's_retry",
    ATTEMPT_COUNT: 2,
    ACTIVE: true,
    CLEARED_AT: null,
  }, {
    STATUS: "issued",
    ATTEMPT_COUNT: 1,
    OWNER_NOTE: "O'Brien",
    PRIOR_VALUE: null,
  });

  assert.equal(calls.datastore, 0);
  assert.equal(calls.queries.length, 1);
  assert.equal(
    calls.queries[0],
    "UPDATE Form2_Sessions SET ACTIVE = TRUE, ATTEMPT_COUNT = 2, " +
      "CLEARED_AT = NULL, LAST_OUTCOME = 'owner''s_retry', STATUS = 'verified' " +
      "WHERE ROWID = 1000000000001 AND ATTEMPT_COUNT = 1 AND " +
      "OWNER_NOTE = 'O''Brien' AND PRIOR_VALUE IS NULL AND STATUS = 'issued'",
  );
});

test("limits conditional UPDATEs to ROWID plus four explicit predicates", async () => {
  const { adapter, calls } = fixture();
  await adapter.updateRow(SESSION_TABLE, {
    ROWID: "1000000000001",
    STATUS: "verified",
  }, {
    STATUS: "issued",
    ATTEMPT_COUNT: 1,
    LAST_OUTCOME: "issued",
    UPDATED_AT: "2026-08-14T18:00:00.000Z",
  });
  assert.match(
    calls.queries[0],
    /WHERE ROWID = 1000000000001 AND ATTEMPT_COUNT = 1 AND LAST_OUTCOME = 'issued' AND STATUS = 'issued' AND UPDATED_AT = '2026-08-14T18:00:00.000Z'$/,
  );

  await assert.rejects(
    adapter.updateRow(SESSION_TABLE, {
      ROWID: "1000000000001",
      STATUS: "submitted",
    }, {
      STATUS: "verified",
      ATTEMPT_COUNT: 1,
      LAST_OUTCOME: "verified",
      UPDATED_AT: "2026-08-14T18:00:00.000Z",
      LEASE_OWNER: "owner",
    }),
    (error) => (
      error instanceof CatalystDataStoreAdapterError &&
      error.publicCode === "datastore_input_invalid" &&
      /condition limit/.test(error.message)
    ),
  );
  assert.equal(calls.queries.length, 1);
});

test("executes exact hash and ROWID SELECT statements for every store lookup", async () => {
  const { adapter, calls } = fixture();
  await adapter.findRowsByTokenHash(SESSION_TABLE, "a".repeat(64));
  await adapter.findRowsByIssueRequestKey(SESSION_TABLE, "b".repeat(64));
  await adapter.findRowsByDealIssuanceKey(SESSION_TABLE, "e".repeat(64));
  await adapter.findRowsByPrefillKey(PREFILL_TABLE, "c".repeat(64));
  await adapter.findRowsBySubmissionKey(SUBMISSION_TABLE, "d".repeat(64));
  await adapter.findRowsByRowId(PREFILL_TABLE, "1000000000002");

  assert.deepEqual(calls.queries, [
    `SELECT * FROM ${SESSION_TABLE} WHERE ACCESS_TOKEN_HASH = '${"a".repeat(64)}'`,
    `SELECT * FROM ${SESSION_TABLE} WHERE ISSUE_REQUEST_KEY = '${"b".repeat(64)}'`,
    `SELECT * FROM ${SESSION_TABLE} WHERE DEAL_ISSUANCE_KEY = '${"e".repeat(64)}'`,
    `SELECT * FROM ${PREFILL_TABLE} WHERE PREFILL_KEY = '${"c".repeat(64)}'`,
    `SELECT * FROM ${SUBMISSION_TABLE} WHERE SUBMISSION_KEY = '${"d".repeat(64)}'`,
    `SELECT * FROM ${PREFILL_TABLE} WHERE ROWID = 1000000000002`,
  ]);
});

test("rejects tables outside the configured four-table allowlist and invalid adapter configuration", async () => {
  const { adapter, app } = fixture();
  await assert.rejects(
    adapter.insertRow("Other_Table", { STATUS: "issued" }),
    CatalystDataStoreAdapterError,
  );
  await assert.rejects(
    adapter.findRowsByRowId("Other_Table", "1000000000001"),
    CatalystDataStoreAdapterError,
  );

  for (const overrides of [
    { sessionTableName: "unsafe-table" },
    { prefillTableName: SESSION_TABLE },
    { platformOperationTimeoutMs: 249 },
    { platformOperationTimeoutMs: 15001 },
  ]) {
    assert.throws(
      () => createCatalystDataStoreAdapter(app, config(overrides)),
      CatalystDataStoreAdapterError,
    );
  }
  assert.throws(
    () => createCatalystDataStoreAdapter({}, config()),
    CatalystDataStoreAdapterError,
  );
});

test("rejects unsafe identifiers, ROWIDs, empty conditions, and update shapes", async () => {
  const { adapter } = fixture();
  for (const row of [
    { status: "issued" },
    { "STATUS; DELETE": "issued" },
    { ROWID: "1000000000001", STATUS: "issued" },
  ]) {
    await assert.rejects(adapter.insertRow(SESSION_TABLE, row), CatalystDataStoreAdapterError);
  }

  await assert.rejects(
    adapter.updateRow(SESSION_TABLE, { ROWID: "1 OR 1=1", STATUS: "verified" }, {
      STATUS: "issued",
    }),
    CatalystDataStoreAdapterError,
  );
  await assert.rejects(
    adapter.updateRow(SESSION_TABLE, { ROWID: "1000000000001", STATUS: "verified" }, {}),
    CatalystDataStoreAdapterError,
  );
  await assert.rejects(
    adapter.updateRow(SESSION_TABLE, { ROWID: "1000000000001" }, { STATUS: "issued" }),
    CatalystDataStoreAdapterError,
  );
  await assert.rejects(
    adapter.updateRow(SESSION_TABLE, { ROWID: "1000000000001", STATUS: "verified" }, {
      ROWID: "1000000000001",
    }),
    CatalystDataStoreAdapterError,
  );
});

test("encodes only bounded primitive strings, safe integers, booleans, and null", async () => {
  const { adapter } = fixture();
  const invalidValues = [
    "x".repeat(4097),
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    Number.NaN,
    1n,
    undefined,
    [],
    {},
    () => {},
  ];
  for (const value of invalidValues) {
    await assert.rejects(
      adapter.insertRow(SESSION_TABLE, { VALUE: value }),
      CatalystDataStoreAdapterError,
    );
  }

  const tooManyColumns = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`FIELD_${index}`, index]),
  );
  await assert.rejects(
    adapter.insertRow(SESSION_TABLE, tooManyColumns),
    CatalystDataStoreAdapterError,
  );
  const oversizedTotal = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`FIELD_${index}`, "x".repeat(4096)]),
  );
  await assert.rejects(
    adapter.insertRow(SESSION_TABLE, oversizedTotal),
    CatalystDataStoreAdapterError,
  );
});

test("requires lowercase 64-character hashes and digit-only bounded ROWIDs", async () => {
  const { adapter } = fixture();
  for (const hash of ["a".repeat(63), "A".repeat(64), `${"a".repeat(63)}'`]) {
    await assert.rejects(
      adapter.findRowsByDealIssuanceKey(SESSION_TABLE, hash),
      CatalystDataStoreAdapterError,
    );
  }
  for (const rowId of ["", "-1", "1.5", "0 OR 1=1", "1".repeat(31)]) {
    await assert.rejects(
      adapter.findRowsByRowId(SESSION_TABLE, rowId),
      CatalystDataStoreAdapterError,
    );
  }
});

test("classifies DML timeouts as ambiguous and SELECT timeouts as non-ambiguous", async () => {
  const insertTimeout = fixture({
    insertImpl: async () => {
      throw new OperationTimeoutError("synthetic timeout", { ambiguous: true });
    },
  });
  await assert.rejects(
    insertTimeout.adapter.insertRow(SESSION_TABLE, { STATUS: "issued" }),
    (error) => (
      error instanceof CatalystDataStoreAdapterError &&
      error.publicCode === "dependency_timeout" &&
      error.ambiguous === true
    ),
  );

  const queryTimeout = fixture({
    queryImpl: async () => {
      throw new OperationTimeoutError("synthetic timeout");
    },
  });
  await assert.rejects(
    queryTimeout.adapter.updateRow(SESSION_TABLE, {
      ROWID: "1000000000001",
      STATUS: "verified",
    }, { STATUS: "issued" }),
    (error) => error.publicCode === "dependency_timeout" && error.ambiguous === true,
  );
  await assert.rejects(
    queryTimeout.adapter.findRowsByRowId(SESSION_TABLE, "1000000000001"),
    (error) => error.publicCode === "dependency_timeout" && error.ambiguous === false,
  );
});

test("returns only generic failures and never logs raw row or query input", async () => {
  const rawValue = "synthetic-secret-that-must-not-be-logged";
  const logged = [];
  const originals = { error: console.error, log: console.log, warn: console.warn };
  console.error = (...values) => logged.push(values);
  console.log = (...values) => logged.push(values);
  console.warn = (...values) => logged.push(values);
  try {
    const failed = fixture({
      insertImpl: async () => {
        throw new Error(`provider exposed ${rawValue}`);
      },
      queryImpl: async () => ({ invalid: rawValue }),
    });
    await assert.rejects(
      failed.adapter.insertRow(SESSION_TABLE, { VALUE: rawValue }),
      (error) => !error.message.includes(rawValue),
    );
    await assert.rejects(
      failed.adapter.findRowsByRowId(SESSION_TABLE, "1000000000001"),
      (error) => !error.message.includes(rawValue),
    );
    assert.deepEqual(logged, []);
  } finally {
    console.error = originals.error;
    console.log = originals.log;
    console.warn = originals.warn;
  }
});
