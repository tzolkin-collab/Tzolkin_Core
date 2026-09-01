// Política de conexão ao banco.
//
// O PostgreSQL do Core é remoto (EasyPanel). TLS autenticado é o padrão:
// nenhum fallback silencioso para transporte sem identidade verificada.
// O estado do transporte é medido e bloqueia operações sensíveis.
// Ver docs/SECURITY.md#o-banco-do-core-trafega-sem-tls-pela-internet-pública
import pg from 'pg';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const SSL_MODES = ['require', 'allow', 'disable'];

export function describeTarget(connectionString) {
 const url = new URL(connectionString);
 // sslmode=disable na própria URL é intenção explícita, e é respeitada.
 return {
  host: url.searchParams.get('host') || url.hostname,
  loopback: LOOPBACK.has(url.searchParams.get('host') || url.hostname),
  urlSslMode: url.searchParams.get('sslmode'),
 };
}

// Uma conexão só é considerada criptografada se o socket for TLS de fato.
const encrypted = client => Boolean(client.connection?.stream?.encrypted);

async function probe(connectionString, ssl, Client) {
 const client = new Client({ connectionString, ssl, connectionTimeoutMillis: 8000 });
 try {
  await client.connect();
  return encrypted(client) && (ssl.rejectUnauthorized === false || client.connection.stream.authorized === true);
 } catch { return false; } finally { await client.end().catch(() => {}); }
}

/**
 * Abre o pool decidindo o TLS uma única vez, na inicialização, em vez de deixar
 * cada conexão negociar por conta própria — o resultado precisa ser determinístico
 * e auditável.
 *
 * mode:
 *  'require' — exige TLS com certificado e hostname verificados, sem fallback.
 *  'allow'   — compatibilidade legada explícita; pode cair para texto claro avisando.
 *  'disable' — nem tenta.
 */
export async function openDatabase({ connectionString, mode = 'require', ...poolOptions }, { Client = pg.Client, Pool = pg.Pool } = {}) {
 if (!connectionString) throw new Error('DATABASE_URL é obrigatória.');
 if (!SSL_MODES.includes(mode)) throw new Error(`DATABASE_SSL inválido: use ${SSL_MODES.join(', ')}.`);

 const target = describeTarget(connectionString);
 const url = new URL(connectionString);
 const urlMode = url.searchParams.get('sslmode');
 const urlSsl = url.searchParams.get('ssl');
 if (urlMode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'].includes(urlMode))
  throw new Error('sslmode inválido na DATABASE_URL.');
 if (urlSsl && !['0', '1', 'true', 'false', 'no-verify'].includes(urlSsl))
  throw new Error('ssl inválido na DATABASE_URL.');
 const disabled = urlMode === 'disable' || ['0', 'false'].includes(urlSsl);
 const unverified = urlMode === 'no-verify' || urlSsl === 'no-verify';
 const urlRequiresTls = ['require', 'verify-ca', 'verify-full', 'no-verify'].includes(urlMode) || ['1', 'true', 'no-verify'].includes(urlSsl);
 if ((mode === 'require' && (disabled || unverified)) || (mode === 'disable' && urlRequiresTls) || (disabled && urlRequiresTls))
  throw new Error('Políticas TLS conflitantes entre DATABASE_SSL e DATABASE_URL.');
 for (const key of Object.keys(poolOptions)) {
  if (!['max', 'idleTimeoutMillis', 'connectionTimeoutMillis', 'application_name'].includes(key))
   throw new Error('Opção de pool não permitida pela política de transporte.');
 }
 // pg dá precedência aos parâmetros da URL sobre ssl. Ler apenas os certificados
 // e remover opções TLS da URL impede que ela desligue a validação silenciosamente.
 const parsedSsl = new pg.Client({ connectionString }).connectionParameters.ssl;
 const certificates = {};
 for (const key of ['ca', 'cert', 'key']) if (parsedSsl?.[key]) certificates[key] = parsedSsl[key];
 for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
 const normalized = url.href;
 const requireVerified = mode === 'require' || ['require', 'verify-ca', 'verify-full'].includes(urlMode) || ['1', 'true'].includes(urlSsl);
 let ssl = false;
 let verified = false;

 if (mode !== 'disable' && !disabled) {
  if (await probe(normalized, { ...certificates, rejectUnauthorized: true }, Client)) {
   ssl = { ...certificates, rejectUnauthorized: true }; verified = true;
  } else if (!requireVerified && await probe(normalized, { ...certificates, rejectUnauthorized: false }, Client)) {
   // Criptografa, mas não prova com quem se está falando: melhor que texto claro,
   // longe de suficiente. Continua sinalizado como não verificado.
   ssl = { ...certificates, rejectUnauthorized: false }; verified = false;
  }
 }

 const tls = ssl !== false;
 if ((!verified && requireVerified) || (!tls && unverified)) {
  throw new Error('O servidor não aceitou conexão criptografada com a validação exigida. Conexão recusada.');
 }

 const security = {
  tls,
  verified,
  remote: !target.loopback,
  // O que realmente importa: texto claro saindo desta máquina para outro host.
  insecure: !tls && !target.loopback,
  mode,
 };
 return { pool: new Pool({ ...poolOptions, connectionString: normalized, ssl }), security };
}

export function assertVerifiedTransport(security) {
 if (!security?.tls || !security?.verified)
  throw new Error('Rotação cancelada: exige TLS com certificado e hostname verificados, inclusive em loopback.');
}

// Bloco de aviso na inicialização. Sem hostname, sem credencial — só o estado.
export function transportWarning(security) {
 if (security.tls && !security.verified)
  return 'ATENÇÃO: TLS sem certificado verificado. Não cadastre cliente real; corrija a confiança no servidor.';
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
