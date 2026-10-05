'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),https=require('node:https'),http=require('node:http');
const {Writable,PassThrough}=require('node:stream');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const schema=require('./report-storage-schema-fixture');
function fixture({deferResponses=false,principalData,principalBody,principalStreamFailure=false,principalChunks,principalPrematureClose=false,credentialType,storageResponseTransform,storageSchema=false,providerTransport,storageBodyTransform}={}){
 let at=1800000000000;const rows=new Map(),receipts=new Map(),requests=[],principals=[],created=[];let sequence=0,authDelay=null,mode='normal',clientCalls=0;
 const binding={schemaVersion:1,enabled:true,environment:'development',sourceRevision:'a'.repeat(40),projectId:'123456789',
  controlHost:'synthetic.invalid',tableId:'123456788',nonce:'c'.repeat(32),verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000};
 const config={environment:'development',sourceRevision:binding.sourceRevision,controlHost:binding.controlHost,
  expectedProjectIdSha256:sha(binding.projectId),operatorIdHash:'operator_'+sha('synthetic')};
 let user='user';
 let app={config:{projectId:binding.projectId,projectKey:'synthetic-key',environment:'Development'},
  credential:{switchUser(value){user=value;principals.push(value);},getCurrentUser:()=>user,getCurrentUserType:()=> 'admin'},
  async authenticateRequest(request){if(authDelay)await authDelay;request.headers.Authorization='synthetic-managed-credential';}};
 if(credentialType){
  assert.ok(['admin','user'].includes(credentialType));
  const path=require('node:path'),root=path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
  const {CatalystCredential}=require(path.join(root,'lib/utils/credential'));
  const {CatalystApp}=require(path.join(root,'lib/catalyst-app'));
  const {CREDENTIAL_HEADER}=require(path.join(root,'lib/utils/constants')).default;
  const credential=new CatalystCredential({adminType:'token',adminToken:'synthetic-admin-token',
   [CREDENTIAL_HEADER.user_token]:'synthetic-user-token',[CREDENTIAL_HEADER.user_cred_type]:'token',[CREDENTIAL_HEADER.user]:credentialType});
  app=new CatalystApp({project_id:binding.projectId,project_key:'synthetic-key',environment:'Development',credential});
 }
 function query(sql){
  const receiptKey=/EVENT_KEY = '([^']+)'/.exec(sql)?.[1];
  if(receiptKey)return receipts.has(receiptKey)?[{RevenueDeskEventReceipts:structuredClone(receipts.get(receiptKey))}]:[];
  const key=/IdempotencyKey = '([^']+)'/.exec(sql)?.[1];
  if(key)return [...rows.values()].filter(r=>r.IdempotencyKey===key).slice(0,2).map(r=>({ReportRuns:structuredClone(r)}));
  const prefix=/IdempotencyKey LIKE '([^']+)%'/.exec(sql)?.[1];
  return [...rows.values()].filter(r=>r.IdempotencyKey.startsWith(prefix)).sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION).slice(0,2).map(r=>({ReportRuns:structuredClone(r)}));
 }
 const originalHttps=https.request,originalHttp=http.request;
 https.request=function(options,callback){
  clientCalls++;const parts=[];let request;
  request=new Writable({autoDestroy:false,write(chunk,_encoding,done){parts.push(Buffer.from(chunk));done();},final(done){
   const bytes=Buffer.concat(parts);const payload=bytes.length?JSON.parse(bytes):null;requests.push({path:options.path,payload,method:options.method});
   const principal=options.headers['X-CATALYST-USER'];
   assert.ok(['admin','user'].includes(principal));
   if(providerTransport&&credentialType)assert.ok(['Zoho-oauthtoken synthetic-user-token','Zoho-oauthtoken synthetic-admin-token'].includes(options.headers.Authorization));
   else assert.equal(options.headers.Authorization,credentialType?'Zoho-oauthtoken synthetic-user-token':'synthetic-managed-credential');
   if(!providerTransport)assert.equal(principal,credentialType||'admin');
   const path=options.path.replace(`/baas/v1/project/${binding.projectId}`,'');
   (deferResponses?setImmediate:queueMicrotask)(async()=>{
    if(mode==='network_error'){request.destroy(new Error('synthetic socket error'));return;}
    if(mode==='stall')return;
    let status=200,data;
    const provided=providerTransport?await providerTransport({path,payload,method:options.method,principal}):null;
    if(provided){status=provided.status||200;data=provided.data;}
    else if(path==='/query')data=query(payload.query);
    else if(path==='/project-user/current')data=principalData === undefined ? {user_id:'987654321',status:'ACTIVE',role_details:{role_name:'App Administrator',role_id:'987654320'},email_id:'private-unused@example.invalid'} : principalData;
    else if(['/table/RevenueDeskEventReceipts/row','/table/123456787/row'].includes(path)){
     assert.equal(payload.length,1);const row=payload[0];
     if(storageSchema&&schema.missingMandatory(row,'eventReceipts').length){status=400;data={error_code:'INVALID_DATA'};}
     else if(receipts.has(row.EVENT_KEY)){status=409;data={error_code:'DUPLICATE_VALUE'};}
     else {row.ROWID=String(++sequence);row.CREATORID='987654321';
      if(mode==='admission_representation'){row.RECEIPT_VERSION='1';row.ATTEMPT_COUNT='0';row.RECEIVED_AT='2027-01-15 08:00:00';row.PROCESSED_AT=row.RECEIVED_AT;}
      const stored=storageSchema?schema.withNullColumns(row,'eventReceipts'):row;
      receipts.set(row.EVENT_KEY,structuredClone(stored));data=[stored];}
     if(mode==='admission_stall')return;
     if(mode==='admission_lost'){request.destroy(new Error('synthetic ambiguous admission'));return;}
     if(mode==='admission_conflict')receipts.get(row.EVENT_KEY).EVENT_DATA_JSON='{}';
    }
    else {assert.ok(['/table/ReportRuns/row','/table/123456788/row'].includes(path));assert.equal(payload.length,1);
     const row=payload[0];if(mode==='report_invalid_data'||storageSchema&&schema.missingMandatory(row,'reportRuns').length){status=400;data={error_code:'INVALID_DATA'};}
     else if(rows.has(row.IdempotencyKey)&&mode!=='uniqueness_broken'){status=409;data={error_code:'DUPLICATE_VALUE'};}
     else {row.ROWID=String(++sequence);row.CREATORID='987654321';const stored=storageSchema?schema.withNullColumns(row,'reportRuns'):row;
      rows.set(mode==='uniqueness_broken'&&rows.has(row.IdempotencyKey)?row.ROWID:row.IdempotencyKey,structuredClone(stored));data=[stored];}}
    if(mode==='lost_insert'&&['/table/ReportRuns/row','/table/123456788/row'].includes(path)){request.destroy(new Error('synthetic response lost after insert'));return;}
    if(storageResponseTransform&&path!=='/project-user/current')storageResponseTransform({path,data,rows,receipts});
    const stream=new PassThrough();stream.statusCode=status;stream.headers={'content-type':'application/json'};
    callback(stream);request.emit('response',stream);
    if(path==='/project-user/current'&&principalStreamFailure){stream.destroy(new Error('private synthetic stream failure'));return;}
    if(path==='/project-user/current'&&principalPrematureClose){stream.write('{');stream.destroy();return;}
    if(path==='/project-user/current'&&principalChunks){for(const chunk of principalChunks)stream.write(chunk);stream.end();}
    else if(path==='/project-user/current'&&principalBody!==undefined)stream.end(principalBody);
    else if(mode==='oversize')stream.end('x'.repeat(65537));else stream.end(storageBodyTransform?storageBodyTransform({path,data}):JSON.stringify({data}));
   });done();}});
  request.method='POST';request.protocol='https:';request.host='synthetic.invalid';request.path=options.path;created.push(request);return request;
 };
 http.request=()=>{throw Error('HTTP/network prohibited');};
 return {app,rows,receipts,requests,principals,created,get clientCalls(){return clientCalls;},set mode(v){mode=v;},set authDelay(v){authDelay=v;},restore(){https.request=originalHttps;http.request=originalHttp;}};
}


module.exports={fixture};
