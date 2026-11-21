// Lecture bornée. Le curseur natif conserve la précision du Timestamp Firestore.
export async function boundedHistory(readPage,cap=200){
 if(!Number.isSafeInteger(cap)||cap<1||cap>200)throw Error('history-cap');
 const events=[];let cursor=null;
 while(events.length<cap){const size=Math.min(20,cap-events.length),page=await readPage(cursor,size);events.push(...page.events);if(page.events.length<size)return {events,complete:true};cursor=page.cursor;}
 const tail=await readPage(cursor,1);return {events,complete:tail.events.length===0};
}
