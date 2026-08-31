'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');

const TABLES = Object.freeze({
  submission: 'Form2SubmissionsV3',
  prefill: 'Form2PrefillsV3',
  session: 'Form2SessionsV3Runtime',
  proof: 'Form2VerificationProofsV3',
});
const ROW_ID = /^[1-9][0-9]{0,29}$/;
const HASH = /^[a-f0-9]{64}$/;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRows(result, table) {
  invariant(Array.isArray(result), 'FORM2_EVIDENCE_UNAVAILABLE',
    'Form 2 evidence readback is invalid.', { httpStatus: 503 });
  return result.map((entry) => {
    const row = plain(entry?.[table]) ? entry[table] : entry;
    invariant(plain(row), 'FORM2_EVIDENCE_UNAVAILABLE',
      'Form 2 evidence readback is invalid.', { httpStatus: 503 });
    return { ...row };
  });
}

function withTimeout(operation, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new RevenueDeskError(
        'FORM2_EVIDENCE_UNAVAILABLE', 'Form 2 evidence read timed out.',
        { httpStatus: 503, retryable: true },
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createForm2EvidenceStore(app, { timeoutMs } = {}) {
  invariant(app && typeof app.zcql === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 5000,
  'INVALID_RUNTIME_CONFIGURATION', 'Form 2 evidence reader is unavailable.',
  { httpStatus: 503 });

  async function exact(table, column, value) {
    const permitted = (table === TABLES.submission && column === 'ROWID' && ROW_ID.test(value))
      || (table === TABLES.prefill && column === 'PREFILL_KEY' && HASH.test(value))
      || (table === TABLES.session && column === 'ROWID' && ROW_ID.test(value))
      || (table === TABLES.proof && column === 'SESSION_ROW_ID' && ROW_ID.test(value));
    invariant(permitted, 'FORM2_EVIDENCE_INVALID', 'Form 2 evidence identity is invalid.',
      { httpStatus: 409 });
    const rendered = column === 'ROWID' ? value : `'${value}'`;
    const statement = `SELECT * FROM ${table} WHERE ${column} = ${rendered} LIMIT 2`;
    let result;
    try {
      result = await withTimeout(() => app.zcql().executeZCQLQuery(statement), timeoutMs);
    } catch (error) {
      if (error instanceof RevenueDeskError) throw error;
      throw new RevenueDeskError('FORM2_EVIDENCE_UNAVAILABLE',
        'Form 2 evidence read failed.', { cause: error, httpStatus: 503, retryable: true });
    }
    const rows = unwrapRows(result, table);
    invariant(rows.length <= 1, 'FORM2_EVIDENCE_AMBIGUOUS',
      'Form 2 evidence ownership is ambiguous.', { httpStatus: 503 });
    return rows[0] || null;
  }

  async function readBundle(submissionRowId) {
    const submission = await exact(TABLES.submission, 'ROWID', submissionRowId);
    invariant(submission, 'FORM2_EVIDENCE_INVALID', 'Form 2 submission evidence is missing.',
      { httpStatus: 409 });
    const prefillKey = String(submission.PREFILL_KEY || '');
    const sessionRowId = String(submission.SESSION_ROW_ID || '');
    invariant(HASH.test(prefillKey) && ROW_ID.test(sessionRowId),
      'FORM2_EVIDENCE_INVALID', 'Form 2 submission evidence is malformed.',
      { httpStatus: 409 });
    const [prefill, session, proof] = await Promise.all([
      exact(TABLES.prefill, 'PREFILL_KEY', prefillKey),
      exact(TABLES.session, 'ROWID', sessionRowId),
      exact(TABLES.proof, 'SESSION_ROW_ID', sessionRowId),
    ]);
    invariant(prefill && session && proof, 'FORM2_EVIDENCE_INVALID',
      'Form 2 access evidence is incomplete.', { httpStatus: 409 });
    return Object.freeze({ submission, prefill, session, proof });
  }

  return Object.freeze({ readBundle });
}

module.exports = Object.freeze({ TABLES, createForm2EvidenceStore });
