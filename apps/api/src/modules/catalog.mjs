// Catálogo do ecossistema: produtos e atalhos operacionais importados do Notion.
// Cadastro, não monitoramento: "status" aqui é o que foi registrado, não disponibilidade medida.
import { fail } from '../platform/http.mjs';

// O QUE CADA TIPO DE ITEM PODE FAZER (ADR 0007, opção B). A política vive aqui e
// só aqui: rota nenhuma testa id nem tipo por conta própria. Ciclo de vida é o
// outro eixo, decidido por quem chama.
export const CAPABILITIES = Object.freeze({
 // contrato de acesso, vínculo de pessoa, chave context:read e /v1/context
 access: ['product', 'platform'],
 // oferta, template de checkout e checkout público
 checkout: ['product', 'platform'],
 // contratação com service_model = 'product'
 product_engagement: ['product', 'platform'],
 // captação comercial, chaves commercial:* e contratações do item
 commercial: ['product', 'platform', 'service_line'],
 // cobrança nascida de contrato comercial aceito (ADR 0008): quem vende trabalho
 // por proposta. Produto e plataforma cobram por oferta e checkout.
 contract_billing: ['service_line'],
 // recursos, deploys, e-mails e campanhas
 operate: ['product', 'platform', 'service_line', 'internal'],
});

export const capabilitiesOf = kind => Object.keys(CAPABILITIES).filter(capability => CAPABILITIES[capability].includes(kind));

const KIND_NAMES = { product: 'um produto', platform: 'uma plataforma', service_line: 'uma linha de serviço', internal: 'um item interno' };
const REFUSALS = {
 access: 'não dá acesso de usuários pelo Core',
 checkout: 'não vende por checkout',
 product_engagement: 'não recebe contratação do tipo produto',
 commercial: 'não tem ciclo comercial',
 contract_billing: 'não cobra a partir de contrato comercial: cobra por oferta e checkout',
 operate: 'não pode ser operado',
};

export const listProducts = client => client.query("SELECT id,name FROM products WHERE lifecycle_status='active' ORDER BY name");

export const findProduct = (client, productId) =>
 client.query("SELECT id,name FROM products WHERE id=$1 AND lifecycle_status='active'", [productId]).then(r => r.rows[0] || null);

// Rascunho é configurável: oferta, template e até contrato de acesso podem ser
// preparados antes de ativar — o checklist de ativação do projeto exige isso
// (delivery.mjs). O que rascunho nunca faz é dar acesso: vínculo de pessoa e
// /v1/context exigem item ativo.
export const findEditableProduct = (client, productId) =>
 client.query("SELECT id,name FROM products WHERE id=$1 AND lifecycle_status IN ('active','draft')", [productId]).then(r => r.rows[0] || null);

/** Item que existe, está no ciclo pedido E cujo tipo tem a capacidade. */
export function findProductFor(client, productId, capability, { draft = false } = {}) {
 const kinds = CAPABILITIES[capability];
 if (!kinds) throw new Error(`Capacidade desconhecida: ${capability}`);
 const lifecycle = draft ? "('active','draft')" : "('active')";
 return client.query(`SELECT id,name FROM products WHERE id=$1 AND lifecycle_status IN ${lifecycle} AND portfolio_kind = ANY($2::text[])`,
  [productId, kinds]).then(r => r.rows[0] || null);
}

/**
 * Como findProductFor, mas recusa. Tipo sem a capacidade vira 409 dizendo o
 * porquê; item ausente ou fora do ciclo vira o erro que a rota passou.
 */
export async function requireProductFor(client, productId, capability, { draft = false, missing } = {}) {
 const product = await findProductFor(client, productId, capability, { draft });
 if (product) return product;
 const row = (await client.query('SELECT name,portfolio_kind FROM products WHERE id=$1', [productId])).rows[0];
 if (row && !CAPABILITIES[capability].includes(row.portfolio_kind))
  throw fail(409, `${row.name} é ${KIND_NAMES[row.portfolio_kind] || 'um item'} e ${REFUSALS[capability]}.`);
 throw missing || fail(404, 'Produto não encontrado.');
}

export const findCatalogEntry = (client, productId) =>
 client.query("SELECT payload,imported_at FROM ecosystem_entries WHERE id=$1 AND kind='product'", [productId])
  .then(r => r.rows[0] || null);

export function catalogRoutes(router) {
 router.get('/api/ecosystem', async ({ pool, reply }) => {
  const result = await pool.query('SELECT kind,payload,imported_at FROM ecosystem_entries ORDER BY id');
  return reply(200, { entries: result.rows });
 });
}
