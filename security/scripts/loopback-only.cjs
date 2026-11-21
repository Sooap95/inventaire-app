// Garde des clients Node : aucun endpoint non local n'est autorisé en recette.
const http=require('node:http'),https=require('node:https'),net=require('node:net');
function check(host){
 const name=String(host||'localhost').replace(/^\[|\]$/g,'');
 if(!['127.0.0.1','localhost','::1'].includes(name))throw new Error('TEST_NETWORK_GUARD: non-loopback destination refused');
}
for(const mod of [http,https])for(const method of ['request','get']){
 const original=mod[method];mod[method]=function(...args){
  const x=args[0];if(typeof x==='string'||x instanceof URL)check(new URL(x).hostname);
  else check(x.hostname||(x.host?x.host.split(':')[0]:null));
  if(args[1]&&typeof args[1]==='object'&&(args[1].host||args[1].hostname))check(args[1].hostname||args[1].host);
  return original.apply(this,args);
 };
}
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let options=Array.isArray(args[0])?args[0][0]:args[0];
 if(options&&typeof options==='object'){if(!options.path)check(options.host);}
 else if(typeof options==='number')check(typeof args[1]==='string'?args[1]:'localhost');
 return connect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,options){check(new URL(typeof input==='string'||input instanceof URL?input:input.url).hostname);return originalFetch(input,options);};
