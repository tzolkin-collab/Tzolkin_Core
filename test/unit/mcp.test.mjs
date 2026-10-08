// Model Context Protocol (MCP) Server: testes unitários do protocolo JSON-RPC 2.0, ferramentas de Acompanhamento e Diretório, e gestão de tokens Bearer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mcpRoutes, _internals } from '../../apps/api/src/modules/mcp.mjs';

const ID_EMPRESA = '11111111-1111-4000-8000-111111111111';
const ID_CONTRATO = '22222222-2222-4000-8000-222222222222';
const ID_ATIVIDADE = '33333333-3333-4000-8000-333333333333';
const ID_PESSOA = '44444444-4444-4000-8000-444444444444';
const ID_TOKEN = '55555555-5555-4000-8000-555555555555';

const OPERADOR = { subject: 'op-1', email: 'gustavo@exemplo.test' };
const corpoReq = obj => ({
 headers: { 'content-type': 'application/json' },
 async *[Symbol.asyncIterator]() {
  yield Buffer.from(JSON.stringify(obj));
 },
});

test('MCP: protocolo, ferramentas e instruções para bots', () => {
 assert.equal(_internals.MCP_PROTOCOL_VERSION, '2024-11-05');
 assert.equal(_internals.SERVER_INFO.name, 'tzolkin-core');
 assert.equal(_internals.SERVER_INFO.version, '1.0.0');

 // Instruções exigem Markdown estruturado e Brasília UTC-3
 assert.match(_internals.MCP_INSTRUCTIONS, /MARKDOWN \(\.md\) ESTRUTURADO/);
 assert.match(_internals.MCP_INSTRUCTIONS, /## /);
 assert.match(_internals.MCP_INSTRUCTIONS, /- \[ \]/);
 assert.match(_internals.MCP_INSTRUCTIONS, /Brasília/);

 // Ferramentas registradas
 const nomes = _internals.TOOLS.map(t => t.name);
 assert.deepEqual(nomes, [
  'listar_empresas',
  'buscar_empresa',
  'listar_pessoas',
  'listar_atividades',
  'obter_atividade',
  'criar_atividade',
  'editar_atividade',
  'excluir_atividade',
 ]);

 for (const f of _internals.TOOLS) {
  assert.ok(f.description, `${f.name} tem descrição`);
  assert.equal(f.inputSchema.type, 'object', `${f.name} tem schema`);
 }
});

test('MCP: normalização de fuso horário para Brasília (-03:00)', () => {
 const n = _internals.normalizarDataFuso;
 assert.equal(n('2026-10-08'), '2026-10-08T00:00:00-03:00');
 assert.equal(n('2026-10-08 14:30'), '2026-10-08T14:30:00-03:00');
 assert.equal(n('2026-10-08T14:30'), '2026-10-08T14:30:00-03:00');
 assert.equal(n('2026-10-08T14:30:00'), '2026-10-08T14:30:00-03:00');
 assert.equal(n('2026-10-08T14:30:00Z'), '2026-10-08T14:30:00Z');
 assert.equal(n('2026-10-08T14:30:00-03:00'), '2026-10-08T14:30:00-03:00');
 assert.equal(n(null), null);
});

test('MCP: herança de categoria por modelo de serviço da contratação', () => {
 const m = _internals.CATEGORIA_POR_MODELO;
 assert.equal(m.education, 'mentoria');
 assert.equal(m.consulting, 'consultoria');
 assert.equal(m.advisory, 'assessoria');
 assert.equal(m.product, 'software');
 assert.equal(m.on_demand, 'outro');
 assert.equal(m.unclassified, 'outro');
});

test('MCP: resolução de autenticação (operador, env token, mcp_token)', async () => {
 const auth = _internals.resolverAutenticacaoMcp;

 // 1. Operador logado na tela
 const comOp = await auth({ pool: {}, req: { headers: {} }, operator: OPERADOR });
 assert.deepEqual(comOp, { tipo: 'operador', ator: 'gustavo@exemplo.test' });

 // 2. Sem header e sem operador = null
 const semHeader = await auth({ pool: {}, req: { headers: {} }, env: {} });
 assert.equal(semHeader, null);

 // 3. Token fixo no .env
 const comEnv = await auth({
  pool: {},
  req: { headers: { authorization: 'Bearer spark-secreto-env-1234567890' } },
  env: { SPARK_MCP_TOKEN: 'spark-secreto-env-1234567890' },
 });
 assert.deepEqual(comEnv, { tipo: 'env', ator: 'spark-env-bot' });

 // 4. Token gravado na tabela mcp_tokens
 const tokenValido = 'mcp_live_tokenDeTesteParaBotDeAutomacao123';
 const tokenHash = createHash('sha256').update(tokenValido).digest('hex');
 let atualizouUso = false;
 const poolMock = {
  query: async (sql, params) => {
   if (sql.includes('UPDATE mcp_tokens SET last_used_at')) {
    assert.equal(params[0], tokenHash);
    atualizouUso = true;
    return { rows: [{ id: ID_TOKEN, label: 'Bot Spark Principal' }] };
   }
   return { rows: [] };
  },
 };

 const comBanco = await auth({
  pool: poolMock,
  req: { headers: { authorization: `Bearer ${tokenValido}` } },
  env: {},
 });
 assert.deepEqual(comBanco, { tipo: 'token', ator: 'Bot Spark Principal', id: ID_TOKEN });
 assert.equal(atualizouUso, true, 'atualizou last_used_at');
});

test('MCP: rotas registradas e método POST /api/mcp responde initialize, ping e tools/list', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h, opts) => rotas.set(`GET ${p}`, { h, opts }),
  post: (p, h, opts) => rotas.set(`POST ${p}`, { h, opts }),
  delete: (p, h, opts) => rotas.set(`DELETE ${p}`, { h, opts }),
 };

 mcpRoutes(router, { pool: {}, env: { SPARK_MCP_TOKEN: 'token-mcp-1234567890123' } });

 assert.ok(rotas.has('POST /api/mcp'));
 assert.ok(rotas.has('GET /api/mcp/sse'));
 assert.ok(rotas.has('GET /api/mcp/tokens'));
 assert.ok(rotas.has('POST /api/mcp/tokens'));
 assert.ok(rotas.has('DELETE /api/mcp/tokens/:id'));
 assert.ok(rotas.has('GET /api/mcp/status'));

 const rotaMcp = rotas.get('POST /api/mcp');
 assert.equal(rotaMcp.opts.webhook, true, 'isento de CSRF para bots externos');
 assert.equal(rotaMcp.opts.auth, 'public', 'valida token internamente');

 const chamarMcp = async (payload, token = 'token-mcp-1234567890123') => {
  let codigo = 0;
  let resposta = null;
  const req = {
   headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
   async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify(payload));
   },
  };
  await rotaMcp.h({
   pool: {},
   req,
   reply: (status, dados) => {
    codigo = status;
    resposta = dados;
   },
  });
  return { codigo, resposta };
 };

 // 1. initialize
 const init = await chamarMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
 assert.equal(init.codigo, 200);
 assert.equal(init.resposta.result.protocolVersion, '2024-11-05');
 assert.equal(init.resposta.result.serverInfo.name, 'tzolkin-core');
 assert.ok(init.resposta.result.instructions.includes('MARKDOWN'));

 // 2. ping
 const ping = await chamarMcp({ jsonrpc: '2.0', id: 2, method: 'ping' });
 assert.equal(ping.codigo, 200);
 assert.deepEqual(ping.resposta.result, {});

 // 3. tools/list
 const lista = await chamarMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
 assert.equal(lista.codigo, 200);
 assert.equal(lista.resposta.result.tools.length, 8);

 // 4. Método desconhecido
 const desconhecido = await chamarMcp({ jsonrpc: '2.0', id: 4, method: 'inexistente' });
 assert.equal(desconhecido.codigo, 200);
 assert.equal(desconhecido.resposta.error.code, -32601);

 // 5. Sem autenticação = 401
 await assert.rejects(chamarMcp({ jsonrpc: '2.0', id: 5, method: 'ping' }, null), e => e.status === 401);
});

