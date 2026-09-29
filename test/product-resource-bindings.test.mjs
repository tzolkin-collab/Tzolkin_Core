// Registro único de conexão, ponta a ponta no PostgreSQL: as regras que a 034
// gravou no banco, exercidas pelas rotas reais contra as restrições de verdade.
//
// Roda só no banco descartável (node scripts/test-commercial.mjs test/product-resource-bindings.test.mjs).
// A senha do operador é gerada aqui; nenhuma credencial real entra e nenhum
// provedor externo é chamado — o inventário de deploy é um stub local.
//
// O que só um banco de verdade prova, e por isso está aqui e não nos unitários:
//  · PUT pelo id de uma conexão de contratação responde 409 e NÃO 500 — o 500 era
//    o CHECK um_dono derrubando a transação;
//  · desvincular não apaga linha: a linha continua lá, desligada, e religar é a
//    MESMA linha (a UNIQUE da 022 continua valendo);
//  · o projeto de entrega nasce de um item do portfólio que JÁ EXISTE, nenhum item
//    é inventado, o índice único da 015 vira 409 em português e arquivar substituiu
//    excluir — era a exclusão que esbarrava na chave estrangeira da conexão e
//    devolvia o 23503 traduzido como "Empresa ou produto não encontrado.";
//  · a fachada legada grava no registro único e não escreve mais na tabela antiga.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCore } from '../apps/api/src/server.mjs';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';

const inventario = {
 github: { status: 'ok', items: [{ id: '12', name: 'org/repo' }] },
 vercel: { status: 'ok', items: [{ id: 'prj_1', name: 'Web', type: 'app' }] },
 easypanel: { status: 'ok', items: [{ id: 'project/db', name: 'DB', type: 'postgres' }] },
};

