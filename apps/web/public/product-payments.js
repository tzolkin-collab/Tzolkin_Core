import { createIcon, providerLogo } from './icons.js';

const el = (tag, text, cls) => {
 const n = document.createElement(tag);
 if (text !== undefined && text !== null) n.textContent = text;
 if (cls) n.className = cls;
 return n;
};

const moeda = (centavos = 0, curr = 'BRL') =>
 new Intl.NumberFormat('pt-BR', { style: 'currency', currency: curr || 'BRL' }).format((Number(centavos) || 0) / 100);

const TABS = {
 gateway: 'Gateway e Contas',
 catalogo: 'Produtos, Ofertas e Links',
 transacoes: 'Assinaturas e Cobranças',
 recebiveis: 'Parcelas de Contrato',
};

const GATEWAY_LABELS = {
 stripe: 'Stripe (Checkout, Links e Assinaturas)',
 asaas: 'Asaas (PIX e Boleto)',
 contract_billing: 'Faturamento por Contrato (Parcelas)',
};

export function setupProductPayments({ api, billing, receivables }) {
 let generation = 0, data = null, legacy = null, product = null, tab = 'gateway', noticeMsg = '';
 const host = () => document.getElementById('view-product-payments');

 async function refresh() {
  if (!product) return;
  const ticket = ++generation;
  try {
   const [mgmt, oldPay] = await Promise.all([
    api('/api/products/' + encodeURIComponent(product.id) + '/stripe-management'),
    api('/api/products/' + encodeURIComponent(product.id) + '/payments').catch(() => null),
   ]);
   if (ticket !== generation) return;
   data = mgmt;
   legacy = oldPay;
   render();
  } catch (error) {
   if (ticket === generation) host()?.replaceChildren(el('p', error.message, 'security-banner'));
  }
 }

 async function runAction(payload, successText) {
  noticeMsg = 'Processando na Stripe…';
  render();
  try {
   await api('/api/products/' + encodeURIComponent(product.id) + '/stripe-management', 'POST', payload);
   noticeMsg = successText || 'Operação concluída com sucesso.';
   await refresh();
  } catch (error) {
   noticeMsg = 'Erro: ' + (error.message || 'Falha na operação.');
   render();
  }
 }

 function renderGatewayTab(panel) {
  const cfg = data.config || {};
  const accounts = data.accounts || [];
  const stripe = data.stripe || {};

  // 1. Seleção de Gateway e Conta Stripe do Contexto
  const cardCfg = el('section', undefined, 'panel');
  cardCfg.append(
   el('h3', 'Gateway e Conta ativa do contexto'),
   el('p', 'Defina qual gateway processa as vendas deste contexto e qual conta da Stripe está vinculada.', 'detail')
  );
  const formCfg = el('form', undefined, 'form-grid');
  const lblGw = el('label', 'Gateway principal do contexto');
  const selGw = el('select');
  for (const [k, rotulo] of Object.entries(GATEWAY_LABELS)) {
   const opt = el('option', rotulo);
   opt.value = k;
   if (k === cfg.gateway) opt.selected = true;
   selGw.append(opt);
  }
  lblGw.append(selGw);

  const lblAcct = el('label', 'Conta da Stripe vinculada a este contexto');
  const selAcct = el('select');
  for (const acc of accounts) {
   const sufixo = acc.configured ? (acc.mode === 'live' ? ' · Produção' : ' · Teste') : ' · Sem chave';
   const opt = el('option', `${acc.label} (${acc.business_name || acc.id})${sufixo}`);
   opt.value = acc.id;
   if (acc.id === cfg.stripe_account_id) opt.selected = true;
   selAcct.append(opt);
  }
  lblAcct.append(selAcct);

  const btnSaveCfg = el('button', 'Salvar gateway e conta', 'primary');
  btnSaveCfg.type = 'submit';
  formCfg.append(lblGw, lblAcct, btnSaveCfg);
  formCfg.onsubmit = ev => {
   ev.preventDefault();
   runAction({ action: 'select_gateway', gateway: selGw.value, stripe_account_id: selAcct.value }, 'Gateway e conta do contexto atualizados.');
  };
  cardCfg.append(formCfg);
  panel.append(cardCfg);

  // 2. Resumo da conta conectada
  const cardStatus = el('section', undefined, 'panel');
  cardStatus.append(el('h3', 'Estado da conta Stripe selecionada'));
  if (stripe.connected && stripe.account) {
   const grid = el('div', undefined, 'metrics');
   for (const [k, v] of [
    ['Conta Stripe', stripe.account.business_name || stripe.account.id],
    ['ID na Stripe', stripe.account.id],
    ['Ambiente', stripe.mode === 'live' ? 'Produção (Live)' : 'Teste (Sandbox)'],
    ['Cobranças ativas', stripe.account.charges_enabled ? 'Habilitadas' : 'Restritas'],
   ]) {
    const c = el('article');
    c.append(el('span', k), el('strong', String(v)));
    grid.append(c);
   }
   cardStatus.append(grid);
  } else {
   cardStatus.append(
    el('p', stripe.error || 'Nenhuma chave secreta configurada para esta conta da Stripe.', 'detail')
   );
  }
  panel.append(cardStatus);

  // 3. Conectar nova conta Stripe (multi-conta)
  const cardNew = el('section', undefined, 'panel');
  cardNew.append(
   el('h3', 'Conectar nova conta da Stripe no Core'),
   el('p', 'Adicione outra conta da Stripe (de uma unidade de negócio, projeto ou sociedade). A chave secreta é validada na Stripe e guardada cifrada no cofre do Core.', 'detail')
  );
  const formNew = el('form', undefined, 'form-grid');
  const inLabel = el('input'); inLabel.placeholder = 'Ex.: Stripe Skiller ou Stripe Educação'; inLabel.required = true;
  const inSlug = el('input'); inSlug.placeholder = 'Ex.: skiller';
  const inKey = el('input'); inKey.type = 'password'; inKey.placeholder = 'sk_live_... ou sk_test_...'; inKey.required = true;
  const l1 = el('label', 'Nome da conta'); l1.append(inLabel);
  const l2 = el('label', 'Identificador curto (opcional)'); l2.append(inSlug);
  const l3 = el('label', 'Chave secreta da Stripe (Secret Key)'); l3.append(inKey);
  const btnConn = el('button', 'Validar e conectar conta Stripe', 'secondary'); btnConn.type = 'submit';
  formNew.append(l1, l2, l3, btnConn);
  formNew.onsubmit = ev => {
   ev.preventDefault();
   runAction(
    { action: 'connect_account', label: inLabel.value.trim(), slug: inSlug.value.trim(), secret_key: inKey.value.trim() },
    'Nova conta da Stripe validada, cifrada e vinculada a este contexto.'
   );
  };
  cardNew.append(formNew);
  panel.append(cardNew);
 }

 function renderCatalogoTab(panel) {
  const stripe = data.stripe || {};
  const localOffers = data.local_offers || [];

  // 1. Criar Produto + Oferta + Payment Link na Stripe
  const actionsGrid = el('div', undefined, 'pay-connections');

  const cardProd = el('section', undefined, 'panel');
  cardProd.append(el('h3', '1. Criar produto na Stripe'), el('p', 'Cria o produto diretamente na conta Stripe ativa já marcado com a metadata deste contexto.', 'detail'));
  const formProd = el('form', undefined, 'form-grid');
  const inProdName = el('input'); inProdName.value = product?.name || ''; inProdName.required = true;
  const inProdDesc = el('input'); inProdDesc.placeholder = 'Descrição comercial na fatura/checkout';
  const lp1 = el('label', 'Nome do produto na Stripe'); lp1.append(inProdName);
  const lp2 = el('label', 'Descrição'); lp2.append(inProdDesc);
  const btnProd = el('button', 'Criar produto na Stripe', 'secondary'); btnProd.type = 'submit';
  formProd.append(lp1, lp2, btnProd);
  formProd.onsubmit = ev => {
   ev.preventDefault();
   runAction({ action: 'create_product', name: inProdName.value.trim(), description: inProdDesc.value.trim() }, 'Produto criado na Stripe e vinculado ao contexto.');
  };
  cardProd.append(formProd);

  const cardPrice = el('section', undefined, 'panel');
  cardPrice.append(el('h3', '2. Criar oferta + Payment Link na Stripe'), el('p', 'Cria o preço na Stripe, gera o Payment Link oficial da Stripe e sincroniza a oferta no Core.', 'detail'));
  const formPrice = el('form', undefined, 'form-grid');
  const selStripeProd = el('select');
  const optAuto = el('option', 'Usar produto padrão do contexto (ou criar automaticamente)');
  optAuto.value = data.config?.default_stripe_product_id || '';
  selStripeProd.append(optAuto);
  for (const p of stripe.products || []) {
   const o = el('option', `${p.name} (${p.id})${p.context_match ? ' ★' : ''}`);
   o.value = p.id;
   if (p.id === data.config?.default_stripe_product_id) o.selected = true;
   selStripeProd.append(o);
  }
  const inOfferName = el('input'); inOfferName.placeholder = `Ex.: ${product?.name || 'Plano'} Anual`; inOfferName.required = true;
  const inAmount = el('input'); inAmount.type = 'number'; inAmount.step = '0.01'; inAmount.min = '1'; inAmount.placeholder = 'Ex.: 497.00'; inAmount.required = true;
  const selKind = el('select');
  for (const [v, t] of [['subscription:month', 'Assinatura Mensal'], ['subscription:year', 'Assinatura Anual'], ['one_time:', 'Pagamento Único (à vista)']]) {
   const o = el('option', t); o.value = v; selKind.append(o);
  }
  const inRedirect = el('input'); inRedirect.placeholder = 'https://seusite.com.br/obrigado (opcional)';

  const lpr1 = el('label', 'Produto na Stripe'); lpr1.append(selStripeProd);
  const lpr2 = el('label', 'Nome da oferta'); lpr2.append(inOfferName);
  const lpr3 = el('label', 'Valor (R$)'); lpr3.append(inAmount);
  const lpr4 = el('label', 'Modalidade'); lpr4.append(selKind);
  const lpr5 = el('label', 'Redirecionamento pós-compra'); lpr5.append(inRedirect);
  const btnPrice = el('button', 'Criar oferta e Payment Link', 'primary'); btnPrice.type = 'submit';
  formPrice.append(lpr1, lpr2, lpr3, lpr4, lpr5, btnPrice);
  formPrice.onsubmit = ev => {
   ev.preventDefault();
   const [kind, interval] = selKind.value.split(':');
   const amountMinor = Math.round( parseFloat(String(inAmount.value).replace(',', '.')) * 100 );
   runAction({
    action: 'create_price',
    stripe_product_id: selStripeProd.value || undefined,
    name: inOfferName.value.trim(),
    amount_minor: amountMinor,
    currency: 'BRL',
    kind,
    interval: interval || null,
    redirect_url: inRedirect.value.trim() || undefined,
    create_payment_link: true,
   }, 'Oferta e Payment Link criados na Stripe e sincronizados no Core.');
  };
  cardPrice.append(formPrice);

  actionsGrid.append(cardProd, cardPrice);
  panel.append(actionsGrid);

  // 2. Ofertas sincronizadas neste contexto
  const secOffers = el('section', undefined, 'panel');
  const topBar = el('div', undefined, 'section-toolbar');
  const copy = el('div');
  copy.append(el('h3', 'Ofertas ativas deste contexto'), el('p', 'Use o Payment Link oficial da Stripe no site. O script CDN do Core adiciona automaticamente as UTMs do contexto ao link.', 'detail'));
  if (billing?.mount) {
   const btnRegras = el('button', 'Automações de e-mail por oferta', 'secondary');
   btnRegras.type = 'button';
   btnRegras.onclick = () => billing.mount(product, host());
   topBar.append(copy, btnRegras);
  } else {
   topBar.append(copy);
  }
  secOffers.append(topBar);

  const offersGrid = el('div', undefined, 'pay-offers');
  for (const off of localOffers) {
   const card = el('article', undefined, 'pay-offer');
   card.append(
    el('span', off.provider === 'stripe' ? 'Stripe' : 'Asaas', 'client-chip'),
    el('h3', off.name || off.slug),
    el('p', off.kind === 'subscription' ? `Assinatura (${off.interval === 'year' ? 'Anual' : 'Mensal'})` : 'Pagamento único', 'detail'),
    el('strong', moeda(off.amount_minor, off.currency))
   );
   if (off.offer_ref) card.append(el('p', `Preço Stripe: ${off.offer_ref}`, 'detail mono'));
   const linkRow = el('div', undefined, 'pay-link');
   if (off.payment_link_url) {
    const copyBtn = el('button', 'Copiar Payment Link Stripe', 'primary');
    copyBtn.type = 'button';
    copyBtn.onclick = async () => {
     try {
      await navigator.clipboard.writeText(off.payment_link_url);
      copyBtn.textContent = 'Link copiado!';
      setTimeout(() => { copyBtn.textContent = 'Copiar Payment Link Stripe'; }, 2000);
     } catch {
      copyBtn.textContent = off.payment_link_url;
     }
    };
    linkRow.append(copyBtn);
   } else if (off.offer_ref && off.provider === 'stripe') {
    const genBtn = el('button', 'Gerar Payment Link na Stripe', 'secondary');
    genBtn.type = 'button';
    genBtn.onclick = () => runAction({ action: 'create_payment_link', price_id: off.offer_ref }, 'Payment Link gerado na Stripe.');
    linkRow.append(genBtn);
   }
   card.append(linkRow);
   offersGrid.append(card);
  }
  if (!localOffers.length) offersGrid.append(el('p', 'Nenhuma oferta vinculada a este contexto ainda. Crie acima ou importe do catálogo da Stripe abaixo.', 'empty-list'));
  secOffers.append(offersGrid);
  panel.append(secOffers);

  // 3. Catálogo existente na conta Stripe (para importar/vincular em 1 clique)
  if ((stripe.prices || []).length) {
   const secStripeCat = el('section', undefined, 'panel');
   secStripeCat.append(
    el('h3', 'Preços existentes na conta Stripe'),
    el('p', 'Preços já cadastrados na conta Stripe selecionada. Vincule qualquer preço a este contexto com um clique.', 'detail')
   );
   const list = el('div', undefined, 'tracking-list');
   for (const pr of stripe.prices) {
    const row = el('article', undefined, 'tracking-row');
    row.append(
     el('strong', `${pr.product_name} · ${pr.nickname}`),
     el('span', `${moeda(pr.amount_minor, pr.currency)} (${pr.kind === 'subscription' ? pr.interval : 'à vista'})`),
     el('span', pr.id, 'detail mono')
    );
    if (pr.linked_in_core) {
     row.append(el('span', 'Vinculado ao contexto', 'status active'));
    } else {
     const btnSync = el('button', 'Vincular a este contexto', 'secondary');
     btnSync.type = 'button';
     btnSync.onclick = () => runAction({ action: 'sync_offer', price_id: pr.id, name: `${pr.product_name} - ${pr.nickname}` }, 'Preço da Stripe vinculado ao contexto.');
     row.append(btnSync);
    }
    list.append(row);
   }
   secStripeCat.append(list);
   panel.append(secStripeCat);
  }
 }

 function renderTransacoesTab(panel) {
  const stripe = data.stripe || {};
  const purchases = data.local_purchases || [];

  // 1. Assinaturas na Stripe
  const secSubs = el('section', undefined, 'panel');
  secSubs.append(el('h3', 'Assinaturas na Stripe'), el('p', 'Assinaturas lidas em tempo real da conta Stripe conectada.', 'detail'));
  const subsList = el('div', undefined, 'tracking-list');
  for (const s of stripe.subscriptions || []) {
   const row = el('article', undefined, 'tracking-row');
   row.append(
    el('strong', `${s.id} · ${moeda(s.amount_minor, s.currency)}`),
    el('span', `Cliente: ${s.customer} · Status: ${s.status}`),
    el('span', s.current_period_end ? `Renovação: ${s.current_period_end.slice(0, 10)}` : '', 'detail')
   );
   if (s.status === 'active' || s.status === 'trialing') {
    const btnCancel = el('button', s.cancel_at_period_end ? 'Cancelamento agendado' : 'Cancelar ao fim do ciclo', 'secondary');
    btnCancel.type = 'button';
    btnCancel.disabled = s.cancel_at_period_end;
    btnCancel.onclick = () => runAction({ action: 'cancel_subscription', subscription_id: s.id, immediate: false }, 'Cancelamento ao fim do período agendado na Stripe.');
    row.append(btnCancel);
   }
   subsList.append(row);
  }
  if (!(stripe.subscriptions || []).length) subsList.append(el('p', 'Nenhuma assinatura encontrada nesta conta Stripe.', 'empty-list'));
  secSubs.append(subsList);
  panel.append(secSubs);

  // 2. Cobranças / Pagamentos registrados no Core e na Stripe
  const secCharges = el('section', undefined, 'panel');
  secCharges.append(el('h3', 'Pagamentos e cobranças recentes'), el('p', 'Compras registradas no Core para este contexto e intenções de pagamento na Stripe.', 'detail'));
  const chargesList = el('div', undefined, 'tracking-list');
  for (const p of purchases) {
   const row = el('article', undefined, 'tracking-row');
   row.append(
    el('strong', `${p.customer_name || p.customer_email || p.external_id}`),
    el('span', `${moeda(p.amount_cents, p.currency)} · ${p.provider.toUpperCase()} · ${p.status}`),
    el('span', String(p.updated_at || '').slice(0, 10), 'detail')
   );
   chargesList.append(row);
  }
  for (const c of stripe.charges || []) {
   const row = el('article', undefined, 'tracking-row');
   row.append(
    el('strong', `${c.customer_email || c.description || c.id}`),
    el('span', `${moeda(c.amount_minor, c.currency)} · Stripe · ${c.status}`),
    el('span', String(c.created_at || '').slice(0, 10), 'detail')
   );
   chargesList.append(row);
  }
  if (!purchases.length && !(stripe.charges || []).length) {
   chargesList.append(el('p', 'Nenhum pagamento registrado para este contexto ainda.', 'empty-list'));
  }
  secCharges.append(chargesList);
  panel.append(secCharges);
 }

 function renderRecebiveisTab(panel) {
  const rows = data.contract_receivables || [];
  const sec = el('section', undefined, 'panel');
  const top = el('div', undefined, 'section-toolbar');
  const copy = el('div');
  copy.append(
   el('h3', 'Parcelas de contratações deste contexto'),
   el('p', 'Recebíveis vinculados às contratações atribuídas a este contexto.', 'detail')
  );
  top.append(copy);
  sec.append(top);

  const list = el('div', undefined, 'tracking-list');
  for (const r of rows) {
   const item = el('article', undefined, 'tracking-row');
   item.append(
    el('strong', `${r.tenant_name} · ${r.engagement_title}`),
    el('span', `Parcela ${r.installment}: ${moeda(r.amount_minor, r.currency)} · Vencimento ${String(r.due_date || '').slice(0, 10)}`),
    el('span', r.status === 'paid' ? 'Pago' : r.status === 'cancelled' ? 'Cancelado' : 'Em aberto', 'status ' + (r.status === 'paid' ? 'active' : 'building'))
   );
   list.append(item);
  }
  if (!rows.length) list.append(el('p', 'Nenhuma parcela de contrato cadastrada para as contratações deste contexto.', 'empty-list'));
  sec.append(list);

  if (receivables?.load) {
   const hostRec = el('div');
   sec.append(hostRec);
  }
  panel.append(sec);
 }

 function render() {
  const root = host();
  if (!root) return;
  root.replaceChildren();
  if (!data) {
   root.append(el('p', 'Carregando pagamentos e conta Stripe do contexto…', 'empty-list'));
   return;
  }

  const intro = el('section', undefined, 'pay-product-hero');
  intro.append(
   el('span', 'PAGAMENTOS E GATEWAY DO CONTEXTO', 'overview-kicker'),
   el('h2', `Pagamentos · ${product.name}`),
   el('p', 'Escolha o gateway, conecte e gerencie contas da Stripe, crie produtos, ofertas e Payment Links ou acompanhe parcelas de contratos deste contexto.')
  );
  root.append(intro);

  if (noticeMsg) {
   const banner = el('p', noticeMsg, 'notice-inline');
   root.append(banner);
  }

  // Resumo rápido no topo
  const connections = el('div', undefined, 'pay-connections');
  const activeAcct = (data.accounts || []).find(a => a.id === data.config?.stripe_account_id) || data.accounts?.[0];
  const cards = [
   ['Gateway ativo', GATEWAY_LABELS[data.config?.gateway] || 'Stripe', true],
   ['Conta Stripe no contexto', activeAcct ? `${activeAcct.label} (${activeAcct.mode || 'sem chave'})` : 'Padrão', Boolean(data.stripe?.connected)],
   ['Ofertas no contexto', `${(data.local_offers || []).length} oferta(s) / ${(data.contract_receivables || []).length} parcela(s)`, true],
  ];
  for (const [titulo, subtitulo, ok] of cards) {
   const card = el('article', undefined, 'pay-connection');
   const mark = el('span', undefined, 'pay-provider-mark');
   mark.append(providerLogo('stripe'));
   const body = el('div');
   body.append(el('h3', titulo), el('p', subtitulo, 'detail'));
   card.append(mark, body, el('span', ok ? 'Ativo' : 'Pendente', 'status ' + (ok ? 'active' : 'building')));
   connections.append(card);
  }
  root.append(connections);

  const nav = el('nav', undefined, 'resource-tabs');
  nav.setAttribute('aria-label', 'Seções de pagamentos do contexto');
  for (const [key, label] of Object.entries(TABS)) {
   const botao = el('button', label, 'secondary');
   botao.type = 'button';
   if (key === tab) botao.setAttribute('aria-current', 'page');
   botao.onclick = () => {
    if (tab === key) return;
    tab = key;
    noticeMsg = '';
    render();
   };
   nav.append(botao);
  }
  root.append(nav);

  const panel = el('div', undefined, 'pay-panel');
  root.append(panel);
  if (tab === 'gateway') renderGatewayTab(panel);
  else if (tab === 'catalogo') renderCatalogoTab(panel);
  else if (tab === 'transacoes') renderTransacoesTab(panel);
  else renderRecebiveisTab(panel);
 }

 async function load(next) {
  product = next;
  data = null;
  noticeMsg = '';
  render();
  await refresh();
 }

 function clear() {
  generation++;
  data = null;
  legacy = null;
  product = null;
  tab = 'gateway';
  noticeMsg = '';
  host()?.replaceChildren();
 }

 return { load, clear };
}
