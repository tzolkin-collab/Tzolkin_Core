import { createIcon } from './icons.js';
import { selo } from './data-table.js';
import { mountTabs } from './tabs.js';

// Tela "WhatsApp": a conexão com a Evolution, as conversas (o que os leads responderam) e a atividade da fila (o que está esperando,
// o que saiu, o que falhou). As mensagens saem pelas automações do funil (Inbound → Automações → "Enviar WhatsApp ao lead" / "Avisar a
// equipe no WhatsApp") ou pela resposta manual de uma conversa, sempre pela fila.
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const SITUACAO = { sent: ['Enviada', 'success'], queued: ['Na fila', 'info'], sending: ['Enviando', 'info'], failed: ['Falhou', 'danger'], cancelled: ['Cancelada', 'neutral'], suppressed: ['Não enviada', 'neutral'] };
const TIPO = { lead: 'ao lead', equipe: 'à equipe', teste: 'teste' };
const quando = v => (v ? new Date(v).toLocaleString('pt-BR') : '');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const cortar = (t, n) => (t.length > n ? `${t.slice(0, n - 3)}…` : t);

export function setupWhatsapp({ api }) {
 // aviso: a frase do que a pessoa acabou de fazer, que sobrevive ao redesenho
 let geracao = 0, fila = null, estado = null, erro = '', aviso = '';
 let aba = 'conversas', conversas = null, aberta = null, conversa = null, erroConversa = '';
 const host = () => document.getElementById('view-whatsapp');

 async function carregar() {
  const ticket = ++geracao;
  desenhar();
  const [lista, conexaoDaEvolution, caixa] = await Promise.all([
   api('/api/whatsapp/outbox').catch(e => ({ falha: e.message })),
   api('/api/whatsapp/status').catch(e => ({ falha: e.message })),
   api('/api/whatsapp/conversations').catch(e => ({ falha: e.message })),
  ]);
  if (ticket !== geracao) return;
  erro = lista.falha || '';
  fila = lista.falha ? { disponivel: false, itens: [], contagem: {}, suprimidos: 0 } : lista;
  estado = conexaoDaEvolution;
  conversas = caixa.falha ? { disponivel: false, conversas: [], nao_lidas: 0, falha: caixa.falha } : caixa;
  desenhar();
 }

 function conexao() {
  const caixa = el('section', undefined, 'whatsapp-estado');
  const linha = (rotulo, valor, tom) => { const l = el('div'); l.append(el('span', rotulo), valor ? selo(valor, tom) : el('span', '…')); return l; };
  if (!estado) { caixa.append(el('p', 'Consultando a Evolution…', 'email-help')); return caixa; }
  const conectada = estado.conectada === true;
  caixa.append(
   linha('Evolution', estado.configurada ? (conectada ? 'Conectada' : 'Desconectada') : 'Não configurada', conectada ? 'success' : 'danger'),
   linha('Envio automático', fila?.envio_ligado ? 'Ligado' : 'Desligado', fila?.envio_ligado ? 'success' : 'warning'),
  );
  if (estado.instancia) caixa.append(el('p', `Instância ${estado.instancia}`, 'email-help'));
  if (!estado.configurada) caixa.append(el('p', 'Preencha EVOLUTION_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY em Configurações → Integrações → WhatsApp.', 'email-help'));
  else if (!conectada) caixa.append(el('p', `${estado.motivo || 'A instância não está conectada.'} Enquanto isso, as mensagens esperam na fila (e expiram em 48 horas).`, 'email-help'));
  if (fila?.disponivel && !fila.envio_ligado) caixa.append(el('p', 'O envio está desligado: nada sai, as mensagens só acumulam na fila. Para ligar, defina WHATSAPP_ENVIO como "ligado" em Configurações → Integrações → WhatsApp.', 'email-help'));
  return caixa;
 }

 // ---------- Conversas ----------
 async function abrir(numero) {
  aberta = numero; conversa = null; erroConversa = ''; desenhar();
  try {
   const r = await api(`/api/whatsapp/conversations/${numero}`);
   if (aberta !== numero) return;
   conversa = r; desenhar();
   const item = conversas?.conversas.find(c => c.number === numero);
   if (item?.unread) {
    await api(`/api/whatsapp/conversations/${numero}/lida`, 'POST', {});
    conversas.nao_lidas -= item.unread; item.unread = 0;
    if (aberta === numero) desenhar();
   }
  } catch (e) { if (aberta === numero) { erroConversa = e.message; desenhar(); } }
 }

 function fio() {
  const painel = el('div', undefined, 'wa-fio');
  if (!aberta) { painel.append(el('p', 'Escolha uma conversa.', 'email-empty')); return painel; }
  if (erroConversa) { painel.append(el('p', erroConversa, 'email-help email-outbox-erro')); return painel; }
  if (!conversa) { painel.append(el('p', 'Carregando conversa…', 'email-empty')); return painel; }
  const item = conversas?.conversas.find(c => c.number === aberta);
  const topo = el('header', undefined, 'wa-fio-topo');
  topo.append(el('strong', item?.lead_name || conversa.name || aberta), el('small', [aberta, conversa.lead_id ? 'lead do funil' : 'sem lead ligado'].join(' · ')));
  const mensagens = el('div', undefined, 'wa-mensagens');
  for (const m of conversa.mensagens) {
   const b = el('div', undefined, `wa-msg ${m.direcao}`); b.dataset.direcao = m.direcao;
   b.append(el('p', m.texto));
   const situacao = m.status ? (SITUACAO[m.status] || [m.status])[0] : null;
   b.append(el('small', [quando(m.em), m.direcao === 'out' ? situacao : null].filter(Boolean).join(' · ')));
   if (m.erro) b.append(el('small', m.erro, 'email-outbox-erro'));
   mensagens.append(b);
  }
  const form = el('form', undefined, 'wa-resposta');
  const texto = el('textarea'); texto.rows = 3; texto.maxLength = 4096; texto.disabled = conversa.bloqueado; texto.setAttribute('aria-label', 'Resposta');
  texto.placeholder = conversa.bloqueado ? 'Este número pediu para não receber mensagens.' : 'Escreva a resposta';
  const enviar = el('button', 'Enviar', 'primary'); enviar.type = 'submit'; enviar.disabled = conversa.bloqueado;
  const ajuda = el('p', aviso || 'A resposta entra na fila e sai no ritmo do envio automático, se ele estiver ligado.', 'email-help'); aviso = '';
  form.append(texto, enviar, ajuda);
  form.onsubmit = async e => {
   e.preventDefault();
   if (!texto.value.trim()) return;
   enviar.disabled = true;
   try { await api(`/api/whatsapp/conversations/${aberta}/responder`, 'POST', { text: texto.value }); aviso = 'Resposta na fila.'; await abrir(aberta); }
   catch (err) { ajuda.textContent = err.message; ajuda.classList.add('email-outbox-erro'); enviar.disabled = false; }
  };
  painel.append(topo, mensagens, form);
  queueMicrotask(() => { mensagens.scrollTop = mensagens.scrollHeight; });
  return painel;
 }

 function painelConversas() {
  const caixa = el('section', undefined, 'wa-caixa');
  if (!conversas) { caixa.append(el('p', 'Carregando conversas…', 'email-empty')); return caixa; }
  if (!conversas.disponivel) {
   const v = el('div', undefined, 'email-empty');
   v.append(createIcon('message-circle'), el('h2', 'Caixa de entrada'), el('p', conversas.falha || 'Disponível assim que a atualização do banco (migração 063) for aplicada.'));
   caixa.append(v); return caixa;
  }
  const lista = el('div', undefined, 'wa-lista'); lista.setAttribute('role', 'list');
  if (!conversas.conversas.length) lista.append(el('p', 'Nenhuma resposta recebida ainda. Quando um lead responder no WhatsApp, a conversa aparece aqui (o webhook da Evolution precisa apontar para o Core).', 'email-empty'));
  for (const c of conversas.conversas) {
   const b = el('button', undefined, 'wa-conversa' + (c.number === aberta ? ' active' : '')); b.type = 'button'; b.setAttribute('role', 'listitem');
   const topo = el('span', undefined, 'wa-conversa-topo'); topo.append(el('strong', c.lead_name || c.name || c.number), el('small', quando(c.last_at)));
   const base = el('span', undefined, 'wa-conversa-base'); base.append(el('span', cortar(c.last_text, 70)));
   if (c.unread) base.append(el('span', String(c.unread), 'wa-nao-lida'));
   b.append(topo, base); b.onclick = () => abrir(c.number); lista.append(b);
  }
  caixa.append(lista, fio());
  return caixa;
 }

 // ---------- Atividade da fila ----------
 function atividade() {
  const caixa = el('section', undefined, 'email-activity');
  if (!fila) { caixa.append(el('p', 'Carregando atividade…', 'email-empty')); return caixa; }
  if (!fila.disponivel) {
   const v = el('div', undefined, 'email-empty');
   v.append(createIcon('message-circle'), el('h2', 'Histórico de mensagens'), el('p', erro || 'Disponível assim que a atualização do banco (migração 062) for aplicada.'));
   caixa.append(v); return caixa;
  }
  const c = fila.contagem || {};
  caixa.append(el('p', `Últimos 30 dias: ${plural(c.sent || 0, 'enviada', 'enviadas')}, ${c.queued || 0} na fila, ${plural(c.failed || 0, 'com falha', 'com falha')}${fila.suprimidos ? ` · ${plural(fila.suprimidos, 'número bloqueado', 'números bloqueados')}` : ''}.`, 'email-note'));
  const nota = el('p', aviso, 'email-note'); nota.setAttribute('role', 'status'); aviso = '';
  const lista = el('div', undefined, 'email-outbox');
  if (!fila.itens.length) lista.append(el('p', 'Nenhuma mensagem na fila ainda. As automações de lead com a ação "Enviar WhatsApp ao lead" ou "Avisar a equipe no WhatsApp" aparecem aqui.', 'email-empty'));
  for (const m of fila.itens) {
   const linha = el('article', undefined, 'email-outbox-item'); linha.dataset.id = m.id; linha.dataset.status = m.status;
   const topo = el('div', undefined, 'email-outbox-top'); const [rotulo, tom] = SITUACAO[m.status] || [m.status, 'neutral'];
   topo.append(selo(rotulo, tom), el('strong', cortar(m.body_text, 140)));
   const meta = [m.to_name || m.to_number, TIPO[m.kind], quando(m.sent_at || m.created_at), m.attempts > 1 ? `${m.attempts} tentativas` : null].filter(Boolean).join(' · ');
   linha.append(topo, el('p', meta, 'email-help'));
   if (m.last_error) linha.append(el('p', m.last_error, 'email-help email-outbox-erro'));
   const acoes = el('div', undefined, 'email-outbox-acoes');
   if (m.status === 'failed') {
    const b = el('button', 'Reenviar', 'secondary'); b.type = 'button';
    b.onclick = async () => { b.disabled = true; try { await api(`/api/whatsapp/outbox/${m.id}/reenviar`, 'POST', {}); aviso = 'Na fila de novo: sai no próximo ciclo (até 30 segundos), se o envio estiver ligado.'; await carregar(); } catch (e) { nota.textContent = e.message; b.disabled = false; } };
    acoes.append(b);
   }
   if (['queued', 'failed', 'sent'].includes(m.status)) {
    const b = el('button', 'Não enviar mais a este número', 'quiet'); b.type = 'button';
    b.onclick = async () => { b.disabled = true; try { const r = await api('/api/whatsapp/suppress', 'POST', { number: m.to_number, reason: 'manual' }); aviso = `${m.to_number} não receberá mais mensagens do Core${r.tirados_da_fila ? ` (${r.tirados_da_fila} saíram da fila)` : ''}.`; await carregar(); } catch (e) { nota.textContent = e.message; b.disabled = false; } };
    acoes.append(b);
   }
   if (acoes.childElementCount) linha.append(acoes);
   lista.append(linha);
  }
  caixa.append(nota, lista);
  return caixa;
 }

 function desenhar() {
  const root = host(); if (!root) return;
  root.replaceChildren(); root.classList.add('email-hub');
  const intro = el('div', undefined, 'email-intro');
  intro.append(createIcon('message-circle'), el('p', 'Mensagens de WhatsApp enviadas pelas automações do funil e respondidas pelos leads, pela Evolution API.'));
  const abas = el('div'); abas.id = 'whatsapp-tabs';
  root.append(intro, conexao(), abas);
  const naoLidas = conversas?.nao_lidas;
  mountTabs({
   host: abas, active: aba, label: 'Seções do WhatsApp', prefix: 'whatsapp',
   tabs: [{ key: 'conversas', label: 'Conversas', count: Number.isFinite(naoLidas) && naoLidas > 0 ? naoLidas : undefined }, { key: 'atividade', label: 'Atividade' }],
   onChange: key => { aba = key; desenhar(); },
  });
  const painel = aba === 'conversas' ? painelConversas() : atividade();
  painel.id = `whatsapp-panel-${aba}`; painel.setAttribute('role', 'tabpanel'); painel.setAttribute('aria-labelledby', `whatsapp-tab-${aba}`);
  root.append(painel);
 }

 return { load: carregar, clear() { geracao++; fila = null; estado = null; erro = ''; aviso = ''; conversas = null; aberta = null; conversa = null; erroConversa = ''; host()?.replaceChildren(); } };
}
