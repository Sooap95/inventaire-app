// src/production/target.js
var binding_default = {
  projectId: "inventaire-maison-8fd95",
  projectNumber: "272639034410",
  databaseId: "(default)",
  location: "eur3",
  origin: "https://sooap95.github.io",
  basePath: "/inventaire-app/",
  firebase: {
    apiKey: "AIzaSyAfzXb6eSKaFXPc7kkLnXfmHcO1kvpuCSk",
    authDomain: "inventaire-maison-8fd95.firebaseapp.com",
    projectId: "inventaire-maison-8fd95",
    storageBucket: "inventaire-maison-8fd95.firebasestorage.app",
    messagingSenderId: "272639034410",
    appId: "1:272639034410:web:18c837ff78c3eefa5faf53"
  }
};
var PREPROD = Object.freeze({ projectId: "inventaire-v02-preprod-a1", projectNumber: "319106753418", databaseId: "(default)", location: "europe-west6", origin: "https://inventaire-maison-v02-recette-sync.pages.dev" });
var TargetPolicyError = class extends Error {
  constructor(message) {
    super(message);
    this.code = "target-policy-denied";
  }
};
var BINDING = Object.freeze({ ...binding_default, firebase: Object.freeze({ ...binding_default.firebase }) });
var fail = (code) => {
  throw new TargetPolicyError(code);
};
function assertProductionContext(input) {
  if (!input || Object.keys(input).sort().join() !== Object.keys(BINDING).sort().join()) fail("PRODUCTION_BINDING");
  for (const key of ["projectId", "projectNumber", "databaseId", "location", "origin", "basePath"]) if (input[key] !== BINDING[key]) fail("PRODUCTION_BINDING");
  if (!input.firebase || Object.keys(input.firebase).sort().join() !== Object.keys(BINDING.firebase).sort().join()) fail("PRODUCTION_WEB_BINDING");
  for (const key of Object.keys(BINDING.firebase)) if (input.firebase[key] !== BINDING.firebase[key]) fail("PRODUCTION_WEB_BINDING");
  if (globalThis.location?.origin !== BINDING.origin || location.protocol !== "https:" || !(location.pathname === BINDING.basePath.slice(0, -1) || location.pathname.startsWith(BINDING.basePath))) fail("PRODUCTION_ORIGIN");
  return BINDING;
}
function assertProductionDatabase(db, binding) {
  const p = assertProductionContext(binding), d = db?._delegate || db, o = d?.app?.options;
  if (!o || Object.keys(p.firebase).some((k) => o[k] !== p.firebase[k]) || d?._databaseId?.projectId !== p.projectId || d?._databaseId?.database !== p.databaseId || d?._settings?.host !== "firestore.googleapis.com" || d?._settings?.ssl !== true) fail("PRODUCTION_DATABASE");
}
export {
  BINDING,
  assertProductionContext,
  assertProductionDatabase
};
