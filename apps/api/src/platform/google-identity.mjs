import {createHash,randomBytes} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {digest} from './session.mjs';

const GOOGLE_ISSUERS=['https://accounts.google.com','accounts.google.com'];
const GOOGLE_JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000,cooldownDuration:30000});
const emailPattern=/^[^\s@]{1,128}@[^\s@]{1,190}$/;
const b64=value=>value.toString('base64url');
export function createGoogleIdentity({pool,clientId,clientSecret,publicOrigin,allowedEmails='',clock=Date.now,keySet=GOOGLE_JWKS,fetcher=fetch}={}){
 let origin;try{origin=new URL(publicOrigin);}catch{throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');}
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');
 if(!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId||'')||typeof clientSecret!=='string'||clientSecret.length<16)throw Error('Google OAuth credentials are required.');
 const emails=new Set(allowedEmails.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));if(!emails.size||[...emails].some(email=>!emailPattern.test(email)))throw Error('CORE_ALLOWED_EMAILS is required.');
 const redirectUri=origin.origin+'/api/auth/google/callback';
 return{
  mode:'google-oidc',secure:true,loginDisabled:()=>true,
  async resolve(_req,token){if(!token)return null;const result=await pool.query(`SELECT subject,email FROM operator_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()`,[digest(token)]);return result.rows[0]||null;},
  async begin(){const state=b64(randomBytes(32)),verifier=b64(randomBytes(48)),nonce=b64(randomBytes(32)),challenge=b64(createHash('sha256').update(verifier).digest());
   await pool.query(`INSERT INTO operator_auth_flows(state_hash,code_verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')`,[digest(state),verifier,nonce]);
   const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [key,value]of Object.entries({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}))target.searchParams.set(key,value);return target;
  },
  async finish(callbackUrl){const state=callbackUrl.searchParams.get('state'),code=callbackUrl.searchParams.get('code');if(!state||!code||callbackUrl.searchParams.get('error'))throw Error('Autenticação Google não concluída.');
   const flow=(await pool.query(`DELETE FROM operator_auth_flows WHERE state_hash=$1 AND expires_at>now() RETURNING code_verifier,nonce`,[digest(state)])).rows[0];if(!flow)throw Error('Tentativa de login expirada.');
   const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,code_verifier:flow.code_verifier,grant_type:'authorization_code',redirect_uri:redirectUri});
   const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Google recusou a autenticação.');const tokens=await response.json();if(typeof tokens.id_token!=='string')throw Error('Identidade Google ausente.');
   const {payload}=await jwtVerify(tokens.id_token,keySet,{issuer:GOOGLE_ISSUERS,audience:clientId,algorithms:['RS256'],clockTolerance:5});const email=String(payload.email||'').toLowerCase();if(payload.nonce!==flow.nonce||payload.email_verified!==true||!emails.has(email))throw Error('Conta Google não autorizada.');
   const token=b64(randomBytes(32)),maxAge=28800;await pool.query(`INSERT INTO operator_sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')`,[digest(token),String(payload.sub),email]);return{token,maxAge};
  },
  async revoke(token){if(token)await pool.query('UPDATE operator_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[digest(token)]);},
 };
}
