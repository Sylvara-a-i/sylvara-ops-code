'use strict';
const zlib=require('node:zlib'),crypto=require('node:crypto');
const {bindingDiagnosticError}=require('./report-storage-binding-diagnostic');
const JSON_KEY='REPORT_STORAGE_QUALIFICATION_JSON',HASH_KEY='REPORT_STORAGE_QUALIFICATION_SHA256';
const PART_PREFIX='REPORT_STORAGE_QUALIFICATION_PART_';
const PART_LIMIT=400,TOTAL_LIMIT=4096,MAX_PARTS=Math.ceil(TOTAL_LIMIT/100);
// Engineering margin below an observed successful configuration, NOT a Zoho limit.
const PLANNING_BUDGET=3578;
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
function bindingHeld(reason,partIndex,expectedCodeUnits,observedCodeUnits){
 throw bindingDiagnosticError(reason,partIndex,expectedCodeUnits,observedCodeUnits);
}
// Tuple version one preserves the same 41 scalars across supported binding schemas. No
// private constants, defaults, omitted fields or environment-derived values.
const SHAPE=Object.freeze({schemaVersion:0,enabled:false,environment:'',sourceRevision:'',projectId:'',controlHost:'',tableId:'',nonce:'',
 capability:{region:'',origin:'',controllerFunctionId:'',deploymentId:'',sdkVersion:'',authMode:'',authType:'',creatorPolicy:'',
  tables:{reportRuns:{id:'',name:'',schemaSha256:'',uniquenessSha256:'',uniqueField:'',projectionSha256:''},
   eventReceipts:{id:'',name:'',schemaSha256:'',uniquenessSha256:'',uniqueField:'',projectionSha256:''}},
  evidence:{ownerAuthorization:{digest:'',verifiedAt:0,expiresAt:0},ownership:{digest:'',verifiedAt:0,expiresAt:0},access:{digest:'',verifiedAt:0,expiresAt:0}}},
 verifiedAt:0,expiresAt:0,timeoutMs:0,singleAdmittedInvocation:false});
