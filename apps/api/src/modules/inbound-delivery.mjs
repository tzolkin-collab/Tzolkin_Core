import{fail,isUuid}from'../platform/http.mjs';import{commercialPermission}from'./commercial-keys.mjs';
export function inboundDeliveryRoutes(router,{inboundPool}={}) {
 router.get('/api/commercial/delivery',async({pool,operator,reply})=>{
  await commercialPermission(pool,operator);if(!inboundPool)return reply(200,{configured:false,counts:[],failed:[]});
  const counts=(await inboundPool.query('SELECT status,count(*)::int AS count,min(created_at) AS oldest FROM institucional.core_outbox GROUP BY status')).rows;
  const failed=(await inboundPool.query("SELECT id,attempts,last_error,created_at FROM institucional.core_outbox WHERE status='failed' ORDER BY created_at LIMIT 50")).rows;
  return reply(200,{configured:true,counts,failed});
 });
 router.post('/api/commercial/delivery/:id/retry',async({pool,operator,params,reply})=>{
  await commercialPermission(pool,operator,true,true);if(!inboundPool)throw fail(503,'Fila não configurada.');if(!isUuid(params.id))throw fail(400,'Entrega inválida.');
  const c=await inboundPool.connect();try{await c.query('BEGIN');const changed=await c.query("UPDATE institucional.core_outbox SET status='pending',attempts=0,next_attempt_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id",[params.id]);if(!changed.rowCount)throw fail(409,'Entrega não está em falha.');await c.query("INSERT INTO institucional.core_outbox_audit(outbox_id,action,actor) VALUES($1,'retry',$2)",[params.id,operator.email||operator.subject]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return reply(200,{ok:true});
 });
}
