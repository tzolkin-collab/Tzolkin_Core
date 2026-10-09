// Contas de operador e times.
//
// Quem entra no Core é a UNIÃO de duas fontes:
//   1. CORE_ALLOWED_EMAILS — raiz de confiança, sempre vale. É o quebra-vidro:
//      erro no cadastro nunca tranca todo mundo para fora.
//   2. operator_accounts com status 'active' — gerenciado aqui pelo administrador.
//
// A união, e não a substituição, é o que torna seguro conceder acesso pelo painel.
// Suspender no cadastro NÃO revoga quem está no ambiente — para revogar de
// verdade um endereço do ambiente, edita-se o ambiente. A tela diz isso.
import { fail, input, onlyParams, text } from '../platform/http.mjs';
import { registrarAuditoria, resumirConta, resumirTime } from '../platform/auditoria-operadores.mjs';

// A lista do ambiente é a autoridade atual. Normalizada aqui do mesmo jeito que
// a sessão a compara, para a divergência ser real e não artefato de maiúscula.
export function allowedEmails(env = process.env) {
 return [...new Set(String(env.CORE_ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))];
}

/**
 * Porteiro consultado pelo login do Google. Soma-se à lista do ambiente,
 * nunca a substitui: o ambiente é o quebra-vidro.
 */
export function createAccountGate(pool) {
 return async email => {
  if (typeof email !== 'string' || !email.includes('@')) return false;
  const r = await pool.query(
   "SELECT 1 FROM operator_accounts WHERE email=$1 AND status='active'", [email.trim().toLowerCase()]);
  return r.rowCount > 0;
 };
}

// Quem administra contas. Em modo local existe um operador só, o que tem a
// senha do bootstrap — ele é owner por definição.
async function exigirOwner(client, operator) {
 if (!(await papelDoOperador(client, operator)).administra) throw fail(403, 'Apenas administradores podem gerenciar contas.');
}

/**
 * O papel de quem está logado: { papel, nome, origem, administra }.
 *   local     senha de bootstrap (modo local): owner por definição
 *   cadastro  tem conta ATIVA em operator_accounts: vale o papel dela (só 'owner' administra)
 *   ambiente  entrou por CORE_ALLOWED_EMAILS e não tem conta ativa: conta como owner, senão o primeiro acesso não conseguiria cadastrar ninguém
 * Sem e-mail e fora do modo local não administra.
 */
export async function papelDoOperador(db, operator, env = process.env) {
 if (operator?.subject === 'local-bootstrap') return { papel: 'owner', nome: null, origem: 'local', administra: true };
 const email = operator?.email?.toLowerCase();
 if (!email) return { papel: 'member', nome: null, origem: 'ambiente', administra: false };
 const r = await db.query("SELECT role,name FROM operator_accounts WHERE email=$1 AND status='active'", [email]);
 const row = r.rows?.[0];
 if (row) return { papel: row.role, nome: row.name ?? null, origem: 'cadastro', administra: row.role === 'owner' };
 const permitidos = allowedEmails(env);
 const temListaEnv = Boolean(env.CORE_ALLOWED_EMAILS);
 if (!temListaEnv || permitidos.includes(email)) return { papel: 'owner', nome: null, origem: 'ambiente', administra: true };
 return { papel: 'viewer', nome: null, origem: 'cadastro', administra: false };
}
export const podeAdministrar = async (db, operator, env = process.env) => (await papelDoOperador(db, operator, env)).administra;

const PAPEL_CONTA = ['owner', 'member', 'viewer'];
const PAPEL_TIME = ['lead', 'member'];

