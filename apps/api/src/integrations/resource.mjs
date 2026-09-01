import { createDeliverySettings, readJson } from './delivery-settings.mjs';

const safeText = (v, max = 180) => typeof v === 'string' ? v.slice(0,max) : null;
const host = v => typeof v === 'string' && v.length <= 253 && /^(\*\.)?[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(v) ? v : null;
const date = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 8640000000000000 ? new Date(v).toISOString() : null;
const error = () => ({status:'error',message:'Consulta indisponível. Verifique permissões e conexão com a plataforma.'});

export function normalizeDomains(provider, body, targetId) {
 const rows = provider === 'vercel' ? body?.domains : body;
 if (!Array.isArray(rows)) throw Error('Invalid domains');
 const [projectName,serviceName] = targetId.split('/');
 const scoped = provider === 'vercel' ? rows : rows.filter(d => d.serviceDestination?.projectName === projectName && d.serviceDestination?.serviceName === serviceName);
 const items = scoped.slice(0,100).map(d => ({host:host(provider === 'vercel' ? d.name : d.host),
  verified:provider === 'vercel' && typeof d.verified === 'boolean' ? d.verified : null,
  https:provider === 'easypanel' && typeof d.https === 'boolean' ? d.https : null,
  port:provider === 'easypanel' && Number.isInteger(d.serviceDestination?.port) ? d.serviceDestination.port : null,
 })).filter(d => d.host);
 return {status:'ok',items,partial:scoped.length > 100 || items.length < Math.min(scoped.length,100) || Boolean(body?.pagination?.next)};
}

export function normalizeDeployments(body) {
 if (!Array.isArray(body?.deployments)) throw Error('Invalid deployments');
 return {status:'ok',partial:Boolean(body.pagination?.next) || body.deployments.length > 20,items:body.deployments.slice(0,20).map(d => ({
  id:safeText(d.uid || d.id),state:['READY','ERROR','BUILDING','QUEUED','INITIALIZING','CANCELED'].includes(d.state || d.readyState) ? d.state || d.readyState : 'UNKNOWN',
  target:['production','preview'].includes(d.target) ? d.target : null,
  branch:safeText(d.meta?.githubCommitRef),commit:/^[a-f0-9]{7,64}$/i.test(d.meta?.githubCommitSha || '') ? d.meta.githubCommitSha.slice(0,7) : null,
  created_at:date(d.createdAt ?? d.created),
 }))};
}

export function normalizeEasypanelDeployments(body,targetId) {
 if (!Array.isArray(body)) throw Error('Invalid actions');
 const [project,service]=targetId.split('/');
 const rows=body.filter(d=>d && d.projectName===project && d.serviceName===service && d.type==='deployment');
 const items=rows.slice(0,20).map(d=>({
  id:typeof d.id==='string' && /^[\w-]{1,180}$/.test(d.id)?d.id:null,
  state:d.status==='done'?'SUCCEEDED':d.status==='error'?'ERROR':'UNKNOWN',
  target:null,branch:null,commit:null,created_at:null,
  // A API retorna data sem offset; não assumir UTC nem o fuso do navegador.
  created_label:typeof d.createdAt==='string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d.createdAt)?d.createdAt:null,
 })).filter(d=>d.id);
 return {status:'ok',items,partial:body.length>=21 || rows.length>20 || items.length<Math.min(rows.length,20),scope:'Últimas ações de deploy deste serviço. Concluído indica término da ação, não saúde da aplicação. Datas no horário informado pelo EasyPanel, sem fuso especificado.'};
}

export function createResourceReader({env=process.env,fetchImpl=fetch,clock=Date.now,settings=createDeliverySettings({env,fetchImpl,clock})}={}) {
 return async ({provider,target,environment='production'}) => {
  const query = async (path,params={}) => {
   const base = new URL(provider === 'vercel' ? 'https://api.vercel.com' : env.EASYPANEL_URL);
   if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['/','/api','/api/'].includes(base.pathname)) throw Error('Invalid base');
   const token = provider === 'vercel' ? env.VERCEL_TOKEN : env.EASYPANEL_TOKEN;
   if (!token) throw Error('Missing token');
   const url = new URL(path,base.origin);
   for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
   if (provider === 'vercel' && env.VERCEL_TEAM_ID) url.searchParams.set('teamId',env.VERCEL_TEAM_ID);
   return readJson(await fetchImpl(url,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)}));
  };
  if (provider === 'vercel' ? !/^[\w-]{1,120}$/.test(target.id) : provider !== 'easypanel' || !/^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(target.id)) throw Error('Invalid target');
  const protect = async fn => {try{return await fn();}catch{return error();}};
  const [projectName,serviceName] = target.id.split('/');
  const [configuration,domains,deployments] = await Promise.all([
   protect(() => settings({provider,target,environment})),
   protect(async () => normalizeDomains(provider,await query(provider === 'vercel' ? `/v9/projects/${encodeURIComponent(target.id)}/domains` : '/api/listDomains',provider === 'vercel' ? {limit:'100'} : {projectName,serviceName}),target.id)),
   provider === 'vercel' ? protect(async () => normalizeDeployments(await query('/v6/deployments',{projectId:target.id,limit:'20'}))) : protect(async()=>normalizeEasypanelDeployments(await query('/api/listActions',{projectName,serviceName,type:'deployment',limit:'21'}),target.id)),
  ]);
  return {provider,target:{id:target.id,name:target.name,type:target.type},environment,checked_at:new Date(clock()).toISOString(),configuration,domains,deployments};
 };
}
