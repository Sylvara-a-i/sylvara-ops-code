'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { TABLES, createForm2EvidenceStore } = require('../lib/form2-evidence-store');

const SUBMISSION_ROW_ID = '8000000000001';
const SESSION_ROW_ID = '7000000000001';
const PREFILL_KEY = 'a'.repeat(64);

function rows() {
  return {
    [TABLES.submission]: [{
      ROWID: SUBMISSION_ROW_ID, PREFILL_KEY, SESSION_ROW_ID,
    }],
    [TABLES.prefill]: [{ ROWID: '7100000000001', PREFILL_KEY }],
    [TABLES.session]: [{ ROWID: SESSION_ROW_ID }],
    [TABLES.proof]: [{ ROWID: '7200000000001', SESSION_ROW_ID }],
  };
}

function fixture(shape = 'nested', selectedRows = rows()) {
  const statements = [];
  const app = {
    zcql() {
      return {
        async executeZCQLQuery(statement) {
          statements.push(statement);
          const table = Object.values(TABLES).find((name) => statement.includes(`FROM ${name} `));
          const result = selectedRows[table] || [];
          return result.map((row) => shape === 'nested' ? { [table]: { ...row } } : { ...row });
        },
      };
    },
  };
  return {
    store: createForm2EvidenceStore(app, { timeoutMs: 500 }), statements,
  };
}

for (const shape of ['nested', 'flat']) {
  test(`reads exact ${shape} Catalyst ZCQL Form 2 evidence with string ROWIDs`, async () => {
    const selected = fixture(shape);
    const result = await selected.store.readBundle(SUBMISSION_ROW_ID);
    assert.equal(result.submission.ROWID, SUBMISSION_ROW_ID);
    assert.equal(result.prefill.PREFILL_KEY, PREFILL_KEY);
    assert.equal(result.session.ROWID, SESSION_ROW_ID);
    assert.equal(result.proof.SESSION_ROW_ID, SESSION_ROW_ID);
    assert.equal(selected.statements.length, 4);
    assert.match(selected.statements[0], /WHERE ROWID = 8000000000001 LIMIT 2$/);
    assert.ok(selected.statements.some((statement) =>
      statement.includes(`WHERE PREFILL_KEY = '${PREFILL_KEY}' LIMIT 2`)));
    assert.ok(selected.statements.some((statement) =>
      statement.includes(`WHERE SESSION_ROW_ID = '${SESSION_ROW_ID}' LIMIT 2`)));
  });
}

test('rejects duplicate, missing, or malformed evidence without a write surface', async () => {
  const duplicateRows = rows();
  duplicateRows[TABLES.proof].push({ ...duplicateRows[TABLES.proof][0], ROWID: '7200000000002' });
  await assert.rejects(fixture('flat', duplicateRows).store.readBundle(SUBMISSION_ROW_ID),
    { code: 'FORM2_EVIDENCE_AMBIGUOUS' });

  const missingRows = rows();
  missingRows[TABLES.prefill] = [];
  await assert.rejects(fixture('flat', missingRows).store.readBundle(SUBMISSION_ROW_ID),
    { code: 'FORM2_EVIDENCE_INVALID' });

  await assert.rejects(fixture().store.readBundle('1 OR 1=1'),
    { code: 'FORM2_EVIDENCE_INVALID' });
});