const TUPLE_COUNT=41;
function shapeValues(value,shape=SHAPE,values=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!==Object.keys(shape).join(','))held();
 for(const key of Object.keys(shape)){
  const expected=shape[key],actual=value[key];
  if(expected&&typeof expected==='object')shapeValues(actual,expected,values);
  else {if(typeof actual!==typeof expected||typeof actual==='number'&&(!Number.isSafeInteger(actual)||actual<0)
    ||typeof actual==='string'&&Buffer.byteLength(actual)>TOTAL_LIMIT)held();values.push(actual);}
 }
 return values;
}
function fromTuple(values,fail=held){
 if(!Array.isArray(values)||values.length!==TUPLE_COUNT)fail('tuple_shape');let index=0;
 function object(shape){const result={};for(const key of Object.keys(shape)){
  const expected=shape[key];if(expected&&typeof expected==='object')result[key]=object(expected);
  else {const actual=values[index++];if(typeof actual!==typeof expected)fail('tuple_scalar_type');
   if(typeof actual==='number'&&(!Number.isSafeInteger(actual)||actual<0)
    ||typeof actual==='string'&&Buffer.byteLength(actual)>TOTAL_LIMIT)fail('tuple_scalar_bounds');result[key]=actual;}
 }return result;}
 const result=object(SHAPE);if(index!==TUPLE_COUNT||![3,4,5,6].includes(result.schemaVersion))fail('tuple_schema');return result;
}
function rawBound(raw,fail=held){if(typeof raw!=='string'||!raw.length||raw.length>TOTAL_LIMIT||!/^[\x20-\x7e]+$/.test(raw))fail('raw_bounds');}
function encodeStorageBinding(raw,{partSize=200,format='json'}={}){
 rawBound(raw);if(![100,200,400].includes(partSize)||!['json','tuple-v1'].includes(format))held();
 let wire=raw,tupleLength;
 if(format==='tuple-v1'){
  let value;try{value=JSON.parse(raw);}catch{held();}
  const values=shapeValues(value);if(values.length!==TUPLE_COUNT||![3,4,5,6].includes(value.schemaVersion)||JSON.stringify(value)!==raw)held();
  const reconstructed=JSON.stringify(fromTuple(values));if(reconstructed!==raw)held();
  const tuple=JSON.stringify(values);tupleLength=Buffer.byteLength(tuple);if(tupleLength>TOTAL_LIMIT)held();
  wire=zlib.deflateRawSync(Buffer.from(tuple),{level:9}).toString('base64');if(wire.length>TOTAL_LIMIT)held();
 }
 const parts={};for(let i=0;i<Math.ceil(wire.length/partSize);i++)parts[PART_PREFIX+i]=wire.slice(i*partSize,(i+1)*partSize);
 return {parts,marker:(format==='json'?'parts-v1:':'tuple-v1:')+partSize+':'+Object.keys(parts).length+':'+wire.length
  +(format==='tuple-v1'?':'+tupleLength+':'+raw.length:'')};
}
function decodeBinding(environment,fail){
 if(!environment||typeof environment!=='object'||Array.isArray(environment))fail('environment_shape');
 if(!Object.hasOwn(environment,JSON_KEY))fail('marker_missing');
 const marker=environment[JSON_KEY],keys=Object.keys(environment).filter(k=>k.startsWith(PART_PREFIX));
 if(typeof marker!=='string')fail('marker_type');
 const compact=marker.startsWith('tuple-v1:');
 if(!compact&&!marker.startsWith('parts-v1:')){
  if(keys.length||Buffer.byteLength(marker)>TOTAL_LIMIT||/^(?:parts|tuple)-/.test(marker))fail('inline_shape');return marker;
 }
 const expression=compact?/^tuple-v1:(100|200|400):([1-9]|[1-3][0-9]|4[01]):([1-9][0-9]{0,3}):([1-9][0-9]{0,3}):([1-9][0-9]{0,3})$/
  :/^parts-v1:(100|200|400):([1-9]|[1-3][0-9]|4[01]):([1-9][0-9]{0,3})$/;
 const match=expression.exec(marker);if(!match)fail('marker_syntax');
 const size=Number(match[1]),count=Number(match[2]),length=Number(match[3]);
 const tupleLength=compact?Number(match[4]):0,rawLength=compact?Number(match[5]):0;
 if(count>MAX_PARTS||length>TOTAL_LIMIT||count!==Math.ceil(length/size))fail('marker_bounds');
 if(keys.length!==count)fail('part_count');
 if(compact&&(tupleLength>TOTAL_LIMIT||rawLength>TOTAL_LIMIT))fail('marker_bounds');
 let wire='';for(let i=0;i<count;i++){
  const key=PART_PREFIX+i,part=environment[key],expected=i<count-1?size:length-i*size;
  if(!Object.hasOwn(environment,key))fail('part_missing');
  if(typeof part!=='string')fail('part_type');
  const observedCodeUnits=part.length;
  if(observedCodeUnits!==expected)fail('part_length',i,expected,observedCodeUnits);
  if(!/^[\x20-\x7e]+$/.test(part))fail('part_ascii');wire+=part;
 }
 if(wire.length!==length||Buffer.byteLength(wire)!==length)fail('wire_length');if(!compact)return wire;
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(wire))fail('base64_syntax');
 const compressed=Buffer.from(wire,'base64');if(compressed.toString('base64')!==wire)fail('base64_canonical');
 let inflated;try{inflated=zlib.inflateRawSync(compressed,{maxOutputLength:TOTAL_LIMIT,info:true});}catch{fail('inflate_failed');}
 // Node24 has no rejectGarbageAfterEnd option: compare actual consumed bytes.
 if(inflated.engine.bytesWritten!==compressed.length)fail('inflate_consumption');
 if(inflated.buffer.length!==tupleLength)fail('tuple_length');
 const tuple=inflated.buffer.toString('utf8');if(!Buffer.from(tuple,'utf8').equals(inflated.buffer))fail('tuple_utf8');
 let values;try{values=JSON.parse(tuple);}catch{fail('tuple_json');}
 if(JSON.stringify(values)!==tuple)fail('tuple_canonical');
 const raw=JSON.stringify(fromTuple(values,fail));rawBound(raw,fail);if(raw.length!==rawLength)fail('raw_length');return raw;
}
function decodeStorageBinding(environment){return decodeBinding(environment,bindingHeld);}
function entryBytes(key,value){return Buffer.byteLength(JSON.stringify(key)+':'+JSON.stringify(value));}
/** Pure offline planning. Baseline contains only safe counts and serialized
 * contributions for these controlled keys, never unrelated keys/values or a
 * credentials map. Complete baseline bytes must come from independent metadata.
 * This neither grants authority nor writes/removes configuration. */
