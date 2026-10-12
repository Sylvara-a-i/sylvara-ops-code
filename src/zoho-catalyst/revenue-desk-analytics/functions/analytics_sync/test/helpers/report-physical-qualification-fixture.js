'use strict';
module.exports=function({schema,sha,crypto,cap,environment,REVISION,installSocketFixture,invoke}){
async function fixture(t,{readBooleanString=false,failRoot=false,holdClose=false,timeoutMs=1000,schemaVersion=3,wrongCapability=false}={}){
 const rows=new Map(),receipts=new Map(),pending=[];let next=1000000000;
 const network=installSocketFixture({plans:Array.from({length:13},()=>({manual:true,...(holdClose?{holdClose:true}:{})})),onRequest(r,control){
  const relative=r.path.replace('/baas/v1/project/123456789','');
  let data,statusCode=200;
  if(relative==='/table/123456787/row'){
   const row=r.body[0];const stored=schema.withNullColumns({...row,ROWID:String(++next),CREATORID:'987654321'},'eventReceipts');receipts.set(row.EVENT_KEY,stored);data=[stored];
  }else if(relative==='/table/123456788/row'){
   const row=r.body[0];
   if(failRoot){control.reset();return;}
   if(rows.has(row.IdempotencyKey)){statusCode=409;data={error_code:'DUPLICATE_VALUE'};}
   else{const stored=schema.withNullColumns({...row,ROWID:String(++next),CREATORID:'987654321'},'reportRuns');rows.set(row.IdempotencyKey,stored);
    data=[Object.fromEntries(Object.entries(stored).map(([k,v])=>[k,typeof v==='boolean'?String(v):v]))];}
   if(schemaVersion===5){control.respond({statusCode,body:{data}});return;}
   // Real constructor/dispatch callbacks must overlap before either response.
   pending.push(()=>control.respond({statusCode,body:{data}}));if(pending.length===2)pending.splice(0).forEach(f=>f());return;
  }else if(relative==='/query'){
   const q=r.body.query;
   if(q.startsWith('SELECT * FROM RevenueDeskEventReceipts ')){const key=/'([^']+)'/.exec(q)[1];data=receipts.has(key)?[{RevenueDeskEventReceipts:receipts.get(key)}]:[];}
   else{const key=/'([^']+)'/.exec(q)[1];let found=q.includes(' LIKE ')?[...rows].filter(([k])=>k.startsWith(key.slice(0,-1))).map(([,v])=>v).sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION):rows.has(key)?[rows.get(key)]:[];
    if(readBooleanString)found=found.map(r=>({...r,ActualEstimatedSeparated:'false'}));data=found.map(ReportRuns=>({ReportRuns}));}
  }else throw Error('UNAPPROVED_SYNTHETIC_REQUEST');
  control.respond({statusCode,body:{data}});
 }});t.after(()=>network.restore());
 const at=Date.now();
 const binding={schemaVersion,enabled:true,environment:'development',sourceRevision:REVISION,projectId:'123456789',controlHost:environment().ROUTE_CONTROL_HOST,tableId:'123456788',nonce:crypto.randomBytes(16).toString('hex'),
  capability:{region:'US',origin:'https://api.catalyst.zoho.com',controllerFunctionId:'123456786',deploymentId:'synthetic_controller',sdkVersion:'3.4.0',authMode:'user',authType:'admin',creatorPolicy:'observed_consistent_v1',
   tables:{reportRuns:{id:'123456788',name:'ReportRuns',schemaSha256:sha('synthetic-runs'),uniquenessSha256:sha('synthetic-runs-unique'),uniqueField:'IdempotencyKey',projectionSha256:cap.projectionDigest(cap.REPORT_FIELDS)},
    eventReceipts:{id:'123456787',name:'RevenueDeskEventReceipts',schemaSha256:sha('synthetic-receipts'),uniquenessSha256:sha('synthetic-receipts-unique'),uniqueField:'EVENT_KEY',projectionSha256:cap.projectionDigest(cap.RECEIPT_FIELDS)}},
   evidence:Object.fromEntries(['ownerAuthorization','ownership','access'].map(kind=>[kind,{digest:sha('synthetic-'+kind),verifiedAt:at-2,expiresAt:at+60000}]))},verifiedAt:at-1,expiresAt:at+60000,timeoutMs,singleAdmittedInvocation:true};
 if(wrongCapability)binding.capability.origin='https://other.invalid';
 const raw=JSON.stringify(binding);
 Object.assign(process.env,environment(),{X_ZOHO_CATALYST_ORG_ID:'987654321',REPORT_CONTROLLER_FUNCTION_ID:'123456786',REPORT_DEPLOYMENT_ID:'synthetic_controller',REPORT_STORAGE_QUALIFICATION_JSON:raw,REPORT_STORAGE_QUALIFICATION_SHA256:sha(raw)});
 return {network,rows,receipts,binding,run:()=>invoke({profile:'report_storage_qualification_v1',action:'qualify_storage'})};
}
return fixture;};
