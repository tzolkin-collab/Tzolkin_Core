// API pública documentada: https://easypanel.io/docs/api-reference
// Somente inventário. Não consultar configurações de apps/bancos: podem conter segredos.
const invalid = () => new Error('Resposta do EasyPanel incompatível. Confira a versão da API do painel.');
const name = value => typeof value === 'string' && /^[a-zA-Z0-9_. -]{1,120}$/.test(value);
const TYPES = new Set(['app', 'compose', 'postgres', 'mysql', 'mariadb', 'mongo', 'mongodb', 'redis', 'box', 'wordpress']);

export function normalizeInventory(body) {
 // Formato confirmado no painel real: listas de projetos e serviços separadas.
 // Agrupar só os três campos permitidos, nunca propagar env/token/source.
 if (body && !Array.isArray(body) && Array.isArray(body.projects) && Array.isArray(body.services)) {
  const groups = new Map();
  for (const project of body.projects) {
   if (!project || !name(project.name) || groups.has(project.name)) throw invalid();
   groups.set(project.name, { name: project.name, services: [] });
  }
  for (const service of body.services) {
   if (!service || !name(service.projectName) || !groups.has(service.projectName)) throw invalid();
   groups.get(service.projectName).services.push({ name: service.name, type: service.type });
  }
  body = [...groups.values()];
 }
 if (!Array.isArray(body)) throw invalid();
 let omittedServices = 0;
 const projects = body.slice(0, 100).map(project => {
  if (!project || !name(project.name) || !Array.isArray(project.services)) throw invalid();
  omittedServices += Math.max(0, project.services.length - 200);
  return {
   name: project.name,
   services: project.services.slice(0, 200).map(service => {
    if (!service || !name(service.name) || typeof service.type !== 'string') throw invalid();
    return { name: service.name, type: TYPES.has(service.type) ? service.type : 'unknown' };
   }),
  };
 });
 return { projects, omitted_projects: Math.max(0, body.length - 100), omitted_services: omittedServices };
}

export function createEasypanelAdapter({ baseUrl, token, fetchImpl = fetch }) {
 let url;
 try { url = new URL(baseUrl); } catch { throw new Error('Configure uma URL HTTPS válida para o EasyPanel.'); }
 if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', '/api', '/api/'].includes(url.pathname))
  throw new Error('EasyPanel exige URL HTTPS do painel, sem credenciais ou parâmetros.');
 if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Configure a credencial do EasyPanel no servidor.');
 const endpoint = new URL('/api/listProjectsAndServices', url.origin);
 return {
  async inventory() {
   let response;
   try {
    response = await fetchImpl(endpoint, {
     method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
     signal: AbortSignal.timeout(8000),
    });
   } catch { throw new Error('Não foi possível conectar ao EasyPanel por HTTPS.'); }
   if (!response.ok) {
    const message = [401, 403].includes(response.status) ? 'Credencial do EasyPanel inválida ou sem acesso.'
     : response.status === 404 ? 'API pública não encontrada. Confira a versão do EasyPanel.'
     : response.status === 429 ? 'Limite de consultas do EasyPanel atingido.' : 'EasyPanel indisponível no momento.';
    throw new Error(message);
   }
   try {
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
     while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) { await reader.cancel(); throw invalid(); }
      chunks.push(Buffer.from(value));
     }
    } finally { reader.releaseLock(); }
    return normalizeInventory(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   } catch { throw invalid(); }
  },
 };
}
