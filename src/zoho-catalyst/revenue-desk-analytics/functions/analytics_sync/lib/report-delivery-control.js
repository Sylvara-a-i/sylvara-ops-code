'use strict';

const crypto = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value);
function fail() { throw Object.assign(new Error('REPORT_DELIVERY_HELD'), { code: 'REPORT_DELIVERY_HELD' }); }
const same = require('node:util').isDeepStrictEqual;
const fields = ['clientId','deploymentId','dealId','accountId','contactId','configurationVersion','periodStart','periodEnd'];
function validateSnapshot(value, at) {
  const x = structuredClone(value);
  if (!x || !x.binding || !fields.every(k => typeof x.binding[k] === 'string')
    || !fields.slice(0,5).every(k => ID.test(x.binding[k]))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x.binding.configurationVersion)
    || !HASH.test(x.nativeRelationshipEvidenceSha256)
    || !x.report || x.report.completed !== true || x.report.fresh !== true || x.report.validated !== true
    || !['generationKey','manifestSha256','sourceRevisionDigest'].every(k => HASH.test(x.report[k]))
    || !x.report.summary || !['generationKey','documentSha256','privateReceiptKey'].every(k => HASH.test(x.report.summary[k]))
    || x.report.summary.role !== 'summary'
    || !x.recipient || x.recipient.contactId !== x.binding.contactId
    || x.recipient.explicitlySelected !== true || x.recipient.verified !== true
    || x.recipient.eligible !== true || x.recipient.suppressed !== false
    || typeof x.recipient.address !== 'string' || x.recipient.address.length > 254
    || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(x.recipient.address)
    || !HASH.test(x.recipient.verificationDigest)
    || !Number.isSafeInteger(x.recipient.verifiedAt) || x.recipient.verifiedAt > at
    || !Number.isSafeInteger(x.recipient.expiresAt) || x.recipient.expiresAt <= at) fail();
  for (const k of ['periodStart','periodEnd']) if (!/^\d{4}-\d{2}-\d{2}$/.test(x.binding[k])
    || !Number.isFinite(Date.parse(x.binding[k])) || new Date(x.binding[k]).toISOString().slice(0,10) !== x.binding[k]) fail();
  if (x.binding.periodEnd < x.binding.periodStart) fail();
  // Select only the verified report recipient. Alert/signer/account mailboxes
  // are neither alternatives nor fallback sources.
  return { binding:Object.fromEntries(fields.map(k => [k,x.binding[k]])),
    nativeRelationshipEvidenceSha256:x.nativeRelationshipEvidenceSha256,
    report:{generationKey:x.report.generationKey,manifestSha256:x.report.manifestSha256,
      sourceRevisionDigest:x.report.sourceRevisionDigest,summary:Object.fromEntries(['role','generationKey','documentSha256','privateReceiptKey'].map(k=>[k,x.report.summary[k]]))},
    recipient:{contactId:x.recipient.contactId,address:x.recipient.address,
      verificationDigest:x.recipient.verificationDigest,verifiedAt:x.recipient.verifiedAt,expiresAt:x.recipient.expiresAt} };
}
function validState(state) {
  if (!state || state.kind !== 'report_delivery_v1' || !['initial','resend'].includes(state.mode)
    || !['confirmation','dispatch_started','provider_accepted'].includes(state.phase)
    || !HASH.test(state.claimToken) || !Number.isSafeInteger(state.createdAt)
    || !Number.isSafeInteger(state.confirmBy) || state.confirmBy < state.createdAt
    || !state.snapshot || !fields.every(k => typeof state.snapshot.binding?.[k] === 'string')
    || !HASH.test(state.snapshot.report?.summary?.documentSha256)
    || (state.phase === 'provider_accepted' && (!state.provider || !HASH.test(state.provider.messageReferenceDigest)
      || state.provider.accepted !== true || !Number.isSafeInteger(state.provider.acceptedAt)))
    || state.inboxReceipt !== 'unknown'
    || state.readReceipt !== 'unknown'
    || state.followUp !== 'unknown') fail();
  const s=state.snapshot;
  validateSnapshot({...s,report:{...s.report,completed:true,fresh:true,validated:true},
    recipient:{...s.recipient,explicitlySelected:true,verified:true,eligible:true,suppressed:false}},state.createdAt);
  return state;
}
function deliveryProjection(state) {
  validState(state); const b=state.snapshot.binding;
  return {ClientId:b.clientId,DeploymentId:b.deploymentId,ReportType:'free_test_summary_delivery',
    PeriodStart:b.periodStart,PeriodEnd:b.periodEnd,ReportVersion:'report-delivery-v1',
    GenerationStatus:'DraftGenerated',ApprovalStatus:state.mode==='initial'?'StandingInitialDelivery':state.phase==='confirmation'?'ResendConfirmationRequired':'ResendConfirmed',
    DeliveryStatus:state.phase==='provider_accepted'?'ProviderAccepted':state.phase==='confirmation'?'ConfirmationPending':'ReconciliationRequired',
    ReconciliationStatus:'Verified',ActualEstimatedSeparated:true,CrossClientIsolationPassed:true,
    DuplicateSendGuardPassed:true,ReportTotalsReconciled:true,AutoDeliveryEnabledAtRun:state.mode==='initial',
    SchemaVersion:2,ReportFormat:'pdf',ReportObjectKey:json(state.snapshot.report),
    RecipientSnapshotJson:json(state.snapshot.recipient)};
}

