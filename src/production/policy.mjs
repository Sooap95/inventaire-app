// Production build only. Common transactions and their A0/A2 baselines are intact.
import {assertProductionContext,assertProductionDatabase} from './target.js';
import {TargetPolicyError} from '../preprod/target.js';
const checks=new WeakMap();
export function productionPolicy(binding){const p=assertProductionContext(binding),token=Object.freeze({kind:'production'});checks.set(token,db=>assertProductionDatabase(db,p));return token;}
export function checkTarget(policy,db){const check=policy&&checks.get(policy);if(!check)throw new TargetPolicyError('EXPLICIT_TARGET_POLICY_REQUIRED');check(db);}
