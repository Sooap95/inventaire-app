// Le SDK d'émulation est chargé seulement dans la page de recette générée.
if(window.FAMILY_LAB_CONFIG){
 if(window.FAMILY_LAB_CONFIG.mode==='ui-fixture'){if(window.FAMILY_LAB_CONFIG.projectId!=='ui-fixture-no-firebase')throw Error('FIXTURE_ONLY');await import('./mobile-ui.bundle.js');}
 else{
 if(!['127.0.0.1','localhost'].includes(location.hostname)||window.FAMILY_LAB_CONFIG.projectId!=='demo-inventaire-v02')throw Error('EMULATOR_ONLY');
 await import('./family-lab.bundle.js');
 }
}
