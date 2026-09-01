// Composição do Core: pipeline de requisição + registro dos módulos.
//
// Ordem deliberada: cabeçalhos → método → origem → estáticos → rota →
// autenticação → corpo → transação. Autorização nunca depende do frontend.
import http from 'node:http';
import { createRouter } from './platform/router.mjs';
import { createSessionStore, readSessionCookie } from './platform/session.mjs';
import { json, fail, securityHeaders, replier, describeError } from './platform/http.mjs';
import { identityRoutes } from './modules/identity.mjs';
import { workspaceRoutes } from './modules/workspace.mjs';
import { catalogRoutes } from './modules/catalog.mjs';
import { directoryRoutes } from './modules/directory.mjs';
import { contractsRoutes } from './modules/contracts.mjs';
import { accessRoutes, authenticateApp } from './modules/access.mjs';
import { productConsoleRoutes } from './modules/product-console.mjs';
import { deploysRoutes, buildRegistry } from './modules/deploys.mjs';
import { infrastructureRoutes } from './modules/infrastructure.mjs';
import { deliveryRoutes } from './modules/delivery.mjs';
import { platformOperationsRoutes } from './modules/platform-operations.mjs';
import { trackingRoutes } from './modules/tracking.mjs';
import { financeRoutes } from './modules/finance.mjs';
import { billingRoutes } from './modules/billing.mjs';
import {emailRoutes} from './modules/emails.mjs';

const MODULES = [
 identityRoutes, workspaceRoutes, catalogRoutes, trackingRoutes, billingRoutes, emailRoutes,
 directoryRoutes, contractsRoutes, accessRoutes, productConsoleRoutes,
];

// `security` é o estado do transporte do banco medido por platform/database.mjs.
// Ausente = não medido; os endpoints reportam 'unknown' em vez de fingir segurança.
export function createCore({ pool, adminPassword, clock = Date.now, security = null, deployRegistry, infrastructureOptions, deliveryOptions, platformOptions, financeOptions, webOrigin } = {}) {
 if (webOrigin && !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(webOrigin)) throw new Error('Use uma origem local explícita para o frontend.');
 const sessions = createSessionStore({ adminPassword, clock });
 const router = createRouter();
 for (const register of MODULES) register(router);
 // Integrações externas são opcionais e injetáveis: os testes passam um registro
 // apontado para um stub local, e nunca tocam num provedor de verdade.
 deploysRoutes(router, { registry: deployRegistry ?? buildRegistry(), clock });
 infrastructureRoutes(router, { ...infrastructureOptions, clock });
 deliveryRoutes(router, deliveryOptions);
 platformOperationsRoutes(router,{...platformOptions,clock});
 financeRoutes(router,financeOptions);

 const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const reply = replier(res);
  try {
   const origin = webOrigin || `http://127.0.0.1:${server.address().port}`;
   const url = new URL(req.url, origin);
   if (!['GET', 'POST', 'PUT'].includes(req.method)) throw fail(405, 'Método não permitido.');
   // CSRF: mutação só a partir da origem exata do bootstrap.
   if (req.method !== 'GET' && req.headers.origin !== origin) throw fail(403, 'Origem não permitida.');

   const sessionToken = readSessionCookie(req);
   const matched = router.match(req.method, url.pathname);
   if (!matched) {
    // Exige sessão antes de revelar se a rota existe.
    if (!sessions.isValid(sessionToken)) throw fail(401, 'Entre para continuar.');
    throw fail(router.allows(url.pathname) ? 405 : 404, router.allows(url.pathname) ? 'Método não permitido.' : 'Rota não encontrada.');
   }

   const { route, params } = matched;
   const auth = route.auth || 'admin';
   let productId;
   if (auth === 'service') {
    const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
    if (!bearer) throw fail(401, 'Credencial do app obrigatória.');
    productId = await authenticateApp(pool, bearer);
    if (!productId) throw fail(401, 'App não autorizado.');
   } else if (auth === 'admin' && !sessions.isValid(sessionToken)) {
    throw fail(401, 'Entre para continuar.');
   }

   const context = { req, res, url, params, pool, reply, sessions, sessionToken, productId, security };
   if (!route.transactional) return await route.handler(context);

   context.body = await json(req);
   const client = await pool.connect();
   try {
    await client.query('BEGIN');
    const { tenant, type } = await route.handler({ ...context, client });
    if(route.audit!==false)await client.query('INSERT INTO audit_events(type,tenant_id) VALUES($1,$2)', [type, tenant]);
    await client.query('COMMIT');
    return reply(200, { ok: true, tenant_id: tenant });
   } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) {
   const { status, message } = describeError(error);
   reply(status, { message });
  }
 });
 server.requestTimeout = 15000;
 server.headersTimeout = 10000;
 return server;
}
