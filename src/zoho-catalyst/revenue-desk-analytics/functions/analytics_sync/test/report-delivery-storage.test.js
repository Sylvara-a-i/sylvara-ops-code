'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {canonicalJson}=require('../lib/facts');
const {createReportDeliveryStorageReader}=require('../lib/report-delivery-storage');
const sha=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)||typeof x==='string'?x:canonicalJson(x)).digest('hex');
const clone=x=>structuredClone(x);
function fixture(){
 let at=1800000000000,downloads=0,reads=0;const bytes=Buffer.from('%PDF-1.7\n synthetic stored summary\n%%EOF\n');
 const b={clientId:'client_a',deploymentId:'test_a',dealId:'deal_a',accountId:'account_a',contactId:'contact_a',configurationVersion:'config_a',periodStart:'2026-09-01',periodEnd:'2026-09-08'};
 const generation=sha('summary'),bundleKey=sha('bundle'),scope={environment:'development',clientKey:sha('client'),deploymentKey:sha('test'),configurationVersion:'config_a',sourceRevision:'a'.repeat(40)};
 const binding={...b,scope,environment:'development',company:'Sylvara',externalSharing:false,ownerReviewRequired:true,
  parentId:'reports_a',parentParentId:'clients_a',organizationId:'org_a',teamFolderId:'team_a',writerId:'owner_a',
  accessApprovalDigest:sha('access'),retentionApprovalDigest:sha('retention'),contractQualificationDigest:sha('contract'),verifiedAt:at-1000,expiresAt:at+60000};
 const receipt={resourceId:'file_a',versionId:'version_a',versionNumber:'1',documentSha256:sha(bytes),parentId:'reports_a',status:'draft_generated_owner_review_required_delivery_not_authorized'};
 const ref={generationKey:generation,documentSha256:sha(bytes),privateReceiptKey:sha(`workdrive-draft-v1\0${generation}`),receiptSha256:sha(receipt)};
 const manifest={schemaVersion:1,initialDeliveryArtifact:'summary',supportingAvailability:'private',artifacts:{summary:ref,supporting:{generationKey:sha('supporting')}}};
 const bundle={key:bundleKey,version:1,state:{kind:'report_bundle_v1',phase:'accepted',identity:{...b,configurationVersionId:'config_a'},manifest,manifestSha256:sha(manifest)}};
 const draft={key:ref.privateReceiptKey,version:1,state:{kind:'workdrive_draft_v1',phase:'verified',identity:{...binding,format:'pdf',generationKey:generation,documentSha256:sha(bytes),byteLength:bytes.length,filename:`free-test-${generation}.pdf`},receipt}};
 const rows=new Map([[bundleKey,bundle],[ref.privateReceiptKey,draft]]);
 const parent={id:'reports_a',isFolder:true,parentId:'clients_a',organizationId:'org_a',teamFolderId:'team_a',name:'Reports',sizeBytes:0};
 const meta={id:'file_a',isFolder:false,parentId:'reports_a',organizationId:'org_a',teamFolderId:'team_a',name:draft.state.identity.filename,sizeBytes:bytes.length};
 const versions=[{resourceId:'file_a',versionId:'version_a',versionNumber:'1',sizeBytes:bytes.length}];
 const workdrive={getMetadata:async id=>clone(id==='reports_a'?parent:meta),listVersions:async()=>clone(versions),downloadVersion:async(id,selector)=>{downloads++;assert.equal(id,'file_a');assert.deepEqual(selector,{versionId:'version_a',versionNumber:'1'});return Buffer.from(bytes);}};
 const options={reportRunStore:{get:async key=>{reads++;return clone(rows.get(key));}},workdrive,readDestinationBinding:async()=>clone(binding),now:()=>at};
 const snapshot={binding:b,report:{generationKey:bundleKey,manifestSha256:sha(manifest),summary:{role:'summary',...ref}}};
 return {options,snapshot,bytes,bundle,draft,rows,binding,meta,parent,versions,get downloads(){return downloads;},get reads(){return reads;},advance:n=>at+=n,read:()=>createReportDeliveryStorageReader(options)({snapshot})};
}
const held=promise=>assert.rejects(promise,error=>error.code==='REPORT_DELIVERY_STORAGE_HELD');
test('reads only the accepted exact immutable summary and rechecks ledger',async()=>{const f=fixture();assert.deepEqual(await f.read(),f.bytes);assert.equal(f.downloads,1);assert.equal(f.reads,4);assert.equal('upload'in f.options.workdrive,false);});
test('cross-client or deployment bundle cannot dispatch download',async()=>{for(const key of ['clientId','deploymentId']){const f=fixture();f.bundle.state.identity[key]='other';await held(f.read());assert.equal(f.downloads,0);}});
test('incorrect bundle manifest or receipt hash is held',async()=>{const f=fixture();f.bundle.state.manifestSha256=sha('wrong');await held(f.read());assert.equal(f.downloads,0);const g=fixture();g.draft.state.receipt.versionNumber='2';await held(g.read());assert.equal(g.downloads,0);});
test('unverified or non-PDF stored draft is held',async()=>{for(const [key,value]of [['phase','upload_started'],['format','html']]){const f=fixture();if(key==='phase')f.draft.state[key]=value;else f.draft.state.identity[key]=value;await held(f.read());assert.equal(f.downloads,0);}});
test('wrong parent lineage or scope cannot dispatch download',async()=>{const f=fixture();f.parent.parentId='other_client';await held(f.read());assert.equal(f.downloads,0);const g=fixture();g.binding.scope.configurationVersion='other';await held(g.read());assert.equal(g.downloads,0);});
test('missing or ambiguous exact version is held',async()=>{const f=fixture();f.versions.length=0;await held(f.read());const g=fixture();g.versions.push(clone(g.versions[0]));await held(g.read());assert.equal(g.downloads,0);});
test('actual stored byte mismatch is never accepted',async()=>{const f=fixture();f.options.workdrive.downloadVersion=async()=>Buffer.from('%PDF-1.7\nwrong\n%%EOF');await held(f.read());});
test('concurrent receipt or bundle correction is detected after content read',async()=>{for(const row of ['draft','bundle']){const f=fixture();f.options.workdrive.downloadVersion=async()=>{f[row].version++;return f.bytes;};await held(f.read());}});
test('expired binding or changed parent after download is held',async()=>{const f=fixture();f.options.workdrive.downloadVersion=async()=>{f.advance(60001);return f.bytes;};await held(f.read());const g=fixture();g.options.workdrive.downloadVersion=async()=>{g.parent.parentId='moved';return g.bytes;};await held(g.read());});
test('already cancelled read performs no store or provider operation',async()=>{const f=fixture(),c=new AbortController();c.abort();await held(createReportDeliveryStorageReader(f.options)({snapshot:f.snapshot,signal:c.signal}));assert.equal(f.reads,0);assert.equal(f.downloads,0);});

