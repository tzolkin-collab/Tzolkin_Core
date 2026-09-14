// Reads only the institutional delivery queue; never logs contact payloads or credentials.
import pg from 'pg';
import {randomUUID} from 'node:crypto';
export async function deliverCore(payload,key,{url,token,fetchImpl=fetch}) {
 const target=new URL('/v1/commercial/intake',url);
 if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)))throw Error('INBOUND_URL_INVALID');
 try {
  const response=await fetchImpl(target,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,'idempotency-key':key},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return {ok:false,retryable:response.status>=500||[401,403,408,429].includes(response.status),code:`http_${response.status}`};
  const body=await response.json();if(typeof body.lead_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.lead_id))return {ok:false,retryable:true,code:'invalid_response'};
  return {ok:true,id:body.lead_id};
 }catch{return {ok:false,retryable:true,code:'delivery_unconfirmed'};}
}
export async function processCoreOutbox(pool,send) {
 const lease=randomUUID();
 const r=await pool.query(`WITH candidate AS (SELECT id FROM institucional.core_outbox
 WHERE (status='pending' AND next_attempt_at<=now()) OR (status='processing' AND lease_until<now())
 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE institucional.core_outbox o SET status='processing',lease_token=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
 FROM candidate c WHERE o.id=c.id RETURNING o.*`,[lease]);
 const row=r.rows[0];if(!row)return 'empty';
 let result;
 try{result=await send(row.payload,row.id);}catch{result={ok:false,retryable:true,code:'delivery_unconfirmed'};}
 if(result.ok){await pool.query("UPDATE institucional.core_outbox SET status='delivered',core_lead_id=$3,delivered_at=now(),last_error=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",[row.id,lease,result.id]);return 'delivered';}
 const failed=!result.retryable||row.attempts>=12;
 await pool.query(`UPDATE institucional.core_outbox SET status=$3,last_error=$4,next_attempt_at=now()+($5*interval '1 second'),lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,[row.id,lease,failed?'failed':'pending',result.code,Math.min(3600,15*2**Math.min(row.attempts,8))]);return failed?'failed':'retry';
}
export function createInstitutionalWorker(env=process.env) {
 if(!env.INBOUND_SITE_DATABASE_URL)return null;
 if(!env.INBOUND_SITE_API_KEY||!env.PUBLIC_ORIGIN)throw Error('INBOUND_CONFIGURATION_INCOMPLETE');
 const pool=new pg.Pool({connectionString:env.INBOUND_SITE_DATABASE_URL,max:2,connectionTimeoutMillis:8000});let stopping=false,timer;
 const tick=async()=>{if(stopping)return;try{for(let i=0;i<20&&!stopping;i++){const state=await processCoreOutbox(pool,(payload,key)=>deliverCore(payload,key,{url:env.PUBLIC_ORIGIN,token:env.INBOUND_SITE_API_KEY}));if(state==='empty')break;if(state==='failed')console.error('[inbound] item requires manual review');}}catch{console.error('[inbound] queue unavailable');}if(!stopping)timer=setTimeout(tick,15000);};
 return {pool,start(){timer=setTimeout(tick,2000);},async stop(){stopping=true;clearTimeout(timer);await pool.end();}};
}