test('MCP: execução de ferramentas de Diretório (listar_empresas, buscar_empresa, listar_pessoas)', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const consultas = [];
 const pool = {
  query: async (sql, params = []) => {
   consultas.push({ sql, params });
   if (sql.includes('FROM tenants t')) {
    return {
     rows: [
      {
       id: ID_EMPRESA,
       name: 'Acme Corp',
       slug: 'acme-corp',
       organization_type: 'client',
       lifecycle_status: 'active',
       relationship_kind: 'contract',
       engagements: [
        { id: ID_CONTRATO, label: 'Mentoria Executiva', service_model: 'education', category: 'mentoria', status: 'active' },
       ],
      },
     ],
    };
   }
   if (sql.includes('FROM stakeholders s')) {
    return {
     rows: [
      { id: ID_PESSOA, name: 'Carlos Silva', email: 'carlos@acme.test', role: 'Diretor', tenant_id: ID_EMPRESA, tenant_name: 'Acme Corp' },
     ],
    };
   }
   return { rows: [] };
  },
 };

 mcpRoutes(router, { pool, env: { SPARK_MCP_TOKEN: 'token-mcp-1234567890123' } });
 const rotaMcp = rotas.get('POST /api/mcp');

 const chamarFerramenta = async (name, args = {}) => {
  let saida = null;
  const req = {
   headers: { authorization: 'Bearer token-mcp-1234567890123', 'content-type': 'application/json' },
   async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name, arguments: args } }));
   },
  };
  await rotaMcp({
   pool,
   req,
   reply: (st, dados) => {
    saida = dados;
   },
  });
  return saida;
 };

 // 1. listar_empresas
 const r1 = await chamarFerramenta('listar_empresas', { busca: 'Acme' });
 assert.equal(r1.result.isError, false);
 const resEmpresas = JSON.parse(r1.result.content[0].text);
 assert.equal(resEmpresas.length, 1);
 assert.equal(resEmpresas[0].name, 'Acme Corp');
 assert.equal(resEmpresas[0].engagements[0].category, 'mentoria');

 // 2. buscar_empresa
 const r2 = await chamarFerramenta('buscar_empresa', { id: ID_EMPRESA });
 assert.equal(r2.result.isError, false);
 const resBusca = JSON.parse(r2.result.content[0].text);
 assert.equal(resBusca.name, 'Acme Corp');

 // 3. listar_pessoas
 const r3 = await chamarFerramenta('listar_pessoas', { tenant_id: ID_EMPRESA });
 assert.equal(r3.result.isError, false);
 const resPessoas = JSON.parse(r3.result.content[0].text);
 assert.equal(resPessoas.length, 1);
 assert.equal(resPessoas[0].name, 'Carlos Silva');
});

