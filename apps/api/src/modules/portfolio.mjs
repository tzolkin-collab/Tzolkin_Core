// Portfólio e contratações — criar, editar, classificar e arquivar.
//
// Dois cadastros separados, como decidido no ADR-0005:
//  - PORTFÓLIO (products): o que a TZOLKIN vende — produto, plataforma ou
//    linha de serviço — e o que ela opera para si mesma (interno).
//  - CONTRATAÇÃO (client_engagements): o que um cliente comprou — sob demanda,
//    consultoria, assessoria, mentoria ou produto —, ligada a um item do
//    portfólio quando fizer sentido.
//
// EXCLUIR É ARQUIVAR. products.id é chave estrangeira em 18 tabelas e
// client_engagements em 2, todas sem cascata, e a role de produção não tem
// DELETE. Arquivar tira da operação corrente sem apagar o histórico que aponta
// para o item.
//
// O IDENTIFICADOR DO PRODUTO NÃO MUDA. Ele aparece na URL pública de checkout
// (/c/:productId) e em chaves de app já emitidas. Nome, tipo e família mudam.
//
// ATIVAR não passa por aqui quando o item tem projeto técnico: aí quem ativa é o
// checklist de delivery (POST /api/delivery/projects/:id/activate), que confere
// oferta, checkout, contrato e deploy antes de liberar.
import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { SERVICE_MODELS } from './commercial-intake.mjs';
import { CAPABILITIES, capabilitiesOf, requireProductFor } from './catalog.mjs';

// `internal`: software da própria TZOLKIN, sem comprador externo (ADR 0007).
export const PORTFOLIO_KINDS = ['product', 'platform', 'service_line', 'internal'];
export const ENGAGEMENT_STATUS = ['planned', 'active', 'paused', 'completed', 'discontinued', 'unclassified'];

// O próprio Core é item do portfólio. Arquivá-lo ou devolvê-lo a rascunho
// tiraria a identidade do painel de dentro dele mesmo.
const PROTEGIDOS = new Set(['core']);
const FAMILIA = /^[a-z][a-z0-9-]{1,39}$/;
const COLUNAS = 'id,name,portfolio_kind,brand_family,lifecycle_status,revision,created_at,updated_at,archived_at,archived_from';
const COLUNAS_CONTRATACAO = 'id,tenant_id,product_id,service_model,status,label,revision,created_at,updated_at,archived_at';

const revisao = body => {
 if (!Number.isInteger(body.revision) || body.revision < 1) throw fail(400, 'Revisão inválida.');
 return body.revision;
};

