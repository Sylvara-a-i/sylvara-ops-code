'use strict';
const assert=require('node:assert/strict');
const {createReportSuccessorStore}=require('../../lib/report-successor-store');
const {reportRunProjection}=require('../../lib/report-run-store');
const {canonicalJson}=require('../../lib/facts');
const key='a'.repeat(64),other='b'.repeat(64);
const state={kind:'report_attempt_v1',identity:{clientId:'client_A',deploymentId:'deployment_A',
 periodStart:'2026-09-20',periodEnd:'2026-09-27'},phase:'working',owner:'synthetic',failures:1,nextAttemptAt:1800000000000,lastGenerationKey:null};
const held={code:'REPORT_RUN_RECONCILIATION_REQUIRED'};
function fixture(){
 const rows=new Map(),queries=[],writes=[];let next=100,mode='normal';
 const transport={async insert(row){writes.push(structuredClone(row));
  if(rows.has(row.IdempotencyKey))throw Error('unique constraint');
  if(mode!=='lost')rows.set(row.IdempotencyKey,{...structuredClone(row),ROWID:String(++next)});
  if(mode==='unknown'||mode==='lost')throw Error('synthetic unknown response');
 },async query(sql){queries.push(sql);assert.ok(sql.startsWith('SELECT '));
  const exact=/IdempotencyKey = '([^']+)'/.exec(sql);
  if(exact)return rows.has(exact[1])?[structuredClone(rows.get(exact[1]))]:[];
  const prefix=/IdempotencyKey LIKE '([^']+)%'/.exec(sql)[1];
  return [...rows.values()].filter(r=>r.IdempotencyKey.startsWith(prefix))
   .sort((a,b)=>b.RD_REPORT_VERSION-a.RD_REPORT_VERSION).slice(0,2).map(row=>structuredClone(row));
 }};
 const make=()=>createReportSuccessorStore({app:{},environment:'development',transport});
 return {rows,queries,writes,make,store:make(),set mode(value){mode=value;}};
}

module.exports={fixture,state,key};