test('Uma conexão, um dono', async t => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 3 });
 const adminPassword = randomBytes(32).toString('base64url');
 const server = createCore({ pool, adminPassword, deployRegistry: [], deliveryOptions: { options: async () => inventario } });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const origin = `http://127.0.0.1:${server.address().port}`;
 const marca = randomUUID().slice(0, 8);
 const item = `conexao-${marca}`, projeto = `prj_${marca.replace(/-/g, '')}A`;

 const login = await fetch(origin + '/api/login', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }),
 });
 assert.equal(login.status, 200);
 const cookie = login.headers.get('set-cookie').split(';')[0];
 const get = rota => fetch(origin + rota, { headers: { cookie } });
 const enviar = metodo => (rota, body) => fetch(origin + rota, {
  method: metodo, headers: { cookie, origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
 });
 const post = enviar('POST'), put = enviar('PUT'), remover = enviar('DELETE');
 const ok = async (resposta, contexto) => { const corpo = await resposta.json(); assert.equal(resposta.status, 200, `${contexto}: ${corpo.message}`); return corpo; };
 const conexoes = async () => (await (await get(`/api/product-resource-bindings?product_id=${item}`)).json()).bindings;
 const linhaNoBanco = async externalId => (await pool.query(
  'SELECT id,product_id,engagement_id,active,revision,unbind_reason FROM product_resource_bindings WHERE external_id=$1', [externalId])).rows[0];
 const trilhaNoBanco = async externalId => (await pool.query(
  `SELECT a.action,a.reason,a.before_value,a.after_value FROM product_resource_audit a
    JOIN product_resource_bindings r ON r.id=a.binding_id WHERE r.external_id=$1 ORDER BY a.created_at,a.action`, [externalId])).rows;

 const estado = { tenant: null, contratacao: null, projetoDeEntrega: null };
 try {
  await t.test('prepara item do portfólio, empresa e contratação pelas rotas reais', async () => {
   await ok(await post('/api/portfolio', { id: item, name: `Conexões ${marca}`, portfolio_kind: 'product', brand_family: 'tzolkin' }), 'item');
   estado.tenant = (await ok(await post('/api/tenants', { name: `Conexões ${marca}`, slug: `conexoes-${marca}`, relationship_kind: 'customer' }), 'empresa')).tenant_id;
   estado.contratacao = (await ok(await post('/api/engagements', {
    tenant_id: estado.tenant, product_id: null, service_model: 'advisory', status: 'active', label: `Assessoria ${marca}`,
   }), 'contratação')).id;
  });

  await t.test('vincular exige dono, e um só; o identificador é o do provedor', async () => {
   const base = { resource_type: 'frontend', provider: 'vercel', external_id: projeto, display_name: `site ${marca}`, environment: 'production' };
   for (const [dono, status] of [
    [{}, 400], [{ product_id: item, engagement_id: estado.contratacao }, 400],
    [{ engagement_id: randomUUID() }, 404],
   ]) assert.equal((await put('/api/product-resource-bindings', { ...base, ...dono })).status, status, JSON.stringify(dono));

   const semPrefixo = await put('/api/product-resource-bindings', { ...base, product_id: item, external_id: `site-${marca}` });
   assert.equal(semPrefixo.status, 400);
   assert.match((await semPrefixo.json()).message, /prj_/);

   // Checkout e e-mail são do item que vende, nunca de uma contratação.
   assert.equal((await put('/api/product-resource-bindings', {
    resource_type: 'checkout', provider: 'stripe', external_id: `acct_${marca}`, display_name: 'Conta', engagement_id: estado.contratacao,
   })).status, 400);

   const criada = await ok(await put('/api/product-resource-bindings', { ...base, product_id: item }), 'vincular');
   assert.equal(criada.revision, 1);
   assert.equal(criada.actor_email, undefined, 'a resposta não devolve e-mail de operador');
   assert.deepEqual((await conexoes()).map(c => c.external_id), [projeto]);
  });

  await t.test('recurso já confirmado não troca de dono em silêncio nem pelo 500 do CHECK', async () => {
   const conflito = await put('/api/product-resource-bindings', {
    engagement_id: estado.contratacao, resource_type: 'frontend', provider: 'vercel',
    external_id: projeto, display_name: `site ${marca}`, environment: 'production',
   });
   assert.equal(conflito.status, 409);
   const mensagem = (await conflito.json()).message;
   assert.match(mensagem, /Reatribuir/);
   assert.doesNotMatch(mensagem, /[Rr]emova|editar o vínculo/, 'os dois conselhos antigos davam errado');

   // O caminho que devolvia 500: PUT pelo id de uma conexão de contratação.
   const daContratacao = await ok(await put('/api/product-resource-bindings', {
    engagement_id: estado.contratacao, resource_type: 'backend', provider: 'easypanel',
    external_id: `cliente-${marca}/api`, display_name: `api ${marca}`, environment: 'production',
   }), 'conexão de contratação');
   assert.equal(daContratacao.product_id, null);
   const roubo = await put('/api/product-resource-bindings', {
    id: daContratacao.id, revision: daContratacao.revision, product_id: item, resource_type: 'backend',
    provider: 'easypanel', external_id: `cliente-${marca}/api`, display_name: `api ${marca}`, environment: 'production',
   });
   assert.equal(roubo.status, 409, 'era 500: a linha ficava com dois donos e o banco derrubava a transação');
   assert.match((await roubo.json()).message, /contratação.*Reatribuir/s);
   assert.equal((await linhaNoBanco(`cliente-${marca}/api`)).engagement_id, estado.contratacao, 'a conexão da contratação continua dela');
  });

  await t.test('reatribuir troca o dono com motivo, revisão e trilha com os dois lados', async () => {
   const antes = (await conexoes()).find(c => c.external_id === projeto);
   const semMotivo = await put('/api/product-resource-bindings', {
    engagement_id: estado.contratacao, reassign: true, revision: antes.revision, resource_type: 'frontend',
    provider: 'vercel', external_id: projeto, display_name: `site ${marca}`, environment: 'production',
   });
   assert.equal(semMotivo.status, 400);

   const pedido = motivoOuRevisao => ({
    engagement_id: estado.contratacao, reassign: true, reason: 'o cliente assumiu o projeto', resource_type: 'frontend',
    provider: 'vercel', external_id: projeto, display_name: `site ${marca}`, environment: 'production', ...motivoOuRevisao,
   });
   assert.equal((await put('/api/product-resource-bindings', pedido({ revision: antes.revision + 7 }))).status, 409);
   const reatribuida = await ok(await put('/api/product-resource-bindings', pedido({ revision: antes.revision })), 'reatribuir');
   assert.equal(reatribuida.id, antes.id, 'é a mesma linha: reatribuir não cria conexão nova');
   assert.equal(reatribuida.product_id, null);
   assert.equal(reatribuida.engagement_id, estado.contratacao);
   assert.equal(reatribuida.revision, antes.revision + 1);
   assert.deepEqual(await conexoes(), [], 'o item deixou de ser dono');

   const trilha = await trilhaNoBanco(projeto);
   const reassign = trilha.find(linha => linha.action === 'reassigned');
   assert.ok(reassign, `a trilha precisa registrar a reatribuição: ${trilha.map(l => l.action)}`);
   assert.equal(reassign.before_value.product_id, item);
   assert.equal(reassign.after_value.engagement_id, estado.contratacao);
   assert.equal(reassign.reason, 'o cliente assumiu o projeto');
  });

  await t.test('desvincular é UPDATE: a linha fica, desligada, e religar reaproveita a mesma', async () => {
   const alvo = await linhaNoBanco(projeto);
   await ok(await remover(`/api/product-resource-bindings/${alvo.id}`), 'desvincular');
   const desligada = await linhaNoBanco(projeto);
   assert.ok(desligada, 'desvincular não pode apagar a linha');
   assert.equal(desligada.active, false);
   assert.ok(desligada.unbind_reason, 'desligar sem dizer por quê não é registro');
   assert.equal((await remover(`/api/product-resource-bindings/${alvo.id}`)).status, 409, 'desligar de novo não faz sentido');

   const religada = await ok(await put('/api/product-resource-bindings', {
    product_id: item, resource_type: 'frontend', provider: 'vercel', external_id: projeto,
    display_name: `site ${marca}`, environment: 'production',
   }), 'religar');
   assert.equal(religada.id, alvo.id, 'religar reaproveita a linha desligada');
   assert.equal(religada.active, true);
   assert.deepEqual((await trilhaNoBanco(projeto)).map(l => l.action).filter(a => ['deactivated', 'reactivated'].includes(a)).sort(),
    ['deactivated', 'reactivated']);
  });

  await t.test('a fachada legada grava no registro único e não escreve mais na tabela antiga', async () => {
   const projetoDaFachada = `prj_${marca.replace(/-/g, '')}C`;
   await ok(await put('/api/product-deploy-bindings', {
    provider: 'vercel', external_project_id: projetoDaFachada, external_project_name: `fachada ${marca}`,
    product_id: item, environment: 'production',
   }), 'fachada de item');
   const lista = (await (await get('/api/product-deploy-bindings')).json()).bindings;
   const pelaFachada = lista.find(b => b.external_project_id === projetoDaFachada);
   assert.deepEqual(Object.keys(pelaFachada).sort(),
    ['environment', 'external_project_id', 'external_project_name', 'product_id', 'provider', 'updated_at'],
    'as chaves da resposta não mudam: a aba aberta com o app.js antigo continua funcionando');
   assert.equal(pelaFachada.product_id, item);
   assert.ok(await linhaNoBanco(projetoDaFachada), 'o vínculo nasce no registro único');
   assert.equal((await pool.query('SELECT count(*)::int AS total FROM product_deploy_bindings WHERE external_project_id=$1',
    [projetoDaFachada])).rows[0].total, 0, 'a tabela antiga não recebe escrita nova');
   assert.ok((await trilhaNoBanco(projetoDaFachada)).some(l => l.reason?.includes('fachada')), 'a fachada deixa trilha, que a rota antiga não deixava');
  });

  // Este subteste nasceu para provar que excluir um rascunho com conexão parava de
  // devolver o 23503 traduzido. A fatia do projeto técnico com dono resolveu o
  // problema por outro caminho, e mais fundo: não há mais o que excluir. O que se
  // prova aqui agora é o caminho novo inteiro, contra as restrições de verdade —
  // o projeto nasce de um item que JÁ EXISTE, nenhum item é inventado, o índice
  // único da 015 vira 409 em português, e arquivar tira da lista sem tocar na
  // conexão nem na trilha que citam o item.
  await t.test('projeto de entrega nasce de um dono que já existe, e arquivar substitui excluir', async () => {
   const cadastro = {
    name: `Projeto ${marca}`, owner: 'Time', layout: 'single', repository_id: null,
    components: [{ id: 'web', name: 'Web', kind: 'frontend', path: '.', stack: 'nextjs', runtime: 'node', manager: 'npm', build: '', start: '', output: '', port: null, depends_on: [], bindings: [] }],
   };
   // O formato do item inventado era 'project-<uuid>'. Contar antes e depois é a
   // forma mais direta de afirmar que nenhum INSERT INTO products restou no módulo.
   const inventados = async () => (await pool.query("SELECT count(*)::int AS total FROM products WHERE id LIKE 'project-%'")).rows[0].total;
   const antes = await inventados();
   const semDono = await post('/api/delivery/projects', cadastro);
   assert.equal(semDono.status, 400);
   assert.match((await semDono.json()).message, /Portfólio/);

   const criado = await post('/api/delivery/projects', { ...cadastro, product_id: item });
   assert.equal(criado.status, 201);
   const projetoDeEntrega = (await criado.json()).project;
   estado.projetoDeEntrega = projetoDeEntrega;
   assert.equal(projetoDeEntrega.product_id, item, 'o dono é o item que já existia');
   assert.equal(projetoDeEntrega.belongs_to.kind, 'item');
   assert.equal(await inventados(), antes, 'criar projeto técnico não inventa item do portfólio');

   // Um projeto por item é índice único desde a 015; a rota diz isso em português
   // em vez de deixar sair um 23505 traduzido.
   const repetido = await post('/api/delivery/projects', { ...cadastro, product_id: item });
   assert.equal(repetido.status, 409);
   assert.match((await repetido.json()).message, /já tem projeto técnico/);

   await ok(await put('/api/product-resource-bindings', {
    product_id: item, resource_type: 'repository', provider: 'github',
    external_id: '987654', display_name: `org/projeto-${marca}`,
   }), 'conexão do item');

   // EXCLUIR VIROU ARQUIVAR: o verbo DELETE saiu da rota, e por isso a chave
   // estrangeira da conexão e da trilha nunca mais é alcançada por este caminho.
   assert.equal((await remover(`/api/delivery/projects/${projetoDeEntrega.id}`)).status, 405);
   const arquivado = await ok(await post(`/api/delivery/projects/${projetoDeEntrega.id}/archive`, { revision: projetoDeEntrega.revision }), 'arquivar');
   assert.ok(arquivado.archived_at);
   assert.ok((await pool.query('SELECT 1 FROM delivery_projects WHERE id=$1', [projetoDeEntrega.id])).rowCount, 'arquivar não apaga o projeto');
   assert.ok(await linhaNoBanco('987654'), 'a conexão do item continua inteira');
   assert.ok(!(await (await get('/api/delivery/projects')).json()).projects.some(p => p.id === projetoDeEntrega.id), 'arquivado sai da lista de trabalho');
   assert.ok((await (await get('/api/delivery/projects?include_archived=1')).json()).projects.some(p => p.id === projetoDeEntrega.id), 'e continua acessível a quem pedir');
   await ok(await post(`/api/delivery/projects/${projetoDeEntrega.id}/restore`, { revision: projetoDeEntrega.revision + 1 }), 'restaurar');
  });

  // A tela de Conexões pergunta três coisas que só o registro completo responde:
  // o que está desligado, por que foi desligado e quem mexeu. Antes dela, nenhuma
  // das três tinha resposta pela API — a conexão parqueada pela 034 só existia
  // para quem consultasse o banco.
  await t.test('a tela de Conexões enxerga o desligado, o motivo e a trilha', async () => {
   const alvo = await linhaNoBanco(projeto);
   const ativas = (await (await get('/api/product-resource-bindings')).json()).bindings;
   assert.ok(ativas.every(b => b.active), 'a listagem padrão continua só de ativas');

   await ok(await remover(`/api/product-resource-bindings/${alvo.id}`,
    { reason: 'contrato encerrado; o cliente levou o domínio', revision: (await linhaNoBanco(projeto)).revision }), 'desvincular com motivo');
   assert.equal((await linhaNoBanco(projeto)).unbind_reason, 'contrato encerrado; o cliente levou o domínio');

   const padrao = (await (await get('/api/product-resource-bindings')).json()).bindings;
   assert.ok(!padrao.some(b => b.id === alvo.id), 'a desligada não polui a listagem padrão');
   const tudo = (await (await get('/api/product-resource-bindings?state=all')).json()).bindings;
   const desligada = tudo.find(b => b.id === alvo.id);
   assert.ok(desligada, 'state=all é o que traz a conexão desligada para a tela');
   assert.equal(desligada.active, false);
   assert.equal(desligada.unbind_reason, 'contrato encerrado; o cliente levou o domínio');
   assert.ok(desligada.deactivated_at, 'a tela mostra quando foi desligada');
   for (const proibida of ['actor_subject', 'actor_email'])
    assert.ok(!(proibida in desligada), `a listagem não devolve ${proibida}`);

   const { history } = await ok(await get(`/api/product-resource-bindings/${alvo.id}/history`), 'histórico');
   assert.ok(history.length >= 2, 'a trilha da conexão tem mais de um registro');
   assert.equal(history[0].action, 'deactivated', 'o histórico vem do mais recente para o mais antigo');
   assert.equal(history[0].reason, 'contrato encerrado; o cliente levou o domínio');
   assert.ok(history[0].actor, 'quem mexeu faz parte da resposta que a tela mostra');
   const reatribuicao = history.find(l => l.action === 'reassigned');
   assert.ok(reatribuicao, 'a reatribuição precisa aparecer no histórico');
   // O dono de ANTES só sobrevive em before_value: a linha já foi atualizada, e sem
   // isto o histórico diria "reatribuída" sem dizer de quem para quem.
   assert.equal(reatribuicao.antes_product_id, item);
   assert.equal(reatribuicao.antes_de_contratacao, false);
   assert.equal(reatribuicao.depois_engagement_id, estado.contratacao);
   assert.equal((await get(`/api/product-resource-bindings/${randomUUID()}/history`)).status, 200, 'conexão sem trilha é lista vazia, não erro');
   assert.equal((await get('/api/product-resource-bindings/nao-e-uuid/history')).status, 400);
   assert.equal((await get('/api/product-resource-bindings?state=off')).status, 400, 'estado que a rota não conhece é recusado');

   // Religar pela tela: a mesma linha volta com dono, e o histórico inteiro junto.
   const religada = await ok(await put('/api/product-resource-bindings', {
    id: alvo.id, revision: desligada.revision, product_id: item, resource_type: 'frontend', provider: 'vercel',
    external_id: projeto, display_name: `site ${marca}`, environment: 'production', reason: 'voltou a ser nosso',
   }), 'religar pela tela');
   assert.equal(religada.id, alvo.id);
   assert.equal(religada.active, true);
   assert.equal(religada.unbind_reason, null, 'religar limpa o motivo do desligamento');
  });

  await t.test('desatrelar desliga em lote, com trilha por conexão', async () => {
   const antes = await conexoes();
   assert.ok(antes.length >= 1);
   await ok(await remover(`/api/products/${item}/attachments`), 'desatrelar');
   assert.deepEqual(await conexoes(), []);
   for (const conexao of antes) {
    const linha = await linhaNoBanco(conexao.external_id);
    assert.equal(linha.active, false, conexao.external_id);
    assert.ok((await trilhaNoBanco(conexao.external_id)).some(l => l.action === 'detached'), conexao.external_id);
   }
  });
 } finally {
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   // A limpeza do banco descartável é a única que apaga linha: a trilha primeiro,
   // depois a conexão, depois quem elas citam.
   const produtos = [item, estado.projetoDeEntrega?.product_id].filter(Boolean);
   await client.query('DELETE FROM product_resource_audit WHERE product_id=ANY($1::text[]) OR engagement_id=ANY($2::uuid[])',
    [produtos, [estado.contratacao].filter(Boolean)]);
   await client.query('DELETE FROM product_resource_bindings WHERE product_id=ANY($1::text[]) OR engagement_id=ANY($2::uuid[])',
    [produtos, [estado.contratacao].filter(Boolean)]);
   if (estado.projetoDeEntrega) {
    await client.query('DELETE FROM delivery_audit WHERE project_id=$1', [estado.projetoDeEntrega.id]);
    await client.query('DELETE FROM delivery_projects WHERE id=$1', [estado.projetoDeEntrega.id]);
   }
   await client.query("DELETE FROM portfolio_audit WHERE entity_id=ANY($1::text[])", [[...produtos, estado.contratacao].filter(Boolean)]);
   await client.query('DELETE FROM client_engagements WHERE tenant_id=$1', [estado.tenant]);
   await client.query('DELETE FROM audit_events WHERE tenant_id=$1', [estado.tenant]);
   await client.query('DELETE FROM products WHERE id=ANY($1::text[])', [produtos]);
   await client.query('DELETE FROM tenants WHERE id=$1', [estado.tenant]);
   await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await pool.end();
 }
});
