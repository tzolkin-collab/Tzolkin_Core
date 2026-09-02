// Página pública de checkout. Sem framework, sem build: o mesmo padrão do
// resto do painel. Carrega em /c/:productId/:offerSlug, lê a oferta e o
// template no servidor (nunca decide preço aqui) e cria a sessão de
// pagamento só quando o cliente clica em pagar.
const root = document.getElementById('checkout-root');
const money = (minor, currency) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

function parsePath() {
 const parts = location.pathname.split('/').filter(Boolean);
 if (parts[0] !== 'c' || parts.length !== 3) return null;
 return { productId: parts[1], offerSlug: parts[2] };
}

async function api(path, options) {
 const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } });
 const body = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(body.message || 'Não foi possível continuar.');
 return body;
}

function showError(message) {
 root.replaceChildren();
 const p = el('p', 'checkout-error');
 p.textContent = message;
 root.append(p);
}

function showStatus(title, message) {
 root.replaceChildren();
 const card = el('div', 'checkout-status');
 const h1 = el('h1'); h1.textContent = title;
 const p = el('p'); p.textContent = message;
 card.append(h1, p);
 root.append(card);
}

function applyBranding(branding) {
 document.documentElement.style.setProperty('--tpl-color', branding.primary_color);
 document.documentElement.style.setProperty('--tpl-radius', `${branding.border_radius}px`);
}

async function createSession(route, templateSlug) {
 return api('/api/checkout/sessions', {
  method: 'POST',
  body: JSON.stringify({ product_id: route.productId, offer_slug: route.offerSlug, template_slug: templateSlug ?? null }),
 });
}

async function mountEmbedded(clientSecret, publishableKey) {
 root.replaceChildren();
 const holder = el('div'); holder.id = 'checkout-embedded';
 root.append(holder);
 const stripe = window.Stripe && publishableKey ? window.Stripe(publishableKey) : null;
 if (!stripe) { showError('Não foi possível carregar o pagamento. Recarregue a página.'); return; }
 const checkout = await stripe.initEmbeddedCheckout({ clientSecret });
 checkout.mount('#checkout-embedded');
}

function renderOffer(route, data) {
 root.replaceChildren();
 applyBranding(data.template.branding);
 const card = el('div', 'checkout-card');

 if (data.template.branding.logo_url) {
  const brand = el('div', 'checkout-brand');
  const img = document.createElement('img');
  img.src = data.template.branding.logo_url;
  img.alt = data.product.name;
  brand.append(img);
  card.append(brand);
 }

 const offerBlock = el('div', 'checkout-offer');
 const h1 = el('h1'); h1.textContent = data.offer.name;
 const p = el('p'); p.textContent = data.product.name;
 offerBlock.append(h1, p);
 card.append(offerBlock);

 const price = el('div', 'checkout-price');
 price.textContent = money(data.offer.amount_minor, data.offer.currency);
 if (data.offer.kind === 'subscription') { const small = document.createElement('small'); small.textContent = data.offer.interval === 'year' ? '/ano' : '/mês'; price.append(small); }
 card.append(price);

 const button = el('button', 'checkout-pay');
 button.type = 'button';
 button.textContent = 'Pagar com cartão';
 button.onclick = async () => {
  button.disabled = true; button.textContent = 'Abrindo pagamento…';
  try {
   const session = await createSession(route, data.template.slug);
   if (session.url) { location.href = session.url; return; }
   if (session.clientSecret) { await mountEmbedded(session.clientSecret, data.stripe_publishable_key); return; }
   throw new Error('Resposta inesperada do servidor.');
  } catch (error) {
   button.disabled = false; button.textContent = 'Pagar com cartão';
   showError(error.message);
  }
 };
 card.append(button);

 const note = el('p', 'checkout-note');
 note.textContent = 'Pagamento processado pela Stripe. A confirmação chega por e-mail assim que aprovada.';
 card.append(note);

 root.append(card);
}

async function boot() {
 const route = parsePath();
 if (!route) { showError('Link de pagamento inválido.'); return; }

 const status = new URLSearchParams(location.search).get('status');
 if (status === 'success') { showStatus('Recebemos seu pagamento', 'A confirmação chega em instantes por e-mail.'); return; }
 if (status === 'cancel') { showStatus('Pagamento cancelado', 'Nenhuma cobrança foi feita. Você pode tentar novamente.'); }

 try {
  const query = new URLSearchParams({ product_id: route.productId, offer_slug: route.offerSlug });
  const data = await api(`/api/checkout/offer?${query}`);
  renderOffer(route, data);
 } catch (error) {
  showError(error.message);
 }
}

boot();
