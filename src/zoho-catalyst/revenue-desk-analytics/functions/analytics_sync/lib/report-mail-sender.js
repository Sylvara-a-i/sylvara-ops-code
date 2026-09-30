'use strict';

const crypto = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const AUTH = /^Zoho-oauthtoken [A-Za-z0-9._-]{20,4096}$/;
const ADDRESS = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
function held(ambiguous = false) {
  return Object.assign(new Error('REPORT_MAIL_HELD'), { code:'REPORT_MAIL_HELD', ambiguous });
}
const MAX_PDF = 2 * 1024 * 1024;
const MAX_RESPONSE = 32 * 1024;

/** US Zoho Mail attachment transport. The outer durable delivery claim must be
 * consumed before entry. Exactly one attachment POST and at most one send POST;
 * no redirects, retries, SDK sendMail or read-receipt request. The proposed send
 * response envelope needs independent provider acceptance before installation.
 * https://www.zoho.com/mail/help/api/post-upload-attachments.html
 * https://www.zoho.com/mail/help/api/post-send-email-attachment.html
 */
function createReportMailSender({ binding, authorizationProvider, fetchImpl = globalThis.fetch,
  lookupAcceptance = null, now = Date.now } = {}) {
  const b = structuredClone(binding);
  if (!b || b.environment !== 'development' || b.apiOrigin !== 'https://mail.zoho.com'
    || typeof b.accountId !== 'string' || !/^[1-9][0-9]{2,29}$/.test(b.accountId)
    || typeof b.fromAddress !== 'string' || b.fromAddress.length > 100 || !ADDRESS.test(b.fromAddress)
    || !HASH.test(b.contractQualificationDigest) || !Number.isSafeInteger(b.verifiedAt)
    || !Number.isSafeInteger(b.expiresAt) || b.expiresAt <= b.verifiedAt
    || !Number.isSafeInteger(b.timeoutMs) || b.timeoutMs < 1 || b.timeoutMs > 15000
    || typeof authorizationProvider !== 'function' || typeof fetchImpl !== 'function'
    || typeof now !== 'function' || (lookupAcceptance !== null && typeof lookupAcceptance !== 'function')) throw held();

  async function sendSummary({ operationKey, snapshot, bytes, signal } = {}) {
    if (!HASH.test(operationKey) || snapshot?.report?.summary?.role !== 'summary'
      || !Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > MAX_PDF
      || !bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')
      || sha(bytes) !== snapshot.report.summary.documentSha256
      || !HASH.test(snapshot.recipient?.verificationDigest)
      || typeof snapshot.recipient.address !== 'string' || snapshot.recipient.address.length > 100
      || !ADDRESS.test(snapshot.recipient.address) || !(signal instanceof AbortSignal)) throw held();
    const pdf = Buffer.from(bytes), recipient = snapshot.recipient.address;
    const controller = new AbortController(), started = now(), wallDeadline = performance.now() + b.timeoutMs;
    let dispatched = false, reader, rejectCancelled;
    const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
    function cancel() {
      if (controller.signal.aborted) return;
      controller.abort();
      try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {}
      rejectCancelled(held(dispatched));
    }
    signal.addEventListener('abort',cancel,{once:true}); if(signal.aborted) cancel();
    const timer = setTimeout(cancel,b.timeoutMs);
    function active() {
      const at=now();
      if (!Number.isSafeInteger(at) || !Number.isSafeInteger(started) || at < started
        || at-started >= b.timeoutMs || performance.now() >= wallDeadline
        || b.verifiedAt > at || b.expiresAt <= at) cancel();
      if(controller.signal.aborted) throw held(dispatched);
    }
    async function jsonPost(url, body, contentType, authorization) {
      active(); dispatched=true;
      const response=await fetchImpl(url,{method:'POST',body,redirect:'error',signal:controller.signal,
        headers:{Authorization:authorization,'Content-Type':contentType,Accept:'application/json','Accept-Encoding':'identity'}});
      active();
      if(response?.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers?.get('content-type')||'')
        || (response.headers?.get('content-encoding') && response.headers.get('content-encoding')!=='identity')
        || typeof response.body?.getReader !== 'function') throw held(true);
      const length=response.headers.get('content-length');
      if(length!==null && (!/^[0-9]+$/.test(length)||Number(length)>MAX_RESPONSE))throw held(true);
      reader=response.body.getReader(); const chunks=[];let size=0,count=0;
      while(true){active();const part=await reader.read();active();if(part.done)break;
        if(!(part.value instanceof Uint8Array)||++count>128||(size+=part.value.length)>MAX_RESPONSE)throw held(true);
        chunks.push(Buffer.from(part.value));}
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw held(true);}
      if(value?.status?.code!==200 || !value.data || typeof value.data!=='object')throw held(true);
      return value.data;
    }
    async function work() {
      active(); let authorization=await authorizationProvider({signal:controller.signal});active();
      if(typeof authorization!=='string'||!AUTH.test(authorization))throw held();
      const base=`${b.apiOrigin}/api/accounts/${b.accountId}/messages`;
      const url=new URL(`${base}/attachments`);
      url.searchParams.set('fileName','7-Day Revenue Leak Test.pdf');url.searchParams.set('isInline','false');
      const attachment=await jsonPost(url.href,pdf,'application/pdf',authorization);active();
      if(Array.isArray(attachment) || !['attachmentName','attachmentPath','storeName'].every(k=>
        typeof attachment[k]==='string' && attachment[k].length>0 && attachment[k].length<=1024
        && !/[\r\n\x00]/.test(attachment[k]))
        || !attachment.attachmentPath.startsWith('/Mail/')
        || attachment.attachmentName!=='7-Day Revenue Leak Test.pdf')throw held(true);
      // Only provider-returned attachment locators are reused. No supplied URL
      // or WorkDrive sharing link enters the email payload.
      const data=await jsonPost(base,JSON.stringify({fromAddress:b.fromAddress,toAddress:recipient,
        subject:'Your 7-Day Revenue Leak Test results',
        content:'Your 7-Day Revenue Leak Test summary is attached. Reply to this email if you would like to discuss the findings.',
        mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no',isSchedule:false,
        attachments:[Object.fromEntries(['attachmentName','attachmentPath','storeName'].map(k=>[k,attachment[k]]))]}),
      'application/json',authorization);authorization=undefined;active();
      // Unknown provider envelopes stay ambiguous. HTTP 200 alone is not proof.
      if(typeof data.messageId!=='string'||!/^[1-9][0-9]{2,40}$/.test(data.messageId))throw held(true);
      return Object.freeze({accepted:true,operationKey,documentSha256:sha(pdf),
        recipientVerificationDigest:snapshot.recipient.verificationDigest,
        messageReferenceDigest:sha(`${b.accountId}\0${data.messageId}`),acceptedAt:now()});
    }
    try{return await Promise.race([work(),cancelled]);}catch{throw held(dispatched);}
    finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);controller.abort();
      try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{} }
  }
  return Object.freeze({sendSummary,async lookupAcceptance(input){
    // No broad mailbox search/read grant is assumed. Without exact independent
    // proof, leave the durable claim consumed and outcome Unknown.
    return lookupAcceptance ? lookupAcceptance(input) : null;
  }});
}

function createManagedReportMailSender({app,binding,fetchImpl,lookupAcceptance,now}={}) {
  if(typeof binding?.connectionReference!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(binding.connectionReference))throw held();
  const {createConnectionAuthorizationProvider}=require('./connection-boundary');
  return createReportMailSender({binding,fetchImpl,lookupAcceptance,now,
    authorizationProvider:createConnectionAuthorizationProvider(app,binding.connectionReference,binding.timeoutMs)});
}
module.exports={createReportMailSender,createManagedReportMailSender};
