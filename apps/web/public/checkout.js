// Página pública de checkout. Sem framework, sem build: o mesmo padrão do
// resto do painel. Carrega em /c/:productId/:offerSlug, lê a oferta e o
// template no servidor (nunca decide preço aqui) e cria a sessão de
// pagamento só quando o cliente clica em pagar.
//
// TEMA: todo valor visual é um token --tpl-*, escrito por CSSOM. A CSP é
// style-src 'self' e setProperty não passa por ela — por isso o tema funciona
// sem afrouxar política nenhuma. Todo valor é revalidado AQUI antes de virar
// CSS, mesmo já tendo sido validado no servidor: o modo prévia recebe tema por
// postMessage, que não passa pelo servidor. `red;background:url(...)` é
// exatamente a injeção que essa segunda checagem barra.
//
// TEXTO: sempre via textContent, nunca innerHTML. É o que torna copy escrita
// por operador segura por construção. Não troque isso para "permitir negrito".
//
// PRÉVIA: com ?preview=1 dentro de um iframe da mesma origem, a página renderiza
// tudo normalmente, substitui a área de pagamento por um marcador rotulado e
// NUNCA cria sessão. O editor manda rascunhos de tema e texto por postMessage.
const root = document.getElementById('checkout-root');
const money = (minor, currency) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100);
const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

// Tabelas fixas: um token de enum vira valor CSS só passando por aqui. A folha
// de estilo nunca recebe string arbitrária.
const FONTS = { system: 'system-ui,-apple-system,"Segoe UI",sans-serif' };
const SHADOWS = { none: 'none', soft: '0 1px 3px rgba(15,23,42,.06)', lifted: '0 10px 30px rgba(15,23,42,.12)' };
const DENSITIES = { compact: [14, 20, 18], regular: [20, 28, 24], roomy: [28, 36, 30] };
const WIDTHS = [420, 480, 560];
const COLOR = /^#[0-9a-f]{6}$/i;

const THEME_KEYS = ['color', 'ink', 'muted', 'line', 'bg', 'surface', 'danger',
 'radius', 'border_width', 'scale', 'shadow', 'density', 'width', 'font_family', 'font_display', 'logo_url'];

// Luminância relativa (WCAG). A tinta sobre a cor principal é CALCULADA, nunca
// escolhida — é o que impede publicar branco sobre amarelo. Fica aqui, e não no
// servidor, porque o rascunho da prévia não passa por ele: o contraste tem de
// acompanhar a cor enquanto o operador arrasta o seletor.
function contrastInk(hex) {
 const canal = n => { const c = n / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
 const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
 const luminancia = 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
 return (luminancia + 0.05) / 0.05 > 4.5 ? '#111827' : '#ffffff';
}
const COPY_KEYS = ['headline', 'subheadline', 'cta_label', 'cta_label_processing', 'security_note', 'guarantee',
 'success_title', 'success_body', 'cancel_title', 'cancel_body', 'error_generic', 'invalid_link'];

const estado = { route: null, data: null, theme: {}, copy: {} };
const params = new URLSearchParams(location.search);
// As duas condições juntas: a flag sozinha, numa aba comum, não vira prévia.
const modoPrevia = params.get('preview') === '1' && window.parent !== window;
const texto = chave => estado.copy[chave] ?? '';

function parsePath() {
 const parts = location.pathname.split('/').filter(Boolean);
 if (parts[0] !== 'c' || parts.length !== 3) return null;
 return { productId: parts[1], offerSlug: parts[2] };
}

async function api(path, options) {
 const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } });
 const body = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(body.message || texto('error_generic') || 'Não foi possível continuar.');
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

