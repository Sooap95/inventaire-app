import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('SW : nouvelles ressources précachées, nettoyage limité aux caches de l’application',async()=>{
 const script=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 for(const path of ['domain.js','store.js','manual-ui.js','manual.css'])assert.ok(script.includes(`./src/shopping/${path}`));
 const handlers={},deleted=[];
 const self={addEventListener:(type,fn)=>handlers[type]=fn,clients:{claim:async()=>{} }};
 const current=script.match(/const CACHE = '([^']+)'/)[1];
 const caches={keys:async()=>['inventaire-maison-v3','inventaire-maison-v4-manual-local',current,'inventaire-ocr-https:models','autre-app'],delete:async name=>deleted.push(name)};
 vm.runInNewContext(script,{self,caches});let work;handlers.activate({waitUntil:p=>work=p});await work;
 assert.deepEqual(deleted,['inventaire-maison-v3','inventaire-maison-v4-manual-local']);
});
