"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { IdempotencyError, createCatalystIdempotencyStore } = require("../lib/idempotency");

const TABLE = "Billing_Webhook_Inbox";

function fixture({ insert, queryResponses = [], update } = {}) {
  const calls = { insert: [], query: [], update: [] };
  const table = {
    async insertRow(row) {
      calls.insert.push(row);
      if (insert instanceof Error) throw insert;
      return insert ?? { ROWID: "1000000000001" };
    },
    async updateRow(row) {
      calls.update.push(row);
      if (update instanceof Error) throw update;
      return update ?? row;
    },
  };
  const responses = [...queryResponses];
  const app = {
    datastore() {
      return { table: () => table };
    },
    zcql() {
      return {
        async executeZCQLQuery(statement) {
          calls.query.push(statement);
          return responses.shift() ?? [];
        },
      };
    },
  };
  const config = {
    eventInboxTable: TABLE,
    sourceRevision: "test-revision-001",
    deploymentEnvironment: "development",
    duplicateErrorCodes: Object.freeze(["DUPLICATE_SAMPLE"]),
    platformOperationTimeoutMs: 100,
  };
  return { calls, store: createCatalystIdempotencyStore(app, config) };
}

function claimInput(character = "a", overrides = {}) {
  return {
    eventKey: character.repeat(64),
    eventFingerprint: "f".repeat(64),
    eventType: "subscription_created",
    sourceEventId: "event_sample_001",
    ...overrides,
  };
}

function nestedRow(row) {
  return [{ [TABLE]: row }];
}

test("claims a durable row and independently reads back completion", async () => {
  const { calls, store } = fixture({
    queryResponses: [nestedRow({
      ROWID: "1000000000001",
      STATUS: "completed",
      LAST_OUTCOME: "registered_only",
    })],
  });
  const result = await store.claim(claimInput());
  assert.deepEqual(result, { outcome: "claimed", rowId: "1000000000001" });
  assert.equal(calls.insert[0].STATUS, "processing");
  assert.equal(calls.insert[0].SOURCE_EVENT_ID, "event_sample_001");
  assert.equal(calls.insert[0].EVENT_FINGERPRINT, "f".repeat(64));
  await store.mark("1000000000001", "completed", "registered_only");
  assert.equal(calls.update[0].STATUS, "completed");
  assert.match(calls.query[0], /WHERE ROWID = 1000000000001$/);
});

test("classifies only an exact verified duplicate after durable readback", async () => {
  const duplicate = Object.assign(new Error("conflict"), { code: "DUPLICATE_SAMPLE" });
  const completed = fixture({
    insert: duplicate,
    queryResponses: [nestedRow({
      ROWID: "1000000000001",
      STATUS: "completed",
      EVENT_FINGERPRINT: "f".repeat(64),
      EVENT_TYPE: "subscription_created",
      SOURCE_EVENT_ID: "event_sample_001",
    })],
  });
  assert.deepEqual(
    await completed.store.claim(claimInput("b")),
    { outcome: "duplicate-completed", rowId: "1000000000001" },
  );

  const unresolved = fixture({
    insert: duplicate,
    queryResponses: [nestedRow({
      ROWID: "1000000000002",
      STATUS: "processing",
      EVENT_FINGERPRINT: "f".repeat(64),
      EVENT_TYPE: "subscription_created",
      SOURCE_EVENT_ID: "event_sample_001",
    })],
  });
  assert.equal(
    (await unresolved.store.claim(claimInput("c"))).outcome,
    "duplicate-unresolved",
  );
});

test("a reused event key with a conflicting semantic fingerprint fails closed", async () => {
  const duplicate = Object.assign(new Error("conflict"), { code: "DUPLICATE_SAMPLE" });
  const conflict = fixture({
    insert: duplicate,
    queryResponses: [nestedRow({
      ROWID: "1000000000003",
      STATUS: "completed",
      EVENT_FINGERPRINT: "e".repeat(64),
      EVENT_TYPE: "subscription_created",
      SOURCE_EVENT_ID: "event_sample_001",
    })],
  });
  assert.equal(
    (await conflict.store.claim(claimInput("d"))).outcome,
    "duplicate-conflict",
  );
});

test("unknown store errors and incomplete duplicate reads fail closed", async () => {
  const unknown = fixture({ insert: Object.assign(new Error("unknown"), { code: "OTHER" }) });
  await assert.rejects(unknown.store.claim(claimInput("e")), IdempotencyError);

  const duplicate = Object.assign(new Error("conflict"), { code: "DUPLICATE_SAMPLE" });
  const incomplete = fixture({ insert: duplicate, queryResponses: [[]] });
  await assert.rejects(incomplete.store.claim(claimInput("a")), IdempotencyError);
});

test("an ambiguous update succeeds only when exact readback matches", async () => {
  const recovered = fixture({
    update: new Error("synthetic timeout"),
    queryResponses: [nestedRow({
      ROWID: "1000000000004",
      STATUS: "reconciliation_required",
      LAST_OUTCOME: "downstream_outcome_unknown",
    })],
  });
  await recovered.store.mark(
    "1000000000004",
    "reconciliation_required",
    "downstream_outcome_unknown",
  );

  const mismatch = fixture({
    queryResponses: [nestedRow({
      ROWID: "1000000000005",
      STATUS: "processing",
      LAST_OUTCOME: "claimed",
    })],
  });
  await assert.rejects(
    mismatch.store.mark("1000000000005", "completed", "registered_only"),
    IdempotencyError,
  );
});

test("unsafe numeric row identifiers fail closed", async () => {
  const unsafe = fixture({ insert: { ROWID: Number.MAX_SAFE_INTEGER + 10 } });
  await assert.rejects(unsafe.store.claim(claimInput("a")), IdempotencyError);
});