test('MCP: criação de atividades com Markdown .md estruturado, herança de categoria e auditoria', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const auditoria = [];
 const inseridos = [];

 const clientMock = {
  query: async (sql, params = []) => {
   if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
   if (sql.includes('client_engagements')) {
    return { rows: [{ tenant_id: ID_EMPRESA, service_model: 'education' }] };
   }
   if (sql.includes('INSERT INTO service_activities')) {
    const colunasMatch = sql.match(/INSERT INTO service_activities\(([^)]+)\)/);
    const colunas = colunasMatch ? colunasMatch[1].split(',') : [];
    const act = { revision: 1 };
    colunas.forEach((col, idx) => {
     act[col.trim()] = params[idx];
    });
    inseridos.push(act);
    return { rows: [act] };
   }
   if (sql.includes('INSERT INTO service_activity_audit')) {
    auditoria.push({ acao: params[1], ator: params[2], detalhes: JSON.parse(params[3]) });
    return {};
   }
   return { rows: [] };
  },
  release: () => {},
 };

 const pool = {
  connect: async () => clientMock,
  query: async (sql, params) => clientMock.query(sql, params),
 };

 mcpRoutes(router, { pool, env: { SPARK_MCP_TOKEN: 'token-mcp-1234567890123' } });
 const rotaMcp = rotas.get('POST /api/mcp');

 const criar = async args => {
  let saida = null;
  const req = {
   headers: { authorization: 'Bearer token-mcp-1234567890123', 'content-type': 'application/json' },
   async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'criar_atividade', arguments: args } }));
   },
  };
  await rotaMcp({
   pool,
   req,
   reply: (st, dados) => {
    saida = dados;
   },
  });
  return saida;
 };

 const markdownDesc = `## Pauta do Alinhamento

- [x] Validação do escopo
- [ ] Revisão de métricas

> Alinhamento crucial para entrega do marco 1.`;

 const resp = await criar({
  kind: 'sessao',
  title: 'Call de Alinhamento Semanal',
  description: markdownDesc,
  starts_at: '2026-10-09 14:00',
  ends_at: '2026-10-09 15:00',
  tenant_id: ID_EMPRESA,
  engagement_id: ID_CONTRATO, // service_model = education -> category deve virar 'mentoria'
 });

 assert.equal(resp.result.isError, false);
 const resPayload = JSON.parse(resp.result.content[0].text);
 assert.equal(resPayload.ok, true);
 assert.equal(resPayload.activity.title, 'Call de Alinhamento Semanal');
 assert.equal(resPayload.activity.category, 'mentoria', 'herdou mentoria da contratação education');
  // Gravado como JSON do Editor.js (formato que a tela de Acompanhamento le); devolvido ao bot em Markdown.
  const gravado = JSON.parse(inseridos.at(-1).description);
  assert.deepEqual(gravado.blocks.map(b => b.type), ['header', 'checklist', 'paragraph']);
  assert.equal(gravado.blocks[1].data.items[0].checked, true);
  assert.match(resPayload.activity.description, /^## Pauta do Alinhamento\n\n- \[x\] /);

 assert.equal(auditoria.length, 1);
 assert.equal(auditoria[0].acao, 'created_via_mcp');
 assert.equal(auditoria[0].detalhes.via, 'mcp');
});

