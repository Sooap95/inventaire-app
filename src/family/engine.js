import {enqueue,claim,settle,classify,spend,retry,cancel,copy} from './state.js';
import {deviceStatus} from './membership.js';
export function familyEngine({uid,store,transport,changed=()=>{},online=()=>navigator.onLine,owner=crypto.randomUUID(),now=Date.now}){
 let state,active=true,authorized=false,stops=[],running=false,timer,epoch=0,memberStop=null,connecting=false,lastReason='connecting',connectRequested=false,loaded=new Set();
 const update=async(fn,rev=null)=>{state=await store.mutate(uid,fn,rev);changed(state);return state;};
 async function stopListeners(){for(const stop of stops.splice(0))stop();}
 async function pause(reason){epoch++;lastReason=reason;authorized=false;await stopListeners();if(reason==='revoked'||reason==='waiting')await update(s=>({...s,lastAuthorization:null}));changed(state,reason);}
 async function charge(reads,writes){await update(s=>spend(s,reads,writes,now()));}
 async function start(){state=await store.read(uid);changed(state,'connecting');if(transport.observeMembership)memberStop=transport.observeMembership(async m=>{if(!active)return;const status=deviceStatus(m,uid);if(status!=='active'){await pause(status);return;}if(!authorized&&lastReason!=='quota'){if(connecting)connectRequested=true;else await connect();}},e=>pause(classify(e)));await connect();timer=setInterval(()=>{if(active)reload().then(flush).catch(()=>changed(state,'storage'));},2000);return state;}
 async function connect(){
  if(!active||connecting)return;connecting=true;const token=++epoch;await stopListeners();authorized=false;loaded=new Set();
  try{
   if(!online()&&state.lastAuthorization?.uid===uid&&state.lastAuthorization.policy==='anonymous-device-v2'){authorized=true;lastReason='offline';changed(state,'offline');return;}
   await charge(2,0);await transport.member();if(!active||token!==epoch)return;authorized=true;lastReason=null;if(transport.observeMembership)await update(s=>({...s,lastAuthorization:{uid,policy:'anonymous-device-v2',verifiedAt:now()}}));
   if(!transport.observeMembership)stops.push(transport.watch('member',async(_,meta)=>{if(!meta.fromCache)changed(state);},e=>pause(classify(e))));
   for(const kind of ['products','groups'])stops.push(transport.watch(kind,async(data,meta)=>{
    if(!active||!authorized||token!==epoch||meta.hasPendingWrites)return;try{if(!meta.fromCache)await charge(Math.max(1,meta.changes||data.length),0);if(!active||!authorized||token!==epoch)return;await update(s=>({...s,cache:{...s.cache,[kind]:mergeCache(s.cache[kind],data)}}));if(!meta.fromCache)loaded.add(kind);changed(state,meta.fromCache?'offline':loaded.size===2?null:'connecting');await flush();}catch(e){await pause(classify(e));}
   },e=>pause(classify(e))));
   changed(state);await flush();
  }catch(e){await pause(classify(e));}finally{connecting=false;const again=connectRequested;connectRequested=false;if(again&&active&&!authorized&&lastReason!=='quota')queueMicrotask(()=>connect());}
 }
 async function reload(){state=await store.read(uid);changed(state);}
 async function submit(commands){if(!active)throw Error('signed-out');await update(s=>enqueue(s,commands));await flush();return state;}
 async function flush(){
  if(running||!active||!authorized||!online())return;running=true;
  try{while(active&&authorized&&online()){
   state=await store.read(uid);const head=state.outbox.find(i=>!['ack','cancelled'].includes(i.status));if(!head||!['pending','sending'].includes(head.status)||head.status==='sending'&&head.leaseUntil>now()&&head.owner!==owner)break;
   let item;await update(s=>{const result=claim(s,owner,now());item=result.item;return result.state;});if(!item)break;
   try{
    // Estimation majorée pour transactions, règles et retries. Pas un compteur Firebase.
    await charge(item.command.action.startsWith('undo')?120:50,item.command.action.includes('purchase')||item.command.action.includes('Purchase')?3:2);
    await transport.write(item.command);
    await update(s=>settle(s,item.command.operationId,'ack',owner));
   }catch(e){const status=classify(e);await update(s=>settle(s,item.command.operationId,status,owner,e.message==='compensation-decision-conflict'?e.message:String(e.code||e.message)));if(status==='quota'||status==='revoked')await pause(status);changed(state,status);break;}
  }}finally{running=false;}
 }
 async function resume(id){if(id)await update(s=>retry(s,id));await connect();}
 return {start,submit,flush,reload,resume,charge,cancel:id=>update(s=>cancel(s,id)),mutate:update,get state(){return state;},get authorized(){return authorized;},close:async()=>{active=false;authorized=false;clearInterval(timer);memberStop?.();await stopListeners();}};
}

function mergeCache(before,incoming){const merged=new Map(before.map(d=>[d.id,d]));for(const d of incoming){const old=merged.get(d.id);if(!old||d.revision>=old.revision)merged.set(d.id,copy(d));}return [...merged.values()];}
