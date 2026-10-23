import { $, node } from './dom.js';
import { mountTabs } from './tabs.js';
import { tabela, celulaNome, selo } from './data-table.js';
import { providerLogo, createIcon } from './icons.js';

// CRM → Pagamentos: as vendas do mês dos processadores (Stripe e Asaas) e o estado de cada conexão.
// Os dados vêm de /api/finance/sales (um retrato por processador e mês). Cada venda tem: provider, date, description, gross, fee, net,
// refunded, status (received, pending, failed, refunded, partial_refund) e method.

const PROCESSADORES = { stripe: 'Stripe', asaas: 'Asaas' };
const SITUACAO = { received: ['Recebida', 'success'], pending: ['Pendente', 'info'], failed: ['Falhou', 'danger'], refunded: ['Estornada', 'neutral'], partial_refund: ['Estorno parcial', 'warning'] };
const METODOS = { credit_card: 'Cartão de crédito', card: 'Cartão', debit_card: 'Cartão de débito', pix: 'Pix', boleto: 'Boleto', undefined: 'Não informado' };
const FILTROS_DE_SITUACAO = [['', 'Todas as situações'], ['received', 'Recebidas'], ['pending', 'Pendentes'], ['failed', 'Falharam'], ['estorno', 'Estornadas']];

