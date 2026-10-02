import { digest } from '../platform/session.mjs';
import { fail, input, isProductId, isUuid, text } from '../platform/http.mjs';
import { notificarLeadNovo } from './push.mjs';
import { CHAVES_ATRIBUICAO, atribuicaoEstendida } from '../platform/attribution.mjs';
export { commercialKeyRoutes } from './commercial-keys.mjs';

const optional=(v,max=500)=>v==null||v===''?null:text(v,1,max);
const multiline=(v,max)=>{if(v==null||v==='')return null;if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw fail(400,'Texto inválido.');return v.trim();};
export const SERVICE_MODELS=['on_demand','education','consulting','advisory','product','unclassified'];
export const canonical=v=>JSON.stringify(v,(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
export function validateIntake(body,productId) {
 input(body,['lead','organization','stakeholder','commercial','attribution','privacy']);
 const l=body.lead??{},o=body.organization??{},s=body.stakeholder??{},c=body.commercial??{},a=body.attribution??{},p=body.privacy??{};
 input(l,['name','email','whatsapp','message']);input(o,['name','slug','organization_type']);input(s,['role','title']);input(c,['product_id','service_model','label']);
 input(a,CHAVES_ATRIBUICAO);
 input(p,['notice_version','contact_allowed','captured_at','source']);
 if(c.product_id!==productId||!isProductId(productId))throw fail(403,'Produto inválido para esta chave.');
 if(!SERVICE_MODELS.includes(c.service_model))throw fail(400,'Modelo comercial inválido.');
 const name=text(l.name,2,200),email=optional(l.email,320)?.toLowerCase()??null,phone=optional(l.whatsapp,40)?.replace(/[\s()+.-]/g,'')??null;
 if((!email&&!phone)||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||(phone&&!/^\d{10,15}$/.test(phone)))throw fail(400,'Contato inválido.');
 const orgType=o.organization_type??(o.name?'company':'person');if(!['company','person','nonprofit'].includes(orgType))throw fail(400,'Tipo de organização inválido.');
 if(s.role&&!['owner','decision_maker','champion','finance','technical','operational','student','contact'].includes(s.role))throw fail(400,'Papel inválido.');
 if(p.contact_allowed!=null&&typeof p.contact_allowed!=='boolean')throw fail(400,'Preferência inválida.');
 const date=v=>{if(!v)return null;const d=Date.parse(v);if(!Number.isFinite(d)||d>Date.now()+300000)throw fail(400,'Data inválida.');return new Date(d).toISOString();};
 const privacy={notice_version:optional(p.notice_version,120),contact_allowed:p.contact_allowed===true,captured_at:date(p.captured_at),source:optional(p.source,120)||'unspecified'};
 if(privacy.contact_allowed&&(!privacy.notice_version||!privacy.captured_at))throw fail(400,'Preferência exige versão do aviso e data.');
 return {name,email,phone,message:multiline(l.message,5000),org_name:optional(o.name,200)||name,org_type:orgType,
 role:s.role||'contact',title:optional(s.title,120),product_id:productId,service_model:c.service_model,interest:optional(c.label,200)||'Contato comercial',
 source_system:optional(a.source_system,80)||'tzolkin-site',source_ref:optional(a.source_ref,200),source_created_at:date(a.created_at),privacy,
 // Os 7 campos de sempre entram sempre (null quando ausentes), como antes. A parte estendida
 // (ids do anúncio, sessão, localização) só entra se foi enviada, para o hash de um pedido
 // antigo não mudar (ver platform/attribution.mjs).
 attribution:{...Object.fromEntries(['channel','utm_source','utm_medium','utm_campaign','utm_content','landing_page','referrer'].map(k=>[k,optional(a[k],k==='referrer'?1000:500)])),...atribuicaoEstendida(a,date)}};
}
export async function recordActivity(client,lead,kind,operator,note=null,details={}) {
 await client.query('INSERT INTO commercial_activities(lead_id,kind,note,details,actor_subject,actor_email) VALUES($1,$2,$3,$4,$5,$6)',[lead,kind,note,details,operator.subject,operator.email]);
}
// `avisarLeadNovo` é injetável para o teste conferir QUANDO e com QUÊ o aviso sai, sem push de verdade.
export function commercialIntakeRoutes(router,{avisarLeadNovo=notificarLeadNovo}={}) {
 router.post('/v1/commercial/intake',async({client,pool,body,productId,req})=>{
  const key=req.headers['idempotency-key'];if(!isUuid(key))throw fail(400,'Idempotency-Key UUID obrigatória.');
  const v=validateIntake(body,productId);v.source_ref??=key;
  const hash=digest(canonical(v));
  // Fixed lock order: key first, then durable source identity. Locks are shared by all replicas.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,25))',[`${productId}:${key}`]);
  const prev=(await client.query('SELECT response,request_hash FROM commercial_intake_requests WHERE product_id=$1 AND idempotency_key=$2',[productId,key])).rows[0];
  if(prev){if(prev.request_hash!==hash)throw fail(409,'Chave já usada com outro conteúdo.');return {body:prev.response};}
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,26))',[`${productId}:${v.source_system}:${v.source_ref}`]);
  const existing=(await client.query('SELECT id,tenant_id,stakeholder_id,request_hash FROM commercial_leads WHERE product_id=$1 AND source_system=$2 AND source_ref=$3',[productId,v.source_system,v.source_ref])).rows[0];
  let result;
  if(existing){if(existing.request_hash!==hash)throw fail(409,'Origem já importada com outro conteúdo.');result={lead_id:existing.id,tenant_id:existing.tenant_id,stakeholder_id:existing.stakeholder_id,engagement_id:null,contract_id:null,created:false};}
  else {
   // Limite por e-mail e por espaço: 5 leads novos por hora. Era do site (contava no banco institucional,
   // que saiu com a ADR 0011); sem ele, um formulário público ficaria aberto a enxurrada. Lock por e-mail
   // para dois envios simultâneos não passarem juntos do limite.
   if(v.email){
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,27))',[`${productId}:${v.email}`]);
    const recentes=Number((await client.query("SELECT count(*) FROM commercial_leads WHERE product_id=$1 AND lower(email)=$2 AND created_at>now()-interval '1 hour'",[productId,v.email])).rows[0].count);
    if(recentes>=5)throw fail(429,'Muitos envios com este e-mail. Aguarde antes de tentar novamente.');
   }
   const source=`inbound:${productId}:${v.source_system}`;
   const slug='lead-'+digest(`${source}:${v.source_ref}`).slice(0,40);
   const tenant=(await client.query(`INSERT INTO tenants(name,slug,relationship_kind,lifecycle_status,organization_type,source_system,source_ref) VALUES($1,$2,'prospect','lead',$3,$4,$5) RETURNING id`,[v.org_name,slug,v.org_type,source,v.source_ref])).rows[0].id;
   const person=(await client.query('INSERT INTO stakeholders(name,email,phone,source_system,source_ref) VALUES($1,$2,$3,$4,$5) RETURNING id',[v.name,v.email,v.phone,source,v.source_ref])).rows[0].id;
   await client.query('INSERT INTO organization_stakeholders(tenant_id,stakeholder_id,role,title,is_primary,contact_allowed) VALUES($1,$2,$3,$4,true,$5)',[tenant,person,v.role,v.title,v.privacy.contact_allowed]);
   const lead=(await client.query(`INSERT INTO commercial_leads(tenant_id,stakeholder_id,product_id,name,email,whatsapp,message,source_system,source_ref,service_model,interest,privacy,source_created_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,[tenant,person,productId,v.name,v.email,v.phone,v.message,v.source_system,v.source_ref,v.service_model,v.interest,v.privacy,v.source_created_at,hash])).rows[0].id;
   const a=v.attribution;
   await client.query(`INSERT INTO commercial_attributions(lead_id,source_system,source_ref,channel,utm_source,utm_medium,utm_campaign,utm_content,landing_page,referrer,
     utm_term,utm_tzolkin,meta_campaign_id,meta_adset_id,meta_ad_id,fbclid,gclid,fbc,fbp,session_key,first_touch_at,last_touch,session,geo)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [lead,v.source_system,v.source_ref,a.channel,a.utm_source,a.utm_medium,a.utm_campaign,a.utm_content,a.landing_page,a.referrer,
     a.utm_term??null,a.utm_tzolkin??null,a.meta_campaign_id??null,a.meta_adset_id??null,a.meta_ad_id??null,a.fbclid??null,a.gclid??null,a.fbc??null,a.fbp??null,a.session_key??null,a.first_touch_at??null,
     a.last_touch?JSON.stringify(a.last_touch):null,a.session?JSON.stringify(a.session):null,a.geo?JSON.stringify(a.geo):null]);
   await recordActivity(client,lead,'received',{subject:`app:${productId}`,email:null},null,{source_system:v.source_system,source_ref:v.source_ref});
   result={lead_id:lead,tenant_id:tenant,stakeholder_id:person,engagement_id:null,contract_id:null,created:true};
  }
  await client.query('INSERT INTO commercial_intake_requests(product_id,idempotency_key,request_hash,response) VALUES($1,$2,$3,$4)',[productId,key,hash,result]);
  // Aviso de lead novo no aparelho da equipe. Só quando o lead foi CRIADO agora: um
  // reenvio da mesma chave devolve a resposta guardada (retorno acima) e um lead que
  // já existia tem created:false, então nenhum dos dois avisa de novo. Roda depois do
  // COMMIT (afterCommit em app.mjs) e nunca altera a resposta nem o status do intake.
  const afterCommit=result.created?()=>avisarLeadNovo(pool,{productId,leadId:result.lead_id,nome:v.name,organizacao:v.org_name}):undefined;
  return {body:result,afterCommit};
 },{auth:'service',scope:'commercial:intake',transactional:true,audit:false});
}
