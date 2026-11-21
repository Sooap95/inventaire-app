import {build} from 'esbuild';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),test=false;
if(process.argv.length!==2)throw Error('NO_BUILD_FLAGS');
const sdk=path.join(root,'security/node_modules/@firebase/webchannel-wrapper/dist/webchannel-blob/esm/webchannel_blob_es2018.js');
let substitutions=0,patched=0,policies=0;
const runtime=path.join(root,'src/production/runtime.js');
const result=await build({entryPoints:[path.join(root,'src/family/ui.js')],bundle:true,write:false,format:'esm',target:['safari16','chrome110'],minify:true,metafile:true,nodePaths:[path.join(root,'security/node_modules')],plugins:[
 {name:'explicit-preprod-runtime',setup(build){build.onResolve({filter:/^\.\/runtime\.js$/},args=>{if(path.resolve(args.resolveDir,args.path)!==path.join(root,'src/family/runtime.js'))return;substitutions++;return {path:runtime};});}},
 {name:'production-policy',setup(build){build.onResolve({filter:/target-policy\.mjs$/},args=>{if(path.resolve(args.resolveDir,args.path)!==path.join(root,'security/src/target-policy.mjs'))return;policies++;return {path:path.join(root,'src/production/policy.mjs')};});}},
 {name:'production-labels',setup(build){build.onLoad({filter:/family\/ui\.js$/},args=>{let source=readFileSync(args.path,'utf8');for(const [before,after] of [["Famille — laboratoire fictif","Famille"],["Familie — fiktives Labor","Familie"],["Émulateur uniquement · aucun compte réel · coût nul","Profils familiaux autorisés uniquement"],["Nur Emulator · keine echten Konten · kostenlos","Nur freigegebene Familienprofile"]])source=source.replaceAll(before,after);source=source.replace("function mediaAllowed(){status.textContent=ew().unsupported;return false;}","function mediaAllowed(){return allowProductAction();}");return {contents:source,loader:'js',resolveDir:path.dirname(args.path)};});}},
 {name:'historical-auth-persistence',setup(build){build.onLoad({filter:/family\/identity-core\.js$/},args=>{let source=readFileSync(args.path,'utf8');source=source.replace('initializeAuth,indexedDBLocalPersistence,setPersistence','initializeAuth,indexedDBLocalPersistence,browserLocalPersistence,setPersistence').replace('persistence:indexedDBLocalPersistence','persistence:[indexedDBLocalPersistence,browserLocalPersistence]');return {contents:source,loader:'js',resolveDir:path.dirname(args.path)};});}},
 {name:'no-connectivity-probe',setup(build){build.onLoad({filter:/webchannel_blob_es2018\.js$/},args=>{
  if(args.path!==sdk)throw Error('Unexpected WebChannel source');const source=readFileSync(args.path,'utf8'),needle='if(b==2){var c=p(a.bb,a),d=a.Ua;const e=!d;d=new T(d||"//www.google.com/images/cleardot.gif");l.location&&l.location.protocol=="http"||kc(d,"https");Db(d);e?Bc(d.toString(),c):Cc(d.toString(),c);}else J(2);';
  if(createHash('sha256').update(source).digest('hex')!=='ffb869dc24afd692dee8736f9052850cce4ff28ec65ab4de89a001a57a2d4655'||source.split(needle).length!==2)throw Error('Review upstream connectivity behavior');patched++;return {contents:source.replace(needle,'J(2);'),loader:'js',resolveDir:path.dirname(args.path)};
 });}}
]});
if(substitutions!==1||patched!==1||policies<1)throw Error('BUILD_SUBSTITUTION_MISMATCH');
const inputs=Object.keys(result.metafile.inputs).map(p=>path.relative(root,path.resolve(p))).sort();
const forbidden=['security/src/target-policy.mjs','src/preprod/live-runtime.js','src/preprod/emulator-test-runtime.js','src/mobile/runtime.js','security/src/emulator-admin.mjs','security/src/device-admin.mjs'];
if(!test)forbidden.push('src/family/identity.js','src/family/transport.js','src/preprod/emulator-test-runtime.js','security/src/emulator-writer.mjs','security/src/family-writer.mjs');
if(inputs.some(p=>forbidden.includes(p)))throw Error('PREPROD_BUNDLE_BOUNDARY');
const dest=path.join(root,'dist/production');mkdirSync(path.join(dest,'src/production'),{recursive:true});
writeFileSync(path.join(dest,'src/production/app.bundle.js'),result.outputFiles[0].contents);
writeFileSync(path.join(dest,'bundle-inputs.json'),JSON.stringify({mode:'production',firebaseSdk:true,cloudExecutionAuthorized:true,inputs},null,2)+'\n');
await build({entryPoints:[path.join(root,'src/production/target.js')],bundle:true,format:'esm',target:['safari16','chrome110'],outfile:path.join(dest,'src/production/target.js')});
console.log('Bundle final construit localement : '+result.outputFiles[0].contents.length+' octets ; aucun SDK exécuté.');
