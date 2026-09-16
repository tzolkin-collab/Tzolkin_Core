// Política de capacidades por tipo de item do portfólio (ADR 0007, opção B).
//
// O que estes testes protegem, em ordem de custo de errar:
//  1. linha de serviço e item interno nunca dão acesso nem vendem por checkout;
//  2. a recusa por tipo diz o porquê (409), e item ausente mantém o erro da rota;
//  3. chave só é emitida para escopo que o tipo do item suporta;
//  4. reclassificar não corta em silêncio o que depende do tipo antigo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, capabilitiesOf, findProductFor, requireProductFor } from '../../apps/api/src/modules/catalog.mjs';
import { issueKey } from '../../apps/api/src/modules/commercial-keys.mjs';
import { dependentesDaReclassificacao, portfolioRoutes } from '../../apps/api/src/modules/portfolio.mjs';

const BOOT = { subject: 'local-bootstrap' };

// Banco falso com um item de cada tipo. Responde ao filtro de tipo como o PostgreSQL.
const ITENS = {
 skiller: { id: 'skiller', name: 'TZOLKIN Skiller', portfolio_kind: 'product', lifecycle_status: 'active' },
 educare: { id: 'educare', name: 'Educare', portfolio_kind: 'platform', lifecycle_status: 'active' },
 mentorias: { id: 'mentorias', name: 'TZOLKIN Mentorias', portfolio_kind: 'service_line', lifecycle_status: 'active' },
 core: { id: 'core', name: 'TZOLKIN Core', portfolio_kind: 'internal', lifecycle_status: 'active' },
 rascunho: { id: 'rascunho', name: 'Rascunho', portfolio_kind: 'product', lifecycle_status: 'draft' },
};
function bancoDoPortfolio(extra = () => null) {
 const chamadas = [];
 return {
  chamadas,
  query: async (sql, params) => {
   chamadas.push({ sql, params });
   const outra = extra(sql, params);
   if (outra) return outra;
   const item = ITENS[params?.[0]];
   if (sql.startsWith('SELECT id,name FROM products')) {
    const ciclos = sql.includes("'draft'") ? ['active', 'draft'] : ['active'];
    const ok = item && ciclos.includes(item.lifecycle_status) && params[1].includes(item.portfolio_kind);
    return { rows: ok ? [{ id: item.id, name: item.name }] : [] };
   }
   if (sql.startsWith('SELECT name,portfolio_kind FROM products')) return { rows: item ? [item] : [] };
   return { rows: [] };
  },
 };
}

test('matriz de capacidades', () => {
 assert.deepEqual(capabilitiesOf('product'), ['access', 'checkout', 'product_engagement', 'commercial', 'operate']);
 assert.deepEqual(capabilitiesOf('platform'), capabilitiesOf('product'));
 assert.deepEqual(capabilitiesOf('service_line'), ['commercial', 'contract_billing', 'operate']);
 assert.deepEqual(capabilitiesOf('internal'), ['operate']);
 assert.deepEqual(capabilitiesOf('desconhecido'), []);
 // ADR 0008: só linha de serviço cobra a partir de contrato; o resto cobra por oferta.
 assert.deepEqual(CAPABILITIES.contract_billing, ['service_line']);
 for (const capacidade of ['access', 'checkout']) {
  assert.ok(!CAPABILITIES[capacidade].includes('service_line'), capacidade);
  assert.ok(!CAPABILITIES[capacidade].includes('internal'), capacidade);
 }
 assert.ok(Object.isFrozen(CAPABILITIES));
});

test('findProductFor filtra por tipo e por ciclo', async () => {
 const db = bancoDoPortfolio();
 assert.equal((await findProductFor(db, 'skiller', 'access'))?.id, 'skiller');
 assert.equal(await findProductFor(db, 'mentorias', 'access'), null);
 assert.equal(await findProductFor(db, 'core', 'checkout'), null);
 assert.equal((await findProductFor(db, 'mentorias', 'commercial'))?.id, 'mentorias');
 assert.equal(await findProductFor(db, 'rascunho', 'access'), null, 'rascunho não dá acesso');
 assert.equal((await findProductFor(db, 'rascunho', 'access', { draft: true }))?.id, 'rascunho', 'mas aceita contrato preparado');
 assert.deepEqual(db.chamadas[0].params, ['skiller', ['product', 'platform']]);
 assert.throws(() => findProductFor(db, 'skiller', 'voar'), /Capacidade desconhecida/);
});

