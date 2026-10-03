'use strict';
const JSON_KEY='REPORT_RUNTIME_BINDING_JSON',HASH_KEY='REPORT_RUNTIME_BINDING_SHA256',PART_PREFIX='REPORT_RUNTIME_BINDING_PART_';
const MAX_BYTES=65536,MAX_ENCODED=4*Math.ceil(MAX_BYTES/3),MAX_PARTS=Math.ceil(MAX_ENCODED/100);
function held(){throw Object.assign(new Error('REPORT_BOOTSTRAP_HELD'),{code:'REPORT_BOOTSTRAP_HELD'});}
/** Lossless bounded transport only; never grants authority or changes raw SHA. */
function encodeReportBootstrap(raw,{partSize=400}={}){
 if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>MAX_BYTES||![100,200,400].includes(partSize))held();
 const bytes=Buffer.from(raw,'utf8');if(bytes.length>MAX_BYTES||bytes.toString('utf8')!==raw)held();
 const encoded=bytes.toString('base64'),parts={};
 for(let i=0;i<Math.ceil(encoded.length/partSize);i++)parts[PART_PREFIX+i]=encoded.slice(i*partSize,(i+1)*partSize);
 return {parts,marker:'runtime-parts-v1:'+partSize+':'+Object.keys(parts).length+':'+encoded.length+':'+bytes.length};
}
function decodeReportBootstrap(env){
 const value=env[JSON_KEY],keys=Object.keys(env).filter(k=>k.startsWith(PART_PREFIX));
 if(typeof value!=='string')held();
 if(!value.startsWith('runtime-parts-v1:')){if(keys.length||Buffer.byteLength(value)>MAX_BYTES)held();return value;}
 const match=/^runtime-parts-v1:(100|200|400):([1-9][0-9]{0,2}):([1-9][0-9]{0,4}):([1-9][0-9]{0,4})$/.exec(value);if(!match)held();
 const size=Number(match[1]),count=Number(match[2]),length=Number(match[3]),rawLength=Number(match[4]);
 if(rawLength>MAX_BYTES||length>MAX_ENCODED||length!==4*Math.ceil(rawLength/3)||count>MAX_PARTS||count!==Math.ceil(length/size)||keys.length!==count)held();
 let encoded='';for(let i=0;i<count;i++){
  const key=PART_PREFIX+i,part=env[key],expected=i<count-1?size:length-i*size;
  if(!Object.hasOwn(env,key)||typeof part!=='string'||part.length!==expected||!/^[A-Za-z0-9+/=]+$/.test(part))held();encoded+=part;
 }
 if(encoded.length!==length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))held();
 const bytes=Buffer.from(encoded,'base64');if(bytes.length!==rawLength||bytes.toString('base64')!==encoded)held();
 const raw=bytes.toString('utf8');if(!Buffer.from(raw,'utf8').equals(bytes))held();return raw;
}
module.exports={encodeReportBootstrap,decodeReportBootstrap,JSON_KEY,HASH_KEY,PART_PREFIX,MAX_BYTES,MAX_ENCODED,MAX_PARTS};
