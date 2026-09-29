// Registro único de conexão: as regras que a migração 034 gravou no banco,
// conferidas no código que fala com ele.
//
// O que estes testes protegem, em ordem de custo de errar:
//  1. nenhuma rota do módulo apaga linha — desvincular é UPDATE (o fake recusa
//     qualquer SQL que comece com DELETE, e a fonte é lida para confirmar);
//  2. uma conexão tem um dono só, e a recusa sai em português antes do banco;
//  3. recurso já confirmado não troca de dono sem Reatribuir, revisão e motivo;
//  4. o id é o do provedor, e casar por nome só com id nominal declarado;
//  5. toda ação gravada na trilha existe no CHECK de product_resource_audit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productResourceBindingRoutes, _internals } from '../../apps/api/src/modules/product-resource-bindings.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const OUTRO_ID = '22222222-2222-4222-8222-222222222222';
const CONTRATACAO = '33333333-3333-4333-8333-333333333333';
const BOOT = { subject: 'local-bootstrap' };
const MOMENTO = new Date('2026-09-24T17:02:16.454Z');

const conexao = (extra = {}) => ({
 id: ID, product_id: 'skiller', engagement_id: null, resource_type: 'domain', provider: 'hostinger',
 external_id: 'skiller.tzolkin.cloud', external_id_kind: 'provider_id', display_name: 'skiller.tzolkin.cloud',
 environment: 'production', url: 'https://skiller.tzolkin.cloud', active: true, deactivated_at: null,
 unbind_reason: null, revision: 1, actor_subject: null, actor_email: null,
 created_at: MOMENTO, updated_at: MOMENTO, ...extra,
});

const corpo = (extra = {}) => ({
 product_id: 'skiller', resource_type: 'domain', provider: 'hostinger',
 external_id: 'skiller.tzolkin.cloud', display_name: 'skiller.tzolkin.cloud',
 environment: 'production', url: 'https://skiller.tzolkin.cloud', ...extra,
});

function rotas() {
 const handlers = {};
 productResourceBindingRoutes({
  get(path, fn) { handlers[`GET ${path}`] = fn; },
  put(path, fn) { handlers[`PUT ${path}`] = fn; },
  delete(path, fn) { handlers[`DELETE ${path}`] = fn; },
 });
 return handlers;
}

/**
 * Cliente falso roteado por trecho de SQL. Qualquer DELETE é falha do teste: é a
 * guarda de que desvincular virou UPDATE em todas as rotas, e não só na que foi
 * lembrada. `porId` responde à busca pelo id; `existente`, à busca pelo recurso.
 */
function cliente({ produto = { id: 'skiller' }, contratacao = null, porId = null, existente = null, doProduto = [], papel = null } = {}) {
 const queries = [];
 const query = async (sql, values = []) => {
  queries.push({ sql, values });
  if (/^\s*DELETE\b/i.test(sql)) assert.fail(`nenhuma rota do módulo pode emitir DELETE: ${sql}`);
  if (sql.startsWith('SELECT role FROM operator_accounts')) return { rows: papel ? [{ role: papel }] : [] };
  if (sql.startsWith('SELECT id,name FROM products')) return { rows: produto ? [produto] : [] };
  if (sql.startsWith('SELECT id,archived_at FROM client_engagements')) return { rows: contratacao ? [contratacao] : [] };
  if (sql.startsWith('SELECT * FROM product_resource_bindings WHERE product_id=$1 AND active')) return { rows: doProduto };
  if (sql.startsWith('SELECT * FROM product_resource_bindings WHERE id=$1')) return { rows: porId ? [porId] : [] };
  if (sql.startsWith('SELECT * FROM product_resource_bindings WHERE resource_type=$1')) return { rows: existente ? [existente] : [] };
  if (sql.startsWith('INSERT INTO product_resource_bindings')) return { rows: [conexao({
   product_id: values[0], engagement_id: values[1], resource_type: values[2], provider: values[3],
   external_id: values[4], external_id_kind: values[5], display_name: values[6], environment: values[7], url: values[8] })] };
  if (sql.startsWith('UPDATE product_resource_bindings') && sql.includes('active=false')) {
   const antes = porId || doProduto[0] || conexao();
   const alvo = doProduto.find(linha => linha.id === values[0]) || antes;
   return { rows: doProduto.length ? doProduto.map(linha => ({ ...linha, active: false, revision: linha.revision + 1 }))
    : [{ ...alvo, active: false, deactivated_at: new Date(), unbind_reason: values[1], revision: alvo.revision + 1 }] };
  }
  if (sql.startsWith('UPDATE product_resource_bindings')) {
   const antes = porId || existente || conexao();
   return { rows: [{ ...antes, product_id: values[1], engagement_id: values[2], resource_type: values[3], provider: values[4],
    external_id: values[5], external_id_kind: values[6], display_name: values[7], environment: values[8], url: values[9],
    active: true, deactivated_at: null, unbind_reason: null, revision: antes.revision + 1 }] };
  }
  if (sql.startsWith('INSERT INTO product_resource_audit')) return { rows: [] };
  assert.fail(`SQL inesperado: ${sql}`);
 };
 return { queries, query, trilha: () => queries.filter(q => q.sql.startsWith('INSERT INTO product_resource_audit')) };
}