function preflightStorageEnvironment({baseline,transport,bindingSha256,descriptorPins,retireObsoleteSenderPair=false}={}){
 const validInt=n=>Number.isSafeInteger(n)&&n>=0;
 if(!baseline||Object.keys(baseline).sort().join(',')!=='controlledEntries,entryCount,serializedBytes'
  ||!validInt(baseline.serializedBytes)||baseline.serializedBytes<2||!validInt(baseline.entryCount)
  ||!Array.isArray(baseline.controlledEntries)||!transport||Object.keys(transport).sort().join(',')!=='marker,parts'
  ||!transport.parts||typeof transport.parts!=='object'||Array.isArray(transport.parts)
  ||Object.keys(transport.parts).some(key=>!key.startsWith(PART_PREFIX))
  ||!descriptorPins||typeof retireObsoleteSenderPair!=='boolean'
  ||!/^[a-f0-9]{64}$/.test(bindingSha256||''))held();
 const sender=['REPORT_SENDER_QUALIFICATION_JSON','REPORT_SENDER_QUALIFICATION_SHA256'];
 const descriptors=['REPORT_CONTROLLER_FUNCTION_ID','REPORT_DEPLOYMENT_ID'];
 if(Object.keys(descriptorPins).sort().join(',')!==[...descriptors].sort().join(',')
  ||!/^[1-9][0-9]{2,29}$/.test(descriptorPins[descriptors[0]]||'')
  ||typeof descriptorPins[descriptors[1]]!=='string'||!descriptorPins[descriptors[1]].length||descriptorPins[descriptors[1]].length>192)held();
 const known=new Map();
 for(const entry of baseline.controlledEntries){
  if(!entry||Object.keys(entry).sort().join(',')!=='key,serializedEntryBytes'||typeof entry.key!=='string'
   ||!sender.includes(entry.key)&&!descriptors.includes(entry.key)||known.has(entry.key)
   ||!validInt(entry.serializedEntryBytes)||entry.serializedEntryBytes<Buffer.byteLength(JSON.stringify(entry.key))+3)held();
  known.set(entry.key,entry.serializedEntryBytes);
 }
 const initialCommas=Math.max(0,baseline.entryCount-1),knownBytes=[...known.values()].reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(knownBytes)||known.size>baseline.entryCount||knownBytes>baseline.serializedBytes-2-initialCommas
  ||baseline.entryCount===0&&baseline.serializedBytes!==2)held();
 if(retireObsoleteSenderPair&&!sender.every(key=>known.has(key)))held();
 // Require no storage transport keys in the baseline projection. An armed or
 // partial prior representation must be contained before sizing/preparation.
 const raw=decodeBinding({...transport.parts,[JSON_KEY]:transport.marker},held);
 if(typeof raw!=='string'||!transport.marker.startsWith('tuple-v1:')||crypto.createHash('sha256').update(raw).digest('hex')!==bindingSha256)held();
 const additions={...descriptorPins,...transport.parts,[HASH_KEY]:bindingSha256,[JSON_KEY]:transport.marker};
 let bytes=baseline.serializedBytes,count=baseline.entryCount;
 for(const key of retireObsoleteSenderPair?sender:[]){bytes-=known.get(key);count--;}
 for(const [key,value]of Object.entries(additions)){
  if(known.has(key))bytes-=known.get(key);else count++;
  bytes+=entryBytes(key,value);
 }
 bytes+=Math.max(0,count-1)-initialCommas;
 if(!Number.isSafeInteger(bytes)||bytes<2||bytes>PLANNING_BUDGET)held();
 return Object.freeze({serializedBytes:bytes,entryCount:count,planningBudget:PLANNING_BUDGET,
  remainingPlanningBytes:PLANNING_BUDGET-bytes,providerLimitVerified:false,configurationChanged:false});
}
module.exports={encodeStorageBinding,decodeStorageBinding,preflightStorageEnvironment,JSON_KEY,HASH_KEY,PART_PREFIX,
 PART_LIMIT,TOTAL_LIMIT,MAX_PARTS,TUPLE_COUNT,PLANNING_BUDGET};
