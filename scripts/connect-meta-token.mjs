// Conecta um token persistente da Meta Graph ao Core.
//
// POR QUE UM SCRIPT, E NÃO UM CAMPO NO PAINEL
// O token é credencial de saída: com ele se lê o Gerenciador de Anúncios
// inteiro. Um formulário no painel faria a credencial transitar pelo navegador,
// entrar no histórico de rede das DevTools e, num deslize de log, no servidor de
// aplicação. Aqui ela vai do seu terminal para o banco, cifrada, sem passar por
// mais nada.
//
// POR QUE STDIN, E NÃO ARGUMENTO DE LINHA DE COMANDO
// Argumento aparece em `ps`, no histórico do shell e em log de auditoria do SO.
// Stdin não aparece em nenhum dos três.
//
// USO
//   node --env-file=.env scripts/connect-meta-token.mjs            (token já longo)
//   node --env-file=.env scripts/connect-meta-token.mjs --exchange (trocar curto por longo)
//
// O script pede o token e lê sem eco. Nada do que você digitar é impresso.
//
// PRÉ-REQUISITOS NO AMBIENTE
//   META_MARKETING_KEY  chave de cifragem (32 bytes base64)
//   META_APP_ID         id do app (obrigatório para --exchange e para conferir validade)
//   META_APP_SECRET     segredo do app (idem)
//   DATABASE_URL        banco do Core
import pg from 'pg';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { guardarCredencial } from '../apps/api/src/modules/marketing.mjs';
import { createMetaGraphAdapter, exchangeLongLivedToken } from '../apps/api/src/integrations/meta-graph.mjs';
import { readKey } from '../apps/api/src/platform/secrets.mjs';

const trocar = process.argv.includes('--exchange');

/** Lê uma linha sem ecoar no terminal. */
function perguntarSegredo(rotulo) {
 return new Promise((resolve, reject) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const stdout = process.stdout;
  // Silencia o eco: o terminal recebe só o rótulo, nunca os caracteres.
  const escrever = stdout.write.bind(stdout);
  rl.output.write = chunk => (String(chunk).startsWith(rotulo) ? escrever(chunk) : true);
  rl.question(rotulo, valor => { rl.close(); escrever('\n'); resolve(String(valor).trim()); });
  rl.on('SIGINT', () => { rl.close(); reject(new Error('Cancelado.')); });
 });
}

function perguntar(rotulo, padrao = '') {
 return new Promise(resolve => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question(padrao ? `${rotulo} [${padrao}]: ` : `${rotulo}: `, valor => {
   rl.close(); resolve(String(valor).trim() || padrao);
  });
 });
}

const dias = iso => (iso ? Math.floor((Date.parse(iso) - Date.now()) / 86400000) : null);

async function main() {
 // Falha antes de pedir o token: melhor descobrir a chave faltando agora do
 // que depois de o usuário colar a credencial.
 try { readKey(process.env); }
 catch (e) {
  console.error('\n' + e.message);
  console.error('\nGere uma chave e guarde no ambiente do servidor:');
  console.error('  node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"');
  process.exitCode = 1; return;
 }
 if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não definida.'); process.exitCode = 1; return; }

 const appId = process.env.META_APP_ID || null;
 const appSecret = process.env.META_APP_SECRET || null;

 if (trocar && (!appId || !appSecret)) {
  console.error('--exchange precisa de META_APP_ID e META_APP_SECRET no ambiente.');
  process.exitCode = 1; return;
 }

 console.log(trocar
  ? '\nTroca de token curto por token de longa duração (~60 dias).'
  : '\nConexão de token já persistente (Usuário do Sistema ou token longo).');
 console.log('O que você digitar não será exibido nem gravado em log.\n');

 let token = await perguntarSegredo(trocar ? 'Token de curta duração: ' : 'Token de acesso: ');
 if (!token || token.length < 20) { console.error('Token vazio ou curto demais.'); process.exitCode = 1; return; }

 let tipo = 'long_lived_user';
 let expiraEm = null;

 if (trocar) {
  console.log('Trocando na Meta…');
  try {
   const resultado = await exchangeLongLivedToken({ appId, appSecret, shortLivedToken: token });
   token = resultado.access_token;
   expiraEm = resultado.expires_at;
   tipo = resultado.token_type;
   console.log('Troca concluída.');
  } catch (e) { console.error('Falha na troca:', e.message); process.exitCode = 1; return; }
 }

 // Confere o token contra a Meta antes de gravar. Guardar uma credencial que
 // já não funciona só adia a descoberta do problema para a primeira coleta.
 let escopos = [];
 if (appId && appSecret) {
  try {
   const api = createMetaGraphAdapter({ token, appId, appSecret });
   const estado = await api.debugToken();
   if (!estado.valid) {
    console.error('A Meta considera este token inválido' + (estado.error ? `: ${estado.error}` : '.'));
    process.exitCode = 1; return;
   }
   escopos = estado.scopes;
   if (estado.never_expires) { expiraEm = null; tipo = 'system_user'; }
   else if (estado.expires_at) expiraEm = estado.expires_at;
   console.log('\nToken conferido na Meta:');
   console.log('  tipo:      ' + (estado.type || tipo));
   console.log('  expira:    ' + (expiraEm ? `${expiraEm} (${dias(expiraEm)} dias)` : 'não expira'));
   console.log('  escopos:   ' + (escopos.join(', ') || '(nenhum informado)'));
   if (!escopos.includes('ads_read')) {
    console.warn('\n  AVISO: sem `ads_read` a coleta de campanhas não vai funcionar.');
   }
  } catch (e) { console.error('Não foi possível conferir o token:', e.message); process.exitCode = 1; return; }
 } else {
  console.warn('\nMETA_APP_ID/META_APP_SECRET ausentes: gravando sem conferir validade nem escopos.');
  console.warn('Sem eles o Core não consegue avisar quando o token estiver perto de expirar.');
 }

 const rotulo = await perguntar('\nRótulo desta credencial', 'Meta Ads — TZOLKIN');

 const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  const gravada = await guardarCredencial(client, {
   token, label: rotulo, tokenType: tipo, scopes: escopos, expiresAt: expiraEm, appId,
  });
  await client.query('COMMIT');
  console.log('\nCredencial conectada.');
  console.log('  id:          ' + gravada.id);
  console.log('  impressão:   ' + gravada.token_fingerprint + '   (identifica o token sem revelá-lo)');
  console.log('  cifrada com: META_MARKETING_KEY');
  console.log('\nSe havia outra credencial ativa, ela foi revogada agora.');
  console.log('Próximo passo: abra Campanhas no painel e rode a coleta.');
 } catch (e) {
  await client.query('ROLLBACK');
  console.error('Falha ao gravar:', e.message);
  process.exitCode = 1;
 } finally { client.release(); await pool.end(); }

 // O token só existiu em memória. Sem eco, sem log, sem argv.
 token = randomBytes(8).toString('hex');
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
