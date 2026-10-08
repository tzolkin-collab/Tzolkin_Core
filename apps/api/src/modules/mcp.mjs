// Model Context Protocol (MCP) Server para o Tzolkin Core.
// Suporta bots e agentes externos (ex.: Google Spark, Claude, scripts) via JSON-RPC 2.0 (HTTP POST e SSE).
// Ferramentas de Acompanhamento (atividades, calls, tasks, registros) e Diretório (clientes, empresas, pessoas).
import { randomBytes, createHash } from 'node:crypto';
import { json, fail, isUuid, text } from '../platform/http.mjs';
import { digest } from '../platform/session.mjs';
import { CATEGORIES, KINDS, activityInput, activityUpdateInput, opcional, lembretes } from '../platform/tracking-model.mjs';
import { markdownParaEditorJs, editorJsParaMarkdown } from '../platform/markdown-editorjs.mjs';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = Object.freeze({ name: 'tzolkin-core', version: '1.0.0' });

const MCP_INSTRUCTIONS = `# Diretrizes para Bots e Agentes de IA Conectados ao Tzolkin Core

Você é o assistente inteligente conectado ao Tzolkin Core via Model Context Protocol (MCP).

## 1. REGRAS DE RELACIONAMENTO E CATEGORIZAÇÃO
- **Consulte antes de criar:** Antes de criar atividades, sempre execute 'listar_empresas' ou 'buscar_empresa' para localizar a empresa pelo nome e obter o 'tenant_id' e o 'engagement_id' corretos.
- **Categorização Automática:** A categoria da atividade ('mentoria', 'consultoria', 'assessoria', 'software', 'educacional', 'outro') deve ser herdada da contratação ('engagement_id') do cliente. Se a atividade for geral da empresa sem contratação específica, use a categoria mais adequada ou 'outro'.
- **Tipos de Atividades ('kind'):**
  - **'sessao'** (Call / Reunião): Alinhamentos, chamadas com clientes, reuniões e sessões. Exige 'starts_at' e 'ends_at'.
  - **'tarefa'** (Task): Tarefas a concluir, entregáveis com prazo determinado. Exige 'starts_at' e 'ends_at' (prazo).
  - **'registro'** (Registro): Apontamento de trabalho já executado ou registro em histórico.

## 2. FORMATO DE ESCRITA EM MARKDOWN (.md) ESTRUTURADO
Ao preencher o campo 'description', você DEVE formatar o texto utilizando Markdown limpo e estruturado:
- Cabeçalhos claros para separar seções (ex.: '## Pauta', '## Decisões', '## Próximos Passos').
- Listas de tarefas acionáveis com caixas de seleção ('- [ ] Ação a realizar').
- Tópicos organizados com marcadores ('- ').
- Citações ('> ') para observações críticas ou definições de alinhamento.

## 3. HORÁRIOS E FUSO
- O Core opera no fuso horário de Brasília (UTC-3). Sempre envie horários em formato ISO 8601 (ex.: '2026-10-08T14:00:00-03:00') ou 'YYYY-MM-DDTHH:mm:ss-03:00'.
`;