const trilhaDe = client => client.trilha().map(q => ({
 binding_id: q.values[0], product_id: q.values[1], engagement_id: q.values[2], action: q.values[3],
 actor: q.values[4], reason: q.values[7], antes: q.values[8], depois: q.values[9],
}));

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------

const listar = async consulta => {
 let sql, values, saida;
 await rotas()['GET /api/product-resource-bindings']({
  pool: { query: async (...args) => { [sql, values] = args; return { rows: [conexao()] }; } },
  url: { searchParams: new URLSearchParams(consulta) },
  reply: (status, body) => { saida = { status, body }; },
 });
 return { sql, values, saida };
};

test('a listagem só devolve conexão ativa, com recorte opcional por item', async () => {
 for (const [consulta, esperado] of [['product_id=skiller', ['skiller']], ['', []]]) {
  const { sql, values, saida } = await listar(consulta);
  assert.match(sql, /WHERE active/, 'conexão desligada guarda o último dono para a trilha, não para a tela');
  assert.deepEqual(values, esperado);
  assert.deepEqual(saida, { status: 200, body: { bindings: [conexao()] } });
 }
});

// Enquanto a tela de Conexões não existia, a linha parqueada pela 034 (desligada e
// sem dono) só era visível consultando o banco. state=all é o que a traz para a
// tela — e continua sendo escolha explícita de quem chama, não o padrão.
test('state=all mostra o desligado; qualquer outro estado é recusado', async () => {
 const tudo = await listar('state=all');
 assert.doesNotMatch(tudo.sql, /WHERE active/, 'state=all não pode filtrar por ativo');
 assert.match(tudo.sql, /ORDER BY active DESC/, 'o que vive aparece antes do que foi desligado');

 const recorte = await listar('product_id=skiller&state=all');
 assert.match(recorte.sql, /WHERE product_id=\$1/);
 assert.deepEqual(recorte.values, ['skiller']);

 for (const consulta of ['state=inactive', 'state=off', 'state=ALL'])
  await assert.rejects(() => listar(consulta), e => e.status === 400 && /Estado inválido/.test(e.message), consulta);
 await assert.rejects(() => listar('engagement_id=x'), e => e.status === 400, 'parâmetro que a rota não conhece é recusado');
});

