// Adaptation explicite et bornée du SDK de recette : sa sonde de connectivité
// Google est désactivée à la construction. Les erreurs et retries RPC restent gérés.
// Aucun fichier de node_modules n'est modifié. Échec fermé au changement amont.
import {build} from 'esbuild';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sdk=path.join(root,'security/node_modules/@firebase/webchannel-wrapper/dist/webchannel-blob/esm/webchannel_blob_es2018.js');
const expected='ffb869dc24afd692dee8736f9052850cce4ff28ec65ab4de89a001a57a2d4655';
let patched=0;
const outfile=path.join(root,'dist/family-lab/src/family/family-lab.bundle.js');
const result=await build({entryPoints:[path.join(root,'src/family/ui.js')],outfile,bundle:true,write:false,format:'esm',target:['safari16','chrome110'],minify:true,
 nodePaths:[path.join(root,'security/node_modules')],plugins:[{name:'loopback-connectivity-probe',setup(build){
  build.onLoad({filter:/webchannel_blob_es2018\.js$/},args=>{
   if(args.path!==sdk)throw Error('Unexpected WebChannel source');
   const source=readFileSync(args.path,'utf8'),needle='if(b==2){var c=p(a.bb,a),d=a.Ua;const e=!d;d=new T(d||"//www.google.com/images/cleardot.gif");l.location&&l.location.protocol=="http"||kc(d,"https");Db(d);e?Bc(d.toString(),c):Cc(d.toString(),c);}else J(2);';
   if(createHash('sha256').update(source).digest('hex')!==expected||source.split(needle).length!==2)throw Error('Review upstream connectivity behavior before building');
   patched++;return {contents:source.replace(needle,'J(2);'),loader:'js',resolveDir:path.dirname(args.path)};
  });
 }}]});
if(patched!==1)throw Error('Connectivity adaptation was not applied exactly once');
for(const file of result.outputFiles)writeFileSync(file.path,file.contents);
console.log('Bundle local : '+result.outputFiles[0].contents.length+' octets ; sonde de connectivité extérieure désactivée.');