test('MCP: edição e exclusão (cancelamento) de atividades', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const auditoria = [];
 const existingActivity = {
  id: ID_ATIVIDADE,
  kind: 'tarefa',
  title: 'Tarefa Original',
  status: 'planned',
  category: 'consultoria',
  revision: 1,
  starts_at: '2026-10-08T10:00:00-03:00',
  ends_at: '2026-10-08T18:00:00-03:00',
 };

 const executarQuery = async (sql, params = []) => {
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
  if (sql.includes('SELECT * FROM service_activities WHERE id = $1')) {
   return { rows: [existingActivity] };
  }
  if (sql.includes("UPDATE service_activities SET status = 'cancelled'")) {
   return {
    rows: [{ id: ID_ATIVIDADE, title: 'Tarefa Editada pelo Bot', status: 'cancelled' }],
   };
  }
  if (sql.includes('UPDATE service_activities SET')) {
   return {
    rows: [
     {
      id: ID_ATIVIDADE,
      kind: 'tarefa',
      title: 'Tarefa Editada pelo Bot',
      status: 'done',
      category: 'consultoria',
      revision: 2,
     },
    ],
   };
  }
  if (sql.includes('INSERT INTO service_activity_audit')) {
   auditoria.push({ acao: params[1], ator: params[2], detalhes: JSON.parse(params[3]) });
   return {};
  }
  return { rows: [] };
 };

 const pool = {
  connect: async () => ({ query: executarQuery, release: () => {} }),
  query: executarQuery,
 };

 mcpRoutes(router, { pool, env: { SPARK_MCP_TOKEN: 'token-mcp-1234567890123' } });
 const rotaMcp = rotas.get('POST /api/mcp');

 const chamar = async (name, args) => {
  let saida = null;
  const req = {
   headers: { authorization: 'Bearer token-mcp-1234567890123', 'content-type': 'application/json' },
   async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name, arguments: args } }));
   },
  };
  await rotaMcp({
   pool,
   req,
   reply: (st, dados) => {
    saida = dados;
   },
  });
  return saida;
 };

 // 1. editar_atividade
 const editado = await chamar('editar_atividade', {
  id: ID_ATIVIDADE,
  title: 'Tarefa Editada pelo Bot',
  status: 'done',
 });
 assert.equal(editado.result.isError, false);
 const resEdicao = JSON.parse(editado.result.content[0].text);
 assert.equal(resEdicao.activity.title, 'Tarefa Editada pelo Bot');
 assert.equal(auditoria.some(a => a.acao === 'updated_via_mcp'), true);

 // 2. excluir_atividade
 const excluido = await chamar('excluir_atividade', {
  id: ID_ATIVIDADE,
  motivo: 'Concluído por outra frente',
 });
 assert.equal(excluido.result.isError, false);
 const resExclusao = JSON.parse(excluido.result.content[0].text);
 assert.equal(resExclusao.ok, true);
 assert.equal(resExclusao.activity.status, 'cancelled');
 assert.equal(auditoria.some(a => a.acao === 'cancelled_via_mcp'), true);
});

