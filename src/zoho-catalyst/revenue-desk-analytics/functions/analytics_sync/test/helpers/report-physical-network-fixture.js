'use strict';
// Test-process containment, installed before any retained SDK fixture is loaded.
// The socket fixture may replace TLS/Agent with an in-memory Duplex only.
const net=require('node:net'),tls=require('node:tls'),dns=require('node:dns');
const dgram=require('node:dgram'),http2=require('node:http2');
let blockedCalls=0;
function blocked(){blockedCalls++;throw Object.assign(new Error('EXTERNAL_NETWORK_DISABLED'),{code:'EXTERNAL_NETWORK_DISABLED'});}
for(const [object,names] of [
 [net,['connect','createConnection']],[net.Socket.prototype,['connect']],
 [net.Server.prototype,['listen']],[tls,['connect']],[dgram,['createSocket']],
 [http2,['connect']],[dns,['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']],
 [dns.promises,['lookup','lookupService','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']],
 [require('node:child_process'),['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']],
 [require('node:worker_threads'),['Worker']],
 [globalThis,['fetch','WebSocket']]
])for(const name of names)if(name in object)Object.defineProperty(object,name,{value:blocked,writable:true,configurable:true});
module.exports=Object.freeze({snapshot:()=>Object.freeze({blockedCalls}),blocked});
