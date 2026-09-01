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

test('engagement links an organization to an optional offering and a service model',async()=>{
 const calls=[];const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}};
 const result=await routes().get('POST /api/engagements')({client,body:{tenant_id:'10000000-0000-4000-8000-000000000001',product_id:'barber',service_model:'subscription',status:'planned',label:'TZOLKIN Barber'}});
 assert.equal(result.type,'engagement.saved');
 assert.deepEqual(calls[0].params,['10000000-0000-4000-8000-000000000001','barber','subscription','planned','TZOLKIN Barber']);
});

test('organization rejects mixed legacy categories',async()=>{
 const client={query:async()=>assert.fail('database must not be touched')};
 await assert.rejects(()=>routes().get('POST /api/tenants')({client,body:{name:'Empresa Exemplo',slug:'empresa-exemplo',relationship_kind:'barber'}}),error=>error.status===400);
});