function applyTheme(theme) {
 const style = document.documentElement.style;
 const cor = (nome, valor) => { if (typeof valor === 'string' && COLOR.test(valor)) style.setProperty(nome, valor.toLowerCase()); };
 const inteiro = (valor, min, max, padrao) => (Number.isInteger(valor) && valor >= min && valor <= max ? valor : padrao);

 const principal = typeof theme.color === 'string' && COLOR.test(theme.color) ? theme.color.toLowerCase() : '#111827';
 cor('--tpl-color', principal);
 cor('--tpl-color-contrast', contrastInk(principal));
 cor('--tpl-ink', theme.ink);
 cor('--tpl-muted', theme.muted);
 cor('--tpl-line', theme.line);
 cor('--tpl-bg', theme.bg);
 cor('--tpl-surface', theme.surface);
 cor('--tpl-danger', theme.danger);

 const radius = inteiro(theme.radius, 0, 24, 12);
 style.setProperty('--tpl-radius', `${radius}px`);
 // O cartão sempre teve 1,5× o raio do botão. A conta sai do CSS para cá porque
 // é a mesma regra do resto: valor calculado, nunca expressão vinda de fora.
 style.setProperty('--tpl-radius-card', `${Math.round(radius * 1.5)}px`);
 style.setProperty('--tpl-border', `${inteiro(theme.border_width, 0, 3, 1)}px`);
 style.setProperty('--tpl-scale', String(inteiro(theme.scale, 85, 125, 100) / 100));
 style.setProperty('--tpl-shadow', SHADOWS[theme.shadow] ?? SHADOWS.soft);
 const [gap, padY, padX] = DENSITIES[theme.density] ?? DENSITIES.regular;
 style.setProperty('--tpl-gap', `${gap}px`);
 style.setProperty('--tpl-pad-y', `${padY}px`);
 style.setProperty('--tpl-pad-x', `${padX}px`);
 const largura = WIDTHS.includes(theme.width) ? theme.width : 420;
 style.setProperty('--tpl-width', `${largura}px`);
 // Largura das duas colunas: a escolha do operador vale por coluna, e o desktop
 // ganha as duas mais o vão. Antes o cartão de 420px ficava perdido no meio de
 // um monitor inteiro.
 style.setProperty('--tpl-width-wide', `${largura * 2 + 48}px`);
 style.setProperty('--tpl-font', FONTS[theme.font_family] ?? FONTS.system);
 style.setProperty('--tpl-font-display', FONTS[theme.font_display] ?? FONTS.system);
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

// Marca a parte com seu id de camada. O vocabulário é o de LAYERS em
// platform/checkout-model.mjs, e um teste garante que as duas listas não
// divergem — é o que faz "cliquei nisto" virar "estes campos controlam isto".
const camada = (node, id) => { node.dataset.layer = id; return node; };

// Só na prévia: um lugar clicável onde ainda não há conteúdo. Sem isto, não dá
// para clicar na logo para definir a logo, porque não existe logo para clicar.
const vazio = (id, rotulo) => {
 const marcador = el('div', 'checkout-empty-layer');
 marcador.textContent = rotulo;
 return camada(marcador, id);
};

function renderOffer(aviso) {
 const { route, data } = estado;
 root.replaceChildren();
 applyTheme(estado.theme);
 const card = el('div', 'checkout-card');
 // Duas colunas no desktop, empilhadas no celular. A ordem do DOM é a mesma de
 // sempre — resumo e depois pagamento — então o celular não muda nada e é o CSS
 // que reparte a largura quando ela existe.
 const resumo = el('div', 'checkout-col checkout-col-resumo');
 const pagamento = el('div', 'checkout-col checkout-col-pagamento');

 // Cancelamento aparece ACIMA da oferta, não no lugar dela: o texto padrão diz
 // "você pode tentar novamente", e trocar a página por um aviso tiraria
 // justamente o botão de tentar. Antes deste editor a mensagem era escrita e
 // sobrescrita pelo render seguinte, então nunca chegava a ser vista.
 if (aviso) { const p = el('p', 'checkout-guarantee'); p.textContent = aviso; resumo.append(p); }

 if (estado.theme.logo_url) {
  const brand = el('div', 'checkout-brand');
  const img = document.createElement('img');
  img.src = estado.theme.logo_url;
  img.alt = data.product.name;
  brand.append(img);
  resumo.append(camada(brand, 'brand'));
 } else if (modoPrevia) resumo.append(vazio('brand', 'Logo — clique para definir'));

 // Cabeçalho opcional: sem headline configurada, a página fica idêntica à que
 // existia antes do editor. Nada aparece por padrão.
 if (texto('headline') || texto('subheadline')) {
  const bloco = el('div');
  if (texto('headline')) { const h = el('h2', 'checkout-headline'); h.textContent = texto('headline'); bloco.append(h); }
  if (texto('subheadline')) { const p = el('p', 'checkout-subheadline'); p.textContent = texto('subheadline'); bloco.append(p); }
  resumo.append(camada(bloco, 'headline'));
 } else if (modoPrevia) resumo.append(vazio('headline', 'Chamada — clique para escrever'));

 const offerBlock = el('div', 'checkout-offer');
 const h1 = el('h1'); h1.textContent = data.offer.name;
 const p = el('p'); p.textContent = data.product.name;
 offerBlock.append(h1, p);
 resumo.append(camada(offerBlock, 'offer'));

 const price = el('div', 'checkout-price');
 price.textContent = money(data.offer.amount_minor, data.offer.currency);
 if (data.offer.kind === 'subscription') { const small = document.createElement('small'); small.textContent = data.offer.interval === 'year' ? '/ano' : '/mês'; price.append(small); }
 resumo.append(camada(price, 'price'));

 if (modoPrevia) {
  // A prévia nunca cria sessão de pagamento. Marcador rotulado no lugar do
  // botão, para ninguém confundir o que está vendo com o fluxo real.
  const slot = el('div', 'checkout-preview-slot');
  slot.textContent = 'Área de pagamento. Na página real, é aqui que o pagamento acontece.';
  pagamento.append(camada(slot, 'payment'));
  const falso = el('div', 'checkout-pay checkout-pay-preview');
  falso.textContent = texto('cta_label');
  pagamento.append(camada(falso, 'cta'));
 } else {
  const button = el('button', 'checkout-pay');
  button.type = 'button';
  button.textContent = texto('cta_label');
  button.onclick = async () => {
   button.disabled = true; button.textContent = texto('cta_label_processing');
   try {
    const session = await createSession(route, data.template.slug);
    if (session.url) { location.href = session.url; return; }
    if (session.clientSecret) { await mountEmbedded(session.clientSecret, data.stripe_publishable_key); return; }
    throw new Error('Resposta inesperada do servidor.');
   } catch (error) {
    button.disabled = false; button.textContent = texto('cta_label');
    showError(error.message);
   }
  };
  pagamento.append(camada(button, 'cta'));
 }

 if (texto('guarantee')) { const g = el('p', 'checkout-guarantee'); g.textContent = texto('guarantee'); pagamento.append(camada(g, 'guarantee')); }
 else if (modoPrevia) pagamento.append(vazio('guarantee', 'Garantia — clique para escrever'));

 const note = el('p', 'checkout-note');
 note.textContent = texto('security_note');
 pagamento.append(camada(note, 'note'));

 card.append(resumo, pagamento);
 root.append(card);
 if (modoPrevia) marcarAtiva(estado.camadaAtiva);
}

// Rascunho do editor: aplica tema e texto sem gravar e sem refetch. Lê por
// allowlist explícita, nunca por spread — a lista é a única defesa entre o que
// chega pela mensagem e o que vira CSS.
function aplicarRascunho(draft) {
 if (draft.theme && typeof draft.theme === 'object') {
  for (const chave of THEME_KEYS) if (draft.theme[chave] !== undefined) estado.theme[chave] = draft.theme[chave];
 }
 if (draft.copy && typeof draft.copy === 'object') {
  for (const chave of COPY_KEYS) if (typeof draft.copy[chave] === 'string') estado.copy[chave] = draft.copy[chave];
 }
 if (estado.data) renderOffer();
}

// Camada ativa: destaque na prévia e seleção no editor são o mesmo estado, visto
// dos dois lados. Clicar na página seleciona no painel; selecionar no painel
// destaca na página.
function marcarAtiva(id) {
 estado.camadaAtiva = id || null;
 for (const node of root.querySelectorAll('[data-layer]')) node.classList.toggle('layer-active', node.dataset.layer === estado.camadaAtiva);
}

if (modoPrevia) {
 document.documentElement.classList.add('modo-previa');
 // Delegação: o card é recriado a cada rascunho, então prender o ouvinte na
 // raiz evita religar tudo a cada tecla digitada no editor.
 root.addEventListener('click', event => {
  const alvo = event.target.closest?.('[data-layer]');
  if (!alvo) return;
  event.preventDefault();
  marcarAtiva(alvo.dataset.layer);
  window.parent.postMessage({ type: 'checkout-preview-pick', layer: alvo.dataset.layer }, location.origin);
 });
 addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (event.data?.type === 'checkout-preview-draft') return aplicarRascunho(event.data);
  if (event.data?.type === 'checkout-preview-highlight') return marcarAtiva(typeof event.data.layer === 'string' ? event.data.layer : null);
 });
}

async function boot() {
 const route = parsePath();
 estado.route = route;
 if (!route) { showError('Link de pagamento inválido.'); return; }

 const status = params.get('status');

 try {
  const query = new URLSearchParams({ product_id: route.productId, offer_slug: route.offerSlug });
  if (params.get('template')) query.set('template_slug', params.get('template'));
  const data = await api(`/api/checkout/offer?${query}`);
  estado.data = data;
  estado.theme = { ...data.template.theme };
  estado.copy = { ...data.template.copy };
  // O tema vale também nas telas de status: é onde a confiança se ganha ou se
  // perde, e uma página de sucesso sem a marca parece outra empresa.
  applyTheme(estado.theme);
  if (status === 'success') { showStatus(texto('success_title'), texto('success_body')); return; }
  renderOffer(status === 'cancel' ? texto('cancel_body') : null);
  if (modoPrevia) window.parent.postMessage({ type: 'checkout-preview-ready' }, location.origin);
 } catch (error) {
  showError(error.message);
 }
}

boot();
