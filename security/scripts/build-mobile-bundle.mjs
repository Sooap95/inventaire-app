// Construction distincte : aucun SDK Firebase et aucun adaptateur d'émulation.
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));let substitutions=0;
const result=await build({entryPoints:[path.join(root,'src/family/ui.js')],bundle:true,write:false,format:'esm',target:['safari16','chrome110'],minify:true,metafile:true,
 plugins:[{name:'fixture-only',setup(build){build.onResolve({filter:/^\.\/runtime\.js$/},args=>{if(path.resolve(args.resolveDir,args.path)!==path.join(root,'src/family/runtime.js'))return;substitutions++;return {path:path.join(root,'src/mobile/runtime.js')};});}}]});
if(substitutions!==1||Object.keys(result.metafile.inputs).some(p=>p.includes('node_modules')||p.endsWith('family/identity.js')||p.endsWith('family/transport.js')))throw Error('NIVEAU_1_MUST_NOT_INCLUDE_FIREBASE');
const output=path.join(root,'dist/mobile-ui/src/family/mobile-ui.bundle.js');writeFileSync(output,result.outputFiles[0].contents);
writeFileSync(path.join(root,'dist/mobile-ui/bundle-inputs.json'),JSON.stringify({firebaseSdk:false,inputs:Object.keys(result.metafile.inputs).sort()},null,2)+'\n');
console.log('Bundle mobile niveau 1 : '+result.outputFiles[0].contents.length+' octets ; aucun SDK Firebase.');
