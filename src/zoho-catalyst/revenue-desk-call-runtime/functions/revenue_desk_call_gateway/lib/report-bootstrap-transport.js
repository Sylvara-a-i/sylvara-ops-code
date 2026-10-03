'use strict';
const zlib=require('node:zlib'),crypto=require('node:crypto');
const JSON_KEY='REPORT_RUNTIME_BINDING_JSON',HASH_KEY='REPORT_RUNTIME_BINDING_SHA256',PART_PREFIX='REPORT_RUNTIME_BINDING_PART_';
const MAX_BYTES=65536,MAX_ENCODED=4*Math.ceil(MAX_BYTES/3),MAX_PARTS=Math.ceil(MAX_ENCODED/100);
const MAX_COMPRESSED=MAX_BYTES+1024,MAX_COMPACT_ENCODED=4*Math.ceil(MAX_COMPRESSED/3),MAX_COMPACT_PARTS=Math.ceil(MAX_COMPACT_ENCODED/100);
const PLANNING_BUDGET=3578,IDENTITY_KEYS=['SOURCE_REVISION','DEPLOYMENT_ENVIRONMENT'];
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function held(){throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});}
function exact(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');}
function entryBytes(key,value){return Buffer.byteLength(JSON.stringify(key)+':'+JSON.stringify(value));}
/** Lossless bounded transport only; never grants authority or changes raw SHA. */
function encodeReportBootstrap(raw,{partSize=400,format='parts-v1'}={}){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>MAX_BYTES||![100,200,400].includes(partSize)||!['parts-v1','deflate-v1'].includes(format))held();
 const bytes=Buffer.from(raw,'utf8');if(bytes.length>MAX_BYTES||bytes.toString('utf8')!==raw)held();
 const compact=format==='deflate-v1',wire=compact?zlib.deflateRawSync(bytes,{level:9}):bytes;
 if(compact&&wire.length>MAX_COMPRESSED)held();
 const encoded=wire.toString('base64'),parts={};
 for(let i=0;i<Math.ceil(encoded.length/partSize);i++)parts[PART_PREFIX+i]=encoded.slice(i*partSize,(i+1)*partSize);
 return {parts,marker:(compact?'runtime-deflate-v1:':'runtime-parts-v1:')+partSize+':'+Object.keys(parts).length+':'+encoded.length+':'+bytes.length};
}
function decodeReportBootstrap(env){
 if(!env||typeof env!=='object'||Array.isArray(env)||!Object.hasOwn(env,JSON_KEY))held();
 const value=env[JSON_KEY],keys=Object.keys(env).filter(k=>k.startsWith(PART_PREFIX));
 if(typeof value!=='string')held();
 const compact=value.startsWith('runtime-deflate-v1:');
 if(!compact&&!value.startsWith('runtime-parts-v1:')){if(keys.length||Buffer.byteLength(value)>MAX_BYTES||/^runtime-(?:parts|deflate)-/.test(value))held();return value;}
 const expression=compact?/^runtime-deflate-v1:(100|200|400):([1-9][0-9]{0,2}):([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/
  :/^runtime-parts-v1:(100|200|400):([1-9][0-9]{0,2}):([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/;
 const match=expression.exec(value);if(!match)held();
 const size=Number(match[1]),count=Number(match[2]),length=Number(match[3]),rawLength=Number(match[4]);
 if(rawLength>MAX_BYTES||length>(compact?MAX_COMPACT_ENCODED:MAX_ENCODED)||(!compact&&length!==4*Math.ceil(rawLength/3))
  ||count>(compact?MAX_COMPACT_PARTS:MAX_PARTS)||count!==Math.ceil(length/size)||keys.length!==count)held();
 let encoded='';for(let i=0;i<count;i++){
  const key=PART_PREFIX+i,part=env[key],expected=i<count-1?size:length-i*size;
  if(!Object.hasOwn(env,key)||typeof part!=='string'||part.length!==expected||!/^[A-Za-z0-9+/=]+$/.test(part))held();encoded+=part;
 }
 if(encoded.length!==length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))held();
 const wire=Buffer.from(encoded,'base64');if(wire.toString('base64')!==encoded||compact&&wire.length>MAX_COMPRESSED)held();
 let bytes=wire;
 if(compact){
  let inflated;try{inflated=zlib.inflateRawSync(wire,{maxOutputLength:MAX_BYTES,info:true});}catch{held();}
  // Node24 has no rejectGarbageAfterEnd option. Compare actually consumed bytes.
  if(inflated.engine.bytesWritten!==wire.length)held();bytes=inflated.buffer;
 }
 if(bytes.length!==rawLength)held();
 const raw=bytes.toString('utf8');if(!Buffer.from(raw,'utf8').equals(bytes))held();return raw;
}
/** Complete-map accounting from safe aggregate metadata, never an environment
 * snapshot. Controlled entries must include every observed identity/bootstrap
 * key: any staged activation/hash/part key is held before local preparation. */
function preflightReportBootstrapEnvironment({baseline,transport,bindingSha256,identityPins,now=Date.now}={}){
 const validInt=n=>Number.isSafeInteger(n)&&n>=0;
 if(typeof now!=='function')held();const at=now();if(!validInt(at))held();
 if(!exact(baseline,['observedAt','serializedBytes','entryCount','controlledEntries'])||!validInt(baseline.serializedBytes)||baseline.serializedBytes<2
  ||!validInt(baseline.observedAt)||baseline.observedAt>at||at-baseline.observedAt>900000||!validInt(baseline.entryCount)||!Array.isArray(baseline.controlledEntries)||!exact(transport,['marker','parts'])
  ||!transport.parts||typeof transport.parts!=='object'||Array.isArray(transport.parts)||Object.keys(transport.parts).some(k=>!k.startsWith(PART_PREFIX))
  ||!exact(identityPins,IDENTITY_KEYS)||!/^[a-f0-9]{40}$/.test(identityPins.SOURCE_REVISION||'')||identityPins.DEPLOYMENT_ENVIRONMENT!=='development'
  ||!/^[a-f0-9]{64}$/.test(bindingSha256||''))held();
 const known=new Map();
 for(const entry of baseline.controlledEntries){
  if(!exact(entry,['key','serializedEntryBytes'])||!IDENTITY_KEYS.includes(entry.key)||known.has(entry.key)
   ||!validInt(entry.serializedEntryBytes)||entry.serializedEntryBytes<Buffer.byteLength(JSON.stringify(entry.key))+3)held();
  known.set(entry.key,entry.serializedEntryBytes);
 }
 const commas=Math.max(0,baseline.entryCount-1),knownBytes=[...known.values()].reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(knownBytes)||known.size>baseline.entryCount||knownBytes>baseline.serializedBytes-2-commas
  ||baseline.entryCount===0&&baseline.serializedBytes!==2)held();
 const raw=decodeReportBootstrap({...transport.parts,[JSON_KEY]:transport.marker});if(sha(raw)!==bindingSha256)held();
 const additions={...identityPins,...transport.parts,[HASH_KEY]:bindingSha256,[JSON_KEY]:transport.marker};
 let bytes=baseline.serializedBytes,count=baseline.entryCount;
 for(const [key,value]of Object.entries(additions)){if(known.has(key))bytes-=known.get(key);else count++;bytes+=entryBytes(key,value);}
 bytes+=Math.max(0,count-1)-commas;
 if(!Number.isSafeInteger(bytes)||bytes<2||bytes>PLANNING_BUDGET)held();
 return Object.freeze({serializedBytes:bytes,entryCount:count,planningBudget:PLANNING_BUDGET,remainingPlanningBytes:PLANNING_BUDGET-bytes,
  providerLimitVerified:false,configurationChanged:false});
}
module.exports={encodeReportBootstrap,decodeReportBootstrap,preflightReportBootstrapEnvironment,JSON_KEY,HASH_KEY,PART_PREFIX,
 MAX_BYTES,MAX_ENCODED,MAX_PARTS,MAX_COMPRESSED,MAX_COMPACT_ENCODED,MAX_COMPACT_PARTS,PLANNING_BUDGET};
