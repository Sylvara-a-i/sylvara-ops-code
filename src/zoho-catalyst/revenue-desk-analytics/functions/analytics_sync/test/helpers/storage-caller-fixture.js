'use strict';
// Synthetic reviewed-shape caller. No tenant values, live activation or endpoint.
const crypto = require('node:crypto');
const NOW = 1800000000000;
const EXPIRES = NOW + 120000;
const DIGEST = 'a'.repeat(64);
const SUMMARY = ['status', 'mechanism', 'operationDigest', 'evidenceDigest', 'observedAt',
  'physicalRows', 'reads', 'inserts', 'overlappingRounds', 'admissionReads', 'admissionInserts',
  'admissionEvidenceDigest', 'creatorProvenance', 'namedIdentityVerified', 'durableAdmissionObserved',
  'singleAdmittedInvocationRequired', 'qualificationAuthority', 'deliveryAuthority'];
const EXPECTED = { status: 'storage_unique_successor_observed', mechanism: 'unique_insert_successor_v1',
  physicalRows: 2, reads: 7, inserts: 4, overlappingRounds: 2, admissionReads: 1, admissionInserts: 1,
  creatorProvenance: 'observed_consistent_v1', namedIdentityVerified: false, durableAdmissionObserved: true,
  singleAdmittedInvocationRequired: true, qualificationAuthority: false, deliveryAuthority: false };
const unknown = status => JSON.stringify({ status, concurrencyProven: false, namedIdentityVerified: false,
  qualificationAuthority: false, deliveryAuthority: false });
const clauses = [
  'received_at.toString().matches("^[0-9]{13}$")', 'envelope != null', 'result != null',
  'envelope.size() == 3', 'envelope.get("ok") == true', 'envelope.get("action") == "qualify_storage"',
  'result.size() == 18',
  ...Object.entries(EXPECTED).map(([key, value]) => 'result.get("' + key + '") == ' + JSON.stringify(value)),
  'result.get("operationDigest") == "__OPERATION_DIGEST__"',
  'result.get("evidenceDigest").toString().matches("^[a-f0-9]{64}$")',
  'result.get("admissionEvidenceDigest").toString().matches("^[a-f0-9]{64}$")',
  'result.get("observedAt").toString().matches("^[0-9]{13}$")',
  'result.get("observedAt").toLong() >= __VERIFIED_AT__',
  'result.get("observedAt").toLong() < __EXPIRES_AT__',
  'result.get("observedAt").toLong() <= received_at',
  'received_at >= dispatch_at + 1000', 'received_at + 1000 - dispatch_at <= 40000',
  'received_at >= __VERIFIED_AT__', 'received_at + 1000 <= __EXPIRES_AT__'
];
const templateText = `string standalone.synthetic_storage_caller()
{
result_message = ${JSON.stringify(unknown('held_not_dispatched'))};
try
{
\tapprove_url = "https://synthetic.invalid/approve";
\tdispatch_utc = zoho.currenttime.toString("dd-MMM-yyyy HH:mm:ss","UTC");
\tdispatch_at = dispatch_utc.unixEpoch("UTC");
\t// DISPATCH_PREDICATE
\tif(dispatch_at.toString().matches("^[0-9]{13}$") && approve_url == "https://synthetic.invalid/approve" && "__OPERATION_DIGEST__".matches("^[a-f0-9]{64}$") && __TIMEOUT_MS__ == 25000 && dispatch_at >= __VERIFIED_AT__ && dispatch_at + 1000 + __TIMEOUT_MS__ + 1000 <= __EXPIRES_AT__)
\t{
\t\tbody = __ACTIVATION_COMMAND_JSON__.toMap();
\t\theaders = Map();
\t\theaders.put("Content-Type","application/json");
\t\tresult_message = ${JSON.stringify(unknown('unknown_no_retry'))};
\t\tresponse = invokeurl
\t\t[
\t\t\turl :approve_url
\t\t\ttype :POST
\t\t\tbody:body.toString()
\t\t\theaders:headers
\t\t\tdetailed:true
\t\t\tconnection:"synthetic_managed"
\t\t\tresponse-format:STRING
\t\t];
\t\treceived_utc = zoho.currenttime.toString("dd-MMM-yyyy HH:mm:ss","UTC");
\t\treceived_at = received_utc.unixEpoch("UTC");
\t\tresponse_text = ifnull(response.get("responseText"),"").toString();
\t\t// RESPONSE_PREDICATE
\t\tif(ifnull(response.get("responseCode"),"").toString() == "200" && response_text.length() > 0 && response_text.length() <= 4096)
\t\t{
\t\t\tenvelope = response_text.toMap();
\t\t\tresult = envelope.get("result");
\t\t\t// ACCEPTANCE_PREDICATE
\t\t\tif(${clauses.join(' && ')})
\t\t\t{
\t\t\t\tsummary = Map();
${SUMMARY.map(key => '\t\t\t\tsummary.put("' + key + '",result.get("' + key + '"));').join('\n')}
\t\t\t\tresult_message = summary.toString();
\t\t\t}
\t\t}
\t}
}
catch (ignored)
{
\tresult_message = ${JSON.stringify(unknown('unknown_no_retry'))};
}
return result_message;
}
`;
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const command = { action: 'qualify_storage', profile: 'report_storage_qualification_v1', activation: {
  schemaVersion: 1, operationDigest: DIGEST, verifiedAt: NOW, expiresAt: EXPIRES } };
const callerText = templateText.replaceAll('__ACTIVATION_COMMAND_JSON__', JSON.stringify(JSON.stringify(command)))
  .replaceAll('__OPERATION_DIGEST__', DIGEST).replaceAll('__VERIFIED_AT__', String(NOW))
  .replaceAll('__EXPIRES_AT__', String(EXPIRES)).replaceAll('__TIMEOUT_MS__', '25000');
function responseFixture(observedAt = NOW + 2000) {
  return { dispatchAt: NOW, receivedAt: NOW + 2000, response: { responseCode: 200,
    responseText: JSON.stringify({ ok: true, action: 'qualify_storage', result: { ...EXPECTED,
      operationDigest: DIGEST, evidenceDigest: 'b'.repeat(64), admissionEvidenceDigest: 'c'.repeat(64), observedAt } }) } };
}
module.exports = { NOW, EXPIRES, DIGEST, SUMMARY, EXPECTED, clauses, templateText, callerText, sha, responseFixture };