const TOOLS = [
 {
  name: 'listar_empresas',
  description: 'Lista clientes e empresas cadastrados no Core com suas contratações ativas. Use antes de criar uma atividade para obter o tenant_id e o engagement_id.',
  inputSchema: {
   type: 'object',
   properties: {
    busca: { type: 'string', description: 'Termo para filtrar por nome ou identificador da empresa' },
    status: { type: 'string', enum: ['active', 'lead', 'onboarding', 'paused', 'completed', 'discontinued', 'all'], description: 'Filtrar por ciclo de vida (padrão: active)' },
   },
  },
 },
 {
  name: 'buscar_empresa',
  description: 'Consulta uma empresa específica por UUID ou termo de busca, retornando contratações ativas e contatos (pessoas).',
  inputSchema: {
   type: 'object',
   properties: {
    id: { type: 'string', description: 'UUID da organização (tenant_id)' },
    termo: { type: 'string', description: 'Nome ou identificador da empresa para buscar' },
   },
  },
 },
 {
  name: 'listar_pessoas',
  description: 'Lista pessoas e contatos cadastrados, permitindo filtrar por empresa (tenant_id) ou termo de busca.',
  inputSchema: {
   type: 'object',
   properties: {
    tenant_id: { type: 'string', description: 'UUID da empresa para listar contatos associados' },
    busca: { type: 'string', description: 'Filtrar por nome ou e-mail da pessoa' },
   },
  },
 },
 {
  name: 'listar_atividades',
  description: 'Lista atividades de acompanhamento (calls, tasks e registros) em um período de datas, com filtros opcionais.',
  inputSchema: {
   type: 'object',
   properties: {
    from: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD ou ISO 8601 (padrão: 7 dias atrás)' },
    to: { type: 'string', description: 'Data final no formato YYYY-MM-DD ou ISO 8601 (padrão: 30 dias à frente)' },
    tenant_id: { type: 'string', description: 'UUID da empresa para filtrar' },
    engagement_id: { type: 'string', description: 'UUID da contratação para filtrar' },
    kind: { type: 'string', enum: ['sessao', 'tarefa', 'registro', 'entregavel', 'feature'], description: 'Tipo da atividade' },
    status: { type: 'string', enum: ['planned', 'done', 'cancelled'], description: 'Situação da atividade' },
    busca: { type: 'string', description: 'Termo para busca em título ou descrição' },
   },
  },
 },
 {
  name: 'obter_atividade',
  description: 'Obtém os detalhes completos de uma atividade de acompanhamento pelo ID (UUID).',
  inputSchema: {
   type: 'object',
   properties: {
    id: { type: 'string', description: 'UUID da atividade' },
   },
   required: ['id'],
  },
 },
 {
  name: 'criar_atividade',
  description: 'Cria uma nova atividade de acompanhamento (Call, Task ou Registro) no Core. A descrição DEVE ser escrita em Markdown (.md) estruturado.',
  inputSchema: {
   type: 'object',
   properties: {
    title: { type: 'string', description: 'Título claro da atividade (2 a 160 caracteres)' },
    kind: { type: 'string', enum: ['sessao', 'tarefa', 'registro'], description: 'Tipo: sessao (Call), tarefa (Task), registro (Registro/Apontamento)' },
    tenant_id: { type: 'string', description: 'UUID da empresa vinculada' },
    engagement_id: { type: 'string', description: 'UUID da contratação vinculada (opcional, herda a categoria)' },
    category: { type: 'string', enum: ['mentoria', 'consultoria', 'assessoria', 'software', 'educacional', 'outro'], description: 'Categoria (se omitida, herda da contratação)' },
    starts_at: { type: 'string', description: 'Data/hora de início no fuso local (ISO 8601 ou YYYY-MM-DDTHH:mm:ss-03:00)' },
    ends_at: { type: 'string', description: 'Data/hora de término/prazo no fuso local (obrigatório para sessao e tarefa)' },
    description: { type: 'string', description: 'Descrição estruturada em Markdown (.md) com tópicos, checklists e cabeçalhos' },
    location: { type: 'string', description: 'Local físico ou link da reunião' },
    reminders: { type: 'array', items: { type: 'integer' }, description: 'Antecedência de lembretes em minutos (ex: [15, 60])' },
   },
   required: ['title', 'kind', 'tenant_id', 'starts_at'],
  },
 },
 {
  name: 'editar_atividade',
  description: 'Edita uma atividade existente no Core (título, horários, tipo, status, descrição .md, local).',
  inputSchema: {
   type: 'object',
   properties: {
    id: { type: 'string', description: 'UUID da atividade a ser editada' },
    title: { type: 'string', description: 'Novo título' },
    kind: { type: 'string', enum: ['sessao', 'tarefa', 'registro'] },
    category: { type: 'string', enum: ['mentoria', 'consultoria', 'assessoria', 'software', 'educacional', 'outro'] },
    starts_at: { type: 'string', description: 'Nova data/hora de início' },
    ends_at: { type: 'string', description: 'Nova data/hora de término/prazo' },
    status: { type: 'string', enum: ['planned', 'done', 'cancelled'], description: 'Nova situação' },
    description: { type: 'string', description: 'Nova descrição estruturada em Markdown (.md)' },
    location: { type: 'string', description: 'Novo local' },
    engagement_id: { type: 'string', description: 'Novo UUID de contratação vinculada' },
   },
   required: ['id'],
  },
 },
 {
  name: 'excluir_atividade',
  description: 'Cancela ou remove uma atividade de acompanhamento pelo ID.',
  inputSchema: {
   type: 'object',
   properties: {
    id: { type: 'string', description: 'UUID da atividade' },
    motivo: { type: 'string', description: 'Motivo opcional do cancelamento' },
   },
   required: ['id'],
  },
 },
];

