// Política de conexão ao banco.
//
// O PostgreSQL do Core é remoto (EasyPanel) e hoje não aceita TLS: credencial e
// dados trafegam em texto claro pela internet. Este módulo não resolve isso —
// a correção é de infraestrutura — mas garante que o estado do transporte seja
// medido, visível e capaz de bloquear operações sensíveis.
// Ver docs/SECURITY.md#o-banco-do-core-trafega-sem-tls-pela-internet-pública
import pg from 'pg';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const SSL_MODES = ['require', 'allow', 'disable'];

export function describeTarget(connectionString) {
 const url = new URL(connectionString);
 // sslmode=disable na própria URL é intenção explícita, e é respeitada.
 return {
  host: url.hostname,
  loopback: LOOPBACK.has(url.hostname),
  urlSslMode: url.searchParams.get('sslmode'),
 };
}

// Uma conexão só é considerada criptografada se o socket for TLS de fato.
const encrypted = client => Boolean(client.connection?.stream?.encrypted);

async function probe(connectionString, ssl) {
 const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 8000 });
 try {
  await client.connect();
  return encrypted(client);
 } catch { return false; } finally { await client.end().catch(() => {}); }
}

/**
 * Abre o pool decidindo o TLS uma única vez, na inicialização, em vez de deixar
 * cada conexão negociar por conta própria — o resultado precisa ser determinístico
 * e auditável.
 *
 * mode:
 *  'require' — exige transporte criptografado; recusa iniciar sem ele. Estado-alvo.
 *  'allow'   — tenta criptografar e cai para texto claro avisando. Padrão de hoje,
 *              porque o servidor atual não oferece TLS e o Core precisa seguir rodando.
 *  'disable' — nem tenta.
 */
export async function openDatabase({ connectionString, mode = 'allow', ...poolOptions }) {
 if (!connectionString) throw new Error('DATABASE_URL é obrigatória.');
 if (!SSL_MODES.includes(mode)) throw new Error(`DATABASE_SSL inválido: use ${SSL_MODES.join(', ')}.`);

 const target = describeTarget(connectionString);
 let ssl = false;
 let verified = false;

 if (mode !== 'disable') {
  if (await probe(connectionString, { rejectUnauthorized: true })) {
   ssl = { rejectUnauthorized: true }; verified = true;
  } else if (await probe(connectionString, { rejectUnauthorized: false })) {
   // Criptografa, mas não prova com quem se está falando: melhor que texto claro,
   // longe de suficiente. Continua sinalizado como não verificado.
   ssl = { rejectUnauthorized: false }; verified = false;
  }
 }

 const tls = ssl !== false;
 if (!tls && mode === 'require') {
  throw new Error('DATABASE_SSL=require, mas o servidor não aceitou conexão criptografada. Conexão recusada.');
 }

 const security = {
  tls,
  verified,
  remote: !target.loopback,
  // O que realmente importa: texto claro saindo desta máquina para outro host.
  insecure: !tls && !target.loopback,
  mode,
 };
 return { pool: new pg.Pool({ connectionString, ssl, ...poolOptions }), security };
}

// Bloco de aviso na inicialização. Sem hostname, sem credencial — só o estado.
export function transportWarning(security) {
 if (!security.insecure) return null;
 return [
  '',
  '  ┌─ ATENÇÃO ────────────────────────────────────────────────────────┐',
  '  │ O banco está em host REMOTO e a conexão NÃO é criptografada.     │',
  '  │ Senha e dados trafegam em texto claro pela rede.                 │',
  '  │ Correção e runbook: docs/SECURITY.md                             │',
  '  │ Não cadastre cliente real enquanto isso não for resolvido.       │',
  '  └──────────────────────────────────────────────────────────────────┘',
  '',
 ].join('\n');
}

// Testes escrevem no banco. Preferir uma base separada quando houver;
// sem ela, avisar que se está usando a mesma base do cadastro.
export function testConnectionString(env = process.env) {
 return {
  connectionString: env.DATABASE_URL_TEST || env.DATABASE_URL,
  dedicated: Boolean(env.DATABASE_URL_TEST),
 };
}