test('requireProductFor explica a recusa por tipo e preserva o erro da rota', async () => {
 const db = bancoDoPortfolio();
 await assert.rejects(() => requireProductFor(db, 'mentorias', 'checkout'),
  e => e.status === 409 && /TZOLKIN Mentorias é uma linha de serviço e não vende por checkout/.test(e.message));
 await assert.rejects(() => requireProductFor(db, 'core', 'access'),
  e => e.status === 409 && /item interno/.test(e.message));
 const missing = Object.assign(new Error('Produto não está disponível para acesso.'), { status: 400 });
 await assert.rejects(() => requireProductFor(db, 'inexistente', 'access', { missing }), e => e === missing);
 await assert.rejects(() => requireProductFor(db, 'rascunho', 'access', { missing }), e => e === missing, 'fora do ciclo não é problema de tipo');
 assert.equal((await requireProductFor(db, 'educare', 'access')).id, 'educare');
});

test('chave de contexto não é emitida para linha de serviço; chave comercial é', async () => {
 const expires_at = new Date(Date.now() + 86400000).toISOString();
 const base = { label: 'Chave de teste', expires_at };
 await assert.rejects(
  () => issueKey(bancoDoPortfolio(), { ...base, product_id: 'mentorias', scopes: ['commercial:intake', 'context:read'] }, BOOT),
  e => e.status === 409 && /não dá acesso de usuários/.test(e.message));
 const db = bancoDoPortfolio(sql => sql.startsWith('INSERT INTO app_clients')
  ? { rows: [{ id: 'k1', product_id: 'mentorias', label: base.label, scopes: ['commercial:intake'], expires_at }] } : null);
 const chave = await issueKey(db, { ...base, product_id: 'mentorias', scopes: ['commercial:intake'] }, BOOT);
 assert.equal(chave.product_id, 'mentorias');
 assert.ok(chave.api_key);
});

test('reclassificação confere só as capacidades perdidas', async () => {
 const contagens = { entitlements: 2, billing_offers: 0, memberships: 0 };
 const db = bancoDoPortfolio(sql => {
  const tabela = Object.keys(contagens).find(t => sql.includes(`FROM ${t} `));
  return sql.startsWith('SELECT count(*)') ? { rows: [{ n: tabela ? contagens[tabela] : 0 }] } : null;
 });
 assert.deepEqual(await dependentesDaReclassificacao(db, 'skiller', 'product', 'platform'), [], 'produto e plataforma têm as mesmas capacidades');
 assert.equal(db.chamadas.length, 0);
 assert.deepEqual(await dependentesDaReclassificacao(db, 'skiller', 'product', 'service_line'), ['contratos de produto ativos: 2']);
 assert.deepEqual(await dependentesDaReclassificacao(db, 'mentorias', 'service_line', 'product'), [], 'ganhar capacidade não trava');
});

test('editar o tipo com contrato de acesso vivo vira 409', async () => {
 const rotas = new Map();
 portfolioRoutes({ get: () => {}, post: () => {}, put: (caminho, handler) => rotas.set(caminho, handler) });
 const item = { id: 'skiller', name: 'TZOLKIN Skiller', portfolio_kind: 'product', brand_family: 'tzolkin', lifecycle_status: 'active', revision: 5 };
 const db = { query: async sql => {
  if (sql.includes('FOR UPDATE')) return { rows: [item] };
  if (sql.includes('FROM entitlements')) return { rows: [{ n: 1 }] };
  if (sql.startsWith('SELECT count(*)')) return { rows: [{ n: 0 }] };
  if (sql.startsWith('UPDATE products')) assert.fail('não deveria gravar');
  return { rows: [] };
 } };
 await assert.rejects(
  () => rotas.get('/api/portfolio/:id')({ client: db, operator: BOOT, params: { id: 'skiller' }, body: { name: item.name, portfolio_kind: 'service_line', revision: 5 } }),
  e => e.status === 409 && /contratos de produto ativos: 1/.test(e.message));
});
