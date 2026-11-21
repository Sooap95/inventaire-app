// Vérification locale de la frontière A0. Toute évolution de ces gardes exige revue.
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const a0Sha='556315add3e62475d288144e986489acb0386eb3b9fe006829e9a9ab1c95a462';
function a0Bytes(){const bytes=readFileSync(new URL('config/environments/a0-baseline.json',root));if(createHash('sha256').update(bytes).digest('hex')!==a0Sha)throw Error('A0_MANIFEST_CHANGED');return bytes;}
export function verifyA0Files(read=file=>readFileSync(new URL(file,root))){
 const baseline=JSON.parse(a0Bytes());
 return Object.entries(baseline.files).map(([file,expected])=>{
  const sha256=createHash('sha256').update(read(file)).digest('hex');
  if(sha256!==expected)throw Error('A0_BOUNDARY_CHANGED: '+file);
  return {file,sha256};
 });
}
export const approvedA2Paths=Object.freeze(['security/src/emulator-writer.mjs','security/src/family-writer.mjs','src/family/identity.js','src/family/transport.js','src/family/ui.js']);
const sha=data=>createHash('sha256').update(data).digest('hex');
export function validateA2Manifest(candidate){
 const original=a0Bytes();
 const a0=JSON.parse(original);
 if(!candidate||Object.keys(candidate).length!==6||candidate.format!=='inventaire-a2-local-baseline'||candidate.version!==1||candidate.base!=='9db1d20'||candidate.a0ManifestSha256!==sha(original)||JSON.stringify(candidate.approvedChanged)!==JSON.stringify(approvedA2Paths)||!candidate.files||JSON.stringify(Object.keys(candidate.files))!==JSON.stringify(Object.keys(a0.files)))throw Error('A2_BASELINE_FORMAT');
 for(const [file,before] of Object.entries(a0.files)){
  const entry=candidate.files[file];if(!entry||Object.keys(entry).length!==2||entry.before!==before||!/^[a-f0-9]{64}$/.test(entry.after)||(!approvedA2Paths.includes(file)&&entry.after!==before))throw Error('A2_UNAPPROVED_CHANGE: '+file);
 }
 return candidate;
}
export function verifyA2Files(read=file=>readFileSync(new URL(file,root))){
 const manifest=validateA2Manifest(JSON.parse(readFileSync(new URL('config/environments/a2-local-baseline.json',root))));
 return Object.entries(manifest.files).map(([file,entry])=>{const sha256=sha(read(file));if(sha256!==entry.after)throw Error('A2_BOUNDARY_CHANGED: '+file);return {file,sha256,beforeSha256:entry.before,changed:sha256!==entry.before};});
}
export function verifyA0Historical(){
 return verifyA0Files(file=>execFileSync('git',['show','79eccc4:'+file],{cwd:root,stdio:['ignore','pipe','pipe']}));
}
