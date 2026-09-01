import { createGithubAdapter, githubCliFetch } from './github.mjs';
import { createVercelAdapter } from './vercel.mjs';
import { createEasypanelAdapter } from './easypanel.mjs';

export function createDeliveryOptions({ env = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
 let cached, pending;
 const read = async (configured, task) => {
  if (!configured) return { status: 'not_configured', items: [], truncated: false };
  try { return { status: 'ok', ...await task() }; }
  catch { return { status: 'error', items: [], truncated: false }; }
 };
 return async () => {
  if (cached && clock() - cached.at < 30000) return cached.value;
  pending ??= (async () => {
   const [github, vercel, easypanel] = await Promise.all([
    read(Boolean(env.GITHUB_TOKEN || env.GITHUB_USE_CLI === 'true'), async () => {
     const result = await createGithubAdapter({ token: env.GITHUB_TOKEN, fetchImpl: !env.GITHUB_TOKEN && env.GITHUB_USE_CLI === 'true' ? githubCliFetch : fetchImpl }).listRepositories();
     return { items: result.repositories, truncated: result.truncated };
    }),
    read(Boolean(env.VERCEL_TOKEN), async () => {
     const projects = await createVercelAdapter({ token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID, fetchImpl }).listProjects();
     return { items: projects.map(p => ({ id: p.id, name: p.name, type: 'app' })), truncated: projects.length >= 100 };
    }),
    read(Boolean(env.EASYPANEL_URL || env.EASYPANEL_TOKEN), async () => {
     const result = await createEasypanelAdapter({ baseUrl: env.EASYPANEL_URL, token: env.EASYPANEL_TOKEN, fetchImpl }).inventory();
     return { items: result.projects.flatMap(p => p.services.map(s => ({ id: `${p.name}/${s.name}`, name: `${p.name} / ${s.name}`, type: s.type }))), truncated: Boolean(result.omitted_projects || result.omitted_services) };
    }),
   ]);
   const value = { github, vercel, easypanel, checked_at: new Date(clock()).toISOString() };
   cached = { value, at: clock() }; return value;
  })();
  try { return await pending; } finally { pending = null; }
 };
}