export function accountRoutes(router, { env = process.env } = {}) {
 router.get('/api/accounts', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, []);

  const [contas, times, membros] = await Promise.all([
   pool.query('SELECT id,email,name,role,status,source,created_at FROM operator_accounts ORDER BY email'),
   pool.query('SELECT id,slug,name,description,created_at FROM teams ORDER BY name'),
   pool.query(`SELECT tm.team_id, tm.role, a.id AS account_id, a.email, a.name, a.status
                 FROM team_members tm JOIN operator_accounts a ON a.id = tm.account_id
                ORDER BY a.email`),
  ]);

  const permitidos = allowedEmails(env);
  const ativos = contas.rows.filter(c => c.status === 'active').map(c => c.email.toLowerCase());
  const cadastrados = new Set(contas.rows.map(c => c.email.toLowerCase()));

  return reply(200, {
   accounts: contas.rows,
   teams: times.rows.map(t => ({
    ...t,
    members: membros.rows.filter(m => m.team_id === t.id)
     .map(({ team_id, ...m }) => m),
   })),
   authorization: {
    sources: ['CORE_ALLOWED_EMAILS', 'operator_accounts'],
    env_count: permitidos.length,
    registry_count: ativos.length,
    // Entram pelo ambiente e não estão no cadastro: NÃO dá para suspendê-los
    // por aqui. A tela precisa dizer isso em vez de fingir que o botão resolve.
    env_only: permitidos.filter(e => !cadastrados.has(e)),
    // Total efetivo de quem consegue entrar hoje.
    effective: [...new Set([...permitidos, ...ativos])].length,
   },
   enforcement: 'env_plus_registry',
  });
 }, { body: false });

 router.put('/api/accounts', async ({ client, body, operator }) => {
  await exigirOwner(client, operator);
  input(body, ['email', 'name', 'role', 'status']);
  const email = text(body.email, 3, 320).toLowerCase();
  if (!email.includes('@') || email.startsWith('@')) throw fail(400, 'E-mail inválido.');
  const role = body.role ?? 'member';
  const status = body.status ?? 'active';
  if (!PAPEL_CONTA.includes(role) || !['active', 'suspended'].includes(status)) throw fail(400, 'Classificação inválida.');

  // Nunca deixar a instalação sem administrador ativo.
  if (role !== 'owner' || status !== 'active') {
   const owners = await client.query(
    "SELECT email FROM operator_accounts WHERE role='owner' AND status='active'");
   if (owners.rowCount === 1 && owners.rows[0].email === email)
    throw fail(409, 'Não é possível remover o último administrador.');
  }

  const antes = (await client.query('SELECT role,status,name FROM operator_accounts WHERE email=$1', [email])).rows[0] ?? null;
  const nome = body.name == null ? null : text(body.name, 2, 160);
  await client.query(
   `INSERT INTO operator_accounts(email,name,role,status,source) VALUES($1,$2,$3,$4,'manual')
    ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
      status=EXCLUDED.status, updated_at=now()`,
   [email, nome, role, status]);

  // Se a conta foi suspensa, encerra na hora todas as sessões e vínculos ativos dela
  // (a menos que seja endereço do ambiente, que nunca é revogado pelo cadastro).
  const permitidos = allowedEmails(env);
  if (status === 'suspended' && !permitidos.includes(email)) {
   try {
    await client.query(
     'UPDATE operator_sessions SET revoked_at=now() WHERE lower(email)=$1 AND revoked_at IS NULL',
     [email]);
   } catch (e) {
    if (e?.code !== '42P01') throw e;
   }
   try {
    await client.query(
     'UPDATE push_subscriptions SET revoked_at=now(), updated_at=now() WHERE lower(operator_email)=$1 AND revoked_at IS NULL',
     [email]);
   } catch (e) {
    if (e?.code !== '42P01') throw e;
   }
   try {
    await client.query(
     'UPDATE google_calendar_connections SET revoked_at=now(), updated_at=now() WHERE lower(email)=$1 AND revoked_at IS NULL',
     [email]);
   } catch (e) {
    if (e?.code !== '42P01') throw e;
   }
  }

  // Rastro (Configurações → Auditoria): só quando algo mudou, com o antes e o depois do cadastro.
  const depois = { role, status, name: nome };
  const resumo = resumirConta(antes, depois);
  if (!antes || resumo) await registrarAuditoria(client, { acao: antes ? 'conta.alterada' : 'conta.criada', alvo: email, operator, detalhes: { antes: antes && { role: antes.role, status: antes.status, name: antes.name ?? null }, depois, resumo } });
  // Sem tenant: conta de operador é da TZOLKIN, não de um cliente.
  return { tenant: null, type: 'operator_account.saved' };
 }, { transactional: true, audit: false });

 router.put('/api/teams', async ({ client, body, operator }) => {
  await exigirOwner(client, operator);
  input(body, ['slug', 'name', 'description', 'members']);
  const slug = text(body.slug, 2, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw fail(400, 'Use letras minúsculas, números e hífen no identificador.');
  if (body.members != null && !Array.isArray(body.members)) throw fail(400, 'Membros inválidos.');

  const timeAntes = (await client.query('SELECT id,name,description FROM teams WHERE slug=$1', [slug])).rows[0] ?? null;
  const membrosAntes = timeAntes ? (await client.query('SELECT a.email,tm.role FROM team_members tm JOIN operator_accounts a ON a.id=tm.account_id WHERE tm.team_id=$1 ORDER BY a.email', [timeAntes.id])).rows : [];
  const time = await client.query(
   `INSERT INTO teams(slug,name,description) VALUES($1,$2,$3)
    ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, updated_at=now()
    RETURNING id`,
   [slug, text(body.name, 2, 120), body.description == null ? null : text(body.description, 1, 500)]);
  const teamId = time.rows[0].id;

  if (body.members) {
   // Substitui a composição inteira: enviar a lista é declarar quem é o time.
   // Remover por omissão é mais previsível que acumular membros esquecidos.
   await client.query('DELETE FROM team_members WHERE team_id=$1', [teamId]);
   for (const m of body.members) {
    if (!m || typeof m.email !== 'string') throw fail(400, 'Membro inválido.');
    const papel = m.role ?? 'member';
    if (!PAPEL_TIME.includes(papel)) throw fail(400, 'Papel de time inválido.');
    const conta = await client.query('SELECT id FROM operator_accounts WHERE email=$1', [m.email.trim().toLowerCase()]);
    // Não cria conta implicitamente: um membro sem conta é erro de cadastro,
    // não motivo para inventar um operador.
    if (!conta.rowCount) throw fail(400, `Conta não cadastrada: ${m.email}`);
    await client.query('INSERT INTO team_members(team_id,account_id,role) VALUES($1,$2,$3)',
     [teamId, conta.rows[0].id, papel]);
   }
  }
  const descricao = body.description == null ? null : text(body.description, 1, 500);
  const membrosDepois = body.members ? body.members.map(m => ({ email: m.email.trim().toLowerCase(), role: m.role ?? 'member' })).sort((x, y) => x.email.localeCompare(y.email)) : membrosAntes;
  const antes = timeAntes && { name: timeAntes.name, description: timeAntes.description ?? null, membros: membrosAntes };
  const depois = { name: text(body.name, 2, 120), description: descricao, membros: membrosDepois };
  const resumo = resumirTime(antes, depois);
  if (!antes || resumo) await registrarAuditoria(client, { acao: 'time.salvo', alvo: slug, operator, detalhes: { antes, depois, resumo } });
  return { tenant: null, type: 'team.saved' };
 }, { transactional: true, audit: false });
}
