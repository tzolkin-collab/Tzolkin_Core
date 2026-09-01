// Inventário somente leitura. Endpoint fixo: nunca recebe URL do navegador.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// Alternativa explícita só para bootstrap local: reutiliza o keyring do gh,
// sem extrair/copiar token. Comando fixo e sem shell, apenas leitura.
export async function githubCliFetch(url) {
 const endpoint = new URL(url);
 if (endpoint.origin !== 'https://api.github.com' || endpoint.pathname !== '/user/repos') throw Error('Endpoint não permitido.');
 const { stdout } = await exec('gh', ['api', '--method', 'GET', endpoint.pathname + endpoint.search], { timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
 const items = JSON.parse(stdout);
 return Response.json(items, { headers: { link: Array.isArray(items) && items.length === 100 ? '<next>; rel="next"' : '' } });
}

export function createGithubAdapter({ token, fetchImpl = fetch }) {
 return { async listRepositories() {
  const repositories = [];
  try {
   for (let page = 1; page <= 5; page++) {
    const response = await fetchImpl(`https://api.github.com/user/repos?per_page=100&sort=updated&page=${page}`, {
     method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
     headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw Error();
    const body = await response.json();
    if (!Array.isArray(body)) throw Error();
    for (const repo of body) {
     if (!Number.isSafeInteger(repo.id) || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) throw Error();
     repositories.push({ id: String(repo.id), name: repo.full_name, default_branch: repo.default_branch || '', archived: Boolean(repo.archived) });
    }
    if (!(response.headers.get('link') || '').includes('rel="next"')) return { repositories, truncated: false };
   }
   return { repositories, truncated: true };
  } catch { throw new Error('Não foi possível consultar o GitHub. Confira a credencial e seu acesso aos repositórios.'); }
 } };
}
