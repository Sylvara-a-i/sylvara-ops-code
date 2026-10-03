'use strict';
// Offline only: no Library/provider calls. Upload capability is checked by the operator before fresh reads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const preparer=require('./storage-qualification-preparer');
const pythonScript="import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); z=pathlib.Path(sys.argv[2]); files=sorted(f for f in p.iterdir() if f.is_file()); a=zipfile.ZipFile(z,'x',zipfile.ZIP_DEFLATED); [a.write(f,f.name) for f in files]; a.close(); a=zipfile.ZipFile(z); assert a.testzip() is None; assert set(a.namelist())==set(f.name for f in files); assert all(a.read(f.name)==f.read_bytes() for f in files); a.close()";
function packageFiles(python,directory,archive){cp.execFileSync(python,['-c',pythonScript,directory,archive],{stdio:'pipe',timeout:30000});}
function preflight(python){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sylvara-packaging-check-'));try{const folder=path.join(root,'files');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'synthetic.txt'),'synthetic packaging probe');packageFiles(python,folder,path.join(root,'probe.zip'));return {status:'packaging_round_trip_verified',providerRequests:0};}finally{fs.rmSync(root,{recursive:true,force:true});}}
function run(input,{root,python,uploadToolAvailable,at,packagingPreflight=preflight,packageOutput=packageFiles}={}){
 if(uploadToolAvailable!==true||!root||!python||!path.isAbsolute(input.destination)||!path.isAbsolute(input.archive)||fs.existsSync(input.destination)||fs.existsSync(input.archive))throw Error('LOCAL_PREPARATION_HELD');
 // Recheck the real packaging path before reading witnesses or generating a nonce/claim.
 packagingPreflight(python);
 const {destination,archive,...witnessInput}=input;
 const codecFile=path.join(root,'report-storage-binding.js');
 const codec=fs.existsSync(codecFile)?require(codecFile):undefined;
 const result=preparer.prepareWitnesses(witnessInput,{root,codec,...(at===undefined?{}:{at})});
 const receipt=preparer.write(result,destination,{root,...(at===undefined?{}:{at})});
 // On failure retain the one claim and prepared files; never automatically repeat preparation.
 packageOutput(python,destination,archive);
 return {...receipt,archiveSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),archiveBytes:fs.statSync(archive).size};
}
module.exports={preflight,run};
if(require.main===module){try{const [stage,python,inputFile,root,discoveryFile]=process.argv.slice(2);if(stage==='preflight')console.log(JSON.stringify(preflight(python)));else if(stage==='prepare'){const discovery=JSON.parse(fs.readFileSync(discoveryFile,'utf8'));if(discovery.toolName!=='mcp__codex_apps__library_create_library_file'||discovery.supportedHostUpload!==true)throw Error();console.log(JSON.stringify(run(JSON.parse(fs.readFileSync(inputFile,'utf8')),{root,python,uploadToolAvailable:true})));}else throw Error();}catch{console.error('LOCAL_PREPARATION_HELD');process.exitCode=1;}}
