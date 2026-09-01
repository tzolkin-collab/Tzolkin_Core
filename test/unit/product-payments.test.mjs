import test from 'node:test';
import assert from 'node:assert/strict';
import {productPaymentRoutes} from '../../apps/api/src/modules/product-payments.mjs';

test('product payments centralizes connection inventory and product-scoped offers without allocating global sales',async()=>{
 let handler;productPaymentRoutes({get:(path,fn)=>{assert.equal(path,'/api/products/:productId/payments');handler=fn;}},{env:{STRIPE_SECRET_KEY:'configured',ASAAS_API_KEY:'configured',ASAAS_ENVIRONMENT:'production',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'configured'}});
 const pool={query:async(sql)=>sql.includes('FROM products')?{rows:[{id:'barber',name:'TZOLKIN Barber'}]}:{rows:[{slug:'mensal',version:1,updated_at:'2026-09-01',payload:{name:'Mensal',provider:'stripe',email_owner:'core',email_templates:{payment_confirmed:'pago'}}}]}};let body;
 await handler({pool,params:{productId:'barber'},url:new URL('https://core.test/api/products/barber/payments'),reply:(status,data)=>{assert.equal(status,200);body=data;}});
 assert.equal(body.connections.stripe.configured,true);assert.equal(body.connections.asaas.environment,'production');assert.equal(body.connections.email.provider,'resend');assert.equal(body.offers.length,1);assert.equal(body.rules[0].templates[0].event,'payment_confirmed');assert.equal(body.transaction_scope,'global_unallocated');
});
