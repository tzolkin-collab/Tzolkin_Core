// Contas de operador e times.
//
// ATENÇÃO AO QUE ISTO NÃO FAZ: não autoriza ninguém. Quem entra no Core continua
// sendo decidido por CORE_ALLOWED_EMAILS. Este módulo mantém o cadastro e — o que
// importa de verdade — mostra a DIVERGÊNCIA entre o cadastro e a lista que manda.
//
// Enquanto houver divergência, trocar a fonte de autorização tranca alguém para
// fora. Zerar a divergência é o pré-requisito da entrega E2/E3.
import { fail, input, onlyParams, text } from '../platform/http.mjs';

// A lista do ambiente é a autoridade atual. Normalizada aqui do mesmo jeito que
// a sessão a compara, para a divergência ser real e não artefato de maiúscula.
export function allowedEmails(env = process.env) {
 return [...new Set(String(env.CORE_ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(e => e.includes('@')))];
}

const PAPEL_CONTA = ['owner', 'member', 'viewer'];
const PAPEL_TIME = ['lead', 'member'];

export function accountRoutes(router, { env = process.env } = {}) {
 router.get('/api/accounts', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, []);

  const [contas, times, membros] = await Promise.all([
   pool.query('SELECT id,email,name,role,status,source,created_at FROM operator_accounts ORDER BY email'),
   pool.query('SELECT id,slug,name,description,created_at FROM teams ORDER BY name'),
   pool.query(`SELECT tm.team_id, tm.role, a.id AS account_id, a.email, a.name
                 FROM team_members tm JOIN operator_accounts a ON a.id = tm.account_id
                ORDER BY a.email`),
  ]);

  const permitidos = allowedEmails(env);
  const cadastrados = new Set(contas.rows.map(c => c.email.toLowerCase()));

  return reply(200, {
   accounts: contas.rows,
   teams: times.rows.map(t => ({
    ...t,
    members: membros.rows.filter(m => m.team_id === t.id)
     .map(({ team_id, ...m }) => m),
   })),
   authorization: {
    // Deixa explícito quem manda hoje, para ninguém confundir cadastro com permissão.
    source: 'CORE_ALLOWED_EMAILS',
    allowed_count: permitidos.length,
    // Quem entra mas não está cadastrado: o cadastro está incompleto.
    missing_from_registry: permitidos.filter(e => !cadastrados.has(e)),
    // Quem está cadastrado e NÃO entra: cadastro que não vale nada hoje.
    registered_without_access: contas.rows
     .filter(c => c.status === 'active' && !permitidos.includes(c.email.toLowerCase()))
     .map(c => c.email),
   },
   // Papel é cadastro, não permissão — ainda.
   enforcement: 'registry_only',
  });
 }, { body: false });

 router.put('/api/accounts', async ({ client, body }) => {
  input(body, ['email', 'name', 'role', 'status']);
  const email = text(body.email, 3, 320).toLowerCase();
  if (!email.includes('@') || email.startsWith('@')) throw fail(400, 'E-mail inválido.');
  const role = body.role ?? 'member';
  const status = body.status ?? 'active';
  if (!PAPEL_CONTA.includes(role) || !['active', 'suspended'].includes(status)) throw fail(400, 'Classificação inválida.');

  await client.query(
   `INSERT INTO operator_accounts(email,name,role,status,source) VALUES($1,$2,$3,$4,'manual')
    ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
      status=EXCLUDED.status, updated_at=now()`,
   [email, body.name == null ? null : text(body.name, 2, 160), role, status]);
  // Sem tenant: conta de operador é da TZOLKIN, não de um cliente.
  return { tenant: null, type: 'operator_account.saved' };
 }, { transactional: true, audit: false });

 router.put('/api/teams', async ({ client, body }) => {
  input(body, ['slug', 'name', 'description', 'members']);
  const slug = text(body.slug, 2, 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) throw fail(400, 'Use letras minúsculas, números e hífen no identificador.');
  if (body.members != null && !Array.isArray(body.members)) throw fail(400, 'Membros inválidos.');

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
  return { tenant: null, type: 'team.saved' };
 }, { transactional: true, audit: false });
}
