// Edição das fichas: pessoa (PUT /api/stakeholders) e dados de contato do lead (PUT /api/commercial/leads/:id).
// Banco falso que responde pelo texto do SQL e guarda cada comando, para conferir o que foi (e o que NÃO foi) gravado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { directoryRoutes } from '../../apps/api/src/modules/directory.mjs';
import { commercialWorkspaceRoutes } from '../../apps/api/src/modules/commercial-workspace.mjs';

const registra = (instalar) => {
 const rotas = new Map();
 const roteador = new Proxy({}, { get: (_, metodo) => (caminho, handler) => rotas.set(`${String(metodo).toUpperCase()} ${caminho}`, handler) });
 instalar(roteador);
 return rotas;
};
const TENANT = '10000000-0000-4000-8000-000000000001';
const PESSOA = '20000000-0000-4000-8000-000000000002';
const LEAD = '30000000-0000-4000-8000-000000000003';

/* ---------------- pessoa ---------------- */
const pessoaAtual = { id: PESSOA, name: 'Ana Contato', email: 'ana@exemplo.test', phone: '11999990000', role: 'decision_maker', title: 'Diretora', is_primary: true, contact_allowed: true };
function bancoDePessoa({ pessoa = pessoaAtual, emailEmUso = false } = {}) {
 const comandos = [];
 return { comandos, client: { query: async (sql, params) => {
  comandos.push({ sql, params });
  if (/FROM stakeholders s JOIN organization_stakeholders/.test(sql)) return { rows: pessoa ? [{ ...pessoa }] : [] };
  if (/SELECT 1 FROM stakeholders WHERE lower\(email\)/.test(sql)) return { rows: emailEmUso ? [{}] : [], rowCount: emailEmUso ? 1 : 0 };
  return { rows: [], rowCount: 1 };
 } } };
}
const editarPessoa = (banco, corpo) => registra(directoryRoutes).get('PUT /api/stakeholders')({ client: banco.client, body: { tenant_id: TENANT, stakeholder_id: PESSOA, ...corpo } });
const gravacoes = banco => banco.comandos.filter(c => /^UPDATE/.test(c.sql));

test('pessoa: mudar só o nome grava só a tabela da pessoa e registra antes e depois', async () => {
 const banco = bancoDePessoa();
 const r = await editarPessoa(banco, { name: '  Ana Souza ' });
 assert.equal(r.type, 'stakeholder.updated');
 assert.equal(r.tenant, TENANT);
 const g = gravacoes(banco);
 assert.equal(g.length, 1);
 assert.match(g[0].sql, /UPDATE stakeholders SET/);
 assert.deepEqual(g[0].params, [PESSOA, 'Ana Souza', 'ana@exemplo.test', '11999990000'], 'o resto fica como estava');
 assert.deepEqual(r.details, { before: { name: 'Ana Contato' }, after: { name: 'Ana Souza' } });
});

test('pessoa: papel, cargo e flags são do vínculo com a empresa e não tocam a tabela da pessoa', async () => {
 const banco = bancoDePessoa();
 const r = await editarPessoa(banco, { role: 'finance', title: 'Financeiro', is_primary: false, contact_allowed: false });
 const g = gravacoes(banco);
 assert.equal(g.length, 1);
 assert.match(g[0].sql, /UPDATE organization_stakeholders SET/);
 assert.deepEqual(g[0].params, [TENANT, PESSOA, 'finance', 'Financeiro', false, false]);
 assert.deepEqual(r.details.after, { role: 'finance', title: 'Financeiro', is_primary: false, contact_allowed: false });
});

test('pessoa: e-mail e telefone são normalizados e a trilha NÃO copia o contato', async () => {
 const banco = bancoDePessoa();
 const r = await editarPessoa(banco, { email: ' Nova@Exemplo.TEST ', phone: '(11) 98888-7777' });
 assert.deepEqual(gravacoes(banco)[0].params, [PESSOA, 'Ana Contato', 'nova@exemplo.test', '11988887777']);
 const texto = JSON.stringify(r.details);
 assert.doesNotMatch(texto, /nova@exemplo|ana@exemplo|9888|9999/, 'dado de contato não vai para o histórico da empresa');
 assert.deepEqual(r.details.before, { email: 'valor anterior', phone: 'valor anterior' });
 assert.deepEqual(r.details.after, { email: 'valor novo', phone: 'valor novo' });
});

