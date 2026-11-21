import test from 'node:test';import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
const env=await initializeTestEnvironment({projectId:'demo-inventaire-v02',firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
test.after(async()=>env.cleanup());
test('Live serveur : profil anonyme non membre ne lit pas les produits',async()=>{const db=env.authenticatedContext('fictional-live-phone-a',{firebase:{sign_in_provider:'anonymous'}}).firestore();await assert.rejects(getDoc(doc(db,'products','milk')));});
test('Live serveur : profil ne peut pas créer sa propre autorisation',async()=>{const db=env.authenticatedContext('fictional-live-phone-b',{firebase:{sign_in_provider:'anonymous'}}).firestore();await assert.rejects(setDoc(doc(db,'members','fictional-live-phone-b'),{uid:'fictional-live-phone-b',schemaVersion:2,status:'active',role:'device',authType:'anonymous'}));});
