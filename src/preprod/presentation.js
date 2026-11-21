export function runtimeWords(info,language){
 if(!['preprod','preprod-emulator-test'].includes(info.kind))return {};
 const de=language==='de',local=info.kind==='preprod-emulator-test';
 return {title:de?'Familie — VORPRODUKTION':'Famille — PRÉPRODUCTION',scope:local?(de?'Lokale Emulatoren · fiktive Daten · kein Cloud-Zugriff':'Émulateurs locaux · données fictives · aucun accès cloud'):(de?'Isolierte Vorproduktion · keine persönlichen Daten':'Préproduction isolée · aucune donnée personnelle')};
}
export const diagnosticWords={fr:{title:'Diagnostic agrégé local',open:'Voir les compteurs locaux estimés'},de:{title:'Lokale aggregierte Diagnose',open:'Geschätzte lokale Zähler anzeigen'}};
