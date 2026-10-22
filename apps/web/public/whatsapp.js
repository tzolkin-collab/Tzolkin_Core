import { createIcon } from './icons.js';
import { selo } from './data-table.js';

// Tela "WhatsApp": a conexão com a Evolution e a atividade da fila (o que está esperando, o que saiu, o que falhou).
// As mensagens saem pelas automações do funil (Inbound → Automações → "Enviar WhatsApp ao lead" / "Avisar a equipe no WhatsApp").
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const SITUACAO = { sent: ['Enviada', 'success'], queued: ['Na fila', 'info'], sending: ['Enviando', 'info'], failed: ['Falhou', 'danger'], cancelled: ['Cancelada', 'neutral'], suppressed: ['Não enviada', 'neutral'] };
const TIPO = { lead: 'ao lead', equipe: 'à equipe', teste: 'teste' };
const quando = v => (v ? new Date(v).toLocaleString('pt-BR') : '');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export function setupWhatsapp({ api }) {
 let geracao = 0, fila = null, estado = null, erro = '', aviso = '';   // aviso: a frase do que a pessoa acabou de fazer, que sobrevive ao redesenho
 const host = () => document.getElementById('view-whatsapp');

 async function carregar() {
  const ticket = ++geracao;
  desenhar();
  const [lista, conexao] = await Promise.all([
   api('/api/whatsapp/outbox').catch(e => ({ falha: e.message })),
   api('/api/whatsapp/status').catch(e => ({ falha: e.message })),
  ]);
  if (ticket !== geracao) return;
  erro = lista.falha || '';
  fila = lista.falha ? { disponivel: false, itens: [], contagem: {}, suprimidos: 0 } : lista;
  estado = conexao;
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
   const texto = m.body_text.length > 140 ? `${m.body_text.slice(0, 137)}…` : m.body_text;
   topo.append(selo(rotulo, tom), el('strong', texto));
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
  intro.append(createIcon('message-circle'), el('p', 'Mensagens de WhatsApp enviadas pelas automações do funil, pela Evolution API.'));
  root.append(intro, conexao(), atividade());
 }

 return { load: carregar, clear() { geracao++; fila = null; estado = null; erro = ''; aviso = ''; host()?.replaceChildren(); } };
}
