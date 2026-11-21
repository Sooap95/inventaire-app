// Audit sans écriture : une nouvelle identité n'adopte jamais l'ancien auteur.
import {validateState,validUid} from './state.js';
import {digest} from '../../security/src/contracts.mjs';
export async function auditIdentityBackup(file,newUid,events=[]){
 if(file?.format!=='inventaire-family-local'||file.version!==1||!validUid(newUid))throw Error('invalid-backup');validateState(file.state);
 const oldUid=file.state.uid;if(oldUid===newUid)throw Error('same-identity-use-normal-restore');const outcomes=[];
 for(const item of file.state.outbox.filter(i=>!['ack','cancelled'].includes(i.status))){
  const c=item.command,event=events.find(e=>e.id===c.operationId);let status='manual-review-required';
  if(event){const receipt=c.action.toLowerCase().includes('purchase');const hash=await digest(receipt?c:{...c,eventVersion:2});status=event.authorUid===oldUid&&event.requestHash===hash?'server-received':'operation-identity-conflict';}
  outcomes.push({operationId:c.operationId,action:c.action,targetId:c.targetId,oldAuthorUid:oldUid,status,canAutoReplay:false});
 }
 return {mode:'review-only',oldUid,newUid,outcomes,changes:[],requiresCurrentStockAndDuplicateReview:true};
}
