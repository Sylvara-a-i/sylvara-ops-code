'use strict';
// Pure, opt-in source transformation. This is not a native Deluge compiler.
const crypto = require('node:crypto');
const { types } = require('node:util');
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const PREFIX = 'scd_';
const UNKNOWN = '{"status":"unknown_no_retry","concurrencyProven":false,"namedIdentityVerified":false,"qualificationAuthority":false,"deliveryAuthority":false}';
const HELD = UNKNOWN.replace('unknown_no_retry', 'held_not_dispatched');
const RESPONSE = 'ifnull(response.get("responseCode"),"").toString() == "200" && response_text.length() > 0 && response_text.length() <= 4096';
const FIELDS = Object.freeze(['status', 'mechanism', 'operationDigest', 'evidenceDigest', 'observedAt',
  'physicalRows', 'reads', 'inserts', 'overlappingRounds', 'admissionReads', 'admissionInserts',
  'admissionEvidenceDigest', 'creatorProvenance', 'namedIdentityVerified', 'durableAdmissionObserved',
  'singleAdmittedInvocationRequired', 'qualificationAuthority', 'deliveryAuthority']);
const FLAGS = Object.freeze(['responseCaptured', 'receiptClockCaptured', 'bodyTextCaptured', 'bodyParsed', 'resultCaptured']);
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
function held() { throw new Error('STORAGE_CALLER_DIAGNOSTICS_HELD'); }
function exact(input) {
  if (!input || typeof input !== 'object' || types.isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).length !== 2) held();
  for (const key of ['callerText', 'callerSha256']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) held();
  }
}
function literal(line, expression) {
  const match = expression.exec(line);
  if (!match) held();
  let value;
  try { value = JSON.parse(match[1]); } catch { held(); }
  if (typeof value !== 'string' || !value || JSON.stringify(value) !== match[1]) held();
  return { text: match[1], value };
}
function acceptanceClauses(digest, verifiedAt, expiresAt) {
  return [
    'received_at.toString().matches("^[0-9]{13}$")', 'envelope != null', 'result != null',
    'envelope.size() == 3', 'envelope.get("ok") == true', 'envelope.get("action") == "qualify_storage"',
    'result.size() == 18', 'result.get("status") == "storage_unique_successor_observed"',
    'result.get("mechanism") == "unique_insert_successor_v1"', 'result.get("physicalRows") == 2',
    'result.get("reads") == 7', 'result.get("inserts") == 4', 'result.get("overlappingRounds") == 2',
    'result.get("admissionReads") == 1', 'result.get("admissionInserts") == 1',
    'result.get("creatorProvenance") == "observed_consistent_v1"', 'result.get("namedIdentityVerified") == false',
    'result.get("durableAdmissionObserved") == true', 'result.get("singleAdmittedInvocationRequired") == true',
    'result.get("qualificationAuthority") == false', 'result.get("deliveryAuthority") == false',
    `result.get("operationDigest") == "${digest}"`,
    'result.get("evidenceDigest").toString().matches("^[a-f0-9]{64}$")',
    'result.get("admissionEvidenceDigest").toString().matches("^[a-f0-9]{64}$")',
    'result.get("observedAt").toString().matches("^[0-9]{13}$")',
    `result.get("observedAt").toLong() >= ${verifiedAt}`,
    `result.get("observedAt").toLong() < ${expiresAt}`,
    'result.get("observedAt").toLong() <= received_at',
    'received_at >= dispatch_at + 1000', 'received_at + 1000 - dispatch_at <= 40000',
    `received_at >= ${verifiedAt}`, `received_at + 1000 <= ${expiresAt}`,
  ];
}
// Matching the complete supported frame rejects extra statements, changed guards,
// duplicate anchors and altered summary projection. Opaque private literals stay local.
function inspect(text) {
  const lines = text.split('\n');
  if (lines.length !== 67 || !/^string (?:standalone|automation)\.[A-Za-z][A-Za-z0-9_]*\(\)$/.test(lines[0])) held();
  const route = literal(lines[5], /^\tapprove_url = ("(?:[^"\\]|\\.)*");$/);
  const body = literal(lines[11], /^\t\tbody = ("(?:[^"\\]|\\.)*")\.toMap\(\);$/);
  const connection = literal(lines[22], /^\t\t\tconnection:("(?:[^"\\]|\\.)*")$/);
  const acceptance = /^\t\t\tif\((.*)\)$/.exec(lines[34]);
  if (!acceptance) held();
  const digest = /result\.get\("operationDigest"\) == "([a-f0-9]{64})"/.exec(acceptance[1])?.[1];
  const verifiedAt = /result\.get\("observedAt"\)\.toLong\(\) >= ([0-9]{13})/.exec(acceptance[1])?.[1];
  const expiresAt = /result\.get\("observedAt"\)\.toLong\(\) < ([0-9]{13})/.exec(acceptance[1])?.[1];
  if (!digest || !verifiedAt || !expiresAt || Number(expiresAt) <= Number(verifiedAt)) held();
  const clauses = acceptanceClauses(digest, verifiedAt, expiresAt);
  if (acceptance[1] !== clauses.join(' && ')) held();
  let command;
  try { command = JSON.parse(body.value); } catch { held(); }
  if (!command || Object.keys(command).sort().join(',') !== 'action,activation,profile'
    || command.profile !== 'report_storage_qualification_v1' || command.action !== 'qualify_storage'
    || command.activation?.schemaVersion !== 1 || command.activation.operationDigest !== digest
    || command.activation.verifiedAt !== Number(verifiedAt) || command.activation.expiresAt !== Number(expiresAt)) held();
  const dispatch = 'dispatch_at.toString().matches("^[0-9]{13}$")'
    + ` && approve_url == ${route.text} && "${digest}".matches("^[a-f0-9]{64}$") && 25000 == 25000`
    + ` && dispatch_at >= ${verifiedAt} && dispatch_at + 1000 + 25000 + 1000 <= ${expiresAt}`;
  const expected = [lines[0], '{', `result_message = ${JSON.stringify(HELD)};`, 'try', '{',
    `\tapprove_url = ${route.text};`, '\tdispatch_utc = zoho.currenttime.toString("dd-MMM-yyyy HH:mm:ss","UTC");',
    '\tdispatch_at = dispatch_utc.unixEpoch("UTC");', '\t// DISPATCH_PREDICATE', `\tif(${dispatch})`, '\t{',
    `\t\tbody = ${body.text}.toMap();`, '\t\theaders = Map();', '\t\theaders.put("Content-Type","application/json");',
    `\t\tresult_message = ${JSON.stringify(UNKNOWN)};`, '\t\tresponse = invokeurl', '\t\t[', '\t\t\turl :approve_url',
    '\t\t\ttype :POST', '\t\t\tbody:body.toString()', '\t\t\theaders:headers', '\t\t\tdetailed:true',
    `\t\t\tconnection:${connection.text}`, '\t\t\tresponse-format:STRING', '\t\t];',
    '\t\treceived_utc = zoho.currenttime.toString("dd-MMM-yyyy HH:mm:ss","UTC");',
    '\t\treceived_at = received_utc.unixEpoch("UTC");', '\t\tresponse_text = ifnull(response.get("responseText"),"").toString();',
    '\t\t// RESPONSE_PREDICATE', `\t\tif(${RESPONSE})`, '\t\t{', '\t\t\tenvelope = response_text.toMap();',
    '\t\t\tresult = envelope.get("result");', '\t\t\t// ACCEPTANCE_PREDICATE', `\t\t\tif(${acceptance[1]})`, '\t\t\t{',
    '\t\t\t\tsummary = Map();', ...FIELDS.map(key => `\t\t\t\tsummary.put("${key}",result.get("${key}"));`),
    '\t\t\t\tresult_message = summary.toString();', '\t\t\t}', '\t\t}', '\t}', '}', 'catch (ignored)', '{',
    `\tresult_message = ${JSON.stringify(UNKNOWN)};`, '}', 'return result_message;', '}', ''];
  if (text !== expected.join('\n')) held();
  return clauses;
}
function diagnosticBlock(clauses) {
  const observation = 27; // Zero-based index in the exact supported predicate.
  const lines = [`if(result_message == ${JSON.stringify(UNKNOWN)})`, '{', '\ttry', '\t{',
    '\t\tscd_stage = "diagnostic_unavailable";', '\t\tscd_first = 0;',
    '\t\tscd_other_checked = false;', '\t\tscd_other_passed = false;',
    '\t\tscd_observation_checked = false;', '\t\tscd_observation_passed = false;',
    '\t\tif(scd_responseCaptured)', '\t\t{',
    '\t\t\tif(ifnull(response.get("responseCode"),"").toString() != "200")',
    '\t\t\t{', '\t\t\t\tscd_stage = "http_status";', '\t\t\t}', '\t\t\telse', '\t\t\t{',
    '\t\t\t\tif(scd_bodyTextCaptured == false)', '\t\t\t\t{', '\t\t\t\t\tscd_stage = "body_unavailable";', '\t\t\t\t}',
    '\t\t\t\telse if(response_text.length() == 0)', '\t\t\t\t{', '\t\t\t\t\tscd_stage = "body_empty";', '\t\t\t\t}',
    '\t\t\t\telse if(response_text.length() > 4096)', '\t\t\t\t{', '\t\t\t\t\tscd_stage = "body_oversize";', '\t\t\t\t}',
    '\t\t\t\telse if(scd_bodyParsed == false)', '\t\t\t\t{', '\t\t\t\t\tscd_stage = "body_parse";', '\t\t\t\t}',
    '\t\t\t\telse if(scd_receiptClockCaptured && scd_resultCaptured)', '\t\t\t\t{',
    '\t\t\t\t\tscd_other_checked = true;', '\t\t\t\t\tscd_other_passed = true;'];
  clauses.forEach((clause, index) => {
    const indent = '\t'.repeat(5), name = `scd_clause_${index + 1}`;
    lines.push(`${indent}${name}_checked = false;`, `${indent}${name}_passed = false;`, `${indent}try`, `${indent}{`,
      `${indent}\t${name}_passed = (${clause});`, `${indent}\t${name}_checked = true;`, `${indent}}`,
      `${indent}catch (scd_ignored_${index + 1})`, `${indent}{`, `${indent}\t${name}_checked = false;`, `${indent}}`,
      `${indent}if(${name}_passed == false && scd_first == 0)`, `${indent}{`, `${indent}\tscd_first = ${index + 1};`, `${indent}}`);
    if (index === observation) {
      lines.push(`${indent}scd_observation_checked = ${name}_checked;`, `${indent}scd_observation_passed = ${name}_passed;`);
    } else {
      lines.push(`${indent}if(${name}_checked == false)`, `${indent}{`, `${indent}\tscd_other_checked = false;`, `${indent}}`,
        `${indent}if(${name}_passed == false)`, `${indent}{`, `${indent}\tscd_other_passed = false;`, `${indent}}`);
    }
  });
  lines.push('\t\t\t\t\tif(scd_first > 0)', '\t\t\t\t\t{', '\t\t\t\t\t\tscd_stage = "acceptance_predicate";', '\t\t\t\t\t}',
    '\t\t\t\t\tif(scd_other_checked && scd_other_passed && scd_observation_checked && scd_observation_passed == false)',
    '\t\t\t\t\t{', '\t\t\t\t\t\tif(received_at < result.get("observedAt").toLong() && result.get("observedAt").toLong() < received_at + 1000)',
    '\t\t\t\t\t\t{', '\t\t\t\t\t\t\tscd_stage = "receipt_second_guard_only";', '\t\t\t\t\t\t}', '\t\t\t\t\t}',
    '\t\t\t\t}', '\t\t\t}', '\t\t}', '\t\tscd_diagnostic = Map();', '\t\tscd_diagnostic.put("schemaVersion",1);',
    '\t\tscd_diagnostic.put("rejectionStage",scd_stage);');
  for (const flag of FLAGS) lines.push(`\t\tscd_diagnostic.put("${flag}",scd_${flag});`);
  lines.push('\t\tscd_diagnostic.put("allOtherAcceptanceChecksChecked",scd_other_checked);',
    '\t\tscd_diagnostic.put("allOtherAcceptanceChecksPassed",scd_other_passed);',
    '\t\tscd_diagnostic.put("observationNotAfterReceiptFloorChecked",scd_observation_checked);',
    '\t\tscd_diagnostic.put("observationNotAfterReceiptFloor",scd_observation_passed);',
    '\t\tif(scd_first > 0)', '\t\t{', '\t\t\tscd_diagnostic.put("firstFailedAcceptanceClause",scd_first);', '\t\t}',
    '\t\tscd_output = Map();', '\t\tscd_output.put("status","unknown_no_retry");',
    '\t\tscd_output.put("concurrencyProven",false);', '\t\tscd_output.put("namedIdentityVerified",false);',
    '\t\tscd_output.put("qualificationAuthority",false);', '\t\tscd_output.put("deliveryAuthority",false);',
    '\t\tscd_output.put("diagnostic",scd_diagnostic);', '\t\tresult_message = scd_output.toString();', '\t}',
    '\tcatch (scd_ignored)', '\t{', `\t\tresult_message = ${JSON.stringify(UNKNOWN)};`, '\t}', '}', '');
  return lines.join('\n');
}
function instrumentStorageCaller(input) {
  exact(input);
  const { callerText, callerSha256 } = input;
  if (typeof callerText !== 'string' || callerText.length > 65536
    || !/^[\x09\x0a\x20-\x7e]+$(?![\s\S])/.test(callerText) || !callerText.endsWith('\n')
    || typeof callerSha256 !== 'string' || !HASH.test(callerSha256) || sha(callerText) !== callerSha256
    || callerText.includes(PREFIX) || /__[A-Z_]+__/.test(callerText)) held();
  const clauses = inspect(callerText);
  let text = callerText.replace('\ntry\n', '\n' + FLAGS.map(flag => `scd_${flag} = false;`).join('\n') + '\ntry\n');
  const captures = [
    ['\t\t];\n', '\t\tscd_responseCaptured = true;\n'],
    ['\t\treceived_at = received_utc.unixEpoch("UTC");\n', '\t\tscd_receiptClockCaptured = true;\n'],
    ['\t\tresponse_text = ifnull(response.get("responseText"),"").toString();\n', '\t\tscd_bodyTextCaptured = true;\n'],
    ['\t\t\tenvelope = response_text.toMap();\n', '\t\t\tscd_bodyParsed = true;\n'],
    ['\t\t\tresult = envelope.get("result");\n', '\t\t\tscd_resultCaptured = true;\n'],
  ];
  for (const [anchor, capture] of captures) text = text.replace(anchor, anchor + capture);
  text = text.replace('return result_message;\n', diagnosticBlock(clauses) + 'return result_message;\n');
  return Object.freeze({ text, sha256: sha(text), bytes: Buffer.byteLength(text, 'utf8'), baseCallerSha256: callerSha256,
    diagnosticSchemaVersion: 1, grantsExecutionAuthority: false, providerActions: 0 });
}
module.exports = Object.freeze({ instrumentStorageCaller });
