import {json,input,isUuid,fail} from '../platform/http.mjs';
import {activityInput,activityUpdateInput,timeInput,trackingRange,OPCIONAIS} from '../platform/tracking-model.mjs';
const SEM_MIGRACAO='Descrição, local e link da reunião ainda não estão disponíveis neste banco: falta aplicar a migração 047.';
// Admin interno apenas. Nunca oferecer este endpoint ao portal de clientes sem
// autenticação por pessoa e autorização de tenant no servidor.
export function trackingRoutes(router){
 // A migração 047 (descrição, local, link) é aditiva e pode chegar ao banco depois do código. Enquanto as colunas não existem, a tela
 // esconde os três campos e a API recusa o uso com uma mensagem clara (em vez de "column does not exist"). Verdadeiro nunca volta a falso;
 // falso só é reverificado a cada minuto, para a primeira consulta depois de aplicar a migração já enxergar as colunas.
 let suporta=false,verificadoEm=0;
 async function camposDeAgenda(db){
  if(suporta)return true;
  if(Date.now()-verificadoEm<60000)return false;
  verificadoEm=Date.now();
  const r=await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='service_activities' AND column_name=ANY($1)",[OPCIONAIS]);
  suporta=r.rows[0]?.n===OPCIONAIS.length;return suporta;
 }
 router.get('/api/tracking',async({pool,url,reply})=>{
  const {start,end,tenant,engagement}=trackingRange(url.searchParams);
  const params=[start,end,tenant,engagement];
  const activities=await pool.query(`SELECT a.*,t.name AS tenant_name,e.label AS engagement_label,e.service_model AS engagement_service_model
   FROM service_activities a JOIN tenants t ON t.id=a.tenant_id LEFT JOIN client_engagements e ON e.id=a.engagement_id
   WHERE a.starts_at < ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND a.ends_at > ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND ($3::uuid IS NULL OR a.tenant_id=$3) AND ($4::uuid IS NULL OR a.engagement_id=$4) ORDER BY a.starts_at LIMIT 501`,params);
  const logs=await pool.query(`SELECT l.*,a.title,a.tenant_id,a.engagement_id FROM service_time_logs l JOIN service_activities a ON a.id=l.activity_id
   WHERE l.worked_on >= $1::date AND l.worked_on < $2::date AND ($3::uuid IS NULL OR a.tenant_id=$3) AND ($4::uuid IS NULL OR a.engagement_id=$4) ORDER BY l.worked_on DESC,l.created_at DESC LIMIT 501`,params);
  // Contratações em curso para o formulário escolher (arquivadas não recebem atividade nova).
  const engagements=await pool.query('SELECT id,tenant_id,label,service_model,status,product_id FROM client_engagements WHERE archived_at IS NULL ORDER BY label,id LIMIT 500');
  reply(200,{activities:activities.rows.slice(0,500),logs:logs.rows.slice(0,500),engagements:engagements.rows,truncated:activities.rows.length>500||logs.rows.length>500,time_zone:'America/Sao_Paulo',agenda_campos:await camposDeAgenda(pool)});
 });
 async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const audit=(c,id,action,details,operator)=>c.query('INSERT INTO service_activity_audit(activity_id,action,actor,details) VALUES($1,$2,$3,$4)',[id,action,operator?.email||operator?.subject||'unknown',details]);
 router.post('/api/tracking',async({pool,req,reply,operator})=>{
  const b=activityInput(await json(req));
  const result=await transaction(pool,async c=>{
   // A contratação tem de ser da mesma empresa. Conferida antes do INSERT: a chave composta também recusa, mas como erro de banco (409), não como 400 claro.
   if(OPCIONAIS.some(k=>k in b)&&!(await camposDeAgenda(c)))throw fail(409,SEM_MIGRACAO);
   let engagement=null;
   if(b.engagement_id){engagement=(await c.query('SELECT tenant_id,archived_at FROM client_engagements WHERE id=$1',[b.engagement_id])).rows[0];if(!engagement||engagement.tenant_id!==b.tenant_id)throw fail(400,'A contratação não é desta empresa ou está arquivada.');}
   const row=(await c.query(`INSERT INTO service_activities(${Object.keys(b).join(',')}) VALUES(${Object.keys(b).map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO NOTHING RETURNING *`,Object.values(b))).rows[0];
   // Arquivada só barra atividade NOVA: repetir um cadastro antigo (mesmo id e mesmo conteúdo) continua devolvendo o que já existe.
   if(row){if(engagement?.archived_at)throw fail(400,'A contratação não é desta empresa ou está arquivada.');await audit(c,b.id,'created',b,operator);return row;}
   const existing=(await c.query('SELECT * FROM service_activities WHERE id=$1',[b.id])).rows[0];
   if(!existing||Object.entries(b).some(([k,v])=>k.endsWith('_at')?new Date(existing[k]).toISOString()!==v:existing[k]!==v))throw fail(409,'Identificador já usado em outro cadastro.');
   return existing;
  });reply(200,{activity:result});
 });
 // Edita título, horário, categoria, tipo e os campos de agenda (descrição, local, link). A revisão que a tela leu é obrigatória:
 // se outra pessoa mexeu antes, volta 409 em vez de sobrescrever. As colunas do SET vêm de activityUpdateInput (lista fixa).
 router.put('/api/tracking/:id',async({pool,params,req,reply,operator})=>{
  if(!isUuid(params.id))throw fail(400,'Atividade inválida.');
  const {revision,campos}=activityUpdateInput(await json(req));
  const nomes=Object.keys(campos);
  const row=await transaction(pool,async c=>{
   if(nomes.some(n=>OPCIONAIS.includes(n))&&!(await camposDeAgenda(c)))throw fail(409,SEM_MIGRACAO);
   const result=(await c.query(`UPDATE service_activities SET ${nomes.map((n,i)=>n+'=$'+(i+3)).join(',')},revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *`,[params.id,revision,...nomes.map(n=>campos[n])])).rows[0];
   if(!result)throw fail(409,'Registro alterado ou inexistente. Atualize a agenda.');
   await audit(c,params.id,'updated',{revision,campos},operator);
   return result;
  });reply(200,{activity:row});
 });
 router.put('/api/tracking/:id/status',async({pool,params,req,reply,operator})=>{
  const b=await json(req);input(b,['status','revision']);
  if(!isUuid(params.id)||!['planned','done','cancelled'].includes(b.status)||!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Status ou revisão inválidos.');
  const row=await transaction(pool,async c=>{
   const result=(await c.query('UPDATE service_activities SET status=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING *',[b.status,params.id,b.revision])).rows[0];
   if(!result)throw fail(409,'Registro alterado ou inexistente. Atualize a agenda.');
   await audit(c,params.id,'status_changed',b,operator);return result;
  });reply(200,{activity:row});
 });
 // Troca (ou tira) a contratação de uma atividade já criada. Mesma regra do cadastro: da mesma empresa e não arquivada.
 router.put('/api/tracking/:id/engagement',async({pool,params,req,reply,operator})=>{
  const b=await json(req);input(b,['engagement_id','revision']);
  const engagement=b.engagement_id==null||b.engagement_id===''?null:b.engagement_id;
  if(!isUuid(params.id)||(engagement!==null&&!isUuid(engagement))||!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Contratação ou revisão inválidas.');
  const row=await transaction(pool,async c=>{
   if(engagement&&!(await c.query('SELECT 1 FROM client_engagements e JOIN service_activities a ON a.tenant_id=e.tenant_id WHERE e.id=$1 AND a.id=$2 AND e.archived_at IS NULL',[engagement,params.id])).rows.length)throw fail(400,'A contratação não é desta empresa ou está arquivada.');
   const result=(await c.query('UPDATE service_activities SET engagement_id=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING *',[engagement,params.id,b.revision])).rows[0];
   if(!result)throw fail(409,'Registro alterado ou inexistente. Atualize a agenda.');
   await audit(c,params.id,'engagement_changed',{engagement_id:engagement,revision:b.revision},operator);return result;
  });reply(200,{activity:row});
 });
 router.post('/api/tracking/:id/time',async({pool,params,req,reply,operator})=>{
  if(!isUuid(params.id))throw fail(400,'Atividade inválida.');const b=timeInput(await json(req));
  const result=await transaction(pool,async c=>{
   if(!(await c.query('SELECT id FROM service_activities WHERE id=$1 FOR UPDATE',[params.id])).rows.length)throw fail(404,'Atividade não encontrada.');
   const row=(await c.query('INSERT INTO service_time_logs(id,activity_id,minutes,worked_on,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING *',[b.id,params.id,b.minutes,b.worked_on,b.note])).rows[0];
   if(row){await audit(c,params.id,'time_logged',b,operator);return row;}
   const existing=(await c.query('SELECT id,activity_id,minutes,worked_on::text,note FROM service_time_logs WHERE id=$1',[b.id])).rows[0];
   if(!existing||existing.activity_id!==params.id||Object.entries(b).some(([k,v])=>existing[k]!==v))throw fail(409,'Identificador já usado em outro apontamento.');
   return existing;
  });reply(200,{log:result});
 });
}