test('MCP: gestão de tokens de bots para Configurações (gerar, listar, revogar)', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const tokensGravados = [];
 const pool = {
  query: async (sql, params = []) => {
   if (sql.includes('INSERT INTO mcp_tokens')) {
    const t = {
     id: ID_TOKEN,
     label: params[0],
     token_prefix: params[2],
     created_at: new Date().toISOString(),
    };
    tokensGravados.push(t);
    return { rows: [t] };
   }
   if (sql.includes('SELECT id, label, token_prefix')) {
    return { rows: tokensGravados };
   }
   if (sql.includes('UPDATE mcp_tokens SET revoked_at')) {
    const tok = tokensGravados.find(t => t.id === params[0]);
    if (tok) tok.revoked_at = new Date().toISOString();
    return { rows: [] };
   }
   if (sql.includes('SELECT count(*)::int AS count FROM mcp_tokens')) {
    return { rows: [{ count: tokensGravados.filter(t => !t.revoked_at).length }] };
   }
   return { rows: [] };
  },
 };

 mcpRoutes(router, { pool, env: {} });

 // 1. Gerar chave (POST /api/mcp/tokens)
 let resCriar = null;
 await rotas.get('POST /api/mcp/tokens')({
  pool,
  req: corpoReq({ label: 'Google Spark Prod' }),
  reply: (st, dados) => {
   resCriar = { st, dados };
  },
  operator: OPERADOR,
 });
 assert.equal(resCriar.st, 201);
 assert.equal(resCriar.dados.token.label, 'Google Spark Prod');
 assert.match(resCriar.dados.token.secret, /^mcp_live_[A-Za-z0-9_-]{32}/);
 assert.ok(resCriar.dados.token.secret.length > 20);

 // 2. Listar chaves (GET /api/mcp/tokens)
 let resListar = null;
 await rotas.get('GET /api/mcp/tokens')({
  pool,
  reply: (st, dados) => {
   resListar = { st, dados };
  },
  operator: OPERADOR,
 });
 assert.equal(resListar.st, 200);
 assert.equal(resListar.dados.tokens.length, 1);
 assert.ok(!('secret' in resListar.dados.tokens[0]), 'o segredo nunca é devolvido na listagem');

 // 3. Status (GET /api/mcp/status)
 let resStatus = null;
 await rotas.get('GET /api/mcp/status')({
  pool,
  reply: (st, dados) => {
   resStatus = { st, dados };
  },
  operator: OPERADOR,
 });
 assert.equal(resStatus.st, 200);
 assert.equal(resStatus.dados.tokens_ativos, 1);
 assert.equal(resStatus.dados.protocolo, '2024-11-05');
 assert.equal(resStatus.dados.ferramentas_count, 8);

 // 4. Revogar chave (DELETE /api/mcp/tokens/:id)
 let resRevogar = null;
 await rotas.get('DELETE /api/mcp/tokens/:id')({
  pool,
  params: { id: ID_TOKEN },
  reply: (st, dados) => {
   resRevogar = { st, dados };
  },
  operator: OPERADOR,
 });
 assert.equal(resRevogar.st, 200);
 assert.equal(resRevogar.dados.ok, true);

 // 5. Sem operador deve falhar com 401
 await assert.rejects(
  rotas.get('POST /api/mcp/tokens')({
   pool,
   req: corpoReq({ label: 'Hacker' }),
   reply: () => {},
   operator: null,
  }),
  e => e.status === 401
 );
});