// A tela mostra "desligada em 24/09 porque…". Sem estas duas colunas na listagem,
// ela teria de pedir o histórico de cada linha só para saber o que houve.
test('a listagem devolve o estado por extenso e não devolve e-mail de operador', async () => {
 const { saida } = await listar('state=all');
 const [linha] = saida.body.bindings;
 for (const coluna of ['active', 'deactivated_at', 'unbind_reason', 'revision']) assert.ok(coluna in linha, coluna);
 const colunas = readFileSync(new URL('../../apps/api/src/modules/product-resource-bindings.mjs', import.meta.url), 'utf8')
  .match(/const COLUNAS = `([^`]+)`/)[1];
 for (const proibida of ['actor_subject', 'actor_email']) assert.ok(!colunas.includes(proibida), proibida);
});

// ---------------------------------------------------------------------------
// Um dono, e só um
// ---------------------------------------------------------------------------

test('dono XOR: com os dois donos ou sem nenhum, a recusa vem antes do banco', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const semBanco = { query: async () => assert.fail('o banco não deveria ser consultado') };
 for (const dono of [{ engagement_id: CONTRATACAO }, { product_id: null }, { product_id: '', engagement_id: '' }])
  await assert.rejects(() => handler({ client: semBanco, body: corpo(dono), operator: BOOT }),
   e => e.status === 400 && /um dono só/.test(e.message), JSON.stringify(dono));
});

test('contratação: inexistente é 404, arquivada é 409, e nenhuma das duas escreve', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const pedido = corpo({ product_id: null, engagement_id: CONTRATACAO, resource_type: 'frontend', provider: 'vercel',
  external_id: 'prj_abc123', display_name: 'site do cliente', url: null });

 const semContratacao = cliente({ contratacao: null });
 await assert.rejects(() => handler({ client: semContratacao, body: pedido, operator: BOOT }), e => e.status === 404);
 const arquivada = cliente({ contratacao: { id: CONTRATACAO, archived_at: new Date() } });
 await assert.rejects(() => handler({ client: arquivada, body: pedido, operator: BOOT }),
  e => e.status === 409 && /arquivada/i.test(e.message));
 for (const client of [semContratacao, arquivada])
  assert.ok(!client.queries.some(q => /^(INSERT|UPDATE)/.test(q.sql)), 'recusa não pode gravar');
});

test('checkout e e-mail não são infraestrutura de contratação', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const semBanco = { query: async () => assert.fail('o banco não deveria ser consultado') };
 for (const tipo of ['checkout', 'email'])
  await assert.rejects(() => handler({ client: semBanco, operator: BOOT, body: corpo({
   product_id: null, engagement_id: CONTRATACAO, resource_type: tipo, provider: 'stripe',
   external_id: 'acct_1', display_name: 'Conta', url: null }) }), e => e.status === 400, tipo);
});

// ---------------------------------------------------------------------------
// Vincular, religar, editar
// ---------------------------------------------------------------------------

test('vincular um recurso novo insere e grava trilha created com o ator', async () => {
 const client = cliente();
 const saida = await rotas()['PUT /api/product-resource-bindings']({
  client, body: corpo(), operator: { email: 'ops@tzolkin.test', subject: 'google:ops' } });
 assert.equal(saida.type, 'product.resource.created');
 const [linha] = trilhaDe(client);
 assert.deepEqual([linha.action, linha.actor, linha.product_id, linha.antes], ['created', 'ops@tzolkin.test', 'skiller', null]);
 assert.equal(saida.body.actor_email, undefined, 'a resposta não devolve e-mail de operador');
 assert.equal(saida.body.revision, 1);
});

test('vincular um recurso desligado religa a mesma linha, com trilha reactivated', async () => {
 const desligada = conexao({ active: false, deactivated_at: new Date(), unbind_reason: 'proposta comercial', product_id: null });
 const client = cliente({ existente: desligada });
 const saida = await rotas()['PUT /api/product-resource-bindings']({ client, body: corpo(), operator: BOOT });
 assert.equal(saida.type, 'product.resource.reactivated');
 const update = client.queries.find(q => q.sql.startsWith('UPDATE product_resource_bindings'));
 assert.match(update.sql, /active=true,deactivated_at=NULL,unbind_reason=NULL/);
 assert.equal(update.values[0], ID, 'religar reaproveita a linha, não cria outra');
 assert.equal(trilhaDe(client)[0].action, 'reactivated');
});

test('editar por id exige a revisão lida e recusa a desatualizada', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const atual = conexao({ revision: 4 });
 await assert.rejects(() => handler({ client: cliente({ porId: atual }), body: corpo({ id: ID }), operator: BOOT }),
  e => e.status === 400 && /Revisão/.test(e.message), 'sem revisão não edita');
 await assert.rejects(() => handler({ client: cliente({ porId: atual }), body: corpo({ id: ID, revision: 3 }), operator: BOOT }),
  e => e.status === 409 && /alterada por outra pessoa/.test(e.message));
 const client = cliente({ porId: atual });
 const saida = await handler({ client, body: corpo({ id: ID, revision: 4, display_name: 'outro nome' }), operator: BOOT });
 assert.equal(saida.type, 'product.resource.updated');
 assert.equal(saida.body.revision, 5);
});

test('vincular um recurso novo não aceita revisão: não há versão anterior a comparar', async () => {
 await assert.rejects(() => rotas()['PUT /api/product-resource-bindings']({
  client: { query: async () => assert.fail('o banco não deveria ser consultado') },
  body: corpo({ revision: 1 }), operator: BOOT }), e => e.status === 400 && /Revisão/.test(e.message));
});

// ---------------------------------------------------------------------------
// Reatribuir
// ---------------------------------------------------------------------------

test('recurso ativo de outro dono: 409 aponta para Reatribuir, nunca para remover ou editar', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 for (const [dono, trecho] of [[{ product_id: 'educare' }, /no item educare/], [{ product_id: null, engagement_id: CONTRATACAO }, /em uma contratação/]]) {
  const client = cliente({ produto: { id: 'skiller' }, existente: conexao(dono) });
  await assert.rejects(() => handler({ client, body: corpo(), operator: BOOT }), e =>
   e.status === 409 && /Reatribuir/.test(e.message) && trecho.test(e.message) && !/[Rr]emova|editar/.test(e.message));
  assert.ok(!client.queries.some(q => /^(INSERT|UPDATE)/.test(q.sql)), 'o 409 não pode gravar');
 }
});

test('PUT pelo id de uma conexão de contratação é 409 honesto, e não o 500 do CHECK um_dono', async () => {
 const client = cliente({ porId: conexao({ product_id: null, engagement_id: CONTRATACAO, resource_type: 'frontend', provider: 'vercel', external_id: 'prj_abc123' }) });
 await assert.rejects(() => rotas()['PUT /api/product-resource-bindings']({
  client, operator: BOOT,
  body: corpo({ id: ID, revision: 1, resource_type: 'frontend', provider: 'vercel', external_id: 'prj_abc123', display_name: 'site', url: null }),
 }), e => e.status === 409 && /contratação/.test(e.message) && /Reatribuir/.test(e.message));
 assert.ok(!client.queries.some(q => q.sql.startsWith('UPDATE')), 'nada de UPDATE que viole o CHECK');
});

test('reatribuir exige motivo e revisão certa, e a trilha guarda os dois donos', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const daContratacao = conexao({ product_id: null, engagement_id: CONTRATACAO, revision: 2 });
 const pedido = corpo({ reassign: true, revision: 2, reason: 'o cliente assumiu o projeto' });

 await assert.rejects(() => handler({ client: cliente({ existente: daContratacao }), operator: BOOT, body: { ...pedido, reason: undefined } }),
  e => e.status === 400 && /por que/.test(e.message));
 await assert.rejects(() => handler({ client: cliente({ existente: daContratacao }), operator: BOOT, body: { ...pedido, revision: 1 } }),
  e => e.status === 409 && /alterada por outra pessoa/.test(e.message));

 const client = cliente({ existente: daContratacao });
 const saida = await handler({ client, body: pedido, operator: BOOT });
 assert.equal(saida.type, 'product.resource.reassigned');
 const [linha] = trilhaDe(client);
 assert.deepEqual([linha.action, linha.product_id, linha.engagement_id, linha.reason],
  ['reassigned', 'skiller', null, 'o cliente assumiu o projeto']);
 assert.equal(linha.antes.engagement_id, CONTRATACAO, 'o dono anterior fica no before_value');
 assert.equal(linha.depois.product_id, 'skiller', 'o dono novo fica no after_value');
});

// ---------------------------------------------------------------------------
// Disciplina do identificador
// ---------------------------------------------------------------------------

test('o identificador é o do provedor; o id nominal precisa ser declarado', async () => {
 const handler = rotas()['PUT /api/product-resource-bindings'];
 const deploy = extra => corpo({ resource_type: 'frontend', url: null, ...extra });
 const recusados = [
  [deploy({ provider: 'vercel', external_id: 'site-do-cliente', display_name: 'outro nome' }), /prj_/],
  [deploy({ provider: 'easypanel', resource_type: 'backend', external_id: 'so-o-servico', display_name: 'outro nome' }), /projeto\/serviço/],
  [corpo({ provider: 'github', resource_type: 'repository', external_id: 'tzolkin/core', display_name: 'outro nome', url: null }), /número/],
 ];
 for (const [body, trecho] of recusados)
  await assert.rejects(() => handler({ client: cliente(), body, operator: BOOT }),
   e => e.status === 400 && trecho.test(e.message), JSON.stringify(body.provider));

 const aceitos = [
  deploy({ provider: 'vercel', external_id: 'prj_uxe3ctzAKcIM1avrqWRSRJW6VOyx', display_name: 'site' }),
  deploy({ provider: 'easypanel', resource_type: 'backend', external_id: 'tzolkin/api', display_name: 'tzolkin / api' }),
  corpo({ provider: 'github', resource_type: 'repository', external_id: '123456', display_name: 'tzolkin/core', url: null }),
  // Escape do id nominal: o repositório que a Vercel sugere vem sem id do GitHub,
  // e id igual ao nome é o sinal de que o provedor não deu id (034).
  corpo({ provider: 'github', resource_type: 'repository', external_id: 'tzolkin/core', display_name: 'tzolkin/core', url: null }),
  corpo({ provider: 'github', resource_type: 'repository', external_id: 'tzolkin/core', display_name: 'outro nome', external_id_kind: 'name', url: null }),
 ];
 for (const body of aceitos) {
  const client = cliente();
  await handler({ client, body, operator: BOOT });
  assert.ok(client.queries.some(q => q.sql.startsWith('INSERT INTO product_resource_bindings')), JSON.stringify(body));
 }
 const nominal = cliente();
 await handler({ client: nominal, body: aceitos[3], operator: BOOT });
 assert.equal(nominal.queries.find(q => q.sql.startsWith('INSERT INTO product_resource_bindings')).values[5], 'name');
});

test('recusa URL sem HTTPS', async () => {
 await assert.rejects(() => rotas()['PUT /api/product-resource-bindings']({
  client: cliente(), body: corpo({ url: 'http://skiller.tzolkin.cloud' }), operator: BOOT }),
  e => e.status === 400 && /HTTPS/.test(e.message));
});

// ---------------------------------------------------------------------------
// Desvincular e desatrelar
// ---------------------------------------------------------------------------

test('desvincular é UPDATE com motivo e trilha deactivated; já desligada é 409', async () => {
 const handler = rotas()['DELETE /api/product-resource-bindings/:id'];
 const client = cliente({ porId: conexao({ revision: 3 }) });
 const saida = await handler({ client, params: { id: ID }, body: {}, operator: BOOT });
 assert.equal(saida.type, 'product.resource.deactivated');
 const update = client.queries.find(q => q.sql.startsWith('UPDATE product_resource_bindings'));
 assert.match(update.sql, /active=false,deactivated_at=now\(\),unbind_reason=\$2,revision=revision\+1/);
 const [linha] = trilhaDe(client);
 assert.equal(linha.action, 'deactivated');
 assert.equal(linha.reason, update.values[1], 'o motivo da linha e o da trilha são o mesmo');
 assert.equal(linha.antes.active, true);
 assert.equal(linha.depois.active, false);

 await assert.rejects(() => handler({ client: cliente({ porId: conexao({ active: false }) }), params: { id: ID }, body: {}, operator: BOOT }),
  e => e.status === 409 && /já está desligada/.test(e.message));
 await assert.rejects(() => handler({ client: cliente(), params: { id: ID }, body: {}, operator: BOOT }), e => e.status === 404);
 await assert.rejects(() => handler({ client: cliente(), params: { id: 'nao-e-uuid' }, body: {}, operator: BOOT }), e => e.status === 400);
});

// O motivo é o que separa "desligamos porque o cliente não fechou" de uma linha
// que some da tela sem explicação. A tela de Conexões pergunta; a ficha do item e
// as fachadas legadas mandam DELETE sem corpo e ficam com a frase honesta.
test('desvincular grava o motivo que a tela mandou, e sem motivo grava a frase honesta', async () => {
 const handler = rotas()['DELETE /api/product-resource-bindings/:id'];
 const comMotivo = cliente({ porId: conexao({ revision: 3 }) });
 await handler({ client: comMotivo, params: { id: ID }, body: { reason: 'domínio devolvido ao cliente', revision: 3 }, operator: BOOT });
 const update = comMotivo.queries.find(q => q.sql.startsWith('UPDATE product_resource_bindings'));
 assert.equal(update.values[1], 'domínio devolvido ao cliente');
 assert.equal(trilhaDe(comMotivo)[0].reason, 'domínio devolvido ao cliente');

 const semMotivo = cliente({ porId: conexao({ revision: 3 }) });
 await handler({ client: semMotivo, params: { id: ID }, body: {}, operator: BOOT });
 assert.equal(semMotivo.queries.find(q => q.sql.startsWith('UPDATE product_resource_bindings')).values[1], _internals.MOTIVO_DESVINCULO);

 // Revisão velha: outra pessoa pode ter reatribuído a conexão enquanto esta tela
 // estava aberta, e desligar aqui tiraria o recurso de um dono nunca mostrado.
 await assert.rejects(() => handler({ client: cliente({ porId: conexao({ revision: 4 }) }), params: { id: ID }, body: { revision: 3 }, operator: BOOT }),
  e => e.status === 409 && /alterada por outra pessoa/.test(e.message));
 await assert.rejects(() => handler({ client: cliente({ porId: conexao() }), params: { id: ID }, body: { reason: 'x' }, operator: BOOT }),
  e => e.status === 400, 'motivo de um caractere não é motivo');
 await assert.rejects(() => handler({ client: cliente({ porId: conexao() }), params: { id: ID }, body: { motivo: 'errado' }, operator: BOOT }),
  e => e.status === 400, 'campo que a rota não conhece é recusado');
});

test('desatrelar desliga em lote e deixa uma trilha detached por conexão', async () => {
 const doProduto = [conexao(), conexao({ id: OUTRO_ID, resource_type: 'frontend', provider: 'vercel', external_id: 'prj_abc123' })];
 const client = cliente({ doProduto });
 const saida = await rotas()['DELETE /api/products/:id/attachments']({ client, params: { id: 'skiller' }, operator: BOOT });
 assert.equal(saida.detached_resources, 2);
 const trilha = trilhaDe(client);
 assert.deepEqual(trilha.map(l => l.action), ['detached', 'detached']);
 assert.deepEqual(trilha.map(l => l.binding_id).sort(), [ID, OUTRO_ID].sort());
 assert.ok(trilha.every(l => l.antes.active === true && l.depois.active === false && l.reason));
 assert.equal(client.queries.filter(q => q.sql.startsWith('UPDATE product_resource_bindings')).length, 1, 'um UPDATE em lote, não um por linha');
});

test('desatrelar item inexistente ou arquivado é 404 e não desliga nada', async () => {
 const client = cliente({ produto: null });
 await assert.rejects(() => rotas()['DELETE /api/products/:id/attachments']({ client, params: { id: 'fantasma' }, operator: BOOT }),
  e => e.status === 404);
 assert.ok(!client.queries.some(q => q.sql.startsWith('UPDATE')));
});

// ---------------------------------------------------------------------------
// Permissão
// ---------------------------------------------------------------------------

test('vincular e desvincular exigem escrita; reatribuir e desatrelar exigem owner', async () => {
 const handlers = rotas();
 const operador = { subject: 'google:2', email: 'membro@tzolkin.test' };
 const chamadas = {
  vincular: (client) => handlers['PUT /api/product-resource-bindings']({ client, body: corpo(), operator: operador }),
  desvincular: (client) => handlers['DELETE /api/product-resource-bindings/:id']({ client, params: { id: ID }, body: {}, operator: operador }),
  reatribuir: (client) => handlers['PUT /api/product-resource-bindings']({ client, body: corpo({ reassign: true, revision: 1, reason: 'mudou de dono' }), operator: operador }),
  desatrelar: (client) => handlers['DELETE /api/products/:id/attachments']({ client, params: { id: 'skiller' }, operator: operador }),
 };
 // viewer não escreve nada.
 for (const [nome, chamada] of Object.entries(chamadas))
  await assert.rejects(() => chamada(cliente({ papel: 'viewer', porId: conexao(), existente: conexao({ product_id: 'educare' }) })),
   e => e.status === 403, nome);
 // member escreve, mas não decide dono.
 for (const nome of ['reatribuir', 'desatrelar'])
  await assert.rejects(() => chamadas[nome](cliente({ papel: 'member', existente: conexao({ product_id: 'educare' }) })),
   e => e.status === 403, nome);
 for (const nome of ['vincular', 'desvincular'])
  await chamadas[nome](cliente({ papel: 'member', porId: conexao() }));
});

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

test('o histórico de uma conexão lê a trilha dela e lembra o dono de antes', async () => {
 const handler = rotas()['GET /api/product-resource-bindings/:id/history'];
 let sql, values, saida;
 const pool = { query: async (consulta, args) => {
  if (consulta.startsWith('SELECT role FROM operator_accounts')) return { rows: [{ role: 'viewer' }] };
  [sql, values] = [consulta, args];
  return { rows: [{ id: OUTRO_ID, action: 'reassigned', actor: 'quem@tzolkin.test', reason: 'virou da contratação' }] };
 } };
 await handler({ pool, params: { id: ID }, operator: { subject: 'google:9', email: 'quem@tzolkin.test' }, reply: (status, body) => { saida = { status, body }; } });
 assert.match(sql, /FROM product_resource_audit WHERE binding_id=\$1/);
 assert.match(sql, /before_value->>'product_id'/, 'o dono anterior só sobrevive em before_value');
 assert.deepEqual(values, [ID]);
 assert.equal(saida.status, 200);
 assert.equal(saida.body.history[0].action, 'reassigned');

 await assert.rejects(() => handler({ pool, params: { id: 'nao-e-uuid' }, operator: BOOT, reply: () => {} }), e => e.status === 400);
 // Ler a história de uma conexão é leitura: quem enxerga a conexão enxerga a
 // trilha dela. Um 403 aqui só produziria um botão que serve para dar erro.
 assert.ok(/commercialPermission\(pool, operator, false\)/.test(
  readFileSync(new URL('../../apps/api/src/modules/product-resource-bindings.mjs', import.meta.url), 'utf8')));
});

// ---------------------------------------------------------------------------
// Guardas de fonte
// ---------------------------------------------------------------------------

const fonte = caminho => readFileSync(caminho, 'utf8');
const MODULOS = [
 'apps/api/src/modules/product-resource-bindings.mjs',
 'apps/api/src/modules/product-deploy-bindings.mjs',
 'apps/api/src/modules/service-deploy-bindings.mjs',
];

// Desvincular é UPDATE, nunca DELETE: é o que deixa a linha desligada guardar o
// último dono e o que faz religar reaproveitar a linha. Um DELETE que voltasse
// aqui passaria despercebido em todo teste que não fosse este.
test('nenhuma rota destes módulos emite SQL que comece com DELETE', () => {
 for (const caminho of MODULOS)
  for (const sql of fonte(caminho).match(/(?<=['"`])\s*(DELETE|UPDATE|INSERT|SELECT)\b[^'"`]*/gi) || [])
   assert.doesNotMatch(sql, /^\s*DELETE\b/i, `${caminho}: ${sql.slice(0, 80)}`);
});

