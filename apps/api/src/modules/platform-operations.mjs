import {randomUUID} from 'node:crypto';
import {json,input,fail,onlyParams,isUuid} from '../platform/http.mjs';
import {digest} from '../platform/session.mjs';
import {createDeliveryOptions} from '../integrations/delivery-options.mjs';
import {createEasypanelOperations} from '../integrations/easypanel-operations.mjs';
export function platformOperationsRoutes(router,{options=createDeliveryOptions(),operations=createEasypanelOperations(),clock=Date.now}={}){
 const pending=new Map(),busy=new Set();
 const prune=()=>{for(const [id,p] of pending)if(p.expires<clock())pending.delete(id);};
 async function target(id){if(typeof id!=='string'||! /^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(id)||id.length>240)throw fail(400,'Destino inválido.');const inv=(await options()).easypanel;if(inv?.status!=='ok')throw fail(503,'Inventário indisponível.');const t=inv.items.find(x=>x.id===id);if(!t)throw fail(404,'Serviço não encontrado.');return t;}
 router.get('/api/platforms/easypanel/section',async({url,reply})=>{
  onlyParams(url.searchParams,['target_id','section','action_id']);if(['target_id','section'].some(k=>url.searchParams.getAll(k).length!==1))throw fail(400,'Parâmetros inválidos.');
  const section=url.searchParams.get('section');if(!['settings','logs','containers','metrics','ports','mounts','backups','action'].includes(section))throw fail(400,'Seção inválida.');
  if(section==='action'?url.searchParams.getAll('action_id').length!==1: url.searchParams.has('action_id'))throw fail(400,'Ação inválida.');
  const actionId=url.searchParams.get('action_id');if(section==='action'&&!/^[\w-]{1,180}$/.test(actionId))throw fail(400,'Ação inválida.');
  reply(200,{...await operations.read({target:await target(url.searchParams.get('target_id')),section,actionId}),checked_at:new Date(clock()).toISOString()});
 });
 router.post('/api/platforms/easypanel/prepare',async({req,reply,sessionToken,operator,url})=>{
  onlyParams(url.searchParams,[]);const b=await json(req);input(b,['target_id','action','values','revision']);prune();if(pending.size>=100)throw fail(429,'Há confirmações pendentes. Aguarde.');
  const t=await target(b.target_id);const prepared=await operations.prepare({target:t,action:b.action,values:b.values,revision:b.revision});
  const id=randomUUID();pending.set(id,{target:t,action:b.action,values:b.values,revision:prepared.revision,session:digest(sessionToken||operator.subject),expires:clock()+120000});
  setTimeout(()=>pending.delete(id),120000).unref();
  reply(200,{confirmation_id:id,target_id:t.id,summary:prepared.summary,expires_in:120});
 });
 router.post('/api/platforms/easypanel/execute',async({req,reply,sessionToken,operator,pool,url})=>{
  onlyParams(url.searchParams,[]);const b=await json(req);input(b,['confirmation_id','confirm_target']);prune();
  const p=pending.get(b.confirmation_id);if(!isUuid(b.confirmation_id)||!p||p.session!==digest(sessionToken||operator.subject))throw fail(409,'Confirmação expirada ou já utilizada.');
  if(b.confirm_target!==p.target.id)throw fail(400,'Digite o identificador completo do serviço para confirmar.');
  if(busy.has(p.target.id))throw fail(409,'Uma operação está em andamento neste serviço.');
  pending.delete(b.confirmation_id);busy.add(p.target.id);
  try{
   const t=await target(p.target.id);if(t.type!==p.target.type)throw fail(409,'O tipo do serviço mudou.');
   // Falha ao registrar impede qualquer envio remoto. ID único impede repetição após reinício.
   await pool.query('INSERT INTO platform_operations(id,target_id,action,status) VALUES($1,$2,$3,$4)',[b.confirmation_id,t.id,p.action,'started']);
   let result;
   try{result=await operations.execute({...p,target:t});}
   catch(error){await pool.query('UPDATE platform_operations SET status=$1,updated_at=now() WHERE id=$2',[error.status===409?'rejected':'unknown',b.confirmation_id]);throw error;}
   try{await pool.query('UPDATE platform_operations SET status=$1,updated_at=now() WHERE id=$2',['accepted',b.confirmation_id]);}
   catch{throw fail(502,'Solicitação enviada; registro final indisponível. Não repita sem consultar o EasyPanel.');}
   reply(200,{...result,operation_id:b.confirmation_id});
  }finally{busy.delete(p.target.id);}
 });
 router.get('/api/platforms/easypanel/audit',async({url,pool,reply})=>{
  onlyParams(url.searchParams,['target_id']);if(url.searchParams.getAll('target_id').length!==1)throw fail(400,'Destino obrigatório.');const t=await target(url.searchParams.get('target_id'));
  const rows=(await pool.query('SELECT id,action,status,created_at FROM platform_operations WHERE target_id=$1 ORDER BY created_at DESC LIMIT 30',[t.id])).rows;reply(200,{items:rows});
 });
}
