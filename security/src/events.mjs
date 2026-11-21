// Reçus v2 compacts : jamais de copie du snapshot legacy ou du groupe entier.
export function compactAfter(d,collection,entryId=null,action=''){
 if(collection==='products')return {revision:d.revision,stockMicros:d.stockMicros,thresholdMicros:d.thresholdMicros,targetMicros:d.targetMicros,
  name:d.name,unit:d.unit,frequency:d.frequency,lastRestocked:d.lastRestocked,deleted:d.deleted,details:d.details||{},lastPurchaseId:d.lastPurchaseId||null};
 return {revision:d.revision,totalMicros:d.totalMicros,productRevision:d.productRevision,automaticMicros:d.automaticMicros,
  needsReview:d.needsReview,fulfilledMicros:d.fulfilledMicros||0,
  entry:entryId&&['add','edit','remove'].includes(action)?d.contributions[entryId]:null,
  checked:entryId?(d.checks[entryId]??d.checkAll):null,checkAll:d.checkAll,automaticChecked:d.automaticChecked};
}