test('pessoa: "" e null limpam e-mail, telefone e cargo', async () => {
 const banco = bancoDePessoa();
 const r = await editarPessoa(banco, { email: '', phone: null, title: '' });
 const todas = gravacoes(banco);
 assert.deepEqual(todas.find(g => /UPDATE stakeholders/.test(g.sql)).params, [PESSOA, 'Ana Contato', null, null]);
 assert.deepEqual(todas.find(g => /UPDATE organization_stakeholders/.test(g.sql)).params.slice(2, 4), ['decision_maker', null]);
 assert.deepEqual(r.details.after, { email: null, phone: null, title: null });
});

test('pessoa: sem mudança real não grava nada', async () => {
 const banco = bancoDePessoa();
 const r = await editarPessoa(banco, { name: 'Ana Contato', is_primary: true });
 assert.equal(gravacoes(banco).length, 0);
 assert.equal(r.details, undefined);
});

test('pessoa: valor inválido é recusado antes de tocar no banco', async () => {
 for (const [corpo, esperado] of [
  [{ email: 'sem-arroba' }, /E-mail inválido/], [{ email: 'a@b' }, /E-mail inválido/],
  [{ phone: '12345' }, /Telefone inválido/], [{ phone: 'abcdefghij' }, /Telefone inválido/],
  [{ role: 'chefe' }, /Papel inválido/], [{ name: 'A' }, /Texto inválido/],
  [{ is_primary: 'sim' }, /Valor inválido/], [{ contact_allowed: 1 }, /Valor inválido/],
  [{}, /Informe o que mudar/],
 ]) {
  const banco = bancoDePessoa();
  await assert.rejects(editarPessoa(banco, corpo), e => e.status === 400 && esperado.test(e.message), JSON.stringify(corpo));
  assert.equal(banco.comandos.length, 0, `não pode consultar o banco: ${JSON.stringify(corpo)}`);
 }
 await assert.rejects(editarPessoa(bancoDePessoa(), { campo_novo: 1 }), e => e.status === 400, 'chave desconhecida');
 await assert.rejects(registra(directoryRoutes).get('PUT /api/stakeholders')({ client: bancoDePessoa().client, body: { tenant_id: 'x', stakeholder_id: PESSOA, name: 'Ana' } }), e => e.status === 400);
});

test('pessoa: não existe nesta empresa é 404, e e-mail de outra pessoa é 409', async () => {
 await assert.rejects(editarPessoa(bancoDePessoa({ pessoa: null }), { name: 'Ana Souza' }), e => e.status === 404);
 const repetido = bancoDePessoa({ emailEmUso: true });
 await assert.rejects(editarPessoa(repetido, { email: 'outra@exemplo.test' }), e => e.status === 409);
 assert.equal(gravacoes(repetido).length, 0, 'nada é gravado quando o e-mail já é de outra pessoa');
 // trocar para o próprio e-mail (só maiúsculas) não é conflito
 const proprio = bancoDePessoa({ emailEmUso: true });
 const r = await editarPessoa(proprio, { email: 'ANA@exemplo.test', name: 'Ana C.' });
 assert.equal(r.type, 'stakeholder.updated');
});

/* ---------------- lead ---------------- */
const leadAtual = { id: LEAD, version: 4, status: 'open', owner_id: null, loss_reason: null, name: 'Lead de teste', email: 'lead@exemplo.test', whatsapp: null, message: 'Quero saber mais' };
function bancoDeLead(lead = leadAtual) {
 const comandos = [];
 return { comandos, client: { query: async (sql, params) => {
  comandos.push({ sql, params });
  if (/SELECT \* FROM commercial_leads WHERE id=\$1 FOR UPDATE/.test(sql)) return { rows: lead ? [{ ...lead }] : [] };
  return { rows: [], rowCount: 1 };
 } } };
}
const operador = { subject: 'local-bootstrap', email: 'dono@exemplo.test' };
const editarLead = (banco, corpo) => registra(commercialWorkspaceRoutes).get('PUT /api/commercial/leads/:id')({ client: banco.client, params: { id: LEAD }, body: { version: 4, ...corpo }, operator: operador });
const atualizacao = banco => banco.comandos.find(c => /^UPDATE commercial_leads/.test(c.sql));
const atividade = banco => banco.comandos.find(c => /INSERT INTO commercial_activities/.test(c.sql));

