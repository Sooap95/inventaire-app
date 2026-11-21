// Implémentation officielle Auth Emulator, sans CLI, login ou télémétrie.
import {createRequire} from 'node:module';
import {PROJECT} from '../src/contracts.mjs';
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_TOKEN)throw Error('AUTH_EMULATOR_ONLY');
const require=createRequire(import.meta.url);
const {createApp}=require('../node_modules/firebase-tools/lib/emulator/auth/server.js');
const app=await createApp(PROJECT,2);
const server=app.listen(9099,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
