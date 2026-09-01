import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceReader,normalizeDomains,normalizeDeployments,normalizeEasypanelDeployments} from '../../apps/api/src/integrations/resource.mjs';
import {createCore} from '../../apps/api/src/app.mjs';
import {resourceRoute} from '../../apps/web/public/resource.js';
test('resource domains are scoped and projected without secrets',()=>{
 const row={host:'demo.example',https:true,env:'synthetic-secret',serviceDestination:{projectName:'demo',serviceName:'api',port:3000}};
 const result=normalizeDomains('easypanel',[row,{...row,host:'other.example',serviceDestination:{projectName:'other',serviceName:'api'}},{...row,host:'https://secret@host'}],'demo/api');
 assert.equal(result.items.length,1);assert.equal(result.items[0].https,true);assert.equal(result.items[0].verified,null);assert.equal(result.partial,true);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 assert.equal(normalizeDomains('vercel',{domains:[{name:'demo.example',verified:false}],pagination:{next:1}},'demo').partial,true);
 assert.throws(()=>normalizeDomains('vercel',{},'demo'));
});
test('deployments omit raw logs, environment, URLs and errors',()=>{
 const result=normalizeDeployments({deployments:[{uid:'dpl_test',state:'READY',target:'production',created:123,meta:{githubCommitSha:'abcdef1234'},env:'synthetic-secret',errorMessage:'synthetic-secret',inspectorUrl:'synthetic-secret'}]});
 assert.equal(result.items[0].commit,'abcdef1');assert.equal(result.items[0].state,'READY');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
});
test('resource reads only fixed HTTPS GET endpoints and isolates section failure',async()=>{
 const calls=[];const env={VERCEL_TOKEN:'synthetic-secret',VERCEL_TEAM_ID:'team',EASYPANEL_URL:'https://panel.example',EASYPANEL_TOKEN:'synthetic-secret'};
 const read=createResourceReader({env,fetchImpl:async(url,init)=>{calls.push({url,init});if(url.pathname.endsWith('/domains'))return Response.json({domains:[{name:'demo.example'}]});if(url.pathname==='/v6/deployments')return Response.json({env:'synthetic-secret'},{status:403});if(url.pathname==='/api/listDomains')return Response.json([]);return Response.json(url.hostname==='api.vercel.com'?{id:'demo',rootDirectory:null}:{type:'app'});}});
 const result=await read({provider:'vercel',target:{id:'demo',name:'Demo',type:'app'}});
 assert.equal(result.configuration.status,'ok');assert.equal(result.domains.status,'ok');assert.equal(result.deployments.status,'error');assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 const ep=await read({provider:'easypanel',target:{id:'demo/api',name:'API',type:'app'}});assert.equal(ep.deployments.status,'error');
 for(const {url,init} of calls){assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(url.protocol,'https:');if(url.hostname==='api.vercel.com')assert.equal(url.searchParams.get('teamId'),'team');}
 await assert.rejects(()=>read({provider:'easypanel',target:{id:'../secret'}}));
});
test('resource bounds payloads and never forwards provider errors',async()=>{
 for(const fetchImpl of [async()=>{throw Error('synthetic-secret')},async()=>new Response('x'.repeat(1024*1024+1))]){
  const r=await createResourceReader({env:{VERCEL_TOKEN:'synthetic-secret'},fetchImpl})({provider:'vercel',target:{id:'demo'}});
  for(const key of ['configuration','domains','deployments'])assert.equal(r[key].status,'error');assert.ok(!JSON.stringify(r).includes('synthetic-secret'));
 }
});
test('resource endpoint requires admin and accessible inventory, with no DB writes',async()=>{
 let calls=0;const app=createCore({pool:{query(){throw Error('No database access expected')}},adminPassword:'synthetic-resource-password',deployRegistry:[],deliveryOptions:{options:async()=>({vercel:{status:'ok',items:[{id:'demo',name:'Demo',type:'app'}]}}),resource:async({target})=>{calls++;return {target};}}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`;
 const path='/api/platforms/resource?provider=vercel&target_id=demo&environment=production';
 try{
  assert.equal((await fetch(origin+path)).status,401);assert.equal(calls,0);
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-resource-password'})});const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await fetch(origin+path,{headers})).status,200);assert.equal(calls,1);
  for(const [suffix,status] of [['&target_id=other',400],['&url=https://evil.invalid',400]])assert.equal((await fetch(origin+path+suffix,{headers})).status,status);
  assert.equal((await fetch(origin+path.replace('target_id=demo','target_id=other'),{headers})).status,404);assert.equal(calls,1);
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));}
});
test('internal route parses resource context without external navigation',()=>{
 assert.deepEqual(resourceRoute('#resource?provider=easypanel&target_id=demo%2Fapi&tab=domains'),{provider:'easypanel',id:'demo/api',environment:'production',tab:'domains',deployment:null});
 assert.equal(resourceRoute('#resource?provider=other&target_id=x'),null);
 assert.equal(resourceRoute('#resource?provider=vercel&target_id=x&tab=__proto__').tab,'overview');
});
test('EasyPanel history scopes actions, omits logs and secrets, preserves timezone uncertainty',()=>{
 const row={id:'action-1',projectName:'demo',serviceName:'api',type:'deployment',status:'done',createdAt:'2026-08-31 12:30:00',description:'synthetic-secret',userEmail:'synthetic-secret',meta:{token:'synthetic-secret'}};
 const result=normalizeEasypanelDeployments([row,{...row,serviceName:'other'},{...row,type:'env'},{...row,id:'action-2',status:'error'}],'demo/api');
 assert.equal(result.items.length,2);assert.equal(result.items[0].state,'SUCCEEDED');assert.equal(result.items[1].state,'ERROR');assert.equal(result.items[0].created_at,null);assert.equal(result.items[0].created_label,row.createdAt);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 assert.equal(normalizeEasypanelDeployments(Array(21).fill(row),'demo/api').partial,true);
 assert.throws(()=>normalizeEasypanelDeployments({},'demo/api'));
});
