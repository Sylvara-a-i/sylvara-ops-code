'use strict';
require('./report-physical-network-fixture.js');
// Actual retained SDK method/class definitions, confined to a fake environment.
// No SDK entry/APM import, credential file read, refresh HTTP client or live token.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sdk=path.dirname(require.resolve('zcatalyst-sdk-node/package.json'));
if(require(path.join(sdk,'package.json')).version!=='3.4.0')throw Error('SDK_FIXTURE_VERSION');
const allowed=new Set(['lib/catalyst-app.js','lib/utils/credential.js','lib/utils/constants.js','lib/utils/helper.js','lib/utils/error.js','lib/utils/validator.js']);
const cache=new Map(),calls={credentialFileReads:0,httpClientConstructions:0,unexpectedImports:0};
const deny=key=>()=>{calls[key]++;throw Error('SDK_FIXTURE_DEPENDENCY_DISABLED');};
function load(name){
 if(name==='package.json')return JSON.parse(fs.readFileSync(path.join(sdk,name),'utf8'));
 if(!allowed.has(name)){calls.unexpectedImports++;throw Error('SDK_FIXTURE_IMPORT_DISABLED');}
 if(cache.has(name))return cache.get(name).exports;
 const filename=path.join(sdk,name),module={exports:{}};cache.set(name,module);
 const req=id=>{
  if(id==='fs')return Object.freeze({readFileSync:deny('credentialFileReads')});
  if(['path','url','util'].includes(id))return require('node:'+id);
  if(id==='./api-request')return Object.freeze({HttpClient:class{constructor(){deny('httpClientConstructions')();}},AuthorizedHttpClient:class{constructor(){deny('httpClientConstructions')();}}});
  if(!id.startsWith('.')){calls.unexpectedImports++;throw Error('SDK_FIXTURE_IMPORT_DISABLED');}
  const resolved=path.resolve(path.dirname(filename),id)+(/\.js$/.test(id)?'':'.js');
  return load(path.relative(sdk,resolved).replaceAll('\\','/'));
 };
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:req,module,exports:module.exports,process:{env:{}},Buffer,Promise},{filename});
 return module.exports;
}
function requireSdk(id,fallback){
 if(path.isAbsolute(id)&&id.startsWith(sdk+path.sep)){
  let relative=path.relative(sdk,id).replaceAll('\\','/');if(!/\.(js|json)$/.test(relative))relative+='.js';return load(relative);
 }
 if(id==='zcatalyst-sdk-node')throw Error('SDK_ENTRY_DISABLED');
 return fallback(id);
}
module.exports=Object.freeze({sdk,load,requireSdk,snapshot:()=>Object.freeze({...calls})});