test('MCP: OAuth 2.0 Discovery e Gestão de Clientes OAuth', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const clientesMock = [];
 const pool = {
  query: async (sql, params = []) => {
   if (sql.includes('INSERT INTO mcp_oauth_clients')) {
    const cl = {
     id: ID_TOKEN,
     client_id: params[0],
     client_secret_prefix: params[2],
     label: params[3],
     redirect_uris: params[4],
     created_at: new Date().toISOString(),
    };
    clientesMock.push(cl);
    return { rows: [cl] };
   }
   if (sql.includes('SELECT id, client_id, client_secret_prefix, label, redirect_uris')) {
    return { rows: clientesMock };
   }
   if (sql.includes('UPDATE mcp_oauth_clients SET revoked_at')) {
    const cl = clientesMock.find(c => c.id === params[0]);
    if (cl) cl.revoked_at = new Date().toISOString();
    return { rows: [] };
   }
   return { rows: [] };
  },
 };

 mcpRoutes(router, { pool, env: {} });

 // 1. Discovery (GET /api/mcp/.well-known/oauth-authorization-server)
 let resDisc = null;
 await rotas.get('GET /api/mcp/.well-known/oauth-authorization-server')({
  url: new URL('http://127.0.0.1:3102/api/mcp/.well-known/oauth-authorization-server'),
  reply: (st, dados) => { resDisc = { st, dados }; },
 });
 assert.equal(resDisc.st, 200);
 assert.equal(resDisc.dados.issuer, 'http://127.0.0.1:3102');
 assert.equal(resDisc.dados.authorization_endpoint, 'http://127.0.0.1:3102/api/mcp/oauth/authorize');
 assert.equal(resDisc.dados.token_endpoint, 'http://127.0.0.1:3102/api/mcp/oauth/token');
 assert.equal(resDisc.dados.registration_endpoint, 'http://127.0.0.1:3102/api/mcp/oauth/register');
 assert.deepEqual(resDisc.dados.grant_types_supported, ['authorization_code', 'client_credentials']);

 // 1b. Dynamic Client Registration (RFC 7591)
 let resDynReg = null;
 await rotas.get('POST /api/mcp/oauth/register')({
  pool,
  req: corpoReq({
   client_name: 'Google Spark (Automático)',
   redirect_uris: ['https://spark.google.com/oauth/cb'],
   token_endpoint_auth_method: 'client_secret_post',
  }),
  reply: (st, dados) => { resDynReg = { st, dados }; },
 });
 assert.equal(resDynReg.st, 201);
 assert.equal(resDynReg.dados.client_name, 'Google Spark (Automático)');
 assert.match(resDynReg.dados.client_id, /^mcp_client_[a-f0-9]{32}/);
 assert.match(resDynReg.dados.client_secret, /^mcp_sec_[A-Za-z0-9_-]{32}/);

 // 2. Criar Cliente OAuth (POST /api/mcp/oauth/clients)
 let resCriar = null;
 await rotas.get('POST /api/mcp/oauth/clients')({
  pool,
  req: corpoReq({ label: 'Google Spark (Gemini)', redirect_uri: 'https://spark.google.com/oauth/callback' }),
  reply: (st, dados) => { resCriar = { st, dados }; },
  operator: OPERADOR,
 });
 assert.equal(resCriar.st, 201);
 assert.equal(resCriar.dados.client.label, 'Google Spark (Gemini)');
 assert.match(resCriar.dados.client.client_id, /^mcp_client_[a-f0-9]{24}/);
 assert.match(resCriar.dados.client.client_secret, /^mcp_sec_[A-Za-z0-9_-]{32}/);

 // 3. Listar Clientes OAuth (GET /api/mcp/oauth/clients)
 let resListar = null;
 await rotas.get('GET /api/mcp/oauth/clients')({
  pool,
  reply: (st, dados) => { resListar = { st, dados }; },
  operator: OPERADOR,
 });
 assert.equal(resListar.st, 200);
 assert.equal(resListar.dados.clients.length, 2);
 assert.ok(!('client_secret' in resListar.dados.clients[0]), 'o client_secret nunca é retornado na listagem');

 // 4. Revogar Cliente OAuth (DELETE /api/mcp/oauth/clients/:id)
 let resRevogar = null;
 await rotas.get('DELETE /api/mcp/oauth/clients/:id')({
  pool,
  params: { id: ID_TOKEN },
  reply: (st, dados) => { resRevogar = { st, dados }; },
  operator: OPERADOR,
 });
 assert.equal(resRevogar.st, 200);
 assert.equal(resRevogar.dados.ok, true);
});

