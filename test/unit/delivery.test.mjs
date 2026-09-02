import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, projectIssues } from '../../apps/api/src/platform/delivery-model.mjs';
import { createGithubAdapter } from '../../apps/api/src/integrations/github.mjs';
import { createDeliveryOptions } from '../../apps/api/src/integrations/delivery-options.mjs';
import { createCore } from '../../apps/api/src/app.mjs';

const component = (overrides = {}) => ({ id:'web',name:'Web',kind:'frontend',path:'.',stack:'nextjs',runtime:'node',manager:'npm',build:'',start:'',output:'',port:null,depends_on:[],bindings:[],...overrides });
const project = (overrides = {}) => ({ name:'Synthetic project',owner:'Team',layout:'single',repository_id:null,components:[component()],...overrides });
const inventories = { github:{status:'ok',items:[{id:'12',name:'org/repo'}]},vercel:{status:'ok',items:[{id:'prj_1',name:'Web',type:'app'}]},easypanel:{status:'ok',items:[{id:'project/db',name:'DB',type:'postgres'}]} };
const binding = {environment:'production',provider:'vercel',target_id:'prj_1',branch:'main'};

test('drafts, monorepos and library dependencies have honest configuration state', () => {
 assert.ok(projectIssues(validateProject(project())).some(s => s.includes('Repositório')));
 const result = validateProject(project({layout:'monorepo',repository_id:'12',components:[component({depends_on:['ui'],bindings:[binding]}),component({id:'ui',kind:'library',path:'packages/ui'})]}));
 assert.equal(projectIssues(result).length,0);
 assert.equal(result.components[1].path,'packages/ui');
});

test('rejects invalid layouts, path traversal, duplicate identifiers, cycles and unknown fields', () => {
 const bad = [project({evil:true}),project({layout:'invalid'}),project({components:[component({path:'../secrets'})]}),
  project({components:[component({path:'C:/secret'})]}),project({components:[component({path:'apps/../web'})]}),
  project({layout:'monorepo',components:[component(),component()]}),project({components:[component({depends_on:['missing']})]}),
  project({layout:'monorepo',components:[component({depends_on:['api']}),component({id:'api',depends_on:['web']})]}),
  project({components:[component({kind:'library',bindings:[binding]})]}),project({components:[component({bindings:[binding,binding]})]}),
  project({components:[component({port:70000})]}),project({components:[component({token:'secret'})]}),
  project({components:[component({bindings:[{...binding,branch:'../bad'}]})]})];
 for (const input of bad) assert.throws(() => validateProject(input),e => e.status === 400);
});

test('GitHub pagination is read-only, whitelisted and bounded; failures hide secrets', async () => {
 let calls = 0;
 const adapter = createGithubAdapter({token:'synthetic-secret',fetchImpl:async(url,init) => {
  calls++; assert.match(url,/^https:\/\/api.github.com\/user\/repos\?/); assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
  return Response.json([{id:calls,full_name:`org/repo${calls}`,default_branch:'main',private:true,token:'hidden'}],{headers:calls===1 ? {link:'<next>; rel="next"'} : {}});
 }});
 const result = await adapter.listRepositories(); assert.equal(calls,2);assert.equal(result.repositories.length,2);assert.equal(result.truncated,false); assert.ok(!JSON.stringify(result).includes('hidden'));
 await assert.rejects(createGithubAdapter({token:'secret',fetchImpl:async()=>{throw Error('secret')}}).listRepositories(),e=>!e.message.includes('secret'));
 const capped = await createGithubAdapter({token:'test',fetchImpl:async()=>Response.json([],{headers:{link:'<next>; rel="next"'}})}).listRepositories();
 assert.equal(capped.truncated,true);
});

test('provider failures are isolated and options share a short cache', async () => {
 let calls = 0;
 const options = createDeliveryOptions({env:{GITHUB_TOKEN:'test',VERCEL_TOKEN:'test'},fetchImpl:async url=>{
  calls++;if(String(url).includes('github'))throw Error('secret');return Response.json({projects:[{id:'p',name:'Web',env:'secret'}]});
 }});
 const first = await options();await options();assert.equal(calls,2);assert.equal(first.github.status,'error');assert.equal(first.vercel.status,'ok');assert.equal(first.easypanel.status,'not_configured');assert.ok(!JSON.stringify(first).includes('secret'));
});

function fakePool() {
 let saved = null, snapshot;
 const calls = [], audit = [];
 const pool = { calls,audit,failAudit:false,
  async query(sql,params = []) {
   calls.push(sql);
   if(sql==='BEGIN'){snapshot=structuredClone(saved);return {rows:[]};}
   if(sql==='ROLLBACK'){saved=snapshot;return {rows:[]};}
   if(sql==='COMMIT')return {rows:[]};
   if(sql.startsWith('SELECT id,product_id,specification,revision'))return {rows:saved?[structuredClone(saved)]:[]};
   if(sql.startsWith('SELECT d.id,d.product_id'))return {rows:saved?[{...structuredClone(saved),lifecycle_status:'draft'}]:[]};
   if(sql.startsWith('INSERT INTO products'))return {rows:[]};
   if(sql.startsWith('INSERT INTO delivery_projects')){saved={id:params[0],product_id:params[1],specification:structuredClone(params[2]),revision:1};return {rows:[structuredClone(saved)]};}
   if(sql.startsWith('UPDATE delivery_projects')){saved.specification=structuredClone(params[0]);saved.revision++;return {rows:[structuredClone(saved)]};}
   if(sql.startsWith('UPDATE products SET name'))return {rows:[]};
   if(sql.startsWith('SELECT lifecycle_status FROM products'))return {rows:[{lifecycle_status:'draft'}]};
   if(sql.startsWith('INSERT INTO delivery_audit')){if(pool.failAudit)throw Error('private');audit.push(params);return {rows:[]};}
   throw Error('Unexpected SQL');
  },async connect(){return {...pool,query:pool.query.bind(pool),release(){}};},
 };
 return pool;
}

test('HTTP enforces session, CSRF, revisions, audited transactions and real target choices', async () => {
 const pool = fakePool();let optionsCalls=0;
 const password='synthetic-password-long-enough-for-test';
 const server=createCore({pool,adminPassword:password,deployRegistry:[],deliveryOptions:{options:async()=>{optionsCalls++;return inventories;}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const request=(path,method='GET',body,headers={})=>fetch(origin+path,{method,headers:{origin,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 try {
  assert.equal((await request('/api/delivery/options')).status,401);assert.equal(optionsCalls,0);
  assert.equal((await request('/api/delivery/projects','POST',project())).status,401);assert.equal(pool.calls.length,0);
  const login=await request('/api/login','POST',{password});const cookie=login.headers.get('set-cookie').split(';')[0];const headers={cookie};
  assert.equal((await request('/api/delivery/projects','POST',project(),{cookie,origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('/api/delivery/options?url=bad','GET',null,headers)).status,400);
  assert.equal((await request('/api/delivery/projects','POST',project({repository_id:'unknown'}),headers)).status,400);
  assert.equal((await request('/api/delivery/projects','POST',project({components:[component({bindings:[{...binding,target_id:'unknown'}]})]}),headers)).status,400);
  assert.equal((await request('/api/delivery/projects','POST',project({components:[component({kind:'database',bindings:[binding]})]}),headers)).status,400);
  const create=await request('/api/delivery/projects','POST',project({repository_id:'12',components:[component({bindings:[binding]})]}),headers);
  assert.equal(create.status,201);const record=(await create.json()).project;assert.equal(record.repository_name,'org/repo');assert.match(record.product_id,/^project-/);assert.equal(record.product_lifecycle_status,'draft');assert.equal(record.deployment_status,'not_observed');assert.equal(pool.audit.length,1);
  const endpoint='/api/delivery/projects/'+record.id;
  assert.equal((await request(endpoint,'PUT',project({revision:1}),headers)).status,200);assert.equal(pool.audit.length,2);
  assert.equal((await request(endpoint,'PUT',project({revision:1}),headers)).status,409);
  pool.failAudit=true;const fail=await request(endpoint,'PUT',project({name:'Rollback test',revision:2}),headers);assert.equal(fail.status,500);assert.ok(!(await fail.text()).includes('private'));
  const listed=await(await request('/api/delivery/projects','GET',null,headers)).json();assert.equal(listed.projects[0].revision,2);assert.notEqual(listed.projects[0].name,'Rollback test');
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
