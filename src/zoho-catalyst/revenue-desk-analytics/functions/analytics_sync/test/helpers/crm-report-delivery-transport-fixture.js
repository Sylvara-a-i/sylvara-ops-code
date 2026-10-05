'use strict';
const assert=require('node:assert/strict');
const {createCrmControlClient}=require('../../../../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/crm-client');
const {createManagedReportCrmSender}=require('../../lib/report-mail-sender');
const {createConnectionAuthorizationProvider}=require('../../lib/connection-boundary');

// Independently declared request contracts. A permissive "any GET" fixture would
// miss unselected fields and accidental reads using a write/mail Connection.
const DEAL_FIELDS=['id','Modified_Time','Intake_Submission_ID','Account_Name','Contact_Name',
 'Deployment_Record_ID','Configuration_Version','Test_Status','Test_Report_PDF_URL','Test_Report_Revision',
 'Test_Report_Recipient_Email','Test_Report_Recipient_Verified_At','Test_Report_Delivery_Status'];
const CONTACT_FIELDS=['id','Modified_Time','Account_Name','Email','Email_Opt_Out','Unsubscribed_Mode','Unsubscribed_Time'];
const MAIL_CONTACT_FIELDS=['id','Email','Email_Opt_Out','Unsubscribed_Mode','Unsubscribed_Time'];
const REQUEST_FIELDS=['id','Intake_Submission_ID','Modified_Time','Converted__s','Converted_Date_Time',
 'Converted_Account','Converted_Contact','Converted_Deal','Email','Email_Opt_Out','Unsubscribed_Mode','Unsubscribed_Time',
 'Entry_Offer','Submission_Channel','Free_Test_Contact_Consent','Free_Test_Contact_Consent_At',
 'Free_Test_Contact_Consent_Version','Free_Test_Request_Submitted_At','Intake_Form_Version'];
const API='https://www.zohoapis.com/crm/v8',NAME='7-Day Revenue Leak Test.pdf';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

/** Provider-shaped local transport, never native fetch. Envelopes follow:
 * /get-records.html, /get-email-rel-list.html, /view-email.html and /send-mail.html
 * under https://www.zoho.com/crm/developer/docs/api/v8/ . Attachment ID/body
 * equivalence here is synthetic; this does not qualify live ZFS semantics. */
