import { randomBytes } from 'node:crypto';
import { digest } from '../platform/session.mjs';
import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';

export async function commercialPermission(client, operator, write = false, ownerOnly = false) {
 if (operator?.subject === 'local-bootstrap') return;
 if (!operator?.email) throw fail(403, 'Operador não autorizado.');
 const r = await client.query("SELECT role FROM operator_accounts WHERE email=$1 AND status='active'", [operator.email.toLowerCase()]);
 const role = r.rows[0]?.role;
 // Authenticated env-only operators bootstrap the owner registry, as in accounts.mjs.
 if (role && ((ownerOnly && role !== 'owner') || (write && role === 'viewer'))) throw fail(403, 'Sem permissão para esta operação.');
}
export const KEY_SCOPES = ['context:read','commercial:intake','commercial:read'];
export function validateKey(body, now = Date.now()) {
 input(body, ['product_id','label','scopes','expires_at']);
 if (!isProductId(body.product_id)) throw fail(400,'Produto inválido.');
 const scopes = body.scopes;
 if (!Array.isArray(scopes) || !scopes.length || scopes.length>3 || scopes.some(s=>!KEY_SCOPES.includes(s)) || new Set(scopes).size!==scopes.length) throw fail(400,'Escolha escopos válidos.');
 const expires = Date.parse(body.expires_at);
 if (!Number.isFinite(expires) || expires<=now || expires>now+366*86400000) throw fail(400,'Expiração deve ser futura, em até 366 dias.');
 return {product_id:body.product_id,label:text(body.label,2,120),scopes,expires_at:new Date(expires).toISOString()};
}
async function audit(client,key,action,operator,details={}) {
 await client.query('INSERT INTO app_client_audit(key_id,product_id,action,actor_subject,actor_email,details) VALUES($1,$2,$3,$4,$5,$6)',[key.id,key.product_id,action,operator.subject,operator.email,details]);
}
export async function issueKey(client,values,operator,rotatedFrom=null) {
 const v=validateKey(values);
 if (!(await client.query("SELECT id FROM products WHERE id=$1 AND lifecycle_status IN ('active','draft')",[v.product_id])).rowCount) throw fail(404,'Produto não encontrado.');
 const token=randomBytes(32).toString('base64url');
 const key=(await client.query(`INSERT INTO app_clients(token_hash,product_id,label,scopes,expires_at,rotated_from) VALUES($1,$2,$3,$4,$5,$6)
 RETURNING id,product_id,label,scopes,expires_at,created_at`,[digest(token),v.product_id,v.label,v.scopes,v.expires_at,rotatedFrom])).rows[0];
 await audit(client,key,rotatedFrom?'rotated':'created',operator,{scopes:v.scopes,expires_at:v.expires_at,rotated_from:rotatedFrom});
 return {...key,api_key:token};
}
export function commercialKeyRoutes(router) {
 router.get('/api/app-clients',async({pool,url,reply,operator})=>{
  await commercialPermission(pool,operator,false,true);onlyParams(url.searchParams,['product_id']);const p=url.searchParams.get('product_id');if(!isProductId(p))throw fail(400,'Produto inválido.');
  const keys=await pool.query(`SELECT id,product_id,label,scopes,expires_at,last_used_at,active,revoked_at,created_at,rotated_from FROM app_clients WHERE product_id=$1 ORDER BY created_at DESC`,[p]);
  const history=await pool.query('SELECT id,key_id,action,actor_email,actor_subject,details,created_at FROM app_client_audit WHERE product_id=$1 ORDER BY created_at DESC LIMIT 100',[p]);
  return reply(200,{keys:keys.rows,audit:history.rows});
 });
 router.post('/api/app-clients',async({client,body,operator})=>{await commercialPermission(client,operator,true,true);return {body:await issueKey(client,body,operator)};},{transactional:true,audit:false});
 router.post('/api/app-clients/:id/rotate',async({client,params,body,operator})=>{
  await commercialPermission(client,operator,true,true);if(!isUuid(params.id))throw fail(400,'Chave inválida.');input(body,['expires_at','overlap_minutes']);
  const overlap=body.overlap_minutes??0;if(!Number.isInteger(overlap)||overlap<0||overlap>1440)throw fail(400,'Sobreposição deve ser de 0 a 1440 minutos.');
  const old=(await client.query('SELECT * FROM app_clients WHERE id=$1 FOR UPDATE',[params.id])).rows[0];
  if(!old||!old.active||old.revoked_at||(old.expires_at&&new Date(old.expires_at)<=new Date()))throw fail(409,'Chave inativa ou expirada.');
  if((await client.query('SELECT id FROM app_clients WHERE rotated_from=$1',[old.id])).rowCount)throw fail(409,'Esta chave já foi rotacionada.');
  const next=await issueKey(client,{product_id:old.product_id,label:old.label,scopes:old.scopes,expires_at:body.expires_at},operator,old.id);
  await client.query("UPDATE app_clients SET expires_at=LEAST(COALESCE(expires_at,'infinity'::timestamptz),now()+($2*interval '1 minute')), active=CASE WHEN $2=0 THEN false ELSE active END WHERE id=$1",[old.id,overlap]);
  await audit(client,old,'rotation_scheduled',operator,{overlap_minutes:overlap,replacement_id:next.id});return{body:next};
 },{transactional:true,audit:false});
 router.delete('/api/app-clients/:id',async({client,params,operator})=>{
  await commercialPermission(client,operator,true,true);if(!isUuid(params.id))throw fail(400,'Chave inválida.');
  const key=(await client.query('SELECT id,product_id,active FROM app_clients WHERE id=$1 FOR UPDATE',[params.id])).rows[0];if(!key)throw fail(404,'Chave não encontrada.');
  if(key.active){await client.query('UPDATE app_clients SET active=false,revoked_at=now() WHERE id=$1',[key.id]);await audit(client,key,'revoked',operator);}
  return{body:{ok:true}};
 },{transactional:true,body:false,audit:false});
}
