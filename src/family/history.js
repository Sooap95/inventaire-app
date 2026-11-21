// Projection de lecture seulement. Une annulation retire son achat des statistiques.
export function restockHistory(product,events){
 const undone=new Set(events.filter(e=>e.action==='undoPurchase'&&e.targetId===product.id).map(e=>e.receipt?.compensates));
 const purchases=events.filter(e=>e.action==='purchase'&&e.targetId===product.id&&!undone.has(e.id));
 const original=Array.isArray(product.legacy?.restockHistory)?structuredClone(product.legacy.restockHistory):[];
 const ids=new Set(original.map(e=>e.operationId).filter(Boolean));
 return original.concat(purchases.filter(e=>!ids.has(e.id)).map(e=>({date:e.createdAt,qty:e.valueMicros/1000000,by:e.authorUid,operationId:e.id}))).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
}
