import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {segmentLines,proposeLine,validateConfirmed,accuracy} from '../src/ocr/lines.js';

test('segmentation propose deux zones sans détruire les lignes',()=>{
  const width=100,height=100,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(const [top,bottom] of [[10,20],[50,60]])for(let y=top;y<bottom;y++)for(let x=20;x<80;x++){
    const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;
  }
  const lines=segmentLines(data,width,height);
  assert.equal(lines.length,2);
  assert.ok(lines[0].top<=10&&lines[0].bottom>=20);
  assert.ok(lines[1].top<=50&&lines[1].bottom>=60);
  assert.deepEqual(segmentLines(new Uint8ClampedArray(width*height*4).fill(255),width,height),[]);
});
test('propositions FR/DE : décimales reconnues, pas de quantité inventée',()=>{
  assert.deepEqual(proposeLine('2,5 L lait'),{name:'lait',quantity:'2.5',unit:'L',uncertain:true});
  assert.deepEqual(proposeLine('Milch 2 Liter'),{name:'Milch',quantity:'2',unit:'Liter',uncertain:true});
  assert.deepEqual(proposeLine('Pommes'),{name:'Pommes',quantity:'',unit:'',uncertain:true});
  assert.equal(proposeLine('trois bouteilles huile').quantity,'');
});
test('confirmation nécessaire ; doublons conservés séparément, jamais additionnés',()=>{
  const row={id:'a',name:'lait',quantity:'2,5',unit:'L',confirmed:true};
  assert.equal(validateConfirmed([row])[0].quantity,2.5);
  assert.throws(()=>validateConfirmed([{...row,confirmed:false}]));
  for(const quantity of ['','0','-2','NaN','Infinity'])assert.throws(()=>validateConfirmed([{...row,quantity}]));
  assert.throws(()=>validateConfirmed([]));
  const results=validateConfirmed([row,{...row,id:'b'}]);
  assert.equal(results.length,2);assert.deepEqual(results.map(r=>r.quantity),[2.5,2.5]);
  assert.equal('confirmed' in results[0],false);
});
test('mesures exactes et taux d’erreur caractère connus',()=>{
  assert.equal(accuracy('lait','lait').characterErrorRate,0);
  assert.equal(accuracy('lait','lit').characterErrorRate,.25);
  assert.equal(accuracy('lait','lait!').characterErrorRate,.25);
  assert.equal(accuracy('','lait').characterErrorRate,null);
  assert.equal(accuracy('é','e\u0301').exact,true);
});
test('configuration de confidentialité : aucun moteur distant, pas de Firebase/OFF',()=>{
  const worker=readFileSync(new URL('../labs/ocr/recognizer.worker.js',import.meta.url),'utf8');
  assert.match(worker,/env.allowRemoteModels=false/);
  assert.match(worker,/workerBlobURL:false,gzip:false,cacheMethod:'none'/);
  assert.match(worker,/numThreads=1/);
  for(const path of ['../labs/ocr/app.js','../labs/ocr/recognizer.worker.js','../labs/ocr/index.html']){
    const code=readFileSync(new URL(path,import.meta.url),'utf8');
    assert.doesNotMatch(code,/https:\/\//);
    assert.doesNotMatch(code,/localStorage|indexedDB/);
  }
});
