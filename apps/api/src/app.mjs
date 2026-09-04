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
import { paymentSalesRoutes } from './modules/payment-sales.mjs';
import { billingRoutes } from './modules/billing.mjs';
import {emailRoutes} from './modules/emails.mjs';
import {emailTemplateRoutes} from './modules/email-templates.mjs';
import {productFaviconRoutes} from './modules/product-favicons.mjs';
import {productDeployBindingRoutes} from './modules/product-deploy-bindings.mjs';
import {serviceDeployBindingRoutes} from './modules/service-deploy-bindings.mjs';
import {productPaymentRoutes} from './modules/product-payments.mjs';
import { paymentWebhookRoutes } from './modules/payment-webhooks.mjs';
import { stripeCatalogRoutes } from './modules/stripe-catalog.mjs';
import { accountRoutes } from './modules/accounts.mjs';
import { checkoutTemplateRoutes } from './modules/checkout-templates.mjs';
import { checkoutGatewayRoutes } from './modules/checkout-gateway.mjs';
import { financeForecastRoutes } from './modules/finance-forecasts.mjs';
import { managementRoutes } from './modules/management.mjs';
import { hostingerDnsRoutes } from './modules/hostinger-dns.mjs';
import { productTopologyRoutes } from './modules/product-topology.mjs';
import { productResourceBindingRoutes } from './modules/product-resource-bindings.mjs';

const MODULES = [
 identityRoutes, workspaceRoutes, catalogRoutes, trackingRoutes, billingRoutes, emailRoutes, emailTemplateRoutes, productFaviconRoutes, productDeployBindingRoutes, productResourceBindingRoutes, serviceDeployBindingRoutes, managementRoutes, productPaymentRoutes, productTopologyRoutes,
 checkoutTemplateRoutes, directoryRoutes, contractsRoutes, accessRoutes, productConsoleRoutes,
];

// `security` é o estado do transporte do banco medido por platform/database.mjs.
// Ausente = não medido; os endpoints reportam 'unknown' em vez de fingir segurança.
export function createCore({ pool, adminPassword, identity, clock = Date.now, security = null, deployRegistry, infrastructureOptions, deliveryOptions, platformOptions, financeOptions, salesOptions, hostingerDnsOptions, webOrigin,serveAsset, webhookEnv, catalogAdapter, checkoutOptions} = {}) {
 if (webOrigin && !(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(webOrigin)||/^https:\/\/[a-z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(webOrigin))) throw new Error('Use an explicit HTTP loopback or HTTPS web origin.');
 const sessions = identity||createSessionStore({ adminPassword, clock });
 const router = createRouter();
 for (const register of MODULES) register(router);
 // Integrações externas são opcionais e injetáveis: os testes passam um registro
 // apontado para um stub local, e nunca tocam num provedor de verdade.
 deploysRoutes(router, { registry: deployRegistry ?? buildRegistry(), clock });
 infrastructureRoutes(router, { ...infrastructureOptions, clock });
 deliveryRoutes(router, deliveryOptions);
 hostingerDnsRoutes(router, hostingerDnsOptions);
 platformOperationsRoutes(router,{...platformOptions,clock});
 financeRoutes(router,financeOptions);
 financeForecastRoutes(router);
 paymentSalesRoutes(router,salesOptions);
 paymentWebhookRoutes(router,{clock,...(webhookEnv?{env:webhookEnv}:{})});
 stripeCatalogRoutes(router,{clock,...(catalogAdapter?{adapter:catalogAdapter}:{}),...(webhookEnv?{env:webhookEnv}:{})});
 accountRoutes(router,{...(webhookEnv?{env:webhookEnv}:{})});
 checkoutGatewayRoutes(router,{...(webhookEnv?{env:webhookEnv}:{}),...checkoutOptions});

 const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const reply = replier(res);
  try {
   const origin = webOrigin || `http://127.0.0.1:${server.address().port}`;
   const url = new URL(req.url, origin);
   if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw fail(405, 'Método não permitido.');
   if(req.method==='GET'&&serveAsset?.(url.pathname,res))return;

   const matched = router.match(req.method, url.pathname);
   // CSRF: mutação só a partir da origem exata do bootstrap.
   // Webhook é chamada servidor-a-servidor e não manda Origin: é isento aqui e,
   // em troca, prova a origem pela assinatura/token do provedor no próprio handler.
   if (req.method !== 'GET' && !matched?.route.webhook && req.headers.origin !== origin) throw fail(403, 'Origem não permitida.');

   const sessionToken = readSessionCookie(req);
   const operator=await sessions.resolve(req,sessionToken);
   if (!matched) {
    // Exige sessão antes de revelar se a rota existe.
    if (!operator) throw fail(401, 'Entre para continuar.');
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
   } else if (auth === 'admin' && !operator) {
    throw fail(401, 'Entre para continuar.');
   }

   const context = { req, res, url, params, pool, reply, sessions, sessionToken, productId, security,operator };
   if (!route.transactional) return await route.handler(context);

   context.body = await json(req);
   const client = await pool.connect();
   try {
    await client.query('BEGIN');
    const { tenant, type } = await route.handler({ ...context, client });
    if(route.audit!==false)await client.query('INSERT INTO audit_events(type,tenant_id,actor_subject,actor_email) VALUES($1,$2,$3,$4)', [type, tenant,operator?.subject,operator?.email]);
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