test('actual delivery control reads persisted lowercase physical scope independently of CRM label',async()=>{
 const f=fixture();f.snapshot.binding.configurationVersion='crm_label';
 const full={...f.snapshot,nativeRelationshipEvidenceSha256:sha('native'),
  report:{...f.snapshot.report,completed:true,fresh:true,validated:true,sourceRevisionDigest:sha('source')},
  recipient:{contactId:'contact_a',address:'synthetic@example.com',explicitlySelected:true,verified:true,eligible:true,suppressed:null,suppressionStatus:'provider_enforcement_pending',consentEvidenceDigest:'a'.repeat(64),preflightEvidenceDigest:'b'.repeat(64),
   verificationDigest:sha('recipient'),verifiedAt:1800000000000-1000,expiresAt:1800000000000+60000}};
 const control=require('../lib/report-delivery-control').createReportDeliveryControl({
  store:{get:async()=>{},insert:async()=>{throw Error('unexpected write');},compareAndSwap:async()=>{throw Error('unexpected write');}},
  readSnapshot:async()=>clone(full),authorize:async()=>true,readSummary:createReportDeliveryStorageReader(f.options),
  sender:{sendSummary:async()=>{throw Error('unexpected send');},lookupAcceptance:async()=>null},now:()=>1800000000000});
 assert.equal((await control.view({dealId:'deal_a',actor:{}})).manifestSha256,f.snapshot.report.manifestSha256);
 assert.equal(f.downloads,1);assert.equal(f.reads,4);
});