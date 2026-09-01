// Preview isolado em memória para QA visual. Sem .env, banco ou provedores reais.
import { createCore } from '../apps/api/src/app.mjs';
import { createWeb } from '../apps/web/server.mjs';
let saved = [], snapshot;
if(process.argv.includes('--cards'))saved=[{id:'00000000-0000-4000-8000-000000000001',revision:1,updated_at:new Date().toISOString(),specification:{name:'Demo · Plataforma integrada',repository_id:'1',repository_name:'demo/monorepo',owner:'Equipe de demonstração',layout:'monorepo',components:[{id:'web',name:'Website',kind:'frontend',path:'apps/web',stack:'nextjs',runtime:'node',manager:'npm',depends_on:[],bindings:[{provider:'vercel',target_id:'demo-web',target_name:'Demo Web',environment:'production',branch:'main'}]},{id:'api',name:'API de serviços',kind:'api',path:'apps/api',stack:'node',runtime:'node',manager:'npm',depends_on:[],bindings:[{provider:'easypanel',target_id:'demo/api',target_name:'Demo API',environment:'production',branch:'main'}]}]}}];
const pool = {
 async query(sql, values = []) {
  if(process.argv.includes('--tracking')){
   const fixtureTenant='00000000-0000-4000-8000-000000000002',fixtureId='00000000-0000-4000-8000-000000000003',date=new Date().toISOString().slice(0,10);
   if(sql==='SELECT * FROM tenants ORDER BY created_at DESC')return {rows:[{id:fixtureTenant,name:'Cliente sintético · QA',slug:'qa',status:'active'}]};
   if(sql.startsWith('SELECT a.*,t.name'))return {rows:[{id:fixtureId,tenant_id:fixtureTenant,tenant_name:'Cliente sintético · QA',category:'mentoria',kind:'sessao',title:'Revisão de objetivos · dados sintéticos',starts_at:date+'T13:00:00Z',ends_at:date+'T14:00:00Z',status:'planned',revision:1}]};
   if(sql.startsWith('SELECT l.*,a.title'))return {rows:[{id:fixtureId,activity_id:fixtureId,title:'Revisão de objetivos · dados sintéticos',minutes:45,worked_on:date,note:'Preparação da sessão · exemplo de QA'}]};
  }
  if (sql === 'BEGIN') snapshot = structuredClone(saved);
  if (sql === 'ROLLBACK') saved = snapshot;
  if (sql.startsWith('SELECT id,specification,revision')) return { rows: values.length ? saved.filter(r => r.id === values[0]) : saved };
  if (sql.startsWith('INSERT INTO delivery_projects')) {
   const row = {id:crypto.randomUUID(),specification:values[0],revision:1,updated_at:new Date().toISOString()};saved.push(row);return {rows:[row]};
  }
  if (sql.startsWith('UPDATE delivery_projects')) {
   const row=saved.find(r=>r.id===values[1]);row.specification=values[0];row.revision++;return {rows:[row]};
  }
  return {rows:[]};
 },
 async connect(){return {...pool,release(){}};},
};
const options = async () => ({
 github:{status:'ok',items:[{id:'1',name:'demo/monorepo',default_branch:'main'},{id:'2',name:'demo/website',default_branch:'main'},{id:'3',name:'demo/legacy',default_branch:'main',archived:true}]},
 vercel:{status:'ok',items:[{id:'demo-web',name:'Demo Web',type:'app'}]},
 easypanel:{status:'ok',items:[{id:'demo/api',name:'Demo API',type:'app'},{id:'demo/db',name:'Demo Database',type:'postgres'}]},
});
const settings = async ({target}) => target.type === 'postgres' ? {status:'unsupported',fields:{},message:'Consulta disponível apenas para App.'} : {
 status:'ok',repository:'demo/monorepo',scope:'Configuração sintética para QA; nenhum provedor real consultado.',checked_at:new Date().toISOString(),
 fields:{path:{state:'value',value:'apps/web'},stack:{state:'value',value:'vite'},runtime:{state:'value',value:'node 22.x'},build:{state:'value',value:'npm run build'},start:{state:'unavailable'},output:{state:'automatic'},branch:{state:'value',value:'main'}}
};
const resource=async ({provider,target,environment})=>({provider,target,environment,checked_at:new Date().toISOString(),configuration:await settings({target}),domains:{status:'ok',items:[{host:'demo.example',https:true,verified:true,port:3000}]},deployments:provider==='vercel'?{status:'ok',items:[{id:'dpl_demo',state:'READY',target:'production',branch:'main',commit:'abc1234',created_at:new Date().toISOString()}]}:{status:'unsupported',message:'Histórico de deploys do EasyPanel ainda não integrado.'}});
const deployRegistry=[{name:'vercel',adapter:{
 async listProjects(){return [{id:'demo-web',name:'Demo Web',git_connected:true},{id:'demo-api',name:'Demo API',git_connected:true},{id:'demo-build',name:'Demo Build',git_connected:false}];},
 async listDeployments({projectId}){return [0,1,2].map((n)=>({id:`dpl_${projectId}_${n}`,state:projectId==='demo-api'?'ERROR':projectId==='demo-build'?'BUILDING':'READY',state_label:projectId==='demo-api'?'Falhou':projectId==='demo-build'?'Em build':'Pronto',branch:n?'preview/navigation':'main',commit:'abc1234',commit_message:'Ajusta navegação e configuração do projeto',target:n?'preview':'production',created_at:new Date(Date.now()-(n+1)*3600000).toISOString()}));}
}}];
const operations={
 async read({target,section}){
  if(section==='settings')return {status:'ok',revision:'synthetic',facts:{Habilitado:'Sim',Tipo:target.type},editable:{replicas:1,github:true,build:{type:'nixpacks'},resources:{cpuLimit:2,cpuReservation:0,memoryLimit:512,memoryReservation:128}},actions:target.type==='app'?['deploy','rebuild','restart','start','stop','replicas','environment','github','resources','build','image']:[]};
  if(section==='metrics')return {status:'ok',source:'Dados sintéticos',facts:{'CPU (%)':2.4,'Memória (bytes)':134217728}};
  if(section==='logs')return {status:'error',message:'Coletor indisponível (cenário sintético).'};
  return {status:'ok',items:section==='containers'?[{ID:'container-demo',Estado:'running',Imagem:'demo:latest'}]:[]};
 },
 async prepare(){return {revision:'synthetic',summary:'SIMULAÇÃO: nenhuma operação será enviada ao EasyPanel.'};},
 async execute(){return {status:'accepted',message:'Operação simulada, sem efeito externo.'};}
};
const api=createCore({pool,adminPassword:'synthetic-preview-password-only',webOrigin:'http://127.0.0.1:3101',deployRegistry,infrastructureOptions:{env:{}},deliveryOptions:{options,settings,resource},platformOptions:{options,operations}});
api.listen(0,'127.0.0.1',()=> {
 createWeb({apiOrigin:`http://127.0.0.1:${api.address().port}`}).listen(3101,'127.0.0.1',()=>console.log('Preview isolado: http://127.0.0.1:3101 — web e API separados, dados somente em memória.'));
});
