import {json,input,isUuid,fail} from '../platform/http.mjs';
import {activityInput,timeInput,trackingRange} from '../platform/tracking-model.mjs';
// Admin interno apenas. Nunca oferecer este endpoint ao portal de clientes sem
// autenticação por pessoa e autorização de tenant no servidor.
export function trackingRoutes(router){
 router.get('/api/tracking',async({pool,url,reply})=>{
  const {start,end,tenant}=trackingRange(url.searchParams);
  const params=[start,end,tenant];
  const activities=await pool.query(`SELECT a.*,t.name AS tenant_name FROM service_activities a JOIN tenants t ON t.id=a.tenant_id
   WHERE a.starts_at < ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AND a.ends_at > ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND ($3::uuid IS NULL OR a.tenant_id=$3) ORDER BY a.starts_at LIMIT 501`,params);
  const logs=await pool.query(`SELECT l.*,a.title,a.tenant_id FROM service_time_logs l JOIN service_activities a ON a.id=l.activity_id
   WHERE l.worked_on >= $1::date AND l.worked_on < $2::date AND ($3::uuid IS NULL OR a.tenant_id=$3) ORDER BY l.worked_on DESC,l.created_at DESC LIMIT 501`,params);
  reply(200,{activities:activities.rows.slice(0,500),logs:logs.rows.slice(0,500),truncated:activities.rows.length>500||logs.rows.length>500,time_zone:'America/Sao_Paulo'});
 });
 async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const audit=(c,id,action,details)=>c.query('INSERT INTO service_activity_audit(activity_id,action,actor,details) VALUES($1,$2,$3,$4)',[id,action,'admin-bootstrap',details]);
 router.post('/api/tracking',async({pool,req,reply})=>{
  const b=activityInput(await json(req));
  const result=await transaction(pool,async c=>{
   const row=(await c.query(`INSERT INTO service_activities(id,tenant_id,category,kind,title,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING *`,Object.values(b))).rows[0];
   if(row){await audit(c,b.id,'created',b);return row;}
   const existing=(await c.query('SELECT * FROM service_activities WHERE id=$1',[b.id])).rows[0];
   if(!existing||Object.entries(b).some(([k,v])=>k.endsWith('_at')?new Date(existing[k]).toISOString()!==v:existing[k]!==v))throw fail(409,'Identificador já usado em outro cadastro.');
   return existing;
  });reply(200,{activity:result});
 });
 router.put('/api/tracking/:id/status',async({pool,params,req,reply})=>{
  const b=await json(req);input(b,['status','revision']);
  if(!isUuid(params.id)||!['planned','done','cancelled'].includes(b.status)||!Number.isInteger(b.revision)||b.revision<1)throw fail(400,'Status ou revisão inválidos.');
  const row=await transaction(pool,async c=>{
   const result=(await c.query('UPDATE service_activities SET status=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING *',[b.status,params.id,b.revision])).rows[0];
   if(!result)throw fail(409,'Registro alterado ou inexistente. Atualize a agenda.');
   await audit(c,params.id,'status_changed',b);return result;
  });reply(200,{activity:row});
 });
 router.post('/api/tracking/:id/time',async({pool,params,req,reply})=>{
  if(!isUuid(params.id))throw fail(400,'Atividade inválida.');const b=timeInput(await json(req));
  const result=await transaction(pool,async c=>{
   if(!(await c.query('SELECT id FROM service_activities WHERE id=$1 FOR UPDATE',[params.id])).rows.length)throw fail(404,'Atividade não encontrada.');
   const row=(await c.query('INSERT INTO service_time_logs(id,activity_id,minutes,worked_on,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING *',[b.id,params.id,b.minutes,b.worked_on,b.note])).rows[0];
   if(row){await audit(c,params.id,'time_logged',b);return row;}
   const existing=(await c.query('SELECT id,activity_id,minutes,worked_on::text,note FROM service_time_logs WHERE id=$1',[b.id])).rows[0];
   if(!existing||existing.activity_id!==params.id||Object.entries(b).some(([k,v])=>existing[k]!==v))throw fail(409,'Identificador já usado em outro apontamento.');
   return existing;
  });reply(200,{log:result});
 });
}