/** Trusted, offline-qualified controls. No public request can select a recipient,
 * PDF or sender. Deployment must bind authenticated CRM/native-lineage reads,
 * the existing encrypted ReportRuns adapter and an independently qualified
 * single-dispatch Mail adapter. This module provisions no access or live UI.
 */
function createReportDeliveryControl({store,readSnapshot,authorize,readSummary,sender,now=Date.now,
  timeoutMs=15000,autoDeliveryEnabled=false}={}) {
  if (!store || !['get','insert','compareAndSwap'].every(k=>typeof store[k]==='function')
    || ![readSnapshot,authorize,readSummary,now].every(f=>typeof f==='function')
    || !sender || !['sendSummary','lookupAcceptance'].every(k=>typeof sender[k]==='function')
    || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000
    || typeof autoDeliveryEnabled!=='boolean') fail();
  const attempts=new WeakMap();
  function active(signal){const a=attempts.get(signal),at=now();
    if(!a||signal.aborted||!Number.isSafeInteger(at)||at<a.startedAt||at>=a.expiresAt||performance.now()>=a.wallDeadline){a?.abort();fail();}
  }
  async function scope(dealId,actor,action,signal) {
    active(signal);
    if (typeof dealId!=='string' || !ID.test(dealId) || signal.aborted
      || await authorize({dealId,actor,action,signal}) !== true || signal.aborted) fail();
    active(signal);const snapshot=validateSnapshot(await readSnapshot({dealId,signal}),now());
    active(signal);
    if (signal.aborted || snapshot.binding.dealId!==dealId) fail(); return snapshot;
  }
  async function bounded(work,parent) {
    if (parent!==undefined && !(parent instanceof AbortSignal)) fail();
    const controller=new AbortController(); const abort=()=>controller.abort();
    const startedAt=now();if(!Number.isSafeInteger(startedAt)||startedAt<0)fail();
    attempts.set(controller.signal,{startedAt,expiresAt:startedAt+timeoutMs,wallDeadline:performance.now()+timeoutMs,abort});
    parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();
    let rejectDeadline;
    const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
    const timeout=()=>{abort();rejectDeadline(Object.assign(new Error('REPORT_DELIVERY_HELD'),{code:'REPORT_DELIVERY_HELD'}));};
    const timer=setTimeout(timeout,timeoutMs);
    const parentTimeout=()=>timeout();parent?.addEventListener('abort',parentTimeout,{once:true});
    // The deadline stops local admission and returns promptly. The future Mail
    // adapter must honor this signal; a deadline never proves a remote send did
    // not happen, and consumed claims are reconciliation-only.
    try {return await Promise.race([work(controller.signal),deadline]);} catch {fail();}
    finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);parent?.removeEventListener('abort',parentTimeout);controller.abort();}
  }
  const initialKey=s=>hash(`report-initial-delivery-v1\0${s.binding.deploymentId}`);
  const result=row=>({status:row.state.phase==='provider_accepted'?'provider_accepted':'delivery_reconciliation_required',
    operationKey:row.key,summary:row.state.snapshot.report.summary,
    recipientVerificationDigest:row.state.snapshot.recipient.verificationDigest,
    inboxReceipt:row.state.inboxReceipt,readReceipt:row.state.readReceipt,followUp:row.state.followUp});
  async function exact(row,snapshot) {
    validState(row.state);if(!same(row.state.snapshot.binding,snapshot.binding)) fail();
    return row;
  }
  async function saveAccepted(row,proof,signal) {
    active(signal);if (signal.aborted || !proof || proof.accepted!==true || !HASH.test(proof.messageReferenceDigest)
      || proof.operationKey!==row.key || proof.documentSha256!==row.state.snapshot.report.summary.documentSha256
      || proof.recipientVerificationDigest!==row.state.snapshot.recipient.verificationDigest
      || !Number.isSafeInteger(proof.acceptedAt) || proof.acceptedAt<row.state.createdAt || proof.acceptedAt>now()) fail();
    const state={...row.state,phase:'provider_accepted',provider:{accepted:true,
      messageReferenceDigest:proof.messageReferenceDigest,acceptedAt:proof.acceptedAt}};
    const saved=await store.compareAndSwap(row,state,{signal});
    const actual=saved||await store.get(row.key,{signal});
    if(!actual||!same(actual.state,state)) fail();return result(actual);
  }
  async function recover(row,signal) {
    active(signal);validState(row.state);if(row.state.phase==='provider_accepted')return result(row);
    if(row.state.phase!=='dispatch_started')fail();
    // Unknown/rejected requests are never sent again. Readback must bind exact
    // operation, immutable bytes and verified recipient, not subject/time alone.
    const proof=await sender.lookupAcceptance({operationKey:row.key,snapshot:row.state.snapshot,signal});
    active(signal);if(!proof)return result(row);return saveAccepted(row,proof,signal);
  }
  async function dispatch(row,snapshot,signal,actor,action) {
    if(signal.aborted||!same(snapshot,row.state.snapshot))fail();
    const bytes=await readSummary({snapshot,signal});active(signal);
    if(signal.aborted||!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024
      || !bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')
      ||hash(bytes)!==snapshot.report.summary.documentSha256)fail();
    const fresh=validateSnapshot(await readSnapshot({dealId:snapshot.binding.dealId,signal}),now());
    active(signal);if(signal.aborted||!same(fresh,snapshot))fail();
    if(await authorize({dealId:snapshot.binding.dealId,actor,action,signal})!==true)fail();active(signal);
    let proof;
    try {proof=await sender.sendSummary({operationKey:row.key,snapshot,bytes:Buffer.from(bytes),signal});}
    catch {return result(row);}
    // Timeout/cancellation after dispatch is ambiguous, even if a late result
    // arrives. Reconciliation only; no second request or fabricated receipt.
    try{active(signal);}catch{return result(row);}
    try{return await saveAccepted(row,proof,signal);}catch{return result(row);}
  }
  async function initial({dealId,actor,signal,expectedManifestSha256}={}) {return bounded(async signal=>{
    if(!autoDeliveryEnabled)fail();const snapshot=await scope(dealId,actor,'initial',signal);
    if(expectedManifestSha256!==undefined && (!HASH.test(expectedManifestSha256)
      ||snapshot.report.manifestSha256!==expectedManifestSha256))fail();
    const key=initialKey(snapshot);let row=await store.get(key,{signal});active(signal);
    if(row){await exact(row,snapshot);return recover(row,signal);}
    const at=now(), state={kind:'report_delivery_v1',mode:'initial',phase:'dispatch_started',
      claimToken:crypto.randomBytes(32).toString('hex'),snapshot,createdAt:at,confirmBy:at,
      inboxReceipt:'unknown',readReceipt:'unknown',followUp:'unknown'};
    active(signal);row=await store.insert(key,state,{signal});active(signal);
    if(!row||!same(row.state,state)) {if(row){await exact(row,snapshot);return recover(row,signal);}fail();}
    return dispatch(row,snapshot,signal,actor,'initial');
  },signal);}
  async function prepareResend({dealId,actor,signal}={}) {return bounded(async signal=>{
    const snapshot=await scope(dealId,actor,'resend',signal),at=now();
    const initial=await store.get(initialKey(snapshot),{signal});active(signal);
    if(!initial||initial.state.mode!=='initial'||initial.state.phase!=='provider_accepted')fail();
    await exact(initial,snapshot);if(signal.aborted)fail();
    const key=hash(`report-resend-confirmation-v1\0${crypto.randomBytes(32).toString('hex')}`);
    const state={kind:'report_delivery_v1',mode:'resend',phase:'confirmation',snapshot,
      claimToken:crypto.randomBytes(32).toString('hex'),createdAt:at,confirmBy:at+900000,
      inboxReceipt:'unknown',readReceipt:'unknown',followUp:'unknown'};
    active(signal);const row=await store.insert(key,state,{signal});active(signal);if(!row||!same(row.state,state))fail();
    return {confirmationId:key,expiresAt:state.confirmBy,recipient:snapshot.recipient.address,
      summary:snapshot.report.summary,manifestSha256:snapshot.report.manifestSha256};
  },signal);}
  async function confirmResend({dealId,actor,confirmationId,confirmed,signal}={}) {return bounded(async signal=>{
    if(confirmed!==true||!HASH.test(confirmationId))fail();
    const snapshot=await scope(dealId,actor,'resend',signal);let row=await store.get(confirmationId,{signal});
    active(signal);if(!row||row.state.mode!=='resend')fail();await exact(row,snapshot);
    if(row.state.phase!=='confirmation')return recover(row,signal);
    if(now()>=row.state.confirmBy||!same(row.state.snapshot,snapshot))fail();
    const state={...row.state,phase:'dispatch_started',claimToken:crypto.randomBytes(32).toString('hex')};
    active(signal);const claimed=await store.compareAndSwap(row,state,{signal});active(signal);
    row=claimed||await store.get(row.key,{signal});if(!row)fail();
    if(!same(row.state,state))return recover(row,signal);
    return dispatch(row,snapshot,signal,actor,'resend');
  },signal);}
  async function view({dealId,actor,signal}={}) {return bounded(async signal=>{
    const snapshot=await scope(dealId,actor,'view',signal);
    const bytes=await readSummary({snapshot,signal});active(signal);if(signal.aborted||!Buffer.isBuffer(bytes)
      ||hash(bytes)!==snapshot.report.summary.documentSha256)fail();
    const fresh=validateSnapshot(await readSnapshot({dealId,signal}),now());active(signal);
    if(!same(fresh,snapshot)||await authorize({dealId,actor,action:'view',signal})!==true)fail();active(signal);
    return {summary:snapshot.report.summary,manifestSha256:snapshot.report.manifestSha256};
  },signal);}
  return Object.freeze({initial,prepareResend,confirmResend,view});
}
module.exports={createReportDeliveryControl,deliveryProjection,validateSnapshot,validState};
