import { fail, onlyParams } from '../platform/http.mjs';
import { digest } from '../platform/session.mjs';
import { papelDoOperador } from './accounts.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Configurações → Perfil e sessão, Acessos e Auditoria. Admin interno, como o resto do Core.
//
// "Quem pode mudar o quê": o papel de administrador (owner) JÁ existe em operator_accounts. Quem administra contas é o owner (accounts.mjs)
// e, desde a etapa de credenciais pela tela, só o owner troca credencial de integração (integrations-credentials.mjs). Quem entra
// pelo ambiente (CORE_ALLOWED_EMAILS) e ainda não foi cadastrado conta como owner, como sempre foi, para o primeiro acesso não se trancar.

const ROTULOS_DE_PAPEL = { owner: 'Administrador', member: 'Membro', viewer: 'Leitor' };

export function contaRoutes(router, { env = vivo.env, clock = Date.now } = {}) {
 // Quem sou eu: a pessoa, como entrou, o que pode, e até quando vale a sessão. Nunca devolve token nem hash.
 router.get('/api/me', async ({ pool, url, reply, operator, sessions, sessionToken }) => {
  onlyParams(url.searchParams, []);
  const p = await papelDoOperador(pool, operator);
  const modo = sessions.mode === 'google-oidc' ? 'google' : 'senha-local';
  let sessao = null;
  if (modo === 'google' && sessionToken) {
   const s = (await pool.query('SELECT created_at,expires_at FROM operator_sessions WHERE token_hash=$1 AND revoked_at IS NULL', [digest(sessionToken)])).rows[0];
   const outras = (await pool.query('SELECT count(*)::int AS n FROM operator_sessions WHERE subject=$1 AND token_hash<>$2 AND revoked_at IS NULL AND expires_at>$3', [operator.subject, digest(sessionToken), new Date(clock()).toISOString()])).rows[0].n;
   sessao = { criada_em: s?.created_at ?? null, expira_em: s?.expires_at ?? null, outras_ativas: outras };
  }
  reply(200, {
   email: operator.email ?? null, nome: p.nome ?? null, modo,
   papel: p.papel, papel_rotulo: ROTULOS_DE_PAPEL[p.papel] ?? p.papel, origem: p.origem,   // 'cadastro' | 'ambiente' | 'local'
   pode_administrar: p.administra, sessao,
  });
 }, { body: false });

 // Encerra as OUTRAS sessões da mesma pessoa (esqueceu aberto em outro aparelho). A atual segue valendo.
 router.post('/api/me/sessoes/encerrar-outras', async ({ client, operator, sessions, sessionToken }) => {
  if (sessions.mode !== 'google-oidc' || !sessionToken) throw fail(409, 'No acesso por senha local há uma sessão só: use Sair.');
  const r = await client.query('UPDATE operator_sessions SET revoked_at=now() WHERE subject=$1 AND token_hash<>$2 AND revoked_at IS NULL AND expires_at>now() RETURNING token_hash', [operator.subject, digest(sessionToken)]);
  return { response: { ok: true, encerradas: r.rowCount ?? r.rows.length } };
 }, { transactional: true, body: false, audit: false });

 // Auditoria: o que mudou, por quem e quando. Duas fontes, juntas e em ordem:
 //   audit_events (trilha das empresas) e integration_credentials_history (credenciais pela tela, sem valores).
 // NÃO entram aqui alterações de contas e times (accounts.mjs não grava trilha hoje): a tela diz isso.
 router.get('/api/audit', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['limite']);
  const limite = Math.min(Math.max(Number.parseInt(url.searchParams.get('limite') ?? '100', 10) || 100, 1), 200);
  const eventos = (await pool.query(
   `SELECT e.type,e.actor_email,e.created_at,t.name AS empresa FROM audit_events e LEFT JOIN tenants t ON t.id=e.tenant_id ORDER BY e.created_at DESC LIMIT $1`, [limite])).rows
   .map(r => ({ quando: r.created_at, tipo: r.type, quem: r.actor_email, onde: r.empresa ?? null, fonte: 'empresas' }));
  let credenciais = [];
  try {
   credenciais = (await pool.query('SELECT provider,nome,action,actor,created_at FROM integration_credentials_history ORDER BY created_at DESC LIMIT $1', [limite])).rows
    .map(r => ({ quando: r.created_at, tipo: r.action === 'set' ? 'credencial.definida' : 'credencial.removida', quem: r.actor, onde: `${r.provider} · ${r.nome}`, fonte: 'integracoes' }));
  } catch (e) { if (e?.code !== '42P01') throw e; }   // sem a migração 050 só não há essa fonte
  const itens = [...eventos, ...credenciais].sort((a, b) => new Date(b.quando) - new Date(a.quando)).slice(0, limite);
  reply(200, { itens, fora_da_trilha: ['alterações de contas e times'] });
 }, { body: false });
}

