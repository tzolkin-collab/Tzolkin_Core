// Catálogo da Stripe confrontado com as ofertas do Core.
//
// SOMENTE LEITURA, e de propósito: importar automaticamente exigiria adivinhar
// a qual produto do Core cada oferta pertence. "Skiller Pro" e "A Mesa" não são
// produtos do catálogo (sites, educare, barber, commerce, data, core), e inventar
// esse vínculo criaria dado falso — o contrário do que este Core promete.
//
// Esta rota mostra o que existe lá, o que já existe aqui, e o que falta decidir.
// A gravação continua sendo PUT /api/billing/offers, com o produto escolhido
// explicitamente por quem opera.
import { onlyParams } from '../platform/http.mjs';
import { createStripeCatalogAdapter } from '../integrations/stripe-catalog.mjs';

const CACHE_MS = 30000;

export function stripeCatalogRoutes(router, { env = process.env, clock = Date.now, adapter } = {}) {
 let cache = null;

 router.get('/api/billing/stripe-catalog', async ({ url, pool, reply }) => {
  onlyParams(url.searchParams, []);

  const cliente = adapter ?? (env.STRIPE_SECRET_KEY
   ? createStripeCatalogAdapter({
      secretKey: env.STRIPE_SECRET_KEY,
      ...(env.STRIPE_API_BASE ? { baseUrl: env.STRIPE_API_BASE } : {}),
     })
   : null);

  // Sem credencial não é erro: é estado vazio honesto.
  if (!cliente) return reply(200, {
   configured: false, mode: null, offers: [], products: [],
   summary: { total: 0, imported: 0, missing_product: 0 }, checked_at: new Date(clock()).toISOString(),
  });

  if (!cache || clock() - cache.at > CACHE_MS) {
   let ofertas = []; let erro = null;
   try { ofertas = await cliente.listOffers(); }
   catch (error) { erro = error.name === 'TimeoutError' ? 'Tempo esgotado ao consultar a Stripe.' : error.message; }

   const [produtos, existentes] = await Promise.all([
    pool.query('SELECT id,name FROM products ORDER BY name'),
    pool.query("SELECT product_id, slug, payload->>'provider' AS provider, payload->>'offer_ref' AS offer_ref FROM billing_offers"),
   ]);
   // Casamento por referência do preço — nunca por nome, que muda sem aviso.
   const importadas = new Map(existentes.rows
    .filter(r => r.provider === 'stripe' && r.offer_ref)
    .map(r => [r.offer_ref, { product_id: r.product_id, slug: r.slug }]));

   const linhas = ofertas.map(o => ({
    ...o,
    imported_as: importadas.get(o.offer_ref) ?? null,
    // Só sugere quando o nome bate exatamente com um produto do Core.
    // Aproximação seria adivinhação, e adivinhação vira cadastro errado.
    suggested_product_id: produtos.rows.find(p =>
      p.name.toLowerCase() === String(o.product_name || '').toLowerCase())?.id ?? null,
   }));

   cache = { at: clock(), payload: {
    configured: true,
    mode: env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'live' : 'test',
    error: erro,
    offers: linhas,
    products: produtos.rows,
    summary: {
     total: linhas.length,
     imported: linhas.filter(l => l.imported_as).length,
     // Quantas não têm produto correspondente no Core: é a decisão pendente.
     missing_product: linhas.filter(l => !l.imported_as && !l.suggested_product_id).length,
    },
    // Deixa explícito que esta rota não escreve nada.
    execution: 'read_only',
    checked_at: new Date(clock()).toISOString(),
   } };
  }
  return reply(200, cache.payload);
 }, { body: false });
}
