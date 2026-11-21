// Pas de constructeur activable par un flag/env : l'adaptateur nécessite une revue A2.
import {assertA0Environment} from '../src/preprod/profiles.js';
assertA0Environment(process.env);
console.error('A0_CLOUD_DISABLED: aucun paquet Firebase réel construit. Voir docs/PHASE-8A0-DECISION-A1.md.');
process.exitCode=2;
