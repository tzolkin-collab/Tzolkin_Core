// Adaptador Vercel — SOMENTE LEITURA.
//
// Nenhuma operação de escrita: não dispara, não cancela, não promove, não altera
// variável de ambiente. Disparo de deploy, quando existir, será por Deploy Hook
// (URL secreta por branch, revogável), nunca por este token.
//
// A credencial fica no servidor. O navegador recebe só o resultado normalizado.
// Ver docs/INTEGRATIONS.md#9-deploys--vercel
const BASE = 'https://api.vercel.com';
const TIMEOUT_MS = 8000;
const MSG_MAX = 140;

// Estados publicados pela API. Traduzidos para o painel sem inventar categorias.
const ESTADOS = {
 QUEUED: 'na fila', INITIALIZING: 'iniciando', BUILDING: 'construindo',
 READY: 'no ar', ERROR: 'falhou', CANCELED: 'cancelado',
 BLOCKED: 'bloqueado', DELETED: 'apagado',
};

// Erro de provedor nunca carrega a credencial nem o corpo bruto da resposta.
function mensagemDeFalha(status) {
 if (status === 401 || status === 403) return 'Credencial da Vercel inválida ou sem escopo para este recurso.';
 if (status === 404) return 'Recurso não encontrado na Vercel.';
 if (status === 429) return 'Limite de requisições da Vercel atingido. Tente mais tarde.';
 if (status >= 500) return 'Vercel indisponível no momento.';
 return 'Não foi possível consultar a Vercel.';
}

const iso = ms => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

// Mensagem de commit vira assunto: primeira linha, com teto. O painel é lista de
// deploy, não git log — e corpo de commit aqui chega a milhares de caracteres.
function assunto(texto) {
 if (!texto) return null;
 const primeira = texto.split('\n')[0].trim();
 return primeira.length > MSG_MAX ? primeira.slice(0, MSG_MAX - 1) + '…' : primeira;
}

// A API devolve muito mais campo do que o painel precisa. Só o que tem uso sai daqui:
// o resto seria ruído, e alguns trazem e-mail de quem commitou.
function normalizar(deployment, projectName = null) {
 const meta = deployment.meta || {};
 const commit = meta.githubCommitSha || meta.gitlabCommitSha || meta.bitbucketCommitSha || null;
 return {
  provider: 'vercel',
  project: deployment.name || projectName,
  id: deployment.uid || deployment.id,
  state: deployment.state || deployment.readyState || null,
  state_label: ESTADOS[deployment.state || deployment.readyState] || 'desconhecido',
  target: deployment.target || null,
  url: deployment.url ? 'https://' + deployment.url : null,
  inspector_url: deployment.inspectorUrl || null,
  branch: meta.githubCommitRef || meta.gitlabCommitRef || meta.bitbucketCommitRef || null,
  commit: commit ? commit.slice(0, 7) : null,
  commit_message: assunto(meta.githubCommitMessage || meta.gitlabCommitMessage || meta.bitbucketCommitMessage),
  author: deployment.creator?.username || null,
  source: deployment.source || null,
  created_at: iso(deployment.createdAt ?? deployment.created),
  ready_at: iso(deployment.ready),
  ready_substate: deployment.readySubstate || null,
  rollback_candidate: deployment.isRollbackCandidate ?? null,
  error_message: deployment.errorMessage || null,
 };
}

export function createVercelAdapter({ token, teamId = null, baseUrl = BASE, fetchImpl = fetch }) {
 const get = async (path, params) => {
  const url = new URL(path, baseUrl);
  for (const [chave, valor] of Object.entries(params)) if (valor != null) url.searchParams.set(chave, String(valor));
  // Token de time ou de projeto dispensa teamId — a Vercel infere do escopo.
  // Só um token de conta inteira precisa dele.
  if (teamId) url.searchParams.set('teamId', teamId);
  const response = await fetchImpl(url, {
   headers: { Authorization: `Bearer ${token}` },
   signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw Object.assign(new Error(mensagemDeFalha(response.status)), { providerStatus: response.status });
  return response.json();
 };

 return {
  provider: 'vercel',

  // Lista os projetos ao alcance da credencial. É a base do painel: um projeto
  // parado há meses precisa aparecer como "sem deploy recente", não sumir.
  async listProjects({ limit = 100 } = {}) {
   const body = await get('/v9/projects', { limit });
   return (body.projects || []).map(p => ({
    id: p.id,
    name: p.name,
    framework: p.framework || null,
    // Projeto sem repositório conectado não tem commit, e não aceita Deploy Hook.
    git_connected: Boolean(p.link),
    updated_at: iso(p.updatedAt),
   }));
  },

  async listDeployments({ projectId = null, projectName = null, limit = 20 } = {}) {
   const body = await get('/v7/deployments', { limit, projectId });
   return (body.deployments || []).map(d => normalizar(d, projectName));
  },
 };
}

export const _internals = { normalizar, mensagemDeFalha, assunto, ESTADOS };
