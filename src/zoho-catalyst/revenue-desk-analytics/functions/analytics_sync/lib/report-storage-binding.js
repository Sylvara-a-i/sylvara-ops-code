'use strict';
const JSON_KEY='REPORT_STORAGE_QUALIFICATION_JSON',PART_PREFIX='REPORT_STORAGE_QUALIFICATION_PART_';
const PART_LIMIT=400,TOTAL_LIMIT=4096,MAX_PARTS=Math.ceil(TOTAL_LIMIT/100);
function held(){throw Object.assign(new Error('REPORT_STORAGE_QUALIFICATION_HELD'),{code:'REPORT_STORAGE_QUALIFICATION_HELD'});}
function encodeStorageBinding(raw,{partSize=200}={}){
 if(typeof raw!=='string'||!raw.length||raw.length>TOTAL_LIMIT||!/^[\x20-\x7e]+$/.test(raw))held();
 if(![100,200,400].includes(partSize))held();
 const parts={};for(let i=0;i<Math.ceil(raw.length/partSize);i++)parts[PART_PREFIX+i]=raw.slice(i*partSize,(i+1)*partSize);
 return {parts,marker:'parts-v1:'+partSize+':'+Object.keys(parts).length+':'+raw.length};
}
function decodeStorageBinding(environment){
 const marker=environment[JSON_KEY],keys=Object.keys(environment).filter(k=>k.startsWith(PART_PREFIX));
 if(typeof marker!=='string')held();
 if(!marker.startsWith('parts-v1:')){if(keys.length||Buffer.byteLength(marker)>TOTAL_LIMIT)held();return marker;}
 const match=/^parts-v1:(100|200|400):([1-9]|[1-3][0-9]|4[01]):([1-9][0-9]{0,3})$/.exec(marker);if(!match)held();
 const size=Number(match[1]),count=Number(match[2]),length=Number(match[3]);
 if(count>MAX_PARTS||length>TOTAL_LIMIT||count!==Math.ceil(length/size)||keys.length!==count)held();
 let raw='';for(let i=0;i<count;i++){
  const key=PART_PREFIX+i,part=environment[key],expected=i<count-1?size:length-i*size;
  if(!Object.hasOwn(environment,key)||typeof part!=='string'||part.length!==expected||!/^[\x20-\x7e]+$/.test(part))held();raw+=part;
 }
 if(raw.length!==length||Buffer.byteLength(raw)!==length)held();return raw;
}
module.exports={encodeStorageBinding,decodeStorageBinding,JSON_KEY,PART_PREFIX,PART_LIMIT,TOTAL_LIMIT,MAX_PARTS};