// As fachadas existem para a tela antiga continuar funcionando, não para continuar
// gravando onde ninguém mais lê.
test('nenhum módulo de conexão escreve nas tabelas antigas', () => {
 for (const caminho of MODULOS) {
  const texto = fonte(caminho);
  for (const tabela of ['product_deploy_bindings', 'service_deploy_bindings'])
   assert.doesNotMatch(texto, new RegExp(`(INSERT INTO|UPDATE|DELETE FROM)\\s+${tabela}`), `${caminho}: ${tabela}`);
 }
});

// O CHECK recusa qualquer outra ação e derruba a transação inteira: foi assim que
// 'detached' deixou "Desatrelar conexões" quebrado sem ninguém perceber.
test('toda ação de auditoria do módulo existe no CHECK do banco', () => {
 const aceitas = new Set(fonte('db/schema.sql').match(/action text NOT NULL CHECK\(action IN \(([^)]+)\)\)/g)
  .flatMap(trecho => trecho.match(/'[a-z_]+'/g)).map(valor => valor.slice(1, -1)));
 assert.ok(_internals.ACOES.length >= 6, `o módulo precisa continuar gravando trilha: ${_internals.ACOES}`);
 for (const acao of _internals.ACOES) assert.ok(aceitas.has(acao), `ação "${acao}" não é aceita pelo CHECK: ${[...aceitas]}`);
 // A lista não pode ser decorativa: toda ação gravada no módulo sai dela.
 const gravadas = [...fonte(MODULOS[0]).matchAll(/'(created|updated|reactivated|reassigned|deactivated|detached)'/g)].map(m => m[1]);
 for (const acao of new Set(gravadas)) assert.ok(_internals.ACOES.includes(acao), acao);
 assert.equal(new Set(gravadas).size, _internals.ACOES.length, 'ação declarada e nunca gravada, ou o contrário');
});
