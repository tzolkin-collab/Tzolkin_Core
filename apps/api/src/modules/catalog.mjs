// Catálogo do ecossistema: produtos e atalhos operacionais importados do Notion.
// Cadastro, não monitoramento: "status" aqui é o que foi registrado, não disponibilidade medida.
import { fail } from '../platform/http.mjs';

// O QUE CADA TIPO DE ITEM PODE FAZER (ADR 0007, opção B). A política vive aqui e
// só aqui: rota nenhuma testa id nem tipo por conta própria. Ciclo de vida é o
// outro eixo, decidido por quem chama.
// 'product' é o nome antigo de 'platform': as regras eram idênticas (ADR 0007) e o
// tipo foi unificado. O valor antigo continua sendo aceito e lido, com as mesmas
// regras, até o dono migrar as linhas que ainda o usam.
const SOFTWARE = ['product', 'platform'];
// Trabalho feito por pessoas, sob contrato ou proposta.
const TRABALHO = ['service_line', 'advisory'];

export const CAPABILITIES = Object.freeze({
 // contrato de acesso, vínculo de pessoa, chave context:read e /v1/context
 access: SOFTWARE,
 // oferta, template de checkout e checkout público
 checkout: SOFTWARE,
 // contratação com service_model = 'product'
 product_engagement: SOFTWARE,
 // captação comercial, chaves commercial:* e contratações do item
 commercial: [...SOFTWARE, ...TRABALHO],
 // cobrança nascida de contrato comercial aceito (ADR 0008): quem vende trabalho
 // por proposta. Produto e plataforma cobram por oferta e checkout.
 contract_billing: TRABALHO,
 // recursos, deploys, e-mails e campanhas
 operate: [...SOFTWARE, ...TRABALHO, 'internal'],
});

export const capabilitiesOf = kind => Object.keys(CAPABILITIES).filter(capability => CAPABILITIES[capability].includes(kind));

const KIND_NAMES = { product: 'uma plataforma', platform: 'uma plataforma', service_line: 'uma linha de serviço', advisory: 'um espaço de consultoria e assessoria', internal: 'um item interno' };

// O QUE CADA TIPO É, para a tela. É o único lugar com os rótulos, a ordem, o ícone e o
// texto de cada tipo: o painel os recebe daqui (GET /api/overview e /api/portfolio) em
// vez de repetir um dicionário próprio. `tags` diz se o tipo se organiza por tags.
// A ordem do array é a ordem em que o portfólio se apresenta.
export const KIND_REGISTRY = Object.freeze([
 { kind: 'platform', label: 'Plataforma', plural: 'Plataformas', icon: 'layers',
   what: 'Software B2B ou B2C que o cliente usa, muitas vezes por assinatura. Se cancelar, perde o acesso. Ex.: Skiller, Educare.' },
 { kind: 'service_line', label: 'Linha de serviço', plural: 'Linhas de serviço', icon: 'briefcase',
   what: 'Trabalho feito por pessoas, sob contrato ou proposta. Se cancelar, o cliente fica com o que foi entregue. Ex.: Sites.' },
 { kind: 'advisory', label: 'Consultoria e assessoria', plural: 'Consultoria e assessoria', icon: 'people', tags: true,
   what: 'Consultoria, assessoria e mentoria, organizadas por tags. Trabalho sob contrato.' },
 { kind: 'internal', label: 'Interno', plural: 'Internos', icon: 'settings',
   what: 'Software da própria TZOLKIN. Não se vende. Ex.: Core.' },
]);
// Nomes antigos que ainda podem estar gravados, e o tipo que passaram a ser.
export const KIND_ALIASES = Object.freeze({ product: 'platform' });
export const canonicalKind = kind => KIND_ALIASES[kind] || kind;

// O mesmo tipo, sem o artigo, para rótulo de botão e de tela ("Ativar linha de
// serviço"). KIND_NAMES carrega o artigo porque entra no meio de uma frase de
// recusa; um botão não diz "Ativar uma linha de serviço". Dois dicionários com a
// mesma chave, cada um para uma posição na frase — e nenhum deles escrito duas
// vezes: o checklist de ativação (delivery.mjs) lê deste aqui.
export const KIND_LABELS = Object.freeze({
 product: 'plataforma', platform: 'plataforma', service_line: 'linha de serviço', advisory: 'consultoria e assessoria', internal: 'item interno',
});
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
