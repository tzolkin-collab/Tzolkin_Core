// Visibilidade de deploys — leitura, um adaptador por provedor.
//
// Mesma forma proposta para pagamentos em docs/decisions/0003: o domínio fala
// "deploy", o adaptador traduz para o vocabulário do provedor. Nenhum disparo.
//
// Falha de provedor NÃO derruba o painel: vira status do provedor na resposta.
// Provedor não configurado NÃO é erro: é estado vazio honesto.
import { onlyParams } from '../platform/http.mjs';
import { createVercelAdapter } from '../integrations/vercel.mjs';

const CACHE_MS = 30000;

// Lê a configuração do ambiente. Sem token, o provedor simplesmente não existe —
// nada de chave vazia mandada ao provedor para "ver o que acontece".
export function buildRegistry(env = process.env, { fetchImpl } = {}) {
 const providers = [];
 if (env.VERCEL_TOKEN) {
  providers.push({
   name: 'vercel',
   adapter: createVercelAdapter({
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_TEAM_ID || null,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(env.VERCEL_API_BASE ? { baseUrl: env.VERCEL_API_BASE } : {}),
   }),
  });
 }
 return providers;
}

const MAX_PROJETOS = 24;
const DEPLOYS_POR_PROJETO = 4;

// Um provedor por vez, isolado: se cair, os outros seguem.
// Primeiro os projetos, depois os deploys de cada um — assim projeto parado
// há meses aparece como "sem deploy recente" em vez de sumir da tela.
async function consultarProvedor({ name, adapter }) {
 const todos = await adapter.listProjects();
 const projetos = todos.slice(0, MAX_PROJETOS);
 // Teto explícito: se cortou, o painel diz. Corte silencioso lê como "é tudo".
 const truncated = todos.length > projetos.length ? todos.length - projetos.length : 0;

 const resultados = await Promise.all(projetos.map(async projeto => {
  try {
   const deployments = await adapter.listDeployments({
    projectId: projeto.id, projectName: projeto.name, limit: DEPLOYS_POR_PROJETO,
   });
   return { provider: name, project_id: projeto.id, project: projeto.name, git_connected: projeto.git_connected, deployments };
  } catch {
   // Falha em um projeto não derruba os demais; o projeto aparece sem deploys.
   return { provider: name, project_id: projeto.id, project: projeto.name, git_connected: projeto.git_connected, deployments: [], partial: true };
  }
 }));

 const comAlgo = resultados.filter(p => p.deployments.length || p.partial);
 const ordenados = [...resultados].sort((a, b) =>
  (b.deployments[0]?.created_at || '').localeCompare(a.deployments[0]?.created_at || ''));
 return {
  provider: name, status: 'ok', message: null, truncated,
  projects: ordenados,
  incomplete: comAlgo.some(p => p.partial),
 };
}

async function collect(providers) {
 return Promise.all(providers.map(async provedor => {
  try { return await consultarProvedor(provedor); }
  catch (error) {
   // A mensagem já vem higienizada do adaptador; nada de corpo bruto nem credencial.
   return {
    provider: provedor.name,
    status: 'error',
    message: error.name === 'TimeoutError' ? 'Tempo esgotado ao consultar o provedor.' : error.message,
    truncated: 0, projects: [], incomplete: false,
   };
  }
 }));
}

export function deploysRoutes(router, { registry = buildRegistry(), clock = Date.now } = {}) {
 let cache = null;

 router.get('/api/deploys', async ({ url, reply }) => {
  onlyParams(url.searchParams, []);

  if (!registry.length) {
   return reply(200, {
    configured: false,
    providers: [],
    projects: [],
    checked_at: new Date(clock()).toISOString(),
   });
  }

  // Cache curto: o painel é consultado a cada troca de contexto e não há razão
  // para bater no provedor toda vez. Não é cache de autorização — é de tela.
  if (!cache || clock() - cache.at > CACHE_MS) {
   const results = await collect(registry);
   cache = {
    at: clock(),
    payload: {
     configured: true,
     providers: results.map(({ provider, status, message, truncated, incomplete }) =>
      ({ provider, status, message, truncated, incomplete })),
     projects: results.flatMap(r => r.projects),
     checked_at: new Date(clock()).toISOString(),
    },
   };
  }
  return reply(200, cache.payload);
 }, { body: false });
}
