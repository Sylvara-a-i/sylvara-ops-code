'use strict';
require('./report-physical-network-fixture.js');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function loadBootstrap(httpsObject=require('node:https')){
 const module={exports:{}};
 const req=id=>{if(id==='node:https')return httpsObject;if(id==='node:util')return require(id);throw Error('BOOTSTRAP_NONBUILTIN_IMPORT');};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../lib/report-https-bootstrap.js'),'utf8'),{require:req,module,exports:module.exports},{filename:'report-https-bootstrap.js'});
 return module.exports;
}
module.exports=Object.freeze({loadBootstrap});
