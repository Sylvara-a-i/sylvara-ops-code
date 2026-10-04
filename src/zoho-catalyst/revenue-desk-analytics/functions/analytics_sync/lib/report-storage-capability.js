"use strict";
const crypto=require('node:crypto');
const {canonicalJson}=require('./facts');
const {reportRunProjection}=require('./report-run-store');
const {LEGACY_WINDOW_MS,diagnosticWindowMs}=require('./report-storage-window');
const issued=new WeakSet();
const HASH=/^[a-f0-9]{64}$/,ID=/^[1-9][0-9]{2,29}$/;
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const digest=v=>crypto.createHash('sha256').update(canonicalJson({projection:v})).digest('hex');
const REPORT_FIELDS=Object.freeze([...Object.keys(reportRunProjection({kind:'report_attempt_v1',identity:{clientId:'synthetic',deploymentId:'synthetic',periodStart:'1970-01-01',periodEnd:'1970-01-01'}})),
 'IdempotencyKey','ReportRunId','ReportPayloadJson','RD_REPORT_VERSION'].sort());
const RECEIPT_FIELDS=Object.freeze(['EVENT_KEY','RECEIPT_KIND','STATUS','EVENT_TYPE','EVENT_DATA_JSON','PAYLOAD_FINGERPRINT',
 'RECEIPT_VERSION','ATTEMPT_COUNT','SOURCE_REVISION','SOURCE_ENVIRONMENT','RECEIVED_AT','PROCESSED_AT'].sort());
// Provider responses may include omitted optional schema columns as null. This
// diagnostic never owns non-null values in these columns or arbitrary extras.
const NULL_COLUMNS=Object.freeze({
 reportRuns:Object.freeze(['RecipientSnapshotJson','GeneratedAt','ApprovedAt','ApprovedByRef','SentAt','SourceMetricHash','ErrorMessage']),
 eventReceipts:Object.freeze(['CALL_KEY','CORRELATION_ID','DEPLOYMENT_ID','CONFIGURATION_VERSION_ID','ROUTE_FINGERPRINT',
  'ROUTE_READBACK_FINGERPRINT','RELATED_EVENT_KEY','LEASE_TOKEN','LEASE_EXPIRES_AT','JOB_REFERENCE','ENQUEUED_AT','NEXT_ATTEMPT_AT','LAST_ERROR_CODE'])
});
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
/** Protected owner-reviewed deployment capability; not named token identity or provider least privilege.
 * Evidence hashes refer to independently retained metadata, not self-proving provider permission.
 */
