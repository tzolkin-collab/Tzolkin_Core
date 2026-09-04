import { onlyParams } from '../platform/http.mjs';
import { createDeliveryOptions } from '../integrations/delivery-options.mjs';
import { createHostingerDnsAdapter } from '../integrations/hostinger-dns.mjs';

const normalized = value => String(value || '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const aliases = product => [...new Set([normalized(product.id), normalized(product.name).replace(/^tzolkin-/, '')].filter(value => value.length >= 3))];
const matches = (value, keys) => {
 const candidate = normalized(value);
 return keys.some(key => candidate === key || candidate.startsWith(`${key}-`) || candidate.includes(`-${key}-`) || candidate.endsWith(`-${key}`));
};
const detect = (items, keys, map) => items.filter(item => matches(item.name, keys)).map(item => ({ ...map(item), source: 'detected', confidence: 'high' }));
const connectionKey = type => ({ repository: 'repositories', domain: 'domains', email: 'emails' }[type] || type);
const inventoryHas = (row, { github, vercel, easy, dnsRecords, zone, offers, templates }) => {
 if (row.provider === 'manual') return null;
 if (row.provider === 'github') return github.some(item => String(item.id) === row.external_id || item.name === row.external_id || item.name === row.display_name);
 if (row.provider === 'vercel') return vercel.some(item => String(item.id) === row.external_id || item.name === row.external_id || item.name === row.display_name);
 if (row.provider === 'easypanel') return easy.some(item => String(item.id) === row.external_id || item.name === row.external_id || item.name === row.display_name);
 if (row.provider === 'hostinger') return dnsRecords.some(item => `${item.name}.${zone.zone}` === row.external_id || item.name === row.external_id || `${item.name}.${zone.zone}` === row.display_name);
 if (row.provider === 'stripe' || row.provider === 'asaas') return offers.some(item => item.product_id === row.product_id && item.provider === row.provider);
 if (row.resource_type === 'email') return templates.some(item => item.product_id === row.product_id && item.total > 0);
 return false;
};

// Une somente evidências observáveis. Nunca infere que um recurso está saudável,
// nem grava o vínculo: confirmação explícita continua sendo responsabilidade do operador.
export function productTopologyRoutes(router, { options = createDeliveryOptions(), dns = createHostingerDnsAdapter() } = {}) {
 router.get('/api/products/topology', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, []);
  const [products, bindings, resourceBindings, offers, templates, providers, zone] = await Promise.all([
   pool.query("SELECT id,name,lifecycle_status FROM products WHERE lifecycle_status IN ('active','draft') ORDER BY name LIMIT 201"),
   pool.query('SELECT provider,external_project_id,external_project_name,product_id,environment,updated_at FROM product_deploy_bindings'),
   pool.query('SELECT id,product_id,resource_type,provider,external_id,display_name,environment,url,updated_at FROM product_resource_bindings'),
   pool.query("SELECT product_id,payload->>'provider' AS provider,count(1)::int AS total FROM billing_offers GROUP BY product_id,payload->>'provider'"),
   pool.query('SELECT product_id,count(1)::int AS total FROM email_templates GROUP BY product_id'),
   options(),
   dns.readZone(),
  ]);
  const byProduct = new Map();
  for (const row of products.rows.slice(0, 200)) byProduct.set(row.id, {
   id: row.id, name: row.name, lifecycle_status: row.lifecycle_status,
   connections: { repositories: [], frontend: [], backend: [], domains: [], api: [], worker: [], database: [], cache: [], checkout: [], emails: [] },
  });
  const github = providers.github?.status === 'ok' ? providers.github.items : [];
  const vercel = providers.vercel?.status === 'ok' ? providers.vercel.items : [];
  const easy = providers.easypanel?.status === 'ok' ? providers.easypanel.items : [];
  const dnsRecords = zone.status === 'ok' ? zone.records : [];
  for (const product of byProduct.values()) {
   const keys = aliases(product);
   const frontends = detect(vercel, keys, item => ({ provider: 'vercel', id: item.id, name: item.name, repository: item.repository || null }));
   product.connections.frontend.push(...frontends);
   product.connections.backend.push(...detect(easy.filter(item => ['app', 'compose', 'box', 'wordpress'].includes(item.type)), keys, item => ({ provider: 'easypanel', id: item.id, name: item.name, kind: item.type })));
   product.connections.repositories.push(...detect(github, keys, item => ({ provider: 'github', id: item.id, name: item.name, branch: item.default_branch || null })));
   for (const item of frontends.filter(item => item.repository)) if (!product.connections.repositories.some(repository => repository.name === item.repository)) product.connections.repositories.push({ provider: 'github', id: item.repository, name: item.repository, source: 'detected', confidence: 'high', observed_by: 'vercel' });
   product.connections.domains.push(...dnsRecords.filter(item => matches(item.name, keys)).map(item => ({ provider: 'hostinger', name: `${item.name}.${zone.zone}`, record_type: item.type, verified: item.records.some(record => !record.disabled), source: 'detected', confidence: 'high' })));
  }
  for (const row of bindings.rows) {
   const product = byProduct.get(row.product_id); if (!product) continue;
   const category = row.provider === 'vercel' ? 'frontend' : 'backend';
   const existing = product.connections[category].find(item => item.provider === row.provider && item.id === row.external_project_id);
   if (existing) { existing.source = 'confirmed'; existing.environment = row.environment; }
   else product.connections[category].push({ provider: row.provider, id: row.external_project_id, name: row.external_project_name, environment: row.environment, source: 'confirmed', confidence: 'high' });
  }
  const inventory = { github, vercel, easy, dnsRecords, zone, offers: offers.rows, templates: templates.rows };
  for (const row of resourceBindings.rows) {
   const product = byProduct.get(row.product_id); if (!product) continue;
   const category = connectionKey(row.resource_type); if (!product.connections[category]) continue;
   const existing = product.connections[category].find(item => item.provider === row.provider && String(item.id || item.name) === row.external_id);
   const observed = inventoryHas(row, inventory);
   const confirmed = {
    provider: row.provider, id: row.external_id, name: row.display_name, environment: row.environment,
    url: row.url, source: 'confirmed', confidence: 'high', binding_id: row.id,
    reconciliation: observed === null ? 'manual' : observed ? 'observed' : 'missing',
   };
   if (existing) Object.assign(existing, confirmed); else product.connections[category].push(confirmed);
  }
  for (const row of offers.rows) { const product = byProduct.get(row.product_id); if (product) product.connections.checkout.push({ provider: row.provider || 'manual', offers: row.total, source: 'configured' }); }
  for (const row of templates.rows) { const product = byProduct.get(row.product_id); if (product) product.connections.emails.push({ templates: row.total, source: 'configured' }); }
  reply(200, { checked_at: new Date().toISOString(), products: [...byProduct.values()], providers: { github: providers.github?.status || 'not_configured', vercel: providers.vercel?.status || 'not_configured', easypanel: providers.easypanel?.status || 'not_configured', hostinger: zone.status } });
 }, { body: false });
}
