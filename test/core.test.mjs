import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {createCore} from '../src/server.mjs';
import {testConnectionString} from '../src/platform/database.mjs';

test('Core real PostgreSQL security and contract suite',async t=>{
 const pool=new pg.Pool({connectionString:testConnectionString().connectionString,max:3});
 const adminPassword=randomBytes(32).toString('base64url');let time=Date.now();
 const server=createCore({pool,adminPassword,clock:()=>time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let cookie='';const ids=[];const token=randomBytes(32).toString('base64url');const tokenHash=createHash('sha256').update(token).digest('hex');
 const barberToken=randomBytes(32).toString('base64url');const barberHash=createHash('sha256').update(barberToken).digest('hex');const subject=`test:${randomUUID()}`;
 async function req(path,method='GET',body,headers={}){return fetch(origin+path,{method,headers:{origin,'Content-Type':'application/json',cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});}
 const context=(id,bearer=token)=>req(`/v1/context?tenant_id=${id}&subject=${encodeURIComponent(subject)}`,'GET',undefined,{authorization:`Bearer ${bearer}`,cookie:''});
 try{
  await t.test('health verifies database',async()=>assert.equal((await req('/health')).status,200));
  await t.test('unauthenticated overview rejected',async()=>assert.equal((await req('/api/overview')).status,401));
  await t.test('unauthenticated ecosystem rejected',async()=>assert.equal((await req('/api/ecosystem')).status,401));
  await t.test('cross-origin login rejected',async()=>assert.equal((await req('/api/login','POST',{password:adminPassword},{origin:'https://evil.invalid'})).status,403));
  await t.test('wrong password rejected',async()=>assert.equal((await req('/api/login','POST',{password:'incorrect'})).status,401));
  await t.test('login creates HttpOnly Strict cookie',async()=>{const r=await req('/api/login','POST',{password:adminPassword});assert.equal(r.status,200);const raw=r.headers.get('set-cookie');assert.match(raw,/HttpOnly/);assert.match(raw,/SameSite=Strict/);cookie=raw.split(';')[0];});
  await t.test('ecosystem persisted with six products and no secret fields',async()=>{
   const response=await req('/api/ecosystem');assert.equal(response.status,200);
   const {entries}=await response.json();
   assert.equal(entries.filter(e=>e.kind==='product').length,6);
   assert.equal(entries.filter(e=>e.kind==='resource').length,7);
   for(const {payload} of entries) assert.ok(Object.keys(payload).every(k=>['id','name','category','description','status','url','source','note'].includes(k)));
   assert.equal(entries.find(e=>e.payload.id==='data').payload.url,null);
  });
  await t.test('unknown tenant fields rejected',async()=>assert.equal((await req('/api/tenants','POST',{name:'Test',slug:'test',admin:true})).status,400));
  await t.test('creates two isolated tenants',async()=>{for(let n=0;n<2;n++){const r=await req('/api/tenants','POST',{name:`Integration ${n}`,slug:`test-${randomUUID()}`});assert.equal(r.status,200);ids.push((await r.json()).tenant_id);}});
  await t.test('membership and entitlement persist',async()=>{
   assert.equal((await req('/api/memberships','PUT',{tenant_id:ids[0],product_id:'sites',subject,active:true})).status,200);
   assert.equal((await req('/api/entitlements','PUT',{tenant_id:ids[0],product_id:'sites',plan:'test',rights:['dashboard.read'],active:true})).status,200);
   await pool.query('INSERT INTO app_clients(token_hash,product_id) VALUES($1,$2)',[tokenHash,'sites']);
   const r=await context(ids[0]);assert.equal(r.status,200);const data=await r.json();assert.equal(data.product_id,'sites');assert.deepEqual(data.rights,['dashboard.read']);
  });
  await t.test('app credential cannot administer Core',async()=>assert.equal((await req('/api/overview','GET',undefined,{cookie:'',authorization:`Bearer ${token}`})).status,401));
  await t.test('other tenant cannot be accessed without membership',async()=>assert.equal((await context(ids[1])).status,403));
  await t.test('product cannot be selected by caller',async()=>assert.equal((await req(`/v1/context?tenant_id=${ids[0]}&subject=${encodeURIComponent(subject)}&product_id=barber`,'GET',undefined,{authorization:`Bearer ${token}`})).status,400));
  await t.test('membership revocation immediately denies access',async()=>{await req('/api/memberships','PUT',{tenant_id:ids[0],product_id:'sites',subject,active:false});assert.equal((await context(ids[0])).status,403);await req('/api/memberships','PUT',{tenant_id:ids[0],product_id:'sites',subject,active:true});});
  await t.test('entitlement revocation increments version and denies',async()=>{await req('/api/entitlements','PUT',{tenant_id:ids[0],product_id:'sites',plan:'test',rights:[],active:false});assert.equal((await context(ids[0])).status,403);const row=await pool.query('SELECT version FROM entitlements WHERE tenant_id=$1',[ids[0]]);assert.equal(Number(row.rows[0].version),2);await req('/api/entitlements','PUT',{tenant_id:ids[0],product_id:'sites',plan:'test',rights:[],active:true});});
  await t.test('membership without product is rejected',async()=>assert.equal((await req('/api/memberships','PUT',{tenant_id:ids[0],subject,active:true})).status,400));
  await t.test('membership of one product does not open another product of the same organization',async()=>{
   await pool.query('INSERT INTO app_clients(token_hash,product_id) VALUES($1,$2)',[barberHash,'barber']);
   assert.equal((await req('/api/entitlements','PUT',{tenant_id:ids[0],product_id:'barber',plan:'test',rights:['agenda.read'],active:true})).status,200);
   assert.equal((await context(ids[0],barberToken)).status,403);
   assert.equal((await context(ids[0])).status,200);
   assert.equal((await req('/api/memberships','PUT',{tenant_id:ids[0],product_id:'barber',subject,active:true})).status,200);
   assert.equal((await context(ids[0],barberToken)).status,200);
   assert.equal((await req('/api/memberships','PUT',{tenant_id:ids[0],product_id:'barber',subject,active:false})).status,200);
   assert.equal((await context(ids[0],barberToken)).status,403);
   assert.equal((await context(ids[0])).status,200);
  });
  await t.test('suspension denies tenant access',async()=>{await req('/api/tenants','PUT',{tenant_id:ids[0],status:'suspended'});assert.equal((await context(ids[0])).status,403);});
  await t.test('expired admin session rejected server-side',async()=>{time+=3600001;assert.equal((await req('/api/overview')).status,401);});
  await t.test('login attempts limited',async()=>{for(let n=0;n<10;n++)await req('/api/login','POST',{password:'wrong'});assert.equal((await req('/api/login','POST',{password:adminPassword})).status,429);});
 }finally{
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('DELETE FROM app_clients WHERE token_hash=ANY($1::text[])',[[tokenHash,barberHash]]);for(const table of ['audit_events','memberships','entitlements'])await client.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[ids]);await client.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[ids]);await client.query('COMMIT');}finally{client.release();}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await pool.end();
 }
});
