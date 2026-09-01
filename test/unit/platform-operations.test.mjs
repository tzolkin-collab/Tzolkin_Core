import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../../apps/api/src/app.mjs';
import {createEasypanelOperations,normalizeOperationRead,scrubLogs,fingerprint} from '../../apps/api/src/integrations/easypanel-operations.mjs';
const target={id:'demo/api',name:'API',type:'app'};
const raw={projectName:'demo',name:'api',type:'app',env:'TOKEN=synthetic-secret',token:'synthetic-secret',enabled:true,deploy:{replicas:1,zeroDowntime:true,command:null},source:{type:'github',owner:'demo',repo:'api',path:'/',ref:'main'}};
const env={EASYPANEL_URL:'https://panel.example',EASYPANEL_TOKEN:'synthetic-secret'};
test('operational projections never expose raw config, commands, labels or backup credentials',()=>{
 const c=normalizeOperationRead('containers',[{Id:'container',Labels:{'com.docker.swarm.service.name':'demo_api',secret:'synthetic-secret'},Command:'synthetic-secret',State:'running',Image:'demo:latest'},{Id:'other',Labels:{'com.docker.swarm.service.name':'other_api'}}],target);
 assert.equal(c.items.length,1);assert.ok(!JSON.stringify(c).includes('synthetic-secret'));
 const b=normalizeOperationRead('backups',[{id:'b',projectName:'demo',serviceName:'api',enabled:true,schedule:'0 1 * * *',storageProviderPath:'synthetic-secret',password:'synthetic-secret'}],target);
 assert.ok(!JSON.stringify(b).includes('synthetic-secret'));assert.equal(b.items[0].Agendado,'Sim');
 assert.equal(normalizeOperationRead('metrics',null,target).status,'unavailable');
 assert.equal(normalizeOperationRead('metrics',{cpu:{percent:2},memory:{percent:3,usage:1024},env:'synthetic-secret'},target).facts['CPU (%)'],2);
 assert.throws(()=>normalizeOperationRead('metrics',{},target));
});
test('log redaction removes credentials, known secrets and ANSI escapes',()=>{
 const result=scrubLogs('\x1b[31mStarted\nAuthorization: abc\nDATABASE_URL=postgres://user:pass@db\nvalue synthetic-secret\nhttps://user:pwd@host/path',['synthetic-secret']);
 assert.match(result,/Started/);for(const secret of ['abc','user:pass','synthetic-secret','user:pwd','\x1b'])assert.ok(!result.includes(secret));
});
test('preflight is read-only; execute preserves untouched settings and rejects stale configuration',async()=>{
 const calls=[];const ops=createEasypanelOperations({env,fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json(init.method==='GET'?raw:null);}});
 const settings=await ops.read({target,section:'settings'});assert.ok(!JSON.stringify(settings).includes('synthetic-secret'));
 const command={target,action:'replicas',values:{replicas:2},revision:settings.revision};await ops.prepare(command);assert.ok(calls.every(c=>c.init.method==='GET'));
 await ops.execute(command);const post=calls.find(c=>c.init.method==='POST');assert.equal(post.url.pathname,'/api/updateAppDeploy');assert.deepEqual(JSON.parse(post.init.body).deploy,{...raw.deploy,replicas:2});
 for(const c of calls){assert.equal(c.init.redirect,'error');assert.equal(c.url.protocol,'https:');}
 const count=calls.filter(c=>c.init.method==='POST').length;
 await assert.rejects(()=>ops.execute({...command,revision:'stale'}),{status:409});
 await assert.rejects(()=>ops.prepare({...command,action:'delete',values:{}}),{status:400});
 await assert.rejects(()=>ops.prepare({...command,values:{replicas:0}}),{status:400});
 await assert.rejects(()=>ops.prepare({...command,values:{replicas:2,endpoint:'delete'}}),{status:400});
 assert.equal(calls.filter(c=>c.init.method==='POST').length,count);
});
test('unsafe connections and unrecognized responses fail closed',async()=>{
 let requests=0;const ops=createEasypanelOperations({env:{...env,EASYPANEL_URL:'http://panel.example'},fetchImpl:async()=>{requests++;throw Error('synthetic-secret');}});
 const result=await ops.read({target,section:'settings'});assert.equal(result.status,'error');assert.equal(requests,0);assert.ok(!JSON.stringify(result).includes('synthetic-secret'));
 const bad=createEasypanelOperations({env,fetchImpl:async()=>Response.json({secret:'synthetic-secret'},{status:403})});assert.equal((await bad.read({target,section:'logs'})).status,'error');
});
test('resources and build are validated and preserve same-builder options',async()=>{
 const service={...raw,resources:{cpuLimit:2,cpuReservation:1,memoryLimit:512,memoryReservation:128},build:{type:'nixpacks',nixpacksVersion:'1.41.0',nixPackages:'curl'}};
 const posts=[];const ops=createEasypanelOperations({env,fetchImpl:async(url,init)=>{if(init.method==='POST')posts.push({endpoint:url.pathname,body:JSON.parse(init.body)});return Response.json(init.method==='GET'?service:null);}});
 const command={target,revision:fingerprint(service)};
 await ops.prepare({...command,action:'resources',values:service.resources});
 await ops.execute({...command,action:'resources',values:{...service.resources,memoryLimit:1024}});
 assert.equal(posts[0].endpoint,'/api/updateAppResources');assert.equal(posts[0].body.resources.memoryReservation,128);
 await ops.execute({...command,action:'build',values:{type:'nixpacks',buildCommand:'npm run build'}});assert.equal(posts[1].body.build.nixPackages,'curl');
 await ops.execute({...command,action:'build',values:{type:'dockerfile',file:'apps/api/Dockerfile'}});assert.deepEqual(posts[2].body.build,{type:'dockerfile',file:'apps/api/Dockerfile'});
 for(const values of [{...service.resources,memoryReservation:1000},{...service.resources,cpuLimit:-1},{...service.resources,cpuLimit:Infinity},{cpuLimit:1}])await assert.rejects(()=>ops.prepare({...command,action:'resources',values}),{status:400});
 for(const values of [{type:'unknown'},{type:'dockerfile',file:'../Dockerfile'},{type:'nixpacks',startCommand:'bad\ncommand'},{type:'dockerfile',file:'Dockerfile',startCommand:'node index.js'}])await assert.rejects(()=>ops.prepare({...command,action:'build',values}),{status:400});
 assert.equal(posts.length,3);
});
test('image update preserves registry credentials only on the server',async()=>{
 const service={...raw,source:{type:'image',image:'demo/api:v1',username:'registry-user',password:'synthetic-secret'}};let sent;
 const ops=createEasypanelOperations({env,fetchImpl:async(url,init)=>{if(init.method==='POST')sent=JSON.parse(init.body);return Response.json(init.method==='GET'?service:null);}});
 const settings=await ops.read({target,section:'settings'});assert.ok(!JSON.stringify(settings).includes('synthetic-secret'));assert.equal(settings.editable.image,'demo/api:v1');
 await ops.execute({target,revision:settings.revision,action:'image',values:{image:'demo/api:v2'}});assert.equal(sent.password,'synthetic-secret');assert.equal(sent.image,'demo/api:v2');
});
test('action output is service-scoped and redacted before reaching the browser',async()=>{
 let unrelated=false;
 const ops=createEasypanelOperations({env,fetchImpl:async url=>Response.json(url.pathname==='/api/getAction'?{projectName:unrelated?'other':'demo',serviceName:'api',type:'deployment',log:'Started\nvalue synthetic-secret\npassword=hello\n-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----'}:raw)});
 const result=await ops.read({target,section:'action',actionId:'action-1'});assert.equal(result.status,'ok');assert.match(result.text,/Started/);
 for(const secret of ['synthetic-secret','hello','private-material'])assert.ok(!result.text.includes(secret));
 unrelated=true;assert.equal((await ops.read({target,section:'action',actionId:'action-1'})).status,'error');
});
test('ambiguous remote write is not reported as success or automatically repeated',async()=>{
 let posts=0;const ops=createEasypanelOperations({env,fetchImpl:async(url,init)=>{if(init.method==='POST'){posts++;throw Error('network unavailable synthetic-secret');}return Response.json(raw);}});
 await assert.rejects(()=>ops.execute({target,action:'restart',values:{},revision:fingerprint(raw)}),error=>error.status===502&&!error.message.includes('synthetic-secret'));
 assert.equal(posts,1);
});
test('confirmation requires session, exact target, one use, valid inventory and durable pre-dispatch audit',async()=>{
 let now=1000,executed=0,reads=0,failAudit=false;const events=[];
 const operations={read:async()=>{reads++;return {status:'ok'};},prepare:async()=>({revision:'r',summary:'Confirm action'}),execute:async()=>{executed++;return {status:'accepted'};}};
 const pool={query:async(sql,args)=>{if(failAudit)throw Error('Database offline');events.push({sql,args});return {rows:[]};}};
 const app=createCore({pool,adminPassword:'synthetic-operations-password',clock:()=>now,deployRegistry:[],platformOptions:{operations,options:async()=>({easypanel:{status:'ok',items:[target]}})}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.address().port}`;
 const request=(path,method='GET',body,cookie)=>fetch(origin+'/api/platforms/easypanel/'+path,{method,headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const login=async()=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-operations-password'})});return r.headers.get('set-cookie').split(';')[0];};
 try{
  assert.equal((await request('section?target_id=demo/api&section=metrics')).status,401);assert.equal(reads,0);
  const cookie=await login(),other=await login();
  assert.equal((await request('section?target_id=other/api&section=metrics','GET',undefined,cookie)).status,404);
  const payload={target_id:target.id,action:'restart',values:{},revision:'r'};
  const prepare=async()=>{const r=await request('prepare','POST',payload,cookie);assert.equal(r.status,200);return r.json();};
  const p=await prepare(),body={confirmation_id:p.confirmation_id,confirm_target:target.id};
  assert.equal(executed,0);
  assert.equal((await request('execute','POST',body,other)).status,409);
  assert.equal((await request('execute','POST',{...body,confirm_target:'wrong'},cookie)).status,400);
  assert.equal((await request('execute','POST',body,cookie)).status,200);assert.equal(executed,1);assert.match(events[0].sql,/INSERT INTO platform_operations/);
  assert.equal((await request('execute','POST',body,cookie)).status,409);assert.equal(executed,1);
  const expired=await prepare();now+=120001;assert.equal((await request('execute','POST',{confirmation_id:expired.confirmation_id,confirm_target:target.id},cookie)).status,409);
  const unavailable=await prepare();failAudit=true;assert.equal((await request('execute','POST',{confirmation_id:unavailable.confirmation_id,confirm_target:target.id},cookie)).status,500);assert.equal(executed,1);
  assert.ok(!JSON.stringify(events).includes('synthetic-operations-password'));
 }finally{app.closeAllConnections();await new Promise(r=>app.close(r));}
});
