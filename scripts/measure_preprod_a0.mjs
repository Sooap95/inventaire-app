// Mesures locales de fixtures uniquement, ni Firestore ni inventaire réel.
import {readFileSync,statSync} from 'node:fs';
import {fixtureData,fixtureApply} from '../src/mobile/reducer.js';
import {diagnostics,estimateWeek} from '../src/preprod/diagnostics.js';
import {fresh} from '../src/family/state.js';
import {assertA0Environment} from '../src/preprod/profiles.js';
assertA0Environment(process.env);
const root=new URL('../',import.meta.url),uid='simulation_a0';
const state={...fixtureData(),status:'active'};
const c={actorUid:uid,operationId:'a0-measure-stock-0001',targetCollection:'products',targetId:'milk',expectedRevision:1,action:'product.write',confirmed:true,data:{stockMicros:2e6}};
const after=fixtureApply(state,c,uid,'a'.repeat(64),'2026-11-08T00:00:00.000Z');
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const usage=estimateWeek(JSON.parse(readFileSync(new URL('config/environments/usage-week.json',root))));
const sample=fresh(uid);sample.budget.reads=50;sample.budget.writes=2;
console.log(JSON.stringify({format:'inventaire-a0-local-measurements',version:1,source:'fictional reducer, not Firestore serialization',productJsonBytes:bytes(after.products[0]),stockEventJsonBytes:bytes(after.operations[0]),mobileZipBytes:statSync(new URL('artifacts/Inventaire-Maison-Niveau1-mobile.zip',root)).size,mobileBundleBytes:statSync(new URL('dist/mobile-ui/src/family/mobile-ui.bundle.js',root)).size,diagnostics:diagnostics(sample,{source:'fixture-sample',documents:after.operations.length,bytes:bytes(after.operations),complete:true}),usage,limitations:['UTF-8 JSON payload only; no Firestore index/protocol overhead','example event is not a worst case','no measured cloud resource use','no real phone performance measurement']},null,2));
