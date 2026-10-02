import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceRoutes} from '../../apps/api/src/modules/workspace.mjs';

test('overview does not open concurrent database connections during login', async()=>{
 const routes=new Map();workspaceRoutes({get:(path,handler)=>routes.set(path,handler)});
 let active=0,peak=0,calls=0,result;
 const pool={async query(){active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;calls++;return{rows:[]};}};
 await routes.get('/api/overview')({pool,security:{tls:true,verified:true,insecure:false},reply:(status,data)=>{assert.equal(status,200);result=data;}});
 assert.equal(calls,6);assert.equal(peak,1);assert.deepEqual(result.tenants,[]);assert.deepEqual(result.engagements,[]);assert.equal(result.security.transport,'tls-verified');
});

test('bootstrap returns the first workspace frame in one database round trip',async()=>{
 const routes=new Map();workspaceRoutes({get:(path,handler)=>routes.set(path,handler)});
 let calls=0,sql,result;
 const pool={async query(statement){calls++;sql=statement;return{rows:[{
  tenants:[{id:'tenant-1'}],products:[{id:'legacy',portfolio_kind:'product'}],memberships:[],entitlements:[],engagements:[],stakeholders:[],
  entries:[{id:1,kind:'product',payload:{id:'legacy'}}],resource_bindings:[{id:'binding-1',product_id:'legacy',active:true}],
 }]};}};
 await routes.get('/api/bootstrap')({pool,security:{tls:false,verified:false,insecure:true},reply:(status,data)=>{assert.equal(status,200);result=data;}});
 assert.equal(calls,1);
 assert.match(sql,/FROM tenants/);assert.match(sql,/FROM ecosystem_entries/);assert.match(sql,/FROM product_resource_bindings/);
 assert.deepEqual(result.overview.tenants,[{id:'tenant-1'}]);
 assert.equal(result.overview.products[0].portfolio_kind,'platform');
 assert.ok(result.overview.products[0].capabilities.includes('access'));
 assert.deepEqual(result.catalog.entries,[{id:1,kind:'product',payload:{id:'legacy'}}]);
 assert.deepEqual(result.resource_bindings.bindings,[{id:'binding-1',product_id:'legacy',active:true}]);
 assert.equal(result.overview.security.transport,'plaintext');
});

test('bootstrap normalizes timestamps to the same ISO form the pg driver produced',async()=>{
 const routes=new Map();workspaceRoutes({get:(path,handler)=>routes.set(path,handler)});
 let result;
 const pool={async query(){return{rows:[{
  tenants:[{id:'t',created_at:'2026-10-01T12:00:00.123456+00:00',name:'x'}],products:[],memberships:[],entitlements:[],engagements:[],stakeholders:[],
  entries:[{kind:'product',payload:{created_at:'2026-10-01T12:00:00.5+00:00'},imported_at:'2026-10-01T09:00:00+00:00'}],
  resource_bindings:[{id:'b',deactivated_at:null,updated_at:'2026-10-01T12:00:00.123456+00:00'}],
 }]};}};
 await routes.get('/api/bootstrap')({pool,security:{tls:true,verified:true,insecure:false},reply:(status,data)=>{result=data;}});
 assert.equal(result.overview.tenants[0].created_at,'2026-10-01T12:00:00.123Z');
 assert.equal(result.catalog.entries[0].imported_at,'2026-10-01T09:00:00.000Z');
 assert.equal(result.catalog.entries[0].payload.created_at,'2026-10-01T12:00:00.5+00:00');
 assert.deepEqual(Object.keys(result.catalog.entries[0]),['kind','payload','imported_at']);
 assert.equal(result.resource_bindings.bindings[0].deactivated_at,null);
 assert.equal(result.resource_bindings.bindings[0].updated_at,'2026-10-01T12:00:00.123Z');
});
