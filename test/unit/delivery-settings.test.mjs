import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, createDeliverySettings } from '../../apps/api/src/integrations/delivery-settings.mjs';
import { compareSettings, automaticSettings } from '../../apps/web/public/delivery.js';
import { createCore } from '../../apps/api/src/app.mjs';

test('Vercel settings distinguish defaults, missing data and restricted commands', () => {
 const raw = {id:'prj_demo',rootDirectory:null,framework:'nextjs',nodeVersion:'22.x',buildCommand:'npm run build',outputDirectory:null,
  link:{type:'github',org:'demo',repo:'web',productionBranch:'main'},env:[{value:'synthetic-secret'}],token:'synthetic-secret'};
 const result = normalizeSettings('vercel',raw,'production');
 assert.deepEqual(result.fields.path,{state:'value',value:'.'});
 assert.equal(result.fields.runtime.value,'node 22.x'); assert.equal(result.fields.build.value,'npm run build');
 assert.equal(result.fields.output.state,'automatic'); assert.equal(result.fields.start.state,'unavailable');
 assert.equal(result.fields.branch.value,'main'); assert.equal(result.repository,'demo/web');
 assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 assert.equal(normalizeSettings('vercel',raw,'staging').fields.branch.state,'unavailable');
 assert.equal(normalizeSettings('vercel',{...raw,rootDirectory:undefined,buildCommand:'TOKEN=synthetic-secret npm run build'},'production').fields.build.state,'restricted');
 assert.equal(normalizeSettings('vercel',{...raw,rootDirectory:undefined},'production').fields.path.state,'unavailable');
 for (const path of ['../private','apps/../private','/absolute','https://secret@host','apps//web']) assert.equal(normalizeSettings('vercel',{...raw,rootDirectory:path},'production').fields.path.state,'unavailable');
 for (const cmd of ['npm run build && curl x','npm run build --token secret','node server.js','npm run build\nsecret']) assert.equal(normalizeSettings('vercel',{...raw,buildCommand:cmd},'production').fields.build.state,'restricted');
});

test('EasyPanel normalizes only confirmed source metadata and does not infer image stacks', () => {
 const result = normalizeSettings('easypanel',{type:'app',source:{type:'github',path:'apps/api',ref:'main',owner:'demo',repo:'mono',token:'synthetic-secret'},build:{type:'dockerfile',file:'SECRET'},env:'synthetic-secret',deploy:{command:'synthetic-secret'}},'production');
 assert.equal(result.fields.path.value,'apps/api');assert.equal(result.fields.branch.value,'main');assert.equal(result.repository,'demo/mono');
 assert.equal(result.fields.stack.state,'unavailable');assert.equal(result.fields.start.state,'unavailable');assert.ok(!JSON.stringify(result).includes('secret'));
 assert.equal(normalizeSettings('easypanel',{type:'app',source:{type:'github',path:'/',ref:'main'}},'production').fields.path.value,'.');
 const image=normalizeSettings('easypanel',{type:'app',source:{type:'image',path:'should-not-import',ref:'tag'}},'production');
 assert.equal(image.fields.path.state,'unavailable');assert.equal(image.fields.branch.state,'unavailable');
 assert.throws(()=>normalizeSettings('easypanel',{type:'postgres'},'production'));
});

test('settings requests use fixed GET endpoints, encoded targets, TLS and no redirects', async () => {
 const calls=[];
 const read=createDeliverySettings({env:{VERCEL_TOKEN:'synthetic-secret',VERCEL_TEAM_ID:'team',EASYPANEL_URL:'https://panel.example/api',EASYPANEL_TOKEN:'synthetic-secret'},fetchImpl:async(url,init)=>{
  calls.push({url,init});return Response.json(url.hostname==='api.vercel.com'?{id:'prj_demo',rootDirectory:null}:{type:'app',source:{type:'github',path:'.',ref:'main'}});
 }});
 assert.equal((await read({provider:'vercel',target:{id:'prj_demo'},environment:'production'})).status,'ok');
 assert.equal((await read({provider:'easypanel',target:{id:'demo/api',type:'app'},environment:'production'})).status,'ok');
 assert.equal(calls[0].url.pathname,'/v9/projects/prj_demo');assert.equal(calls[0].url.searchParams.get('teamId'),'team');
 assert.equal(calls[1].url.pathname,'/api/inspectAppService');assert.equal(calls[1].url.searchParams.get('serviceName'),'api');
 for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'error');}
 assert.equal((await read({provider:'easypanel',target:{id:'demo/db',type:'postgres'},environment:'production'})).status,'unsupported');
 assert.equal((await read({provider:'vercel',target:{id:'../env'},environment:'production'})).status,'error');assert.equal(calls.length,2);
});

