// Leitura sob demanda. Nunca retorna objetos brutos, env, scripts ou credenciais.
const unavailable = () => ({ state:'unavailable' });
const automatic = () => ({ state:'automatic' });
const value = value => ({ state:'value', value });
const relative = raw => {
 if (raw === null || raw === '') return value('.');
 if (typeof raw !== 'string' || raw.length > 180) return unavailable();
 const path = raw.replace(/^\.\//, '').replace(/\/$/, '');
 return path === '.' || (/^[\w.@-]+(?:\/[\w.@-]+)*$/.test(path) && !path.split('/').some(s => s === '..' || s === '.')) ? value(path) : unavailable();
};
const branch = raw => typeof raw === 'string' && raw.length <= 120 && /^[\w./-]+$/.test(raw) && !/\.\.|\.lock$|\/\/|^\/|\/$|\.$/.test(raw) ? value(raw) : unavailable();
// Comandos arbitrários podem conter senhas inline. Só formatos conhecidos saem
// do servidor, sem argumentos livres, URLs, shell, atribuições ou expansão.
const command = raw => {
 if (raw === null || raw === '') return automatic();
 if (typeof raw !== 'string') return unavailable();
 return /^(npm|pnpm|yarn|bun) (run )?(build|start|dev)(:[a-z][a-z0-9-]{0,30})?$/.test(raw) ? value(raw) : {state:'restricted'};
};
const repoName = (owner, repo) => typeof owner === 'string' && typeof repo === 'string' && /^[\w.-]{1,100}$/.test(owner) && /^[\w.-]{1,100}$/.test(repo) ? `${owner}/${repo}` : null;

export function normalizeSettings(provider, body, environment) {
 if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid response');
 const fields = Object.fromEntries(['path','stack','runtime','build','start','output','branch'].map(k => [k,unavailable()]));
 let repository = null, scope;
 if (provider === 'vercel') {
  if (typeof body.id !== 'string') throw Error('Invalid project');
  fields.path = relative(body.rootDirectory);
  fields.stack = ['nextjs','vite'].includes(body.framework) ? value(body.framework) : unavailable();
  fields.runtime = typeof body.nodeVersion === 'string' && /^\d{1,3}\.x$/.test(body.nodeVersion) ? value(`node ${body.nodeVersion}`) : unavailable();
  fields.build = command(body.buildCommand);
  fields.output = body.outputDirectory === null || body.outputDirectory === '' ? automatic() : relative(body.outputDirectory);
  fields.branch = environment === 'production' ? branch(body.link?.productionBranch) : unavailable();
  repository = body.link?.type === 'github' ? repoName(body.link.org, body.link.repo) : null;
  scope = 'Configuração do projeto Vercel; não inclui overrides do repositório/deploy. Branch consultada somente para produção.';
 } else {
  if (body.type !== 'app') throw Error('Invalid service');
  if (['github','git'].includes(body.source?.type)) {
   fields.path = relative(body.source.path === '/' ? '.' : body.source.path);
   fields.branch = branch(body.source.ref);
   if (body.source.type === 'github') repository = repoName(body.source.owner, body.source.repo);
  }
  // Dockerfile/imagem não revelam runtime, stack ou comandos efetivos.
  scope = 'Configuração única do serviço EasyPanel, compartilhada por todos os vínculos deste destino; não comprova o ambiente nem o deploy ativo.';
 }
 return {fields,repository,scope};
}

export async function readJson(response) {
 if (!response.ok) throw Error('Provider unavailable');
 const reader = response.body.getReader(), chunks = []; let length = 0;
 try {
  while (true) {
   const {done,value} = await reader.read(); if (done) break;
   length += value.byteLength;
   if (length > 1024 * 1024) { await reader.cancel(); throw Error('Response too large'); }
   chunks.push(Buffer.from(value));
  }
 } finally { reader.releaseLock(); }
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createDeliverySettings({ env = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
 return async ({provider,target,environment}) => {
  if (provider === 'easypanel' && target.type !== 'app') return {status:'unsupported',fields:{},message:'Consulta de configuração disponível apenas para serviços App do EasyPanel nesta etapa.'};
  try {
   let url, token;
   if (provider === 'vercel') {
    if (!/^[\w-]{1,120}$/.test(target.id)) throw Error('Invalid id');
    url = new URL(`/v9/projects/${encodeURIComponent(target.id)}`, 'https://api.vercel.com');
    if (env.VERCEL_TEAM_ID) url.searchParams.set('teamId',env.VERCEL_TEAM_ID);
    token = env.VERCEL_TOKEN;
   } else if (provider === 'easypanel') {
    const base = new URL(env.EASYPANEL_URL);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !['/','/api','/api/'].includes(base.pathname)) throw Error('Invalid URL');
    const parts = target.id.split('/');
    if (parts.length !== 2 || parts.some(p => !/^[a-z0-9_-]+$/.test(p))) throw Error('Invalid id');
    url = new URL('/api/inspectAppService',base.origin);
    url.searchParams.set('projectName',parts[0]); url.searchParams.set('serviceName',parts[1]);
    token = env.EASYPANEL_TOKEN;
   } else throw Error('Invalid provider');
   if (!token) throw Error('Not configured');
   const body = await readJson(await fetchImpl(url,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)}));
   const result = normalizeSettings(provider,body,environment);
   return {status:'ok',...result,checked_at:new Date(clock()).toISOString()};
  } catch { return {status:'error',fields:{},message:'Não foi possível ler uma configuração compatível. Confira conexão, permissões e versão da plataforma.'}; }
 };
}
