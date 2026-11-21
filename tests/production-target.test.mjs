import test from 'node:test';
import assert from 'node:assert/strict';
import {BINDING,assertProductionContext,assertProductionDatabase} from '../src/production/target.js';
import {productionPolicy,checkTarget} from '../src/production/policy.mjs';
const location=()=>({origin:BINDING.origin,protocol:'https:',pathname:BINDING.basePath});
const db=()=>({app:{options:{...BINDING.firebase}},_databaseId:{projectId:BINDING.projectId,database:'(default)'},_settings:{host:'firestore.googleapis.com',ssl:true}});
test('production: exact project, default DB, HTTPS origin and historical path',()=>{
 globalThis.location=location();assert.equal(assertProductionContext(BINDING),BINDING);assert.doesNotThrow(()=>assertProductionDatabase(db(),BINDING));
 for(const other of ['projectId','projectNumber','databaseId','location','origin','basePath'])assert.throws(()=>assertProductionContext({...BINDING,[other]:'other'}));
 for(const key of Object.keys(BINDING.firebase))assert.throws(()=>assertProductionContext({...BINDING,firebase:{...BINDING.firebase,[key]:'other'}}));
 for(const change of [{origin:'https://inventaire-maison-v02-recette-sync.pages.dev'},{pathname:'/another-app/'},{protocol:'http:'}]){globalThis.location={...location(),...change};assert.throws(()=>assertProductionContext(BINDING));}
 globalThis.location=location();
});
test('production: closed policy required and rechecked after a changed target',()=>{
 globalThis.location=location();const policy=productionPolicy(BINDING),database=db();assert.doesNotThrow(()=>checkTarget(policy,database));
 for(const fake of [undefined,{},Object.freeze({kind:'production'})])assert.throws(()=>checkTarget(fake,database));
 database._settings.host='127.0.0.1:8180';assert.throws(()=>checkTarget(policy,database));
 globalThis.location={...location(),pathname:'/another-app/'};assert.throws(()=>checkTarget(policy,db()));globalThis.location=location();
});