const normalizarDataFuso = str => {
 if (!str) return null;
 const s = String(str).trim();
 if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00-03:00`;
 if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) return `${s.replace(' ', 'T')}:00-03:00`;
 if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) return `${s.replace(' ', 'T')}-03:00`;
 return s;
};

const CATEGORIA_POR_MODELO = {
 education: 'mentoria',
 consulting: 'consultoria',
 advisory: 'assessoria',
 product: 'software',
 on_demand: 'outro',
 unclassified: 'outro',
};

// A tela de Acompanhamento (Editor.js) grava e lê `description` como JSON de blocos; o bot trabalha em Markdown.
// Na entrada o Markdown vira blocos (senão a tela mostraria "##" e "- [ ]" literais); na saída os blocos voltam a Markdown.
const descricaoParaCore = valor => {
 const t = opcional('description', valor);
 if (t === null) return null;
 try { if (Array.isArray(JSON.parse(t)?.blocks)) return t; } catch { /* Markdown comum */ }
 return markdownParaEditorJs(t);
};
const atividadeParaBot = a => (a && typeof a === 'object' && 'description' in a ? { ...a, description: editorJsParaMarkdown(a.description) } : a);

async function resolverAutenticacaoMcp({ pool, req, env = process.env, operator = null }) {
 if (operator) return { tipo: 'operador', ator: operator.email || operator.subject };

 const authHeader = req.headers['authorization'] || '';
 const bearer = authHeader.match(/^Bearer\s+([A-Za-z0-9_.-]{16,256})$/i)?.[1];
 if (!bearer) return null;

 const envToken = env.SPARK_MCP_TOKEN || env.MCP_TOKEN;
 if (envToken && bearer === envToken) {
  return { tipo: 'env', ator: 'spark-env-bot' };
 }

 try {
  const hash = digest(bearer);
  const r = await pool.query(
   `UPDATE mcp_tokens SET last_used_at = now()
    WHERE token_hash = $1 AND revoked_at IS NULL
    RETURNING id, label, created_by`,
   [hash]
  );
  if (r.rows.length) {
   const tok = r.rows[0];
   return { tipo: 'token', ator: tok.label, id: tok.id };
  }
 } catch {
  // Tabela mcp_tokens pode não existir em fixture de teste sem migração aplicada
 }

 return null;
}

export function mcpRoutes(router, { pool, clock = Date.now, env = process.env } = {}) {
 // 1. Gestão de tokens MCP para Configurações (requer sessão de operador)
 router.get('/api/mcp/tokens', async ({ pool, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  try {
   const r = await pool.query(
    'SELECT id, label, token_prefix, created_by, last_used_at, created_at, revoked_at FROM mcp_tokens ORDER BY created_at DESC LIMIT 50'
   );
   reply(200, { tokens: r.rows, disponivel: true });
  } catch {
   reply(200, { tokens: [], disponivel: false, aviso: 'Tabela mcp_tokens não encontrada. Aplique a migração 057.' });
  }
 });

 router.post('/api/mcp/tokens', async ({ pool, req, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  const b = await json(req);
  const rotulo = text(b.label || 'Bot Spark Google', 2, 100);
  const tokenRaw = 'mcp_live_' + randomBytes(24).toString('base64url');
  const tokenPrefix = tokenRaw.slice(0, 14) + '...';
  const tokenHash = digest(tokenRaw);

  const r = await pool.query(
   `INSERT INTO mcp_tokens(label, token_hash, token_prefix, created_by)
    VALUES($1, $2, $3, $4)
    RETURNING id, label, token_prefix, created_at`,
   [rotulo, tokenHash, tokenPrefix, operator.email || operator.subject]
  );

  reply(201, {
   token: {
    ...r.rows[0],
    secret: tokenRaw, // Exibido apenas na criação!
   },
   mensagem: 'Chave do bot gerada com sucesso. Guarde o segredo agora, ele não será exibido novamente.',
  });
 });

 router.delete('/api/mcp/tokens/:id', async ({ pool, params, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  await pool.query('UPDATE mcp_tokens SET revoked_at = now() WHERE id = $1', [params.id]);
  reply(200, { ok: true, mensagem: 'Chave revogada.' });
 });

 router.get('/api/mcp/status', async ({ pool, reply, operator }) => {
  let ativos = 0;
  let disponivel = false;
  try {
   const r = await pool.query('SELECT count(*)::int AS count FROM mcp_tokens WHERE revoked_at IS NULL');
   ativos = r.rows[0]?.count || 0;
   disponivel = true;
  } catch {
   disponivel = false;
  }
  const temEnv = Boolean(env.SPARK_MCP_TOKEN || env.MCP_TOKEN);
  reply(200, {
   disponivel,
   tokens_ativos: ativos + (temEnv ? 1 : 0),
   tem_env_token: temEnv,
   protocolo: MCP_PROTOCOL_VERSION,
   ferramentas_count: TOOLS.length,
  });
 });

 // 1.1 Gestão de Clientes OAuth 2.0 para Configurações (requer sessão de operador)
 router.get('/api/mcp/oauth/clients', async ({ pool, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  try {
   const r = await pool.query(
    'SELECT id, client_id, client_secret_prefix, label, redirect_uris, created_by, created_at, revoked_at FROM mcp_oauth_clients ORDER BY created_at DESC LIMIT 50'
   );
   reply(200, { clients: r.rows, disponivel: true });
  } catch {
   reply(200, { clients: [], disponivel: false, aviso: 'Tabela mcp_oauth_clients não encontrada. Aplique a migração 058.' });
  }
 });

 router.post('/api/mcp/oauth/clients', async ({ pool, req, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  const b = await json(req);
  const rotulo = text(b.label || 'Google Spark', 2, 100);
  const clientId = 'mcp_client_' + randomBytes(12).toString('hex');
  const clientSecret = 'mcp_sec_' + randomBytes(24).toString('base64url');
  const secretPrefix = clientSecret.slice(0, 14) + '...';
  const secretHash = digest(clientSecret);
  const redirectUris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(u => String(u).trim()).filter(Boolean) : (b.redirect_uri ? [String(b.redirect_uri).trim()] : []);

  const r = await pool.query(
   `INSERT INTO mcp_oauth_clients(client_id, client_secret_hash, client_secret_prefix, label, redirect_uris, created_by)
    VALUES($1, $2, $3, $4, $5, $6)
    RETURNING id, client_id, client_secret_prefix, label, redirect_uris, created_at`,
   [clientId, secretHash, secretPrefix, rotulo, redirectUris, operator.email || operator.subject]
  );

  reply(201, {
   client: {
    ...r.rows[0],
    client_secret: clientSecret, // Exibido apenas na criação!
   },
   mensagem: 'Credenciais OAuth 2.0 criadas com sucesso. Guarde o Client Secret agora.',
  });
 });

 router.delete('/api/mcp/oauth/clients/:id', async ({ pool, params, reply, operator }) => {
  if (!operator) throw fail(401, 'Entre para continuar.');
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  await pool.query('UPDATE mcp_oauth_clients SET revoked_at = now() WHERE id = $1', [params.id]);
  reply(200, { ok: true, mensagem: 'Cliente OAuth revogado.' });
 });

 // 1.2 OAuth 2.0 Discovery (RFC 8414 & OpenID Connect)
 const responderDiscovery = async ({ reply, url }) => {
  const origin = url.origin;
  reply(200, {
   issuer: origin,
   authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
   token_endpoint: `${origin}/api/mcp/oauth/token`,
   registration_endpoint: `${origin}/api/mcp/oauth/register`,
   response_types_supported: ['code'],
   grant_types_supported: ['authorization_code', 'client_credentials'],
   code_challenge_methods_supported: ['S256', 'plain'],
   token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
   scopes_supported: ['mcp', 'tracking', 'directory'],
  });
 };
 router.get('/api/mcp/.well-known/oauth-authorization-server', responderDiscovery, { webhook: true, auth: 'public' });
 router.get('/.well-known/oauth-authorization-server', responderDiscovery, { webhook: true, auth: 'public' });
 router.get('/api/mcp/.well-known/openid-configuration', responderDiscovery, { webhook: true, auth: 'public' });
 router.get('/.well-known/openid-configuration', responderDiscovery, { webhook: true, auth: 'public' });

 // 1.2b Dynamic Client Registration (RFC 7591)
 router.post(
  '/api/mcp/oauth/register',
  async ({ pool, req, reply }) => {
   let body = {};
   try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    if (rawBody.trim()) body = JSON.parse(rawBody);
   } catch {
    throw fail(400, 'JSON inválido para Dynamic Client Registration.');
   }

   const clientName = (body.client_name ? String(body.client_name).trim() : 'Google Spark').slice(0, 100);
   const clientId = 'mcp_client_' + randomBytes(16).toString('hex');
   const clientSecret = 'mcp_sec_' + randomBytes(32).toString('base64url');
   const secretPrefix = clientSecret.slice(0, 14) + '...';
   const secretHash = digest(clientSecret);
   const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.map(u => String(u).trim()).filter(Boolean)
    : (body.redirect_uri ? [String(body.redirect_uri).trim()] : []);

   try {
    await pool.query(
     `INSERT INTO mcp_oauth_clients(client_id, client_secret_hash, client_secret_prefix, label, redirect_uris, created_by)
      VALUES($1, $2, $3, $4, $5, $6)`,
     [clientId, secretHash, secretPrefix, clientName, redirectUris, 'dynamic_registration']
    );
   } catch {
    throw fail(500, 'Não foi possível registrar o cliente OAuth dinamicamente.');
   }

   const tokenAuthMethod = body.token_endpoint_auth_method || 'client_secret_post';

   reply(201, {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: tokenAuthMethod,
    scope: 'mcp tracking directory',
   });
  },
  { webhook: true, auth: 'public' }
 );

 // 1.3 OAuth 2.0 Authorize Endpoint
 router.get(
  '/api/mcp/oauth/authorize',
  async ({ pool, req, res, url, operator }) => {
   const responseType = url.searchParams.get('response_type') || 'code';
   const clientId = url.searchParams.get('client_id');
   const redirectUri = url.searchParams.get('redirect_uri');
   const state = url.searchParams.get('state');
   const codeChallenge = url.searchParams.get('code_challenge');
   const codeChallengeMethod = url.searchParams.get('code_challenge_method');
   const scope = url.searchParams.get('scope') || 'mcp';

   if (responseType !== 'code') {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erro OAuth: response_type deve ser "code".');
    return;
   }

   if (!operator) {
    res.writeHead(302, { Location: `/?auth_return_to=${encodeURIComponent(url.pathname + url.search)}` });
    res.end();
    return;
   }

   let clientNome = 'Google Spark';
   if (clientId) {
    try {
     const cr = await pool.query('SELECT label FROM mcp_oauth_clients WHERE client_id = $1 AND revoked_at IS NULL', [clientId]);
     if (cr.rows.length) clientNome = cr.rows[0].label;
    } catch {}
   }

   const code = 'mcp_code_' + randomBytes(24).toString('base64url');
   try {
    await pool.query(
     `INSERT INTO mcp_oauth_codes(code, client_id, redirect_uri, code_challenge, code_challenge_method, scope, user_actor, expires_at)
      VALUES($1, $2, $3, $4, $5, $6, $7, now() + interval '10 minutes')`,
     [code, clientId || 'default_spark', redirectUri || null, codeChallenge || null, codeChallengeMethod || null, scope, operator.email || operator.subject]
    );
   } catch {}

   if (redirectUri && redirectUri !== 'urn:ietf:wg:oauth:2.0:oob') {
    const destino = new URL(redirectUri);
    destino.searchParams.set('code', code);
    if (state) destino.searchParams.set('state', state);
    res.writeHead(302, { Location: destino.href });
    res.end();
    return;
   }

   res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
   res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Autorização Google Spark - Tzolkin Core</title>
<style>
body { font-family: system-ui, sans-serif; background: #0c0d0e; color: #f0f0f0; display: grid; place-items: center; min-height: 100vh; margin: 0; }
.card { background: #16181a; border: 1px solid #2a2e33; border-radius: 12px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
h2 { margin: 0 0 12px; font-size: 20px; }
p { color: #8c96a0; font-size: 14px; margin: 0 0 20px; line-height: 1.5; }
code { display: block; padding: 12px; background: #22262a; border-radius: 8px; color: #58a6ff; font-size: 15px; word-break: break-all; margin-bottom: 20px; }
button { background: #1f6feb; color: #fff; border: 0; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 500; cursor: pointer; }
button:hover { background: #388bfd; }
</style>
</head>
<body>
<div class="card">
 <h2>Google Spark Autorizado</h2>
 <p>O acesso ao Tzolkin Core foi autorizado para <strong>${clientNome}</strong>. Use o código abaixo no seu cliente:</p>
 <code id="code-val">${code}</code>
 <button onclick="navigator.clipboard.writeText(document.getElementById('code-val').textContent); this.textContent='Copiado!';">Copiar Código</button>
</div>
</body>
</html>`);
  },
  { webhook: true, auth: 'public' }
 );

 // 1.4 OAuth 2.0 Token Endpoint
 router.post(
  '/api/mcp/oauth/token',
  async ({ pool, req, reply }) => {
   let body = {};
   const ct = req.headers['content-type']?.split(';')[0]?.trim() || '';
   const chunks = [];
   for await (const chunk of req) chunks.push(chunk);
   const rawBody = Buffer.concat(chunks).toString('utf8');

   if (ct === 'application/json' || (rawBody.startsWith('{') && rawBody.endsWith('}'))) {
    try { body = JSON.parse(rawBody); } catch { throw fail(400, 'JSON inválido.'); }
   } else {
    const params = new URLSearchParams(rawBody);
    body = Object.fromEntries(params.entries());
   }

   const grantType = body.grant_type;
   let clientId = body.client_id;
   let clientSecret = body.client_secret;

   const authHeader = req.headers['authorization'] || '';
   if (authHeader.startsWith('Basic ')) {
    try {
     const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
     const [u, p] = decoded.split(':');
     if (u) clientId = u;
     if (p) clientSecret = p;
    } catch {}
   }

   if (grantType === 'authorization_code') {
    const code = body.code;
    if (!code) throw fail(400, 'Parâmetro code obrigatório.');

    const cr = await pool.query(
     `SELECT * FROM mcp_oauth_codes
      WHERE code = $1 AND used_at IS NULL AND expires_at > now()`,
     [code]
    );
    if (!cr.rows.length) throw fail(400, 'Código de autorização inválido ou expirado.');
    const codeRow = cr.rows[0];

    if (codeRow.code_challenge) {
     const verifier = body.code_verifier;
     if (!verifier) throw fail(400, 'code_verifier obrigatório para PKCE.');
     let valid = false;
     if (codeRow.code_challenge_method === 'S256') {
      const calculated = createHash('sha256').update(verifier).digest('base64url');
      valid = calculated === codeRow.code_challenge;
     } else {
      valid = verifier === codeRow.code_challenge;
     }
     if (!valid) throw fail(400, 'code_verifier inválido para PKCE.');
    }

    if (codeRow.client_id && clientId && codeRow.client_id !== clientId && codeRow.client_id !== 'default_spark') {
     throw fail(400, 'client_id não corresponde ao código de autorização.');
    }
    if (clientSecret && (clientId || codeRow.client_id)) {
     const secretHash = digest(clientSecret);
     const cl = await pool.query(
      'SELECT id FROM mcp_oauth_clients WHERE client_id = $1 AND client_secret_hash = $2 AND revoked_at IS NULL',
      [clientId || codeRow.client_id, secretHash]
     );
     if (!cl.rows.length) throw fail(401, 'client_secret inválido.');
    }

    await pool.query('UPDATE mcp_oauth_codes SET used_at = now() WHERE code = $1', [code]);

    const tokenRaw = 'mcp_live_' + randomBytes(24).toString('base64url');
    const tokenHash = digest(tokenRaw);
    const tokenPrefix = tokenRaw.slice(0, 14) + '...';

    await pool.query(
     `INSERT INTO mcp_tokens(label, token_hash, token_prefix, created_by)
      VALUES($1, $2, $3, $4)`,
     ['Google Spark (OAuth)', tokenHash, tokenPrefix, codeRow.user_actor || 'oauth']
    );

    reply(200, {
     access_token: tokenRaw,
     token_type: 'Bearer',
     expires_in: 2592000,
     scope: codeRow.scope || 'mcp',
    });
    return;
   }

   if (grantType === 'client_credentials') {
    if (!clientId || !clientSecret) throw fail(400, 'client_id e client_secret obrigatórios.');

    const secretHash = digest(clientSecret);
    const cl = await pool.query(
     'SELECT id, label FROM mcp_oauth_clients WHERE client_id = $1 AND client_secret_hash = $2 AND revoked_at IS NULL',
     [clientId, secretHash]
    );
    if (!cl.rows.length) throw fail(401, 'Credenciais de cliente inválidas.');

    const clientRow = cl.rows[0];
    const tokenRaw = 'mcp_live_' + randomBytes(24).toString('base64url');
    const tokenHash = digest(tokenRaw);
    const tokenPrefix = tokenRaw.slice(0, 14) + '...';

    await pool.query(
     `INSERT INTO mcp_tokens(label, token_hash, token_prefix, created_by)
      VALUES($1, $2, $3, $4)`,
     [clientRow.label + ' (OAuth)', tokenHash, tokenPrefix, 'client_credentials']
    );

    reply(200, {
     access_token: tokenRaw,
     token_type: 'Bearer',
     expires_in: 2592000,
     scope: 'mcp tracking directory',
    });
    return;
   }

   throw fail(400, `grant_type não suportado: ${grantType}`);
  },
  { webhook: true, auth: 'public' }
 );

 // 2. Execução de Ferramentas MCP
 async function executarFerramenta(nome, args, auth) {
  switch (nome) {
   case 'listar_empresas': {
    const busca = args.busca ? String(args.busca).trim().toLowerCase() : null;
    const status = args.status && args.status !== 'all' ? String(args.status).trim() : 'active';
    const params = [];
    let sql = `SELECT t.id, t.name, t.slug, t.organization_type, t.lifecycle_status, t.relationship_kind,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id', e.id, 'label', e.label, 'service_model', e.service_model,
         'category', CASE e.service_model
           WHEN 'education' THEN 'mentoria'
           WHEN 'consulting' THEN 'consultoria'
           WHEN 'advisory' THEN 'assessoria'
           WHEN 'product' THEN 'software'
           ELSE 'outro' END,
         'status', e.status
       )) FROM client_engagements e WHERE e.tenant_id = t.id AND e.archived_at IS NULL), '[]'::jsonb) AS engagements
       FROM tenants t WHERE 1=1`;

    if (status !== 'all') {
     params.push(status);
     sql += ` AND t.lifecycle_status = $${params.length}`;
    }
    if (busca) {
     params.push(`%${busca}%`);
     sql += ` AND (lower(t.name) LIKE $${params.length} OR lower(t.slug) LIKE $${params.length})`;
    }
    sql += ' ORDER BY t.name LIMIT 100';

    const r = await pool.query(sql, params);
    return r.rows;
   }

   case 'buscar_empresa': {
    const id = args.id ? String(args.id).trim() : null;
    const termo = args.termo ? String(args.termo).trim().toLowerCase() : null;
    if (!id && !termo) throw new Error('Informe id ou termo para buscar a empresa.');

    const params = [];
    let sql = `SELECT t.*,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id', e.id, 'label', e.label, 'service_model', e.service_model,
         'category', CASE e.service_model
           WHEN 'education' THEN 'mentoria'
           WHEN 'consulting' THEN 'consultoria'
           WHEN 'advisory' THEN 'assessoria'
           WHEN 'product' THEN 'software'
           ELSE 'outro' END,
         'status', e.status
       )) FROM client_engagements e WHERE e.tenant_id = t.id AND e.archived_at IS NULL), '[]'::jsonb) AS engagements,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id', s.id, 'name', s.name, 'email', s.email, 'phone', s.phone,
         'role', os.role, 'title', os.title, 'is_primary', os.is_primary
       )) FROM organization_stakeholders os JOIN stakeholders s ON s.id = os.stakeholder_id WHERE os.tenant_id = t.id), '[]'::jsonb) AS contacts
       FROM tenants t WHERE `;

    if (id && isUuid(id)) {
     params.push(id);
     sql += `t.id = $1`;
    } else if (termo) {
     params.push(`%${termo}%`);
     sql += `(lower(t.name) LIKE $1 OR lower(t.slug) LIKE $1)`;
    } else {
     throw new Error('Identificador de empresa inválido.');
    }
    sql += ' LIMIT 1';

    const r = await pool.query(sql, params);
    if (!r.rows.length) throw new Error('Empresa não encontrada.');
    return r.rows[0];
   }

   case 'listar_pessoas': {
    const tenantId = args.tenant_id && isUuid(args.tenant_id) ? args.tenant_id : null;
    const busca = args.busca ? String(args.busca).trim().toLowerCase() : null;
    const params = [];
    let sql = `SELECT s.id, s.name, s.email, s.phone, os.role, os.title, os.is_primary, os.contact_allowed,
       t.id AS tenant_id, t.name AS tenant_name
       FROM stakeholders s
       JOIN organization_stakeholders os ON os.stakeholder_id = s.id
       JOIN tenants t ON t.id = os.tenant_id WHERE 1=1`;

    if (tenantId) {
     params.push(tenantId);
     sql += ` AND os.tenant_id = $${params.length}`;
    }
    if (busca) {
     params.push(`%${busca}%`);
     sql += ` AND (lower(s.name) LIKE $${params.length} OR lower(COALESCE(s.email, '')) LIKE $${params.length})`;
    }
    sql += ' ORDER BY s.name LIMIT 100';

    const r = await pool.query(sql, params);
    return r.rows;
   }

   case 'listar_atividades': {
    const agora = new Date(clock());
    const dePadrao = new Date(agora.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const atePadrao = new Date(agora.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const fromStr = args.from ? String(args.from).slice(0, 10) : dePadrao;
    const toStr = args.to ? String(args.to).slice(0, 10) : atePadrao;

    const params = [fromStr, toStr];
    let sql = `SELECT a.id, a.tenant_id, t.name AS tenant_name, a.engagement_id, e.label AS engagement_label,
       a.category, a.kind, a.title, a.status, a.starts_at, a.ends_at, a.description, a.location, a.meeting_url, a.revision
       FROM service_activities a
       JOIN tenants t ON t.id = a.tenant_id
       LEFT JOIN client_engagements e ON e.id = a.engagement_id
       WHERE a.starts_at < ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND a.ends_at > ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND a.archived_at IS NULL`;

    if (args.tenant_id && isUuid(args.tenant_id)) {
     params.push(args.tenant_id);
     sql += ` AND a.tenant_id = $${params.length}`;
    }
    if (args.engagement_id && isUuid(args.engagement_id)) {
     params.push(args.engagement_id);
     sql += ` AND a.engagement_id = $${params.length}`;
    }
    if (args.kind && KINDS.includes(args.kind)) {
     params.push(args.kind);
     sql += ` AND a.kind = $${params.length}`;
    }
    if (args.status && ['planned', 'done', 'cancelled'].includes(args.status)) {
     params.push(args.status);
     sql += ` AND a.status = $${params.length}`;
    }
    if (args.busca) {
     params.push(`%${String(args.busca).toLowerCase()}%`);
     sql += ` AND (lower(a.title) LIKE $${params.length} OR lower(COALESCE(a.description, '')) LIKE $${params.length})`;
    }
    sql += ' ORDER BY a.starts_at LIMIT 200';

    const r = await pool.query(sql, params);
    return r.rows.map(atividadeParaBot);
   }

   case 'obter_atividade': {
    if (!args.id || !isUuid(args.id)) throw new Error('UUID da atividade inválido.');
    const r = await pool.query(
     `SELECT a.*, t.name AS tenant_name, e.label AS engagement_label, e.service_model AS engagement_service_model
      FROM service_activities a
      JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN client_engagements e ON e.id = a.engagement_id
      WHERE a.id = $1`,
     [args.id]
    );
    if (!r.rows.length) throw new Error('Atividade não encontrada.');
    const atividade = r.rows[0];
    const logs = await pool.query('SELECT * FROM service_time_logs WHERE activity_id = $1 ORDER BY worked_on DESC', [args.id]);
    const links = await pool.query('SELECT * FROM service_activity_links WHERE activity_id = $1', [args.id]).catch(() => ({ rows: [] }));
    return {
     ...atividadeParaBot(atividade),
     time_logs: logs.rows,
     links: links.rows,
    };
   }

   case 'criar_atividade': {
    const id = crypto.randomUUID();
    const tenantId = args.tenant_id;
    if (!isUuid(tenantId)) throw new Error('UUID do cliente (tenant_id) inválido.');

    const startsAt = normalizarDataFuso(args.starts_at);
    let endsAt = normalizarDataFuso(args.ends_at);
    if (!endsAt) {
     if (args.kind === 'registro') {
      endsAt = new Date(Date.parse(startsAt) + 60 * 60000).toISOString();
     } else {
      endsAt = new Date(Date.parse(startsAt) + 60 * 60000).toISOString();
     }
    }

    let engagementId = args.engagement_id && isUuid(args.engagement_id) ? args.engagement_id : null;
    let categoria = args.category;

    if (engagementId) {
     const eng = (await pool.query('SELECT tenant_id, service_model FROM client_engagements WHERE id = $1', [engagementId])).rows[0];
     if (!eng || eng.tenant_id !== tenantId) throw new Error('A contratação informada não pertence à empresa indicada.');
     if (!categoria) categoria = CATEGORIA_POR_MODELO[eng.service_model] || 'outro';
    } else {
     if (!categoria) categoria = 'outro';
    }

    const payload = activityInput({
     id,
     tenant_id: tenantId,
     engagement_id: engagementId,
     category: categoria,
     kind: args.kind,
     title: args.title,
     starts_at: startsAt,
     ends_at: endsAt,
     description: descricaoParaCore(args.description),
     location: opcional('location', args.location),
     reminders: args.reminders,
    });

    const client = await pool.connect();
    try {
     await client.query('BEGIN');
     const colunas = Object.keys(payload);
     const r = await client.query(
      `INSERT INTO service_activities(${colunas.join(',')})
       VALUES(${colunas.map((_, i) => '$' + (i + 1)).join(',')})
       RETURNING *`,
      Object.values(payload)
     );
     await client.query(
      'INSERT INTO service_activity_audit(activity_id, action, actor, details) VALUES($1, $2, $3, $4)',
      [id, 'created_via_mcp', auth.ator || 'spark-bot', JSON.stringify({ ...payload, via: 'mcp' })]
     );
     await client.query('COMMIT');
     return {
      ok: true,
      mensagem: `Atividade '${payload.title}' criada com sucesso no Acompanhamento.`,
      activity: atividadeParaBot(r.rows[0]),
     };
    } catch (e) {
     await client.query('ROLLBACK');
     throw e;
    } finally {
     client.release();
    }
   }

   case 'editar_atividade': {
    if (!args.id || !isUuid(args.id)) throw new Error('UUID da atividade inválido.');
    const existente = (await pool.query('SELECT * FROM service_activities WHERE id = $1', [args.id])).rows[0];
    if (!existente) throw new Error('Atividade não encontrada.');
     if (existente.archived_at) throw new Error('Atividade arquivada: não pode ser editada.');

    const camposParaValidar = {
     revision: existente.revision,
    };
    if (args.title !== undefined) camposParaValidar.title = args.title;
    if (args.kind !== undefined) camposParaValidar.kind = args.kind;
    if (args.category !== undefined) camposParaValidar.category = args.category;
    if (args.description !== undefined) camposParaValidar.description = descricaoParaCore(args.description);
    if (args.location !== undefined) camposParaValidar.location = opcional('location', args.location);

    if (args.starts_at !== undefined || args.ends_at !== undefined) {
     camposParaValidar.starts_at = normalizarDataFuso(args.starts_at) || new Date(existente.starts_at).toISOString();
     camposParaValidar.ends_at = normalizarDataFuso(args.ends_at) || new Date(existente.ends_at).toISOString();
    }

    const { revision, campos } = activityUpdateInput(camposParaValidar);
    if (args.status && ['planned', 'done', 'cancelled'].includes(args.status)) {
     campos.status = args.status;
    }
    if (args.engagement_id !== undefined) {
     campos.engagement_id = args.engagement_id && isUuid(args.engagement_id) ? args.engagement_id : null;
    }

    const nomes = Object.keys(campos);
    if (!nomes.length) return { ok: true, mensagem: 'Nenhum campo para alterar.', activity: atividadeParaBot(existente) };

    const client = await pool.connect();
    try {
     await client.query('BEGIN');
     const sql = `UPDATE service_activities SET ${nomes.map((n, i) => `${n}=$${i + 3}`).join(',')}, revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *`;
     const r = await client.query(sql, [args.id, revision, ...nomes.map(n => campos[n])]);
     if (!r.rows.length) throw new Error('A atividade foi alterada por outro usuário simultaneamente. Atualize os dados e tente novamente.');
     await client.query(
      'INSERT INTO service_activity_audit(activity_id, action, actor, details) VALUES($1, $2, $3, $4)',
      [args.id, 'updated_via_mcp', auth.ator || 'spark-bot', JSON.stringify({ campos, via: 'mcp' })]
     );
     await client.query('COMMIT');
     return {
      ok: true,
      mensagem: `Atividade '${r.rows[0].title}' atualizada com sucesso.`,
      activity: atividadeParaBot(r.rows[0]),
     };
    } catch (e) {
     await client.query('ROLLBACK');
     throw e;
    } finally {
     client.release();
    }
   }

   case 'excluir_atividade': {
    if (!args.id || !isUuid(args.id)) throw new Error('UUID da atividade inválido.');
    const r = await pool.query(
     "UPDATE service_activities SET status = 'cancelled', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *",
     [args.id]
    );
    if (!r.rows.length) throw new Error('Atividade não encontrada.');
    await pool.query(
     'INSERT INTO service_activity_audit(activity_id, action, actor, details) VALUES($1, $2, $3, $4)',
     [args.id, 'cancelled_via_mcp', auth.ator || 'spark-bot', JSON.stringify({ motivo: args.motivo || null, via: 'mcp' })]
    );
    return {
     ok: true,
     mensagem: `Atividade '${r.rows[0].title}' cancelada no Acompanhamento.`,
     activity: r.rows[0],
    };
   }

   default:
    throw new Error(`Ferramenta desconhecida: ${nome}`);
  }
 }

 // 3. Rota Principal JSON-RPC 2.0 (POST /api/mcp)
 async function processarMensagemRpc(msg, auth) {
  if (!msg || typeof msg !== 'object') {
   return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }

  const { id, method, params } = msg;

  try {
   switch (method) {
    case 'initialize': {
     return {
      jsonrpc: '2.0',
      id,
      result: {
       protocolVersion: MCP_PROTOCOL_VERSION,
       capabilities: {
        tools: { listChanged: false },
       },
       serverInfo: SERVER_INFO,
       instructions: MCP_INSTRUCTIONS,
      },
     };
    }

    case 'notifications/initialized': {
     return null; // Notificação não espera resposta
    }

    case 'ping': {
     return { jsonrpc: '2.0', id, result: {} };
    }

    case 'tools/list': {
     return {
      jsonrpc: '2.0',
      id,
      result: {
       tools: TOOLS,
      },
     };
    }

    case 'tools/call': {
     const nome = params?.name;
     const args = params?.arguments || {};
     if (!nome) throw new Error('Nome da ferramenta obrigatório.');

     try {
      const res = await executarFerramenta(nome, args, auth);
      return {
       jsonrpc: '2.0',
       id,
       result: {
        content: [
         {
          type: 'text',
          text: typeof res === 'string' ? res : JSON.stringify(res, null, 2),
         },
        ],
        isError: false,
       },
      };
     } catch (erro) {
      return {
       jsonrpc: '2.0',
       id,
       result: {
        content: [
         {
          type: 'text',
          text: `Erro ao executar ${nome}: ${erro.message}`,
         },
        ],
        isError: true,
       },
      };
     }
    }

    default:
     return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
     };
   }
  } catch (err) {
   return {
    jsonrpc: '2.0',
    id,
    error: { code: -32603, message: err.message || 'Internal error' },
   };
  }
 }

 router.post(
  '/api/mcp',
  async ({ pool, req, reply, operator }) => {
   const auth = await resolverAutenticacaoMcp({ pool, req, env, operator });
   if (!auth) throw fail(401, 'Autenticação MCP obrigatória. Use Authorization: Bearer <token>.');

   const body = await json(req);
   if (Array.isArray(body)) {
    const respostas = (await Promise.all(body.map(m => processarMensagemRpc(m, auth)))).filter(Boolean);
    return reply(200, respostas);
   }

   const resposta = await processarMensagemRpc(body, auth);
   if (!resposta) return reply(204, null);
   return reply(200, resposta);
  },
  { webhook: true, auth: 'public' }
 );

 // 4. Transporte SSE (Server-Sent Events) (GET /api/mcp/sse)
 router.get(
  '/api/mcp/sse',
  async ({ pool, req, res, operator }) => {
   const auth = await resolverAutenticacaoMcp({ pool, req, env, operator });
   if (!auth) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Autenticação MCP obrigatória via Bearer token.' }));
    return;
   }

   const sessionId = randomBytes(16).toString('hex');
   res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
   });

   res.write(`event: endpoint\ndata: /api/mcp?sessionId=${sessionId}\n\n`);

   const interval = setInterval(() => {
    try {
     res.write(': keepalive\n\n');
    } catch {
     clearInterval(interval);
    }
   }, 15000);

   req.on('close', () => clearInterval(interval));
  },
  { webhook: true, auth: 'public' }
 );
}

export const _internals = {
 TOOLS,
 MCP_INSTRUCTIONS,
 MCP_PROTOCOL_VERSION,
 SERVER_INFO,
 CATEGORIA_POR_MODELO,
 normalizarDataFuso,
 resolverAutenticacaoMcp,
};
