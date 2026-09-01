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
