// Catálogo de ofertas da Stripe — SOMENTE LEITURA.
//
// Não cria produto, não cria preço, não arquiva nada. O catálogo é mantido no
// painel da Stripe; aqui ele é lido para que o Core saiba o que existe.
//
// Uma oferta é (produto × preço): "Skiller Pro mensal" e "Skiller Pro anual"
// são ofertas distintas, porque é o preço que determina o que se cobra.
//
// Ver docs/BILLING.md e docs/decisions/0003
const BASE = 'https://api.stripe.com';
const TIMEOUT_MS = 8000;

function mensagemDeFalha(status) {
 if (status === 401 || status === 403) return 'Credencial da Stripe inválida ou sem escopo.';
 if (status === 429) return 'Limite de requisições da Stripe atingido.';
 if (status >= 500) return 'Stripe indisponível no momento.';
 return 'Não foi possível consultar a Stripe.';
}

const texto = (v, max = 300) => (typeof v === 'string' && v && v.length <= max ? v : null);

// Preço vira rótulo humano sem esconder o número: quem confere precisa ver o valor.
function periodo(recurring) {
 if (!recurring) return { billing: 'one_time', label: 'à vista' };
 const n = Number.isSafeInteger(recurring.interval_count) && recurring.interval_count > 1 ? recurring.interval_count : 1;
 const nome = { day: 'dia', week: 'semana', month: 'mês', year: 'ano' }[recurring.interval] || recurring.interval;
 return { billing: 'recurring', label: n > 1 ? `a cada ${n} ${nome}` : `por ${nome}` };
}

export function createStripeCatalogAdapter({ secretKey, baseUrl = BASE, fetchImpl = fetch }) {
 const get = async (path, params = {}) => {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const response = await fetchImpl(url, {
   method: 'GET', redirect: 'error',
   headers: { Authorization: `Bearer ${secretKey}` },
   signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw Object.assign(new Error(mensagemDeFalha(response.status)), { providerStatus: response.status });
  return response.json();
 };

 return {
  provider: 'stripe',

  /**
   * Devolve as ofertas: um item por preço, já com o produto resolvido.
   *
   * Lê preços ATIVOS E INATIVOS de propósito: assinatura em curso pode estar
   * num preço arquivado, e sumir com ela esconderia receita real. O estado vem
   * no campo `active` para a tela poder distinguir.
   */
  async listOffers({ limit = 100 } = {}) {
   const [produtos, precos] = await Promise.all([
    get('/v1/products', { limit }),
    // A Stripe espera sintaxe de array no expand: 'expand' puro devolve 400.
    get('/v1/prices', { limit, 'expand[]': 'data.product' }),
   ]);
   const porId = new Map((produtos.data || []).map(p => [p.id, p]));

   return (precos.data || []).map(preco => {
    // `expand` pode devolver o produto embutido; se não, cai no índice.
    const bruto = preco.product && typeof preco.product === 'object' ? preco.product : porId.get(preco.product);
    const { billing, label } = periodo(preco.recurring);
    return {
     provider: 'stripe',
     offer_ref: preco.id,
     product_ref: texto(bruto?.id) ?? texto(typeof preco.product === 'string' ? preco.product : null),
     product_name: texto(bruto?.name, 160),
     description: texto(bruto?.description),
     // Centavos inteiros: valor monetário nunca em ponto flutuante.
     amount_cents: Number.isSafeInteger(preco.unit_amount) ? preco.unit_amount : null,
     currency: typeof preco.currency === 'string' ? preco.currency.toLowerCase() : null,
     billing, period_label: label,
     active: Boolean(preco.active) && Boolean(bruto?.active ?? true),
     nickname: texto(preco.nickname, 120),
    };
   }).sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '') || (a.amount_cents ?? 0) - (b.amount_cents ?? 0));
  },
 };
}

export const _internals = { periodo, mensagemDeFalha };
