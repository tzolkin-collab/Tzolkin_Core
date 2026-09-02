// Criação de Checkout Session da Stripe.
//
// Esta é a única parte do Core que efetivamente move dinheiro em trânsito —
// tudo o mais em billing/stripe-catalog é leitura ou rascunho. Por isso o
// adaptador nunca decide preço: quem chama (checkout-gateway.mjs) já leu o
// valor de billing_offers no servidor antes de montar `lineItem`. Aceitar
// preço daqui seria aceitá-lo do navegador, um degrau acima.
//
// Só fluxo 1 (Tzolkin vende, Tzolkin recebe): conta única via
// STRIPE_SECRET_KEY, sem Connect nem split. Fluxo 2 depende de D3.
// Ver docs/decisions/0003-configuracao-de-cobranca-por-conta-e-oferta.md
const BASE = 'https://api.stripe.com';
const TIMEOUT_MS = 8000;

function mensagemDeFalha(status) {
 if (status === 401 || status === 403) return 'Credencial da Stripe inválida ou sem escopo.';
 if (status === 429) return 'Limite de requisições da Stripe atingido.';
 if (status >= 500) return 'Stripe indisponível no momento.';
 return 'Não foi possível criar a sessão de pagamento.';
}

// Serializa objetos aninhados no formato "colchete" que a API de formulário
// da Stripe espera: {line_items:[{price_data:{unit_amount:1990}}]} vira
// line_items[0][price_data][unit_amount]=1990
function achatar(valor, prefixo, saida) {
 if (valor === undefined || valor === null || valor === '') return;
 if (Array.isArray(valor)) { valor.forEach((item, i) => achatar(item, `${prefixo}[${i}]`, saida)); return; }
 if (typeof valor === 'object') { for (const [k, v] of Object.entries(valor)) achatar(v, prefixo ? `${prefixo}[${k}]` : k, saida); return; }
 saida.set(prefixo, String(valor));
}

export function createStripeCheckoutAdapter({ secretKey, baseUrl = BASE, fetchImpl = fetch }) {
 return {
  provider: 'stripe',

  /**
   * Cria uma Checkout Session a partir de um item já precificado pelo chamador.
   * `uiMode`: 'hosted' devolve `url` para redirecionar; 'embedded' devolve
   * `client_secret` para montar o Embedded Checkout na própria página.
   */
  async createSession({ uiMode, mode, lineItem, successUrl, cancelUrl, returnUrl }) {
   const params = {
    mode,
    ...(uiMode === 'embedded' ? { ui_mode: 'embedded', return_url: returnUrl } : { success_url: successUrl, cancel_url: cancelUrl }),
    payment_method_types: ['card'],
    line_items: [{
     quantity: 1,
     price_data: {
      currency: lineItem.currency,
      unit_amount: lineItem.amountMinor,
      product_data: { name: lineItem.name },
      ...(mode === 'subscription' ? { recurring: { interval: lineItem.interval } } : {}),
     },
    }],
   };
   const body = new URLSearchParams();
   achatar(params, '', body);

   const response = await fetchImpl(new URL('/v1/checkout/sessions', baseUrl), {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
   });
   if (!response.ok) throw Object.assign(new Error(mensagemDeFalha(response.status)), { providerStatus: response.status });
   return response.json();
  },
 };
}

export const _internals = { achatar, mensagemDeFalha };