async function registrar(client, entity, id, action, before, after, operator) {
 await client.query(
  `INSERT INTO portfolio_audit(entity,entity_id,action,before,after,actor_subject,actor_email)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,
  [entity, id, action, before, after, operator?.subject ?? null, operator?.email ?? null]);
}

// ---------------------------------------------------------------------------
// Portfólio
// ---------------------------------------------------------------------------

/** Carrega com trava e confere existência e revisão. */
async function carregarItem(client, id, revision) {
 if (!isProductId(id)) throw fail(400, 'Identificador inválido.');
 const atual = (await client.query(`SELECT ${COLUNAS} FROM products WHERE id=$1 FOR UPDATE`, [id])).rows[0];
 if (!atual) throw fail(404, 'Item do portfólio não encontrado.');
 if (atual.revision !== revision)
  throw fail(409, 'Este item foi alterado por outra pessoa. Recarregue antes de salvar.');
 return atual;
}

/**
 * O que ainda depende do item. Arquivar ou voltar a rascunho com qualquer um
 * destes vivos cortaria acesso, chave, contrato ou contratação em curso — os
 * filtros de venda e acesso só enxergam produto ativo.
 */
export async function dependentesVivos(client, id) {
 const r = await client.query(
  `SELECT
    (SELECT count(*)::int FROM entitlements WHERE product_id=$1 AND active) AS contratos,
    (SELECT count(*)::int FROM memberships WHERE product_id=$1 AND active) AS acessos,
    (SELECT count(*)::int FROM app_clients WHERE product_id=$1 AND active AND revoked_at IS NULL) AS chaves,
    (SELECT count(*)::int FROM commercial_contracts WHERE product_id=$1 AND status IN ('draft','active')) AS contratos_comerciais,
    (SELECT count(*)::int FROM client_engagements
      WHERE product_id=$1 AND archived_at IS NULL AND status IN ('planned','active','paused')) AS contratacoes`,
  [id]);
 return r.rows[0];
}

const ROTULOS_DEPENDENTES = {
 contratos: 'contratos de produto ativos',
 acessos: 'vínculos de acesso ativos',
 chaves: 'chaves de integração ativas',
 contratos_comerciais: 'contratos comerciais em rascunho ou ativos',
 contratacoes: 'contratações em curso',
};

function exigirSemDependentes(dependentes, acao) {
 const vivos = Object.entries(dependentes).filter(([, n]) => n > 0);
 if (!vivos.length) return;
 const lista = vivos.map(([chave, n]) => `${ROTULOS_DEPENDENTES[chave]}: ${n}`).join('; ');
 throw fail(409, `Não dá para ${acao} enquanto houver ${lista}. Encerre ou mova esses vínculos antes.`);
}

// Reclassificar não pode cortar em silêncio o que depende de uma capacidade que
// o tipo novo não tem (catalog.mjs). Só as capacidades PERDIDAS são conferidas.
const DEPENDENTES_POR_CAPACIDADE = {
 access: [
  ['contratos de produto ativos', 'SELECT count(*)::int AS n FROM entitlements WHERE product_id=$1 AND active'],
  ['vínculos de acesso ativos', 'SELECT count(*)::int AS n FROM memberships WHERE product_id=$1 AND active'],
  ['chaves de contexto ativas', "SELECT count(*)::int AS n FROM app_clients WHERE product_id=$1 AND active AND revoked_at IS NULL AND 'context:read'=ANY(scopes)"],
 ],
 checkout: [['ofertas de cobrança', 'SELECT count(*)::int AS n FROM billing_offers WHERE product_id=$1']],
 product_engagement: [
  ['contratações do tipo produto em curso', "SELECT count(*)::int AS n FROM client_engagements WHERE product_id=$1 AND service_model='product' AND archived_at IS NULL AND status IN ('planned','active','paused')"],
 ],
 commercial: [
  ['chaves comerciais ativas', "SELECT count(*)::int AS n FROM app_clients WHERE product_id=$1 AND active AND revoked_at IS NULL AND scopes && ARRAY['commercial:intake','commercial:read']::text[]"],
  ['contratações em curso', "SELECT count(*)::int AS n FROM client_engagements WHERE product_id=$1 AND archived_at IS NULL AND status IN ('planned','active','paused')"],
 ],
};

export async function dependentesDaReclassificacao(client, id, de, para) {
 const perdidas = Object.keys(CAPABILITIES).filter(c => CAPABILITIES[c].includes(de) && !CAPABILITIES[c].includes(para));
 const vivos = [];
 for (const capacidade of perdidas)
  for (const [rotulo, sql] of DEPENDENTES_POR_CAPACIDADE[capacidade] || []) {
   const n = (await client.query(sql, [id])).rows[0]?.n || 0;
   if (n > 0) vivos.push(`${rotulo}: ${n}`);
  }
 return vivos;
}

function validarItem(body) {
 const name = text(body.name, 2, 120);
 if (!PORTFOLIO_KINDS.includes(body.portfolio_kind))
  throw fail(400, 'Tipo inválido: use produto, plataforma, linha de serviço ou interno.');
 const brand = body.brand_family == null || body.brand_family === ''
  ? 'tzolkin' : String(body.brand_family).trim().toLowerCase();
 if (!FAMILIA.test(brand)) throw fail(400, 'Família inválida: letras minúsculas, números e hífen.');
 return { name, portfolio_kind: body.portfolio_kind, brand_family: brand };
}

// ---------------------------------------------------------------------------
// Contratações
// ---------------------------------------------------------------------------

async function carregarContratacao(client, id, revision) {
 if (!isUuid(id)) throw fail(400, 'Contratação inválida.');
 const atual = (await client.query(
  `SELECT ${COLUNAS_CONTRATACAO} FROM client_engagements WHERE id=$1 FOR UPDATE`, [id])).rows[0];
 if (!atual) throw fail(404, 'Contratação não encontrada.');
 if (atual.revision !== revision)
  throw fail(409, 'Esta contratação foi alterada por outra pessoa. Recarregue antes de salvar.');
 return atual;
}

/**
 * Tudo que dá para conferir sem banco vem primeiro: um tipo inválido não deve
 * custar consulta. Disponibilidade do produto só é conferida quando ele MUDA —
 * uma contratação antiga ligada a um produto que saiu do ar continua editável
 * no resto (situação, rótulo).
 */
async function validarContratacao(client, body, anterior = null) {
 if (!SERVICE_MODELS.includes(body.service_model)) throw fail(400, 'Tipo de contratação inválido.');
 if (!ENGAGEMENT_STATUS.includes(body.status)) throw fail(400, 'Situação da contratação inválida.');
 const productId = body.product_id == null || body.product_id === '' ? null : body.product_id;
 if (productId !== null && !isProductId(productId)) throw fail(400, 'Produto inválido.');
 if (body.service_model === 'product' && productId === null)
  throw fail(400, 'Contratação do tipo produto precisa indicar o produto.');
 const label = text(body.label, 2, 120);
 // Contratação de produto exige item que venda acesso; as demais, item com ciclo
 // comercial (o Core, interno, não é contratado). Também confere quando só o
 // tipo da contratação passa a ser produto.
 const passaAProduto = body.service_model === 'product' && anterior?.service_model !== 'product';
 if (productId !== null && (productId !== anterior?.product_id || passaAProduto))
  await requireProductFor(client, productId, body.service_model === 'product' ? 'product_engagement' : 'commercial',
   { missing: fail(400, 'Produto não está disponível para contratação.') });
 return { product_id: productId, service_model: body.service_model, status: body.status, label };
}

// O rótulo é único por empresa. O antigo POST fazia upsert por rótulo e
// sobrescrevia outra contratação em silêncio; aqui o conflito vira resposta.
async function gravarContratacao(consulta) {
 try { return await consulta(); }
 catch (error) {
  if (error.code === '23505') throw fail(409, 'Esta empresa já tem uma contratação com esse nome.');
  throw error;
 }
}

export function portfolioRoutes(router) {
 // --- portfólio: leitura ---------------------------------------------------
 // O overview só traz ativos e rascunhos. Gerenciar exige ver os arquivados
 // também, para poder restaurar.
 router.get('/api/portfolio', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, ['include_archived']);
  const incluirArquivados = url.searchParams.get('include_archived') === '1';
  const r = await pool.query(
   `SELECT p.id,p.name,p.portfolio_kind,p.brand_family,p.lifecycle_status,p.revision,
           p.created_at,p.updated_at,p.archived_at,p.archived_from,
           (SELECT count(*)::int FROM client_engagements e WHERE e.product_id=p.id AND e.archived_at IS NULL) AS contratacoes,
           (SELECT count(*)::int FROM entitlements x WHERE x.product_id=p.id AND x.active) AS contratos_ativos,
           EXISTS (SELECT 1 FROM delivery_projects d WHERE d.product_id=p.id) AS tem_projeto
      FROM products p
     WHERE $1 OR p.lifecycle_status <> 'archived'
     ORDER BY p.name`, [incluirArquivados]);
  return reply(200, {
   items: r.rows.map(item => ({ ...item, protected: PROTEGIDOS.has(item.id), capabilities: capabilitiesOf(item.portfolio_kind) })),
   kinds: PORTFOLIO_KINDS,
  });
 }, { body: false });

 // --- portfólio: criar -------------------------------------------------------
 router.post('/api/portfolio', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['id', 'name', 'portfolio_kind', 'brand_family']);
  if (!isProductId(body.id))
   throw fail(400, 'Identificador inválido: comece com letra e use minúsculas, números e hífen (2 a 64).');
  const campos = validarItem(body);
  // Nasce rascunho: rascunho não entra em contrato, checkout nem acesso até
  // alguém decidir ativar. Identificador repetido vira 409 em describeError.
  const r = await client.query(
   `INSERT INTO products(id,name,portfolio_kind,brand_family,lifecycle_status)
    VALUES($1,$2,$3,$4,'draft') RETURNING ${COLUNAS}`,
   [body.id, campos.name, campos.portfolio_kind, campos.brand_family]);
  await registrar(client, 'product', body.id, 'created', null, r.rows[0], operator);
  return { tenant: null, type: 'portfolio.created', body: r.rows[0] };
 }, { transactional: true, audit: false });

 // --- portfólio: editar nome, tipo e família --------------------------------
 router.put('/api/portfolio/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['name', 'portfolio_kind', 'brand_family', 'revision']);
  const campos = validarItem(body);
  const antes = await carregarItem(client, params.id, revisao(body));
  if (antes.lifecycle_status === 'archived') throw fail(409, 'Item arquivado. Restaure antes de editar.');
  if (campos.portfolio_kind !== antes.portfolio_kind) {
   const vivos = await dependentesDaReclassificacao(client, antes.id, antes.portfolio_kind, campos.portfolio_kind);
   if (vivos.length)
    throw fail(409, `Não dá para mudar o tipo enquanto houver ${vivos.join('; ')}. Encerre ou mova esses vínculos antes.`);
  }
  const r = await client.query(
   `UPDATE products SET name=$2, portfolio_kind=$3, brand_family=$4, revision=revision+1, updated_at=now()
     WHERE id=$1 RETURNING ${COLUNAS}`,
   [antes.id, campos.name, campos.portfolio_kind, campos.brand_family]);
  await registrar(client, 'product', antes.id, 'updated', antes, r.rows[0], operator);
  return { tenant: null, type: 'portfolio.updated', body: r.rows[0] };
 }, { transactional: true, audit: false });

 // --- portfólio: rascunho ⇄ ativo --------------------------------------------
 router.post('/api/portfolio/:id/lifecycle', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true, true);
  input(body, ['lifecycle_status', 'revision']);
  if (!['draft', 'active'].includes(body.lifecycle_status))
   throw fail(400, 'Estado inválido: use rascunho ou ativo.');
  const antes = await carregarItem(client, params.id, revisao(body));
  if (antes.lifecycle_status === 'archived') throw fail(409, 'Item arquivado. Restaure antes de mudar o estado.');
  if (antes.lifecycle_status === body.lifecycle_status) throw fail(409, 'O item já está nesse estado.');
  if (body.lifecycle_status === 'active') {
   const projeto = await client.query('SELECT 1 FROM delivery_projects WHERE product_id=$1 LIMIT 1', [antes.id]);
   if (projeto.rowCount)
    throw fail(409, 'Este item tem projeto técnico: ative pelo checklist do projeto, que confere oferta, checkout e deploy.');
  } else {
   if (PROTEGIDOS.has(antes.id)) throw fail(409, 'O próprio Core não pode voltar a rascunho.');
   exigirSemDependentes(await dependentesVivos(client, antes.id), 'voltar a rascunho');
  }
  const r = await client.query(
   `UPDATE products SET lifecycle_status=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING ${COLUNAS}`,
   [antes.id, body.lifecycle_status]);
  await registrar(client, 'product', antes.id,
   body.lifecycle_status === 'active' ? 'activated' : 'deactivated', antes, r.rows[0], operator);
  return { tenant: null, type: 'portfolio.lifecycle', body: r.rows[0] };
 }, { transactional: true, audit: false });

 // --- portfólio: arquivar e restaurar ----------------------------------------
 router.post('/api/portfolio/:id/archive', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true, true);
  input(body, ['revision']);
  const antes = await carregarItem(client, params.id, revisao(body));
  if (antes.lifecycle_status === 'archived') throw fail(409, 'O item já está arquivado.');
  if (PROTEGIDOS.has(antes.id)) throw fail(409, 'O próprio Core não pode ser arquivado.');
  exigirSemDependentes(await dependentesVivos(client, antes.id), 'arquivar');
  // No UPDATE, o lado direito lê a linha antiga: archived_from recebe o estado
  // de antes, e é para ele que o restaurar volta.
  const r = await client.query(
   `UPDATE products SET archived_from=lifecycle_status, lifecycle_status='archived', archived_at=now(),
           revision=revision+1, updated_at=now()
     WHERE id=$1 RETURNING ${COLUNAS}`, [antes.id]);
  await registrar(client, 'product', antes.id, 'archived', antes, r.rows[0], operator);
  return { tenant: null, type: 'portfolio.archived', body: r.rows[0] };
 }, { transactional: true, audit: false });

 router.post('/api/portfolio/:id/restore', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true, true);
  input(body, ['revision']);
  const antes = await carregarItem(client, params.id, revisao(body));
  if (antes.lifecycle_status !== 'archived') throw fail(409, 'O item não está arquivado.');
  const r = await client.query(
   `UPDATE products SET lifecycle_status=archived_from, archived_from=NULL, archived_at=NULL,
           revision=revision+1, updated_at=now()
     WHERE id=$1 RETURNING ${COLUNAS}`, [antes.id]);
  await registrar(client, 'product', antes.id, 'restored', antes, r.rows[0], operator);
  return { tenant: null, type: 'portfolio.restored', body: r.rows[0] };
 }, { transactional: true, audit: false });

 // --- contratações: criar ----------------------------------------------------
 // A listagem continua no /api/overview, que já traz todas, arquivadas inclusive.
 router.post('/api/engagements', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['tenant_id', 'product_id', 'service_model', 'status', 'label']);
  if (!isUuid(body.tenant_id)) throw fail(400, 'Empresa inválida.');
  const v = await validarContratacao(client, body);
  const r = await gravarContratacao(() => client.query(
   `INSERT INTO client_engagements(tenant_id,product_id,service_model,status,label)
    VALUES($1,$2,$3,$4,$5) RETURNING ${COLUNAS_CONTRATACAO}`,
   [body.tenant_id, v.product_id, v.service_model, v.status, v.label]));
  await registrar(client, 'engagement', r.rows[0].id, 'created', null, r.rows[0], operator);
  return { tenant: body.tenant_id, type: 'engagement.created', body: r.rows[0] };
 }, { transactional: true });

 // --- contratações: editar por id --------------------------------------------
 // A empresa não muda: levar uma contratação para outro cliente é outra
 // contratação, e o histórico da primeira precisa continuar onde estava.
 router.put('/api/engagements/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  input(body, ['product_id', 'service_model', 'status', 'label', 'revision']);
  const rev = revisao(body);
  const antes = await carregarContratacao(client, params.id, rev);
  if (antes.archived_at) throw fail(409, 'Contratação arquivada. Restaure antes de editar.');
  const v = await validarContratacao(client, body, antes);
  const r = await gravarContratacao(() => client.query(
   `UPDATE client_engagements SET product_id=$2, service_model=$3, status=$4, label=$5,
           revision=revision+1, updated_at=now()
     WHERE id=$1 RETURNING ${COLUNAS_CONTRATACAO}`,
   [antes.id, v.product_id, v.service_model, v.status, v.label]));
  await registrar(client, 'engagement', antes.id, 'updated', antes, r.rows[0], operator);
  return { tenant: antes.tenant_id, type: 'engagement.updated', body: r.rows[0] };
 }, { transactional: true });

 // --- contratações: arquivar e restaurar -------------------------------------
 // Arquivar não mexe na situação: "concluída" continua concluída, só sai das
 // listas de trabalho.
 for (const [acao, arquivar] of [['archive', true], ['restore', false]]) {
  router.post(`/api/engagements/:id/${acao}`, async ({ client, params, body, operator }) => {
   await commercialPermission(client, operator, true, true);
   input(body, ['revision']);
   const antes = await carregarContratacao(client, params.id, revisao(body));
   if (arquivar && antes.archived_at) throw fail(409, 'A contratação já está arquivada.');
   if (!arquivar && !antes.archived_at) throw fail(409, 'A contratação não está arquivada.');
   const r = await client.query(
    `UPDATE client_engagements SET archived_at=${arquivar ? 'now()' : 'NULL'}, revision=revision+1, updated_at=now()
      WHERE id=$1 RETURNING ${COLUNAS_CONTRATACAO}`, [antes.id]);
   await registrar(client, 'engagement', antes.id, arquivar ? 'archived' : 'restored', antes, r.rows[0], operator);
   return { tenant: antes.tenant_id, type: arquivar ? 'engagement.archived' : 'engagement.restored', body: r.rows[0] };
  }, { transactional: true });
 }
}

export const _internals = { PROTEGIDOS, validarItem, validarContratacao, exigirSemDependentes };
