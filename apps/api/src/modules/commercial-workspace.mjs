import { fail,input,isUuid,isProductId,onlyParams,text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { recordActivity } from './commercial-intake.mjs';
const STAGES=['open','qualified','won','lost','archived'];
const note=v=>{if(typeof v!=='string'||v.trim().length<2||v.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw fail(400,'Texto inválido.');return v.trim();};
const uuid=v=>{if(!isUuid(v))throw fail(400,'Identificador inválido.');return v;};
async function owner(client,id){if(id!==null&&!(await client.query("SELECT id FROM operator_accounts WHERE id=$1 AND status='active' AND role IN ('owner','member')",[uuid(id)])).rowCount)throw fail(400,'Responsável não está ativo.');return id;}
async function list({pool,url,reply,productId,operator}) {
 if(operator)await commercialPermission(pool,operator);onlyParams(url.searchParams,['product_id','status','q','offset','limit']);
 const product=productId||url.searchParams.get('product_id');if(product&&!isProductId(product))throw fail(400,'Produto inválido.');
 const status=url.searchParams.get('status')||null;if(status&&!STAGES.includes(status))throw fail(400,'Estágio inválido.');
 const limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0),q=url.searchParams.get('q')?.trim()||null;
 if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000||q?.length>200)throw fail(400,'Paginação inválida.');
 const r=await pool.query(`SELECT l.id,l.product_id,l.name,l.email,l.whatsapp,l.status,l.interest,l.source_system,l.source_created_at,l.created_at,l.owner_id,a.name AS owner_name,a.email AS owner_email,t.name AS organization_name
 FROM commercial_leads l JOIN tenants t ON t.id=l.tenant_id LEFT JOIN operator_accounts a ON a.id=l.owner_id
 WHERE ($1::text IS NULL OR l.product_id=$1) AND ($2::text IS NULL OR l.status=$2) AND ($3::text IS NULL OR concat_ws(' ',l.name,l.email,t.name,l.interest) ILIKE '%'||$3||'%') ORDER BY l.created_at DESC,l.id DESC LIMIT $4 OFFSET $5`,[product,status,q,limit+1,offset]);
 return reply(200,{leads:r.rows.slice(0,limit),has_more:r.rows.length>limit,offset,limit});
}
async function detail({pool,params,reply,productId,operator}) {
 if(operator)await commercialPermission(pool,operator);uuid(params.id);
 const lead=(await pool.query(`SELECT l.*,t.name AS organization_name,a.name AS owner_name,a.email AS owner_email FROM commercial_leads l JOIN tenants t ON t.id=l.tenant_id LEFT JOIN operator_accounts a ON a.id=l.owner_id WHERE l.id=$1 AND ($2::text IS NULL OR l.product_id=$2)`,[params.id,productId||null])).rows[0];
 if(!lead)throw fail(404,'Lead não encontrado.');delete lead.request_hash;
 const attribution=(await pool.query('SELECT * FROM commercial_attributions WHERE lead_id=$1',[lead.id])).rows[0];
 const activities=(await pool.query('SELECT * FROM commercial_activities WHERE lead_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[lead.id])).rows;
 const contracts=(await pool.query('SELECT * FROM commercial_contracts WHERE lead_id=$1 ORDER BY created_at DESC',[lead.id])).rows;
 return reply(200,{lead,attribution,activities,contracts});
}
export function commercialWorkspaceRoutes(router) {
 router.get('/api/commercial/leads',list);router.get('/api/commercial/leads/:id',detail);
 router.get('/v1/commercial/leads',list,{auth:'service',scope:'commercial:read'});router.get('/v1/commercial/leads/:id',detail,{auth:'service',scope:'commercial:read'});
 router.get('/api/commercial/owners',async({pool,reply,operator})=>{await commercialPermission(pool,operator);return reply(200,{owners:(await pool.query("SELECT id,name,email FROM operator_accounts WHERE status='active' AND role IN ('owner','member') ORDER BY name,email")).rows});});
 router.get('/api/commercial/leads/:id/activities',async({pool,params,url,reply,operator})=>{
  await commercialPermission(pool,operator);uuid(params.id);onlyParams(url.searchParams,['offset']);const offset=Number(url.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0)throw fail(400,'Paginação inválida.');
  const rows=(await pool.query('SELECT * FROM commercial_activities WHERE lead_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET $2',[params.id,offset])).rows;return reply(200,{activities:rows.slice(0,100),has_more:rows.length>100});
 });
 router.put('/api/commercial/leads/:id',async({client,params,body,operator})=>{
  await commercialPermission(client,operator,true);uuid(params.id);input(body,['version','status','owner_id','loss_reason']);
  const old=(await client.query('SELECT * FROM commercial_leads WHERE id=$1 FOR UPDATE',[params.id])).rows[0];if(!old)throw fail(404,'Lead não encontrado.');
  if(body.version!==old.version)throw fail(409,'Lead alterado em outra sessão. Reabra o detalhe.');
  const status=body.status??old.status;if(!STAGES.includes(status))throw fail(400,'Estágio inválido.');
  const responsible=Object.hasOwn(body,'owner_id')?await owner(client,body.owner_id):old.owner_id;
  const loss=status==='lost'?text(body.loss_reason??old.loss_reason,2,1000):null;
  await client.query('UPDATE commercial_leads SET status=$2,owner_id=$3,loss_reason=$4,version=version+1,updated_at=now() WHERE id=$1',[old.id,status,responsible,loss]);
  await recordActivity(client,old.id,'updated',operator,null,{before:{status:old.status,owner_id:old.owner_id,loss_reason:old.loss_reason},after:{status,owner_id:responsible,loss_reason:loss}});
  return{body:{ok:true}};
 },{transactional:true,audit:false});
 router.post('/api/commercial/leads/:id/activities',async({client,params,body,operator})=>{
  await commercialPermission(client,operator,true);uuid(params.id);input(body,['note','kind']);if(!['note','call','meeting','email'].includes(body.kind))throw fail(400,'Tipo inválido.');
  if(!(await client.query('SELECT id FROM commercial_leads WHERE id=$1',[params.id])).rowCount)throw fail(404,'Lead não encontrado.');
  await recordActivity(client,params.id,body.kind,operator,note(body.note));return{body:{ok:true}};
 },{transactional:true,audit:false});
 router.get('/api/commercial/contracts',async({pool,url,reply,operator})=>{
  await commercialPermission(pool,operator);onlyParams(url.searchParams,['product_id']);const product=url.searchParams.get('product_id');if(product&&!isProductId(product))throw fail(400,'Produto inválido.');
  return reply(200,{contracts:(await pool.query('SELECT c.*,t.name AS organization_name FROM commercial_contracts c JOIN tenants t ON t.id=c.tenant_id WHERE ($1::text IS NULL OR c.product_id=$1) ORDER BY c.created_at DESC LIMIT 100',[product])).rows});
 });
 router.post('/api/commercial/contracts',async({client,body,operator})=>{
  await commercialPermission(client,operator,true);input(body,['lead_id','title','scope','amount_minor','currency','starts_on','ends_on','owner_id']);
  const l=(await client.query('SELECT id,tenant_id,product_id FROM commercial_leads WHERE id=$1',[uuid(body.lead_id)])).rows[0];if(!l)throw fail(404,'Lead não encontrado.');
  if(!Number.isSafeInteger(body.amount_minor)||body.amount_minor<0||body.amount_minor>10000000000||!['BRL','USD','EUR','GBP'].includes(body.currency))throw fail(400,'Valor ou moeda inválidos.');
  for(const k of ['starts_on','ends_on'])if(body[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(body[k])||!Number.isFinite(Date.parse(body[k]))))throw fail(400,'Data inválida.');
  if(body.starts_on&&body.ends_on&&body.ends_on<body.starts_on)throw fail(400,'Vigência inválida.');
  const c=(await client.query(`INSERT INTO commercial_contracts(lead_id,tenant_id,product_id,title,scope,amount_minor,currency,starts_on,ends_on,owner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[l.id,l.tenant_id,l.product_id,text(body.title,2,160),note(body.scope),body.amount_minor,body.currency,body.starts_on||null,body.ends_on||null,await owner(client,body.owner_id??null)])).rows[0];
  await contractAudit(client,c,operator);await recordActivity(client,l.id,'contract_created',operator,null,{contract_id:c.id});return{body:{contract:c}};
 },{transactional:true,audit:false});
 router.put('/api/commercial/contracts/:id/status',async({client,body,params,operator})=>{
  await commercialPermission(client,operator,true);input(body,['version','status','acceptance_reference']);const c=(await client.query('SELECT * FROM commercial_contracts WHERE id=$1 FOR UPDATE',[uuid(params.id)])).rows[0];if(!c)throw fail(404,'Contrato não encontrado.');
  if(body.version!==c.version)throw fail(409,'Contrato alterado. Atualize a tela.');
  if(!({draft:['active','canceled'],active:['completed','canceled'],completed:[],canceled:[]}[c.status]).includes(body.status))throw fail(409,'Transição inválida.');
  const acceptance=body.status==='active'?text(body.acceptance_reference,2,1000):c.acceptance_reference;
  const changed=(await client.query("UPDATE commercial_contracts SET status=$2,acceptance_reference=$3,accepted_at=CASE WHEN $2='active' THEN now() ELSE accepted_at END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",[c.id,body.status,acceptance])).rows[0];
  await contractAudit(client,changed,operator);if(c.lead_id)await recordActivity(client,c.lead_id,'contract_status',operator,null,{contract_id:c.id,status:body.status});return{body:{contract:changed}};
 },{transactional:true,audit:false});
}
async function contractAudit(client,c,operator){await client.query('INSERT INTO commercial_contract_audit(contract_id,actor_subject,actor_email,snapshot) VALUES($1,$2,$3,$4)',[c.id,operator.subject,operator.email,c]);}
