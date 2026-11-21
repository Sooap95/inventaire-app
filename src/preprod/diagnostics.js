// Compteurs agrégés, sur demande seulement. Aucun UID, ID, nom, commande ou jeton.
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function diagnostics(state,journal=null){
 if(!state||!Array.isArray(state.outbox)||!state.budget||![state.budget.reads,state.budget.writes].every(count))throw Error('diagnostics-input');
 if(journal&&(!['fixture-sample','emulator-admin','preprod-admin-future'].includes(journal.source)||![journal.documents,journal.bytes].every(count)||typeof journal.complete!=='boolean'))throw Error('journal-sample');
 const statuses={};for(const item of state.outbox){if(!['pending','sending','ack','conflict','quota','revoked','invalid','held','cancelled'].includes(item.status))throw Error('diagnostics-status');statuses[item.status]=(statuses[item.status]||0)+1;}
 const total=state.outbox.length,open=total-(statuses.ack||0)-(statuses.cancelled||0);
 return {format:'inventaire-a0-diagnostics',version:1,estimatedLocalBudget:{reads:state.budget.reads,writes:state.budget.writes,limits:{reads:10000,writes:1000},window:'rolling-24h-client'},observedLocal:{outboxEntries:total,outboxOpen:open,conflicts:statuses.conflict||0,statuses},alerts:{outbox:total>=5000?'blocked':total>=4500?'critical':total>=4000?'warning':'normal',journalHistory:journal&&journal.documents>20?'check-per-product-history':'not-established'},journal:journal?{source:journal.source,documents:journal.documents,bytes:journal.bytes,complete:journal.complete}:null,serverBillingCounters:null};
}
export function estimateWeek(x){
 const fields=['profiles','products','groups','fullOpensPerDayPerProfile','ordinaryPerDay','purchasesPerDay','undoPerDay','statsPerDay','backupPerWeek','eventBytes'];
 if(!x||Object.keys(x).length!==fields.length||!fields.every(k=>count(x[k]))||x.profiles<1||x.profiles>3||x.eventBytes<1)throw Error('usage-assumptions');
 const actions=x.ordinaryPerDay+x.purchasesPerDay+x.undoPerDay;
 const snapshots=x.profiles*x.fullOpensPerDayPerProfile*(x.products+x.groups+4);
 const reserved=x.ordinaryPerDay*50+x.purchasesPerDay*50+x.undoPerDay*120+x.statsPerDay*420;
 // Deltas vers tous les profils ; double cible pour achats/annulations avec groupe.
 const deltas=x.profiles*(x.ordinaryPerDay+2*(x.purchasesPerDay+x.undoPerDay));
 const writes=2*x.ordinaryPerDay+3*(x.purchasesPerDay+x.undoPerDay);
 const events=actions*7,baseDocs=x.products+x.groups+x.profiles;
 const backupReads=2*(baseDocs+events)*x.backupPerWeek;
 return {assumptions:structuredClone(x),days:7,events,estimated:{snapshotReadsPerDay:snapshots,reservedOperationReadsPerDay:reserved,listenerDeltaReadsPerDay:deltas,readsPerWeek:(snapshots+reserved+deltas)*7+backupReads,peakDayReadsWithBackup:snapshots+reserved+deltas+backupReads,writesPerDay:writes,writesPerWeek:writes*7,journalPayloadBytesPerWeek:events*x.eventBytes,backupReadsPerWeek:backupReads},notMeasured:['rules-dependent reads','real retries/reconnects','document/index overhead','actual server billing','bandwidth','prior journal'],freeQuotaReference:{readsPerDay:50000,writesPerDay:20000,storedBytes:1073741824,sourceDate:'2026-11-07; revalidate before A1'},costTargetCHF:0};
}