test('lead: corrige e-mail, WhatsApp, nome e mensagem; devolve a versão nova', async () => {
 const banco = bancoDeLead();
 const r = await editarLead(banco, { name: ' Lead Corrigido ', email: ' Novo@Exemplo.TEST ', whatsapp: '(11) 97777-6666', message: 'Linha 1\nLinha 2' });
 assert.deepEqual(r.body, { ok: true, version: 5 });
 assert.deepEqual(atualizacao(banco).params, [LEAD, 'open', null, null, 'Lead Corrigido', 'novo@exemplo.test', '11977776666', 'Linha 1\nLinha 2']);
});

test('lead: a mensagem aceita quebra de linha e tabulação, e recusa caractere de controle', async () => {
 const ok = bancoDeLead();
 await editarLead(ok, { message: 'a\n\tb\r\nc' });
 assert.equal(atualizacao(ok).params[7], 'a\n\tb\r\nc');
 await assert.rejects(editarLead(bancoDeLead(), { message: 'oi\u0000' }), e => e.status === 400);
 await assert.rejects(editarLead(bancoDeLead(), { message: 'x'.repeat(5001) }), e => e.status === 400);
});

test('lead: o lead nunca fica sem meio de contato, e e-mail e WhatsApp seguem as regras do intake', async () => {
 const semEmail = { ...leadAtual, whatsapp: null };
 await assert.rejects(editarLead(bancoDeLead(semEmail), { email: '' }), e => e.status === 400 && /e-mail ou WhatsApp/.test(e.message));
 // limpar o e-mail é permitido quando sobra o WhatsApp
 const comZap = bancoDeLead({ ...leadAtual, whatsapp: '11999990000' });
 await editarLead(comZap, { email: null });
 assert.deepEqual(atualizacao(comZap).params.slice(5, 7), [null, '11999990000']);
 for (const ruim of [{ email: 'sem-arroba' }, { whatsapp: '123' }, { name: 'A' }]) {
  await assert.rejects(editarLead(bancoDeLead(), ruim), e => e.status === 400, JSON.stringify(ruim));
 }
});

test('lead: a trilha diz QUAIS dados mudaram, sem os valores', async () => {
 const banco = bancoDeLead();
 await editarLead(banco, { email: 'novo@exemplo.test', message: 'Outra mensagem' });
 const detalhes = atividade(banco).params[3];
 assert.deepEqual(detalhes.changed, ['email', 'message']);
 assert.doesNotMatch(JSON.stringify(detalhes), /novo@exemplo|Outra mensagem|lead@exemplo/, 'valor de contato fora da trilha');
 // sem mudança de contato, a trilha não traz "changed"
 const so = bancoDeLead();
 await editarLead(so, { owner_id: null });
 assert.equal(atividade(so).params[3].changed, undefined);
});

test('lead: o comportamento antigo (responsável, etapa, motivo, versão) segue igual', async () => {
 const lost = bancoDeLead();
 await editarLead(lost, { status: 'lost', loss_reason: 'Sem orçamento' });
 assert.deepEqual(atualizacao(lost).params.slice(1, 4), ['lost', null, 'Sem orçamento']);
 await assert.rejects(editarLead(bancoDeLead(), { version: 3, name: 'Outro nome' }), e => e.status === 409, 'versão velha: ninguém sobrescreve em silêncio');
 await assert.rejects(editarLead(bancoDeLead(), { status: 'inventado' }), e => e.status === 400);
 await assert.rejects(editarLead(bancoDeLead(null), { name: 'Qualquer' }), e => e.status === 404);
 await assert.rejects(editarLead(bancoDeLead(), { campo_novo: 1 }), e => e.status === 400);
 // só trocar contato não mexe em estágio nem responsável
 const contatoSo = bancoDeLead({ ...leadAtual, owner_id: null });
 await editarLead(contatoSo, { name: 'Novo Nome' });
 assert.deepEqual(atualizacao(contatoSo).params.slice(1, 4), ['open', null, null]);
});
