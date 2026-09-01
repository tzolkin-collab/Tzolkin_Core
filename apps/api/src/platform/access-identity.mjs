import {createRemoteJWKSet,jwtVerify} from 'jose';

const emailPattern=/^[^\s@]{1,128}@[^\s@]{1,190}$/;
const url=value=>{const parsed=new URL(value);if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.cloudflareaccess.com')||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw Error('CF_ACCESS_TEAM_DOMAIN must be a Cloudflare Access HTTPS origin.');return parsed;};
export function createAccessIdentity({teamDomain,audience,allowedEmails='',allowedDomain='',clockTolerance=5,keySet}={}){
 const issuer=url(teamDomain).origin,emails=new Set(allowedEmails.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
 const domain=allowedDomain.trim().toLowerCase();
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(audience||''))throw Error('CF_ACCESS_AUD is required.');
 if(!emails.size&&!domain)throw Error('Configure CORE_ALLOWED_EMAILS or CORE_ALLOWED_DOMAIN.');
 if([...emails].some(email=>!emailPattern.test(email))||(domain&&!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)))throw Error('Invalid operator allowlist.');
 const jwks=keySet||createRemoteJWKSet(new URL('/cdn-cgi/access/certs',issuer),{timeoutDuration:5000,cooldownDuration:30000});
 return{
  mode:'cloudflare-access',secure:true,
  async resolve(req){
   const assertion=req.headers['cf-access-jwt-assertion'];if(typeof assertion!=='string')return null;
   try{const {payload}=await jwtVerify(assertion,jwks,{issuer,audience,algorithms:['RS256'],clockTolerance});const email=String(payload.email||'').toLowerCase();
    if(!emailPattern.test(email)||(!emails.has(email)&&(!domain||!email.endsWith('@'+domain))))return null;
    return{subject:String(payload.sub),email};
   }catch{return null;}
  },
  loginDisabled(){return true;},async revoke(){},
 };
}
