import {openDatabase,transportWarning,scrubSecrets} from './platform/database.mjs';
import {createGoogleIdentity} from './platform/google-identity.mjs';
import {createAccountGate} from './modules/accounts.mjs';
import {createCore} from './app.mjs';
import {serveAsset} from '../../web/assets.mjs';

if(process.env.NODE_ENV!=='production')throw Error('Production entrypoint requires NODE_ENV=production.');
let origin;try{origin=new URL(process.env.PUBLIC_ORIGIN);}catch{throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');}if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw Error('PUBLIC_ORIGIN must be an HTTPS origin.');
// Abertura do banco com nova tentativa: num orquestrador, o Core e o PostgreSQL
// sobem juntos e a primeira conexão pode chegar antes do banco aceitar. Sem isto,
// um atraso de segundos vira reinício em laço. A política de transporte não muda:
// depois das tentativas, ainda se recusa a subir sem TLS verificado.
const TENTATIVAS=5,ESPERA_INICIAL=1000,ESPERA_MAXIMA=30000;
const pausa=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// `diagnosis` já vem limpo de platform/database.mjs; o fallback cobre erro vindo
// de outro ponto (ex.: pg jogando ECONNREFUSED antes da sonda) e por isso passa
// pelo mesmo scrub — mensagem de driver pode carregar a URL com senha.
const causa=error=>scrubSecrets(error?.diagnosis??`[${error?.code??'sem código'}] ${error?.message??'erro sem mensagem'}`,process.env.DATABASE_URL);
const abrirBanco=async()=>{
 for(let tentativa=1;;tentativa++){
  try{return await openDatabase({connectionString:process.env.DATABASE_URL,mode:'require',max:5,connectionTimeoutMillis:8000});}
  catch(error){
   console.error(`[boot] tentativa ${tentativa}/${TENTATIVAS} de abrir o banco falhou: ${causa(error)}`);
   if(tentativa>=TENTATIVAS)throw error;
   const espera=Math.min(ESPERA_INICIAL*2**(tentativa-1),ESPERA_MAXIMA);
   console.error(`[boot] nova tentativa em ${espera}ms.`);
   await pausa(espera);
  }
 }
};
let pool,security;
try{({pool,security}=await abrirBanco());}
catch(error){
 console.error(`[boot] banco indisponível após ${TENTATIVAS} tentativas. Causa: ${causa(error)}`);
 process.exit(1);
}
const warning=transportWarning(security);if(warning){console.error(`[boot] ${warning}`);console.error('[boot] TLS verificado é obrigatório em produção.');process.exit(1);}
const identity=createGoogleIdentity({pool,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,publicOrigin:origin.href,allowedEmails:process.env.CORE_ALLOWED_EMAILS,isAllowed:createAccountGate(pool)});
const server=createCore({pool,identity,security,webOrigin:origin.origin,serveAsset});
// A porta vai para o log: é a única forma de o operador ver, no painel, que a
// app subiu num lugar diferente do que o healthcheck e o proxy procuram.
const porta=Number(process.env.PORT||3000);
server.listen(porta,'0.0.0.0',()=>console.log(`TZOLKIN Core production ready on 0.0.0.0:${porta}`));
const stop=()=>{server.closeAllConnections();server.close(()=>pool.end().finally(()=>process.exit(0)));};process.on('SIGTERM',stop);process.on('SIGINT',stop);
