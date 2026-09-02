import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOffer,inheritBillingOffer,billingRoutes} from '../../apps/api/src/modules/billing.mjs';
import {createCore} from '../../apps/api/src/app.mjs';
const offer={product_id:'sites',slug:'pro',name:'Plano Pro',provider:'asaas',kind:'one_time',amount_minor:19990,currency:'BRL',interval:null,installments:1,email_owner:'provider',email_templates:{welcome:'boas-vindas'},version:0};
test('billing validates minor units, currency, recurrence, installment support and safe templates',()=>{
 assert.equal(validateOffer(offer).amount_minor,19990);
 for(const change of [{provider:'other'},{amount_minor:1.1},{amount_minor:-1},{currency:'USD'},{interval:'month'},{installments:2},{email_owner:'both'},{email_templates:{unknown:'template'}},{email_templates:null},{email_templates:{welcome:'<script>'}},{version:-1},{live:true}])assert.throws(()=>validateOffer({...offer,...change}));
 assert.equal(validateOffer({...offer,provider:'stripe',currency:'USD',kind:'subscription',interval:'month'}).provider,'stripe');
 assert.throws(()=>validateOffer({...offer,provider:'stripe',kind:'installments',installments:3}));
});
test('contract inherits a snapshot; later catalog changes cannot replace it',async()=>{
 const queries=[];const client={async query(sql,args){queries.push([sql,args]);if(sql.startsWith('SELECT offer_slug'))return{rows:[]};if(sql.startsWith('SELECT slug'))return{rows:[{slug:'pro',payload:offer,version:2}]};return{rows:[]};}};
 await inheritBillingOffer(client,'tenant','sites','pro');assert.equal(JSON.parse(queries.at(-1)[1][4]).amount_minor,19990);assert.match(queries.at(-1)[0],/DO NOTHING/);
 let count=0;await inheritBillingOffer({query:async()=>{count++;return{rows:[{offer_slug:'pro'}]};}},'tenant','sites','pro');assert.equal(count,1);
 await assert.rejects(inheritBillingOffer({query:async()=>({rows:[{offer_slug:'pro'}]})},'tenant','sites','other'),/revisão contratual/);
});
test('offer version conflict does not overwrite or record a false history entry',async()=>{
 const routes=new Map();billingRoutes({get(){},put:(p,f)=>routes.set(p,f)});let calls=0;
 await assert.rejects(routes.get('/api/billing/offers')({body:{...offer,version:3},client:{query:async(sql)=>{calls++;if(sql.startsWith('SELECT id,name FROM products'))return{rows:[{id:'sites',name:'Sites'}]};return{rows:[]};}}}),/outra sessão/);assert.equal(calls,3);
});
test('billing API requires admin and same-origin writes; successful writes are transactional',async()=>{
 const calls=[];const client={query:async(sql)=>{calls.push(sql);return{rows:sql.startsWith('SELECT id,name FROM products')?[{id:'sites',name:'Sites'}]:sql.includes('RETURNING version')?[{version:1}]:[]};},release(){}};
 const server=createCore({pool:{connect:async()=>client,query:async()=>({rows:[]})},adminPassword:'test-billing-password-123456789'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
 assert.equal((await fetch(origin+'/api/billing/offers?product_id=sites')).status,401);
 const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password:'test-billing-password-123456789'})});const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(origin+'/api/billing/offers',{method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(offer)})).status,403);
 assert.equal((await fetch(origin+'/api/billing/offers',{method:'PUT',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(offer)})).status,200);
 assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),'COMMIT');assert.ok(calls.some(s=>s.includes('billing_offer_history')));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
