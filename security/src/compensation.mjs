// Même compensation physique : le résultat métier demandé doit aussi coïncider.
// L'UID peut différer (deux appareils) ; aucun choix différent n'est acquitté.
export function sameCompensationDecision(event,command){
 return event.beforeRevision===command.expectedRevision
  && (event.targetCollection!=='products'||event.receipt?.groupBeforeRevision===command.expectedGroupRevision)
  && event.action===command.action && event.targetCollection===command.targetCollection
  && event.targetId===command.targetId && event.receipt?.compensates===command.compensates
  && event.valueMicros===command.valueMicros && event.choice===command.choice
  && event.receipt.choiceValueMicros===(command.choiceValueMicros??0);
}
