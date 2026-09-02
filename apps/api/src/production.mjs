import {openDatabase,transportWarning} from './platform/database.mjs';
import {createGoogleIdentity} from './platform/google-identity.mjs';
import {createAccountGate} from './modules/accounts.mjs';
import {createCore} from './app.mjs';
import {serveAsset} from '../../web/assets.mjs';

if(process.env.NODE_ENV!=='production')throw Error('Production entrypoint requires NODE_ENV=production.');
let origin;try{origin=new URL(process.env.PUBLIC_ORIGIN);}catch{throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');}if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');
const {pool,security}=await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:5,connectionTimeoutMillis:8000});
const warning=transportWarning(security);if(warning)throw Error('Verified database TLS is required.');
const identity=createGoogleIdentity({pool,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,publicOrigin:origin.href,allowedEmails:process.env.CORE_ALLOWED_EMAILS,isAllowed:createAccountGate(pool)});
const server=createCore({pool,identity,security,webOrigin:origin.origin,serveAsset});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('TZOLKIN Core production ready'));
const stop=()=>{server.closeAllConnections();server.close(()=>pool.end().finally(()=>process.exit(0)));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
