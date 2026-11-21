// Mesure de logique sur cet ordinateur, sans réseau ni identité réelle.
import {performance} from 'node:perf_hooks';import {mkdirSync,writeFileSync} from 'node:fs';
import {parseList} from '../src/shopping/domain.js';
const products=[{id:'milk',name:'Lait',unit:'L'},{id:'aptamil',name:'Aptamil',unit:'boîte'}],samples=[];
const text=Array.from({length:100},(_,i)=>['lait x3','Atamil x1','pommes 0,5 kg','œufs'][i%4]).join('\n');
for(let i=0;i<105;i++){const start=performance.now(),rows=parseList(text,products);if(rows.length!==100)throw Error('benchmark rows');if(i>=5)samples.push(performance.now()-start);}
samples.sort((a,b)=>a-b);const result={scope:'Node desktop, 100 lignes, 100 répétitions après 5 chauffes; pas un téléphone',node:process.version,p50ms:samples[50],p95ms:samples[95],maxMs:samples.at(-1),realPhone:false};mkdirSync('test-results/phase6',{recursive:true});writeFileSync('test-results/phase6/performance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