async function createCrmReportDeliveryTransport(x,{outcome='accepted',scan='exact',timeoutMs=1000,readFault=null}={}){
 const requestEvidence=await x.options.crm.getReportRequestEvidence();
 let uploadCount=0,sendCount=0,detailReads=0,listReads=0,sent=null,file=null,lateReaderCancelled=false;
 const calls=[],connections=[],readSignals=[],state={requestInfo:{count:1,more_records:false,next_page_token:null},readFault};
 const tokens={synthetic_report_read:'Zoho-oauthtoken '+'r'.repeat(30),synthetic_report_mail:'Zoho-oauthtoken '+'m'.repeat(30)};
 const app={connections:()=>({async getConnectionCredentials(name){assert.ok(Object.hasOwn(tokens,name));connections.push(name);
  return {headers:{Authorization:tokens[name]},parameters:{}};}})};
 const fields=(u,expected)=>{
  const selected=u.searchParams.get('fields')?.split(',');assert.deepEqual(selected,expected);
  assert.ok(selected.length<=50);assert.equal(new Set(selected).size,selected.length);
 };
 const record=(value)=>({...structuredClone(value),$layout:{id:'synthetic_layout'},unrequested_private:'synthetic must be discarded'});
 async function fetchImpl(url,init){
  const u=new URL(url);assert.equal(u.origin+u.pathname.slice(0,7),API);
  calls.push({path:u.pathname,query:u.searchParams.toString(),method:init.method});
  x.f.runtime.clock.value++;
  const reader=init.headers.Authorization===tokens.synthetic_report_read;
  assert.ok(reader||init.headers.Authorization===tokens.synthetic_report_mail);
  if(reader){assert.equal(init.method,'GET');readSignals.push(init.signal);
   if(u.pathname==='/crm/v8/org'){assert.equal(u.searchParams.size,0);return json({org:[{zgid:'606'}]});}
   if(u.pathname===`/crm/v8/Deals/${x.b.dealId}`){fields(u,DEAL_FIELDS);assert.equal(u.searchParams.size,1);
    return json({data:[record(x.records.deal)]});}
   if(u.pathname===`/crm/v8/Contacts/${x.b.contactId}`){fields(u,CONTACT_FIELDS);assert.equal(u.searchParams.size,1);
    const row=record(x.records.contact);if(state.readFault==='missing_optout')delete row.Email_Opt_Out;
    return json({data:[row]});}
   if(u.pathname==='/crm/v8/Leads'){
    fields(u,REQUEST_FIELDS);assert.equal(u.searchParams.get('ids'),x.b.originalLeadId);
    assert.equal(u.searchParams.get('converted'),'true');assert.equal(u.searchParams.get('per_page'),'2');assert.equal(u.searchParams.size,4);
    const row=record({...requestEvidence,Modified_Time:'2026-08-20T12:00:00+00:00'});
    return json({data:[row],info:structuredClone(state.requestInfo)});
   }
   assert.fail('Unqualified CRM read endpoint');
  }
  assert.equal(init.redirect,'error');assert.equal(init.headers['Accept-Encoding'],'identity');
  if(u.pathname===`/crm/v8/Contacts/${x.b.contactId}`){assert.equal(init.method,'GET');fields(u,MAIL_CONTACT_FIELDS);
   return json({data:[record(x.records.contact)]});}
  if(u.pathname==='/crm/v8/files'){
   assert.equal(init.method,'POST');assert.equal(u.searchParams.size,0);uploadCount++;
   const part=init.body.get('file');assert.equal(part.name,NAME);assert.equal(part.type,'application/pdf');
   file=Buffer.from(await part.arrayBuffer());assert.ok(file.subarray(0,5).equals(Buffer.from('%PDF-')));
   if(outcome==='unknown_upload')throw Error('synthetic lost upload response');
   return json({data:[{code:'SUCCESS',status:'success',details:{name:NAME,id:'synthetic_zfs'}}]},201);
  }
  if(u.pathname===`/crm/v8/Contacts/${x.b.contactId}/actions/send_mail`){
   assert.equal(init.method,'POST');sendCount++;const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['data']);
   assert.equal(body.data.length,1);sent=body.data[0];assert.deepEqual(Object.keys(sent).sort(),
    ['from','to','org_email','subject','content','mail_format','attachments'].sort());
   assert.deepEqual(sent.to,[{email:x.proof.recipient.address}]);assert.equal(sent.org_email,true);assert.equal(sent.mail_format,'text');
   assert.equal(sent.from.email,'reports@example.invalid');assert.deepEqual(sent.attachments,[{id:'synthetic_zfs'}]);
   if(outcome==='rejected')return json({data:[{code:'NOT_ALLOWED',status:'error',message:'synthetic provider rejection'}]},400);
   if(outcome==='unknown_send')throw Error('synthetic lost send response');
   if(outcome==='timeout_send')return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){lateReaderCancelled=true;}}),
    {headers:{'content-type':'application/json'}});
   return json({data:[{code:'SUCCESS',status:'success',details:{message_id:'synthetic_message'}}]},202);
  }
  if(u.pathname===`/crm/v8/Contacts/${x.b.contactId}/Emails`){
   assert.equal(init.method,'GET');listReads++;
   if(u.searchParams.size===0)return json({Emails:[],info:{per_page:10,count:0,more_records:false,next_index:null,prev_index:'0'}});
   assert.equal(u.searchParams.get('type'),'sent_from_crm');
   const index=u.searchParams.get('index');assert.equal(u.searchParams.size,index===null?1:2);
   if(index===null)return json({Emails:[],info:{per_page:10,count:0,more_records:true,next_index:'synthetic_next',prev_index:'0'}});
   assert.equal(index,'synthetic_next');
   const candidate={subject:sent?.subject,message_id:'synthetic_message',sent:true,to:sent?.to,status:[{type:'sent'}]};
   const emails=sent?(scan==='duplicate'?[candidate,{...candidate,message_id:'second_message'}]:[candidate]):[];
   return json({Emails:emails,info:{per_page:10,count:emails.length,more_records:scan==='truncated'||scan==='repeated_index',
    next_index:scan==='repeated_index'?'synthetic_next':scan==='truncated'?'synthetic_final':null,prev_index:'0'}});
  }
  if(u.pathname===`/crm/v8/Contacts/${x.b.contactId}/Emails/synthetic_message`){
   assert.equal(init.method,'GET');assert.equal(u.searchParams.size,0);detailReads++;
   const detail={...sent,sent:true,editable:false,sent_time:new Date(x.f.now()).toISOString(),status:[{type:'sent'}],
    cc:null,bcc:null,attachments:[{id:scan==='wrong_attachment'?'other_zfs':'synthetic_zfs',name:NAME,size:String(file.length)}]};
   return json({Emails:[detail]});
  }
  assert.fail('Unqualified CRM mail endpoint');
 }
 const crm=createCrmControlClient({crmApiBaseUrl:API,crmOrganizationId:'606',platformTimeoutMs:1000},
  {readAuthorization:createConnectionAuthorizationProvider(app,'synthetic_report_read',1000),
   writeAuthorization:async()=>assert.fail('CRM reader requested write authorization'),fetchImpl});
 const sender=createManagedReportCrmSender({app,store:x.d.runs,now:x.f.now,fetchImpl,
  binding:{environment:'development',provider:'crm_native',apiOrigin:'https://www.zohoapis.com',
   fromAddress:'reports@example.invalid',fromName:'Sylvara',connectionReference:'synthetic_report_mail',
   contractQualificationDigest:'c'.repeat(64),senderQualificationDigest:'d'.repeat(64),
   verifiedAt:x.f.now()-1000,expiresAt:x.f.now()+3600000,timeoutMs,maxReconciliationPages:scan==='truncated'?2:3}});
 return {crm,sender,fetchImpl,tokens,calls,connections,state,readSignals,requestEvidence,
  get uploads(){return uploadCount;},get sends(){return sendCount;},get details(){return detailReads;},get lists(){return listReads;},
  get sent(){return sent;},get file(){return file;},get lateReaderCancelled(){return lateReaderCancelled;}};
}
module.exports={createCrmReportDeliveryTransport};
