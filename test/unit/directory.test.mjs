import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryRoutes} from '../../apps/api/src/modules/directory.mjs';

const routes=()=>{const entries=new Map();directoryRoutes({post:(path,handler)=>entries.set('POST '+path,handler),put:(path,handler)=>entries.set('PUT '+path,handler)});return entries;};

test('organization creation keeps relationship, lifecycle and legal shape separate',async()=>{
 const calls=[];const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:'10000000-0000-4000-8000-000000000001'}]};}};
 const result=await routes().get('POST /api/tenants')({client,body:{name:'Empresa Exemplo',slug:'empresa-exemplo',relationship_kind:'customer',lifecycle_status:'onboarding',organization_type:'company'}});
 assert.equal(result.type,'tenant.created');
 assert.deepEqual(calls[0].params,['Empresa Exemplo','empresa-exemplo','customer','onboarding','company']);
});

// Os testes de contratação acompanharam a rota para test/unit/portfolio.test.mjs.

test('organization rejects mixed legacy categories',async()=>{
 const client={query:async()=>assert.fail('database must not be touched')};
 await assert.rejects(()=>routes().get('POST /api/tenants')({client,body:{name:'Empresa Exemplo',slug:'empresa-exemplo',relationship_kind:'barber'}}),error=>error.status===400);
});

test('stakeholder is created as a person and then linked to the organization',async()=>{
 const calls=[];const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:'20000000-0000-4000-8000-000000000002'}]};}};
 const result=await routes().get('POST /api/stakeholders')({client,body:{tenant_id:'10000000-0000-4000-8000-000000000001',name:'Pessoa Exemplo',role:'decision_maker',title:'Diretora',is_primary:true,contact_allowed:true}});

test('stakeholder com e-mail e telefone: normaliza, recusa formato ruim e não repete e-mail',async()=>{
 const base={tenant_id:'10000000-0000-4000-8000-000000000001',name:'Pessoa Exemplo',role:'contact',is_primary:false,contact_allowed:true};
 const comBanco=(existe=false)=>{const calls=[];return {calls,client:{query:async(sql,params)=>{calls.push({sql,params});if(/SELECT 1 FROM stakeholders/.test(sql))return {rows:existe?[{}]:[],rowCount:existe?1:0};return {rows:[{id:'20000000-0000-4000-8000-000000000002'}]};}}};};
 const ok=comBanco();
 await routes().get('POST /api/stakeholders')({client:ok.client,body:{...base,email:' Pessoa@Exemplo.TEST ',phone:'(11) 99999-0000'}});
 assert.deepEqual(ok.calls.at(-2).params,['Pessoa Exemplo','pessoa@exemplo.test','11999990000']);
 for(const ruim of [{email:'sem-arroba'},{email:'a@b'},{phone:'12345678'},{phone:'abcdefghij'}])
  await assert.rejects(routes().get('POST /api/stakeholders')({client:comBanco().client,body:{...base,...ruim}}),e=>e.status===400,JSON.stringify(ruim));
 await assert.rejects(routes().get('POST /api/stakeholders')({client:comBanco(true).client,body:{...base,email:'repetido@exemplo.test'}}),e=>e.status===409);
});
 assert.equal(result.type,'stakeholder.created');assert.equal(calls.length,2);
 assert.deepEqual(calls[0].params,['Pessoa Exemplo',null,null],'sem e-mail nem telefone grava nulo');
 assert.deepEqual(calls[1].params,['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','decision_maker','Diretora',true,true]);
});