function validateStorageCapability(c,{app,config,environment,now,verifiedAt,expiresAt,diagnosticContract}={}){
 let windowMs=LEGACY_WINDOW_MS;
 if(diagnosticContract!==undefined){
  if(config?.environment!=='development'||environment?.DEPLOYMENT_ENVIRONMENT!=='development'||String(app?.config?.environment).toLowerCase()!=='development')held();
  windowMs=diagnosticWindowMs(diagnosticContract);
 }
 if(!exact(c,['region','origin','controllerFunctionId','deploymentId','sdkVersion','authMode','authType','creatorPolicy','tables','evidence'])
  ||c.region!=='US'||c.origin!=='https://api.catalyst.zoho.com'||c.sdkVersion!=='3.4.0'
  ||c.creatorPolicy!=='observed_consistent_v1'||c.authMode!=='user'||c.authType!=='admin'||!ID.test(c.controllerFunctionId||'')
  ||c.controllerFunctionId!==environment.REPORT_CONTROLLER_FUNCTION_ID
  ||typeof c.deploymentId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(c.deploymentId)
  ||c.deploymentId!==environment.REPORT_DEPLOYMENT_ID
  ||!exact(c.tables,['reportRuns','eventReceipts'])||!exact(c.evidence,['ownerAuthorization','ownership','access']))held();
 for(const [role,name,unique,fields]of [['reportRuns','ReportRuns','IdempotencyKey',REPORT_FIELDS],
  ['eventReceipts','RevenueDeskEventReceipts','EVENT_KEY',RECEIPT_FIELDS]]){
  const t=c.tables[role];
  if(!exact(t,['id','name','schemaSha256','uniquenessSha256','uniqueField','projectionSha256'])
   ||!ID.test(t.id||'')||t.name!==name||t.uniqueField!==unique||!HASH.test(t.schemaSha256||'')
   ||!HASH.test(t.uniquenessSha256||'')||t.projectionSha256!==digest(fields))held();
 }
 if(c.tables.reportRuns.id===c.tables.eventReceipts.id)held();
 for(const e of Object.values(c.evidence)){
  if(!exact(e,['digest','verifiedAt','expiresAt'])
   ||!HASH.test(e.digest||'')||!Number.isSafeInteger(e.verifiedAt)||e.verifiedAt<0
   ||!Number.isSafeInteger(e.expiresAt)||e.verifiedAt>verifiedAt||verifiedAt-e.verifiedAt>windowMs
   ||diagnosticContract?.schemaVersion===4&&e.expiresAt-e.verifiedAt>windowMs
   ||e.expiresAt<expiresAt||now<e.verifiedAt||now>=e.expiresAt)held();
 }
 const root=require('node:path').dirname(require.resolve('zcatalyst-sdk-node/package.json'));
 const constants=require(require('node:path').join(root,'lib/utils/constants')).default;
 if(require(require('node:path').join(root,'package.json')).version!==c.sdkVersion
  ||constants.IS_LOCAL!=='false'||constants.CATALYST_ORIGIN!==c.origin
  ||String(app?.config?.projectId)!==String(config.projectId)
  ||String(app?.config?.environment).toLowerCase()!=='development'
  ||app?.credential?.getCurrentUser?.()!==c.authMode||app?.credential?.getCurrentUserType?.()!==c.authType)held();
 const copy=structuredClone(c);const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};freeze(copy);issued.add(copy);return copy;
}
function validateReportInsert(row){
 if(!exact(row,REPORT_FIELDS)||typeof row.ReportPayloadJson!=='string'||Buffer.byteLength(row.ReportPayloadJson)>9500)held();
 let e;try{e=JSON.parse(row.ReportPayloadJson);}catch{held();}
 if(canonicalJson(e)!==row.ReportPayloadJson||e.storageRevision!=='unique_insert_successor_v1'
  ||!exact(e,['storageRevision','key','version','owner','predecessor','rootDigest','state'])
  ||!HASH.test(e.key||'')||!Number.isSafeInteger(e.version)||e.version<1||e.version>2147483647
  ||!/^[a-f0-9]{32}$/.test(e.owner||'')||row.RD_REPORT_VERSION!==e.version)held();
 const expected=e.version===1?'revenue-desk-report-v1:'+e.key:'revenue-desk-report-v2:'+e.key+':'+String(e.version).padStart(10,'0');
 if(row.IdempotencyKey!==expected||row.ReportRunId!==expected
  ||(e.version===1?(e.predecessor!==null||e.rootDigest!==null):
   !HASH.test(e.rootDigest||'')||!exact(e.predecessor,['rowId','version','digest'])
   ||!/^[1-9][0-9]{0,29}$/.test(e.predecessor.rowId||'')||e.predecessor.version!==e.version-1||!HASH.test(e.predecessor.digest||'')))held();
 const expectedProjection=reportRunProjection(e.state);
 if(!Object.entries(expectedProjection).every(([k,v])=>row[k]===v))held();
}
function assertIssuedCapability(c){if(!issued.has(c))held();}
function validateStoredProjection(row,role){
 if(!Object.hasOwn(NULL_COLUMNS,role))held();
 const fields=role==='reportRuns'?REPORT_FIELDS:RECEIPT_FIELDS;
 if(!row||typeof row!=='object'||Array.isArray(row)||!fields.every(k=>Object.hasOwn(row,k))
  ||!Object.hasOwn(row,'ROWID')||!Object.hasOwn(row,'CREATORID')
  ||Object.keys(row).some(k=>!fields.includes(k)&&!['ROWID','CREATORID','MODIFIEDBY','CREATEDTIME','MODIFIEDTIME'].includes(k)
   &&(!NULL_COLUMNS[role].includes(k)||row[k]!==null)))held();
}
module.exports={assertIssuedCapability,validateStoredProjection,validateStorageCapability,validateReportInsert,REPORT_FIELDS,RECEIPT_FIELDS,projectionDigest:digest};
