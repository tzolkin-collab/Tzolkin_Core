import { onlyParams } from '../platform/http.mjs';
import { createEasypanelAdapter } from '../integrations/easypanel.mjs';

export function infrastructureRoutes(router, { env = process.env, fetchImpl, clock = Date.now } = {}) {
 let cached = null;
 let pending = null;
 router.get('/api/infrastructure/easypanel', async ({ url, reply }) => {
  onlyParams(url.searchParams, []);
  if (!env.EASYPANEL_URL && !env.EASYPANEL_TOKEN)
   return reply(200, { configured: false, status: 'not_configured', projects: [], checked_at: null });
  if (!cached || clock() - cached.at >= 30000) {
   pending ??= (async () => {
    let payload;
    try {
     const adapter = createEasypanelAdapter({ baseUrl: env.EASYPANEL_URL, token: env.EASYPANEL_TOKEN, fetchImpl });
     payload = { configured: true, status: 'ok', ...await adapter.inventory() };
    } catch {
     // Nem a URL, nem mensagem arbitrária de fetch/provedor chegam ao navegador.
     payload = { configured: true, status: 'error', projects: [], message: 'Não foi possível consultar o EasyPanel. Verifique URL HTTPS, credencial, permissões e versão da API.' };
    }
    cached = { at: clock(), payload: { ...payload, checked_at: new Date(clock()).toISOString() } };
   })();
   try { await pending; } finally { pending = null; }
  }
  return reply(200, cached.payload);
 }, { body: false });
}