test('settings failures never expose raw errors, oversized responses or provider payloads', async () => {
 for (const fetchImpl of [async()=>{throw Error('synthetic-secret')},async()=>Response.json({secret:'synthetic-secret'},{status:401}),async()=>new Response('synthetic-secret'),async()=>new Response('x'.repeat(1024*1024+1))]) {
  const result=await createDeliverySettings({env:{VERCEL_TOKEN:'synthetic-secret'},fetchImpl})({provider:'vercel',target:{id:'prj_demo'},environment:'production'});
  assert.equal(result.status,'error');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 }
 let called=false;
 const result=await createDeliverySettings({env:{EASYPANEL_URL:'http://panel.example',EASYPANEL_TOKEN:'secret'},fetchImpl:async()=>{called=true}})({provider:'easypanel',target:{id:'demo/api',type:'app'},environment:'production'});
 assert.equal(result.status,'error');assert.equal(called,false);
});

test('comparison never treats unavailable/automatic fields as empty desired values', () => {
 const rows=compareSettings({path:{state:'value',value:'apps/web'},build:{state:'automatic'},output:{state:'unavailable'},branch:{state:'value',value:'main'}},{path:'.',build:'npm run build',branch:'main'});
 assert.equal(rows[0].different,true);assert.equal(rows[1].different,false);assert.equal(rows[2].different,false);assert.equal(rows[3].different,false);
});

test('automatic filling requires a confirmed repository and preserves edits and existing components', () => {
 const snapshot={status:'ok',repository:'demo/web',fields:{path:{state:'value',value:'apps/web'},stack:{state:'value',value:'vite'},build:{state:'automatic'},branch:{state:'value',value:'main'},token:{state:'value',value:'never-import'}}};
 const input={snapshot,repository:'DEMO/web',isNew:true,bindingCount:1,dirty:['path']};
 assert.deepEqual(automaticSettings(input).map(([key])=>key),['stack','branch']);
 for(const change of [{repository:'other/repo'},{repository:null},{isNew:false},{bindingCount:2},{snapshot:{...snapshot,status:'error'}},{snapshot:{...snapshot,repository:null}}]) assert.deepEqual(automaticSettings({...input,...change}),[]);
 assert.deepEqual(automaticSettings({...input,dirty:['path','stack','branch']}),[]);
});

test('settings HTTP requires authentication, validates inventory and has no database writes', async () => {
 let reads=0, inventories=0, available=true;
 const server=createCore({pool:{query(){throw Error('Database must not be touched')}},adminPassword:'synthetic-password-long-enough',deployRegistry:[],deliveryOptions:{
  options:async()=>{inventories++;return {vercel:{status:available?'ok':'error',items:[{id:'prj_demo',type:'app'}]}};},
  settings:async()=>{reads++;return {status:'ok',fields:{path:{state:'value',value:'.'}}};}
 }});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const endpoint='/api/delivery/settings?provider=vercel&target_id=prj_demo&environment=production';
 try {
  assert.equal((await fetch(origin+endpoint)).status,401);assert.equal(inventories,0);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-password-long-enough'})});
  const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(origin+endpoint,{headers})).status,200);assert.equal(reads,1);
  for(const path of [endpoint+'&url=https://evil.invalid',endpoint.replace('production','invalid'),endpoint.replace('vercel','unknown'),endpoint+'&provider=vercel']) assert.equal((await fetch(origin+path,{headers})).status,400);
  assert.equal((await fetch(origin+endpoint.replace('prj_demo','absent'),{headers})).status,404);
  available=false;assert.equal((await fetch(origin+endpoint,{headers})).status,503);assert.equal(reads,1);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