const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesDeHoje = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date());
const deslocar = (mes, delta) => { const [a, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + delta, 15)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const rotuloDoMes = mes => { const t = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-15T12:00:00Z`)); return t[0].toUpperCase() + t.slice(1); };
const quando = v => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);
const metodo = m => METODOS[String(m ?? '').toLowerCase()] || METODOS[m] || m || 'Não informado';
const ehEstorno = s => s.status === 'refunded' || s.status === 'partial_refund';

/** Totais de um conjunto de vendas. Só o que foi recebido entra no bruto, nas taxas e no líquido; pendente e falha ficam à parte. */
export function totais(vendas) {
 const t = { bruto: 0, taxas: 0, estornos: 0, liquido: 0, recebidas: 0, pendentes: 0, aReceber: 0, falhas: 0 };
 for (const s of vendas) {
  if (s.status === 'pending') { t.pendentes++; t.aReceber += s.gross || 0; continue; }
  if (s.status === 'failed') { t.falhas++; continue; }
  t.recebidas++;
  t.bruto += s.gross || 0; t.taxas += s.fee || 0; t.estornos += s.refunded || 0;
  t.liquido += s.net != null ? s.net : (s.gross || 0) - (s.fee || 0);
 }
 return t;
}

export function setupCrmPagamentos({ api, reportError, abrirIntegracoes }) {
 let aba = 'vendas', mes = mesDeHoje(), dados = null, processador = '', situacao = '', geracao = 0;

 async function carregar(forcar = false) {
  const ticket = ++geracao;
  if (forcar || !dados || dados.month !== mes) dados = null;
  desenhar();
  try {
   const r = dados ?? await api('/api/finance/sales?month=' + mes);
   if (ticket !== geracao) return;
   dados = r;
  } catch (e) { if (ticket !== geracao) return; dados = { erro: e.message }; }
  desenhar();
 }

 const vendasDoMes = () => Object.entries(dados?.providers || {}).flatMap(([nome, p]) => (p.snapshot?.payload?.sales || []).map(s => ({ ...s, provider: s.provider || nome })))
  .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
 const atualizadoEm = () => Object.values(dados?.providers || {}).map(p => p.snapshot?.updated_at).filter(Boolean).sort().at(-1) || null;

 async function sincronizar(botao) {
  botao.disabled = true; botao.textContent = 'Sincronizando…';
  try { await api('/api/finance/sales/sync', 'POST', { month: mes }); await carregar(true); }
  catch (e) { reportError(e); botao.disabled = false; botao.textContent = 'Sincronizar'; }
 }

 function barraDoMes() {
  const barra = node('div', undefined, 'pg-barra');
  const nav = node('div', undefined, 'pg-mes');
  const voltar = node('button', undefined, 'quiet'); voltar.type = 'button'; voltar.setAttribute('aria-label', 'Mês anterior'); voltar.append(createIcon('arrow'));
  voltar.firstChild.style.transform = 'rotate(180deg)';
  const avancar = node('button', undefined, 'quiet'); avancar.type = 'button'; avancar.setAttribute('aria-label', 'Próximo mês'); avancar.append(createIcon('arrow'));
  avancar.disabled = mes >= mesDeHoje();
  voltar.onclick = () => { mes = deslocar(mes, -1); carregar(); };
  avancar.onclick = () => { mes = deslocar(mes, 1); carregar(); };
  nav.append(voltar, node('strong', rotuloDoMes(mes)), avancar);
  const direita = node('div', undefined, 'pg-sync');
  const em = quando(atualizadoEm());
  direita.append(node('span', em ? `Atualizado em ${em}` : 'Ainda não sincronizado', 'detail'));
  const botao = node('button', 'Sincronizar', 'secondary'); botao.type = 'button'; botao.onclick = () => sincronizar(botao);
  direita.append(botao);
  barra.append(nav, direita);
  return barra;
 }

 function resumo(vendas) {
  const t = totais(vendas);
  const caixa = node('section', undefined, 'pg-resumo'); caixa.setAttribute('aria-label', 'Resumo do mês');
  const linha = node('div', undefined, 'pg-conta');
  const termo = (rotulo, valor, classe) => { const d = node('div', undefined, 'pg-termo ' + (classe || '')); d.append(node('span', rotulo), node('strong', valor)); return d; };
  linha.append(termo('Bruto', money(t.bruto)), node('span', '−', 'pg-op'), termo('Taxas', money(t.taxas)), node('span', '−', 'pg-op'), termo('Estornos', money(t.estornos)), node('span', '=', 'pg-op'), termo('Líquido', money(t.liquido - t.estornos), 'pg-liquido'));
  const nota = [`${t.recebidas} ${t.recebidas === 1 ? 'venda recebida' : 'vendas recebidas'}`, t.pendentes ? `${t.pendentes} pendente${t.pendentes === 1 ? '' : 's'} (${money(t.aReceber)} a receber)` : null, t.falhas ? `${t.falhas} ${t.falhas === 1 ? 'falhou' : 'falharam'}` : null].filter(Boolean).join(' · ');
  caixa.append(linha, node('p', nota, 'detail'));
  return caixa;
 }

 function filtros(vendas, aoMudar) {
  const caixa = node('div', undefined, 'pg-filtros');
  const grupo = node('div', undefined, 'pg-segmentos'); grupo.setAttribute('role', 'group'); grupo.setAttribute('aria-label', 'Processador');
  const opcoes = [['', 'Todos', vendas.length], ...Object.entries(PROCESSADORES).map(([k, n]) => [k, n, vendas.filter(s => s.provider === k).length])];
  for (const [chave, rotulo, n] of opcoes) {
   const b = node('button', undefined, 'pg-segmento'); b.type = 'button'; b.setAttribute('aria-pressed', String(processador === chave));
   b.append(document.createTextNode(rotulo), node('span', String(n), 'tab-count'));
   b.onclick = () => { processador = chave; aoMudar(); };
   grupo.append(b);
  }
  const sel = node('select'); sel.setAttribute('aria-label', 'Situação');
  for (const [valor, texto] of FILTROS_DE_SITUACAO) { const o = node('option', texto); o.value = valor; sel.append(o); }
  sel.value = situacao; sel.onchange = () => { situacao = sel.value; aoMudar(); };
  caixa.append(grupo, sel);
  return caixa;
 }

 function tabelaDeVendas(vendas) {
  const filtradas = vendas.filter(s => (!processador || s.provider === processador) && (!situacao || (situacao === 'estorno' ? ehEstorno(s) : s.status === situacao)));
  const area = node('div');
  if (!filtradas.length) { area.append(node('p', vendas.length ? 'Nenhuma venda com esses filtros.' : `Nenhuma venda em ${rotuloDoMes(mes)}. Sincronize para buscar nos processadores.`, 'empty-list')); return area; }
  area.append(tabela({
   legenda: 'Vendas do mês',
   linhas: filtradas,
   colunas: [
    { titulo: 'Data', celula: s => (s.date ? new Date(s.date).toLocaleDateString('pt-BR') : '—') },
    { titulo: 'Venda', celula: s => celulaNome({ nome: s.description || 'Venda', apoio: metodo(s.method) }) },
    { titulo: 'Processador', celula: s => { const c = node('span', undefined, 'pg-proc'); const logo = providerLogo(s.provider); if (logo) c.append(logo); c.append(document.createTextNode(PROCESSADORES[s.provider] || s.provider)); return c; } },
    { titulo: 'Situação', celula: s => selo(...(SITUACAO[s.status] || [s.status, 'neutral'])) },
    { titulo: 'Bruto', num: true, celula: s => (s.gross == null ? '—' : money(s.gross)) },
    // Pendente ainda não liquidou: sem taxa nem líquido para mostrar. Estornada: o líquido já desconta o que voltou ao cliente.
    { titulo: 'Taxa', num: true, celula: s => (s.fee == null || s.status === 'pending' ? '—' : money(s.fee)) },
    { titulo: 'Líquido', num: true, celula: s => (s.net == null || s.status === 'pending' ? '—' : money(s.net - (s.refunded || 0))) },
   ],
  }));
  const rodape = node('div', undefined, 'tbl-foot'); rodape.append(node('span', `${filtradas.length} de ${vendas.length} ${vendas.length === 1 ? 'venda' : 'vendas'}`));
  area.append(rodape);
  return area;
 }

 function painelDeVendas() {
  const painel = node('div', undefined, 'pg-painel');
  painel.append(barraDoMes());
  if (!dados) { painel.append(node('p', 'Carregando vendas…', 'detail')); return painel; }
  if (dados.erro) { painel.append(node('p', dados.erro, 'notice-inline')); return painel; }
  const vendas = vendasDoMes();
  const tabelaArea = node('div');
  const redesenharTabela = () => { tabelaArea.replaceChildren(filtros(vendas, redesenharTabela), tabelaDeVendas(vendas)); };
  redesenharTabela();
  painel.append(resumo(vendas), tabelaArea);
  return painel;
 }

 function painelDeProcessadores() {
  const painel = node('div', undefined, 'pg-painel');
  if (!dados) { painel.append(node('p', 'Consultando as conexões…', 'detail')); return painel; }
  if (dados.erro) { painel.append(node('p', dados.erro, 'notice-inline')); return painel; }
  const lista = node('div', undefined, 'pg-processadores');
  for (const [chave, nome] of Object.entries(PROCESSADORES)) {
   const ligado = dados.configured?.[chave] === true;
   const p = dados.providers?.[chave];
   const vendas = (p?.snapshot?.payload?.sales || []);
   const linha = node('article', undefined, 'pg-processador');
   const ident = node('div', undefined, 'pg-processador-id');
   const logo = providerLogo(chave); if (logo) ident.append(logo);
   const textos = node('div'); textos.append(node('strong', nome), node('small', chave === 'asaas' ? `Pix e boleto · ambiente ${dados.configured?.asaas_environment === 'production' ? 'de produção' : 'de testes (sandbox)'}` : 'Cartão e assinaturas', 'detail'));
   ident.append(textos);
   const fatos = node('dl', undefined, 'pg-fatos');
   const fato = (t, v) => { const d = node('div'); d.append(node('dt', t), node('dd', v)); fatos.append(d); };
   fato('Situação', ligado ? 'Conectado' : 'Não configurado');
   fato(`Vendas em ${rotuloDoMes(mes)}`, ligado ? String(vendas.length) : '—');
   fato('Última sincronização', quando(p?.snapshot?.updated_at) || '—');
   const acao = node('div', undefined, 'pg-processador-acao');
   if (p?.attempt?.payload?.state === 'error') acao.append(selo('Última sincronização falhou', 'danger'));
   const configurar = node('button', ligado ? 'Gerenciar chaves' : 'Configurar', ligado ? 'secondary' : 'primary'); configurar.type = 'button'; configurar.onclick = abrirIntegracoes;
   acao.append(configurar);
   linha.append(ident, fatos, acao);
   lista.append(linha);
  }
  painel.append(lista, node('p', 'As chaves de API, os webhooks e as contas conectadas ficam em Configurações → Integrações.', 'detail'));
  return painel;
 }

 function desenhar() {
  const tabsHost = $('crm-payments-tabs'), vendas = $('crm-payments-vendas'), processadores = $('crm-payments-gateways');
  if (!tabsHost || !vendas || !processadores) return;
  mountTabs({ host: tabsHost, tabs: [{ key: 'vendas', label: 'Vendas' }, { key: 'processadores', label: 'Processadores' }], active: aba, label: 'Abas de pagamentos', prefix: 'crm-pay', panelId: aba === 'vendas' ? 'crm-payments-vendas' : 'crm-payments-gateways', onChange: key => { aba = key; desenhar(); } });
  vendas.hidden = aba !== 'vendas'; processadores.hidden = aba !== 'processadores';
  if (aba === 'vendas') vendas.replaceChildren(painelDeVendas()); else processadores.replaceChildren(painelDeProcessadores());
 }

 return { load: () => carregar(), clear() { geracao++; dados = null; processador = ''; situacao = ''; mes = mesDeHoje(); aba = 'vendas'; $('crm-payments-vendas')?.replaceChildren(); $('crm-payments-gateways')?.replaceChildren(); } };
}
