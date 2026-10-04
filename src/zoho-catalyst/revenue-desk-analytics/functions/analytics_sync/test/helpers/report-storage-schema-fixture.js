'use strict';
// Published schema names/types only; synthetic tests contain no tenant metadata.
const runtime=require('../../../../../revenue-desk-call-runtime/config/datastore-schema.json');
const reports=require('../../../../config/report-run-schema.json');
const application={
 eventReceipts:runtime.tables.find(x=>x.api_name==='RevenueDeskEventReceipts').columns,
 reportRuns:[...reports.existing_required_columns,...reports.existing_optional_columns,...reports.additive_columns]
};
const system=['ROWID','CREATORID','CREATEDTIME','MODIFIEDTIME'];
function columns(role){
 return [...system.map(column_name=>({column_name,data_type:column_name.endsWith('TIME')?'datetime':'bigint',max_length:50,is_mandatory:false,is_unique:false})),
  ...application[role].map(c=>({column_name:c.api_name,data_type:c.encrypted===true?'encrypted text':c.type.replace('encrypted_text','encrypted text'),
   max_length:c.max_length??(c.type==='bigint'?19:50),is_mandatory:c.mandatory===true,is_unique:c.unique===true}))];
}
function missingMandatory(row,role){return columns(role).filter(c=>c.is_mandatory&&(!Object.hasOwn(row,c.column_name)||row[c.column_name]===null)).map(c=>c.column_name);}
function nullableColumns(role){return columns(role).filter(c=>!c.is_mandatory&&!system.includes(c.column_name)).map(c=>c.column_name);}
function withNullColumns(row,role){return {...Object.fromEntries(nullableColumns(role).filter(name=>!Object.hasOwn(row,name)).map(name=>[name,null])),...row,CREATEDTIME:'2027-01-15 08:00:00',MODIFIEDTIME:'2027-01-15 08:00:00'};}
module.exports={columns,missingMandatory,nullableColumns,withNullColumns};