test('MCP: OAuth 2.0 Authorize e Token Exchange (code e client_credentials)', async () => {
 const rotas = new Map();
 const router = {
  get: (p, h) => rotas.set(`GET ${p}`, h),
  post: (p, h) => rotas.set(`POST ${p}`, h),
  delete: (p, h) => rotas.set(`DELETE ${p}`, h),
 };

 const codigosMock = new Map();
 const tokensCriados = [];
 const CLIENT_ID = 'mcp_client_test123456789012';
 const CLIENT_SECRET = 'mcp_sec_secretoValido1234567890123456789';
 const CLIENT_SECRET_HASH = createHash('sha256').update(CLIENT_SECRET).digest('hex');

 const pool = {
  query: async (sql, params = []) => {
   if (sql.includes('SELECT label FROM mcp_oauth_clients')) {
    if (params[0] === CLIENT_ID) return { rows: [{ label: 'Google Spark' }] };
    return { rows: [] };
   }
   if (sql.includes('INSERT INTO mcp_oauth_codes')) {
    const code = params[0];
    codigosMock.set(code, {
     code,
     client_id: params[1],
     redirect_uri: params[2],
     scope: params[5],
     user_actor: params[6],
     expires_at: new Date(Date.now() + 600000),
     used_at: null,
    });
    return {};
   }
   if (sql.includes('FROM mcp_oauth_codes') && sql.includes('code = $1')) {
    const c = codigosMock.get(params[0]);
    if (c && !c.used_at) return { rows: [c] };
    return { rows: [] };
   }
   if (sql.includes('UPDATE mcp_oauth_codes SET used_at = now()')) {
    const c = codigosMock.get(params[0]);
    if (c) c.used_at = new Date();
    return {};
   }
   if (sql.includes('INSERT INTO mcp_tokens')) {
    const t = { id: ID_TOKEN, label: params[0], token_hash: params[1], token_prefix: params[2], created_by: params[3] };
    tokensCriados.push(t);
    return { rows: [t] };
   }
   if (sql.includes('SELECT id, label FROM mcp_oauth_clients WHERE client_id = $1 AND client_secret_hash = $2')) {
    if (params[0] === CLIENT_ID && params[1] === CLIENT_SECRET_HASH) {
     return { rows: [{ id: ID_TOKEN, label: 'Google Spark' }] };
    }
    return { rows: [] };
   }
   return { rows: [] };
  },
 };

 mcpRoutes(router, { pool, env: {} });

 // 1. Authorize: Sem operador logado redireciona para login com return_to
 let redirectLogin = null;
 const resLoginMock = {
  writeHead: (st, headers) => { redirectLogin = { st, headers }; },
  end: () => {},
 };
 await rotas.get('GET /api/mcp/oauth/authorize')({
  pool,
  req: {},
  res: resLoginMock,
  url: new URL('http://127.0.0.1:3102/api/mcp/oauth/authorize?response_type=code&client_id=' + CLIENT_ID),
  operator: null,
 });
 assert.equal(redirectLogin.st, 302);
 assert.ok(redirectLogin.headers.Location.includes('/?auth_return_to='));

 // 2. Authorize: Com operador logado e redirect_uri faz 302 com code
 let redirectApp = null;
 const resAppMock = {
  writeHead: (st, headers) => { redirectApp = { st, headers }; },
  end: () => {},
 };
 await rotas.get('GET /api/mcp/oauth/authorize')({
  pool,
  req: {},
  res: resAppMock,
  url: new URL(`http://127.0.0.1:3102/api/mcp/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=https://spark.google.com/oauth/cb&state=xyz987`),
  operator: OPERADOR,
 });
 assert.equal(redirectApp.st, 302);
 const urlDestino = new URL(redirectApp.headers.Location);
 assert.equal(urlDestino.origin, 'https://spark.google.com');
 assert.equal(urlDestino.pathname, '/oauth/cb');
 assert.equal(urlDestino.searchParams.get('state'), 'xyz987');
 const authCode = urlDestino.searchParams.get('code');
 assert.ok(authCode.startsWith('mcp_code_'));

 // 3. Token Exchange com authorization_code
 let resTokenCode = null;
 await rotas.get('POST /api/mcp/oauth/token')({
  pool,
  req: corpoReq({
   grant_type: 'authorization_code',
   code: authCode,
   client_id: CLIENT_ID,
  }),
  reply: (st, dados) => { resTokenCode = { st, dados }; },
 });
 assert.equal(resTokenCode.st, 200);
 assert.equal(resTokenCode.dados.token_type, 'Bearer');
 assert.match(resTokenCode.dados.access_token, /^mcp_live_/);
 assert.equal(resTokenCode.dados.scope, 'mcp');

 // 4. Reutilização de código de autorização deve falhar (one-time use)
 await assert.rejects(
  rotas.get('POST /api/mcp/oauth/token')({
   pool,
   req: corpoReq({
    grant_type: 'authorization_code',
    code: authCode,
    client_id: CLIENT_ID,
   }),
   reply: () => {},
  }),
  e => e.status === 400
 );

 // 5. Token Exchange com client_credentials (JSON e via Basic Auth)
 let resClientCreds = null;
 await rotas.get('POST /api/mcp/oauth/token')({
  pool,
  req: corpoReq({
   grant_type: 'client_credentials',
   client_id: CLIENT_ID,
   client_secret: CLIENT_SECRET,
  }),
  reply: (st, dados) => { resClientCreds = { st, dados }; },
 });
 assert.equal(resClientCreds.st, 200);
 assert.equal(resClientCreds.dados.token_type, 'Bearer');
 assert.match(resClientCreds.dados.access_token, /^mcp_live_/);

 // 6. Token Exchange com client_credentials inválidas deve retornar 401
 await assert.rejects(
  rotas.get('POST /api/mcp/oauth/token')({
   pool,
   req: corpoReq({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: 'segredo_errado',
   }),
   reply: () => {},
  }),
  e => e.status === 401
 );
});

