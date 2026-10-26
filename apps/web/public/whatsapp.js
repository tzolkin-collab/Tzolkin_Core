import { createIcon } from './icons.js';
import { selo } from './data-table.js';
import { mountTabs } from './tabs.js';
import { painelDeAgentes } from './whatsapp-agentes.js';
import { painelDeVisao } from './whatsapp-visao.js';

// Tela "WhatsApp": a visão geral (saúde e resultado de cada instância), as conversas de cada uma (o que os leads responderam), a atividade da fila (o que está
// esperando, o que saiu, o que falhou) e os agentes de IA. As mensagens saem pelas automações do funil ou pela resposta manual de uma
// conversa, sempre pela fila e sempre pela instância da conversa.
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const SITUACAO = { sent: ['Enviada', 'success'], queued: ['Na fila', 'info'], sending: ['Enviando', 'info'], failed: ['Falhou', 'danger'], cancelled: ['Cancelada', 'neutral'], suppressed: ['Não enviada', 'neutral'] };
const TIPO = { lead: 'ao lead', equipe: 'à equipe', teste: 'teste' };
const quando = v => (v ? new Date(v).toLocaleString('pt-BR') : '');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const cortar = (t, n) => (t.length > n ? `${t.slice(0, n - 3)}…` : t);
const guardado = () => { try { return localStorage.getItem('core.wa-instancia') || ''; } catch { return ''; } };
const guardar = v => { try { localStorage.setItem('core.wa-instancia', v); } catch { /* sem armazenamento: vale só nesta visita */ } };
const ESTADOS = { open: ['Conectada', 'success'], connecting: ['Conectando', 'warning'], close: ['Desconectada', 'danger'] };

export function setupWhatsapp({ api, reportError }) {
 // aviso: a frase do que a pessoa acabou de fazer, que sobrevive ao redesenho
 let geracao = 0, fila = null, lista = null, erro = '', aviso = '';
 let aba = 'visao', instancia = guardado(), conversas = null, aberta = null, conversa = null, erroConversa = '', agentes = null, visao = null;
 let antigas = [], paginaAntiga = 1, carregandoAntigas = false, rascunho = '', relogio = null, ajuste = null;
 const host = () => document.getElementById('view-whatsapp');
 const q = () => (instancia ? `?instance=${encodeURIComponent(instancia)}` : '');

 async function carregar() {
  const ticket = ++geracao;
  desenhar();
  lista = await api('/api/whatsapp/instances').catch(e => ({ falha: e.message }));
  if (ticket !== geracao) return;
  const nomes = (lista.instancias || []).map(i => i.name);
  if (!nomes.includes(instancia)) instancia = nomes.includes(lista.padrao) ? lista.padrao : (nomes[0] || '');
  guardar(instancia);
  desenhar();
  await carregarDaInstancia(ticket);
  iniciarAtualizacao();
 }
 async function carregarDaInstancia(ticket = geracao) {
  const [outbox, caixa] = await Promise.all([
   api('/api/whatsapp/outbox' + (aba === 'atividade' ? q() : '')).catch(e => ({ falha: e.message })),
   instancia ? api('/api/whatsapp/chat/conversas' + q()).catch(e => ({ falha: e.message })) : Promise.resolve(null),
  ]);
  if (ticket !== geracao) return;
  erro = outbox.falha || outbox.aviso || '';
  fila = outbox.falha ? { disponivel: false, itens: [], contagem: {}, suprimidos: 0 } : outbox;
  conversas = !caixa ? null : caixa.falha ? { disponivel: false, conversas: [], nao_lidas: 0, falha: caixa.falha } : caixa;
  desenhar();
 }

 // ---------- cabeçalho: a Evolution e o envio ----------
 function resumo() {
  const caixa = el('section', undefined, 'whatsapp-estado');
  const linha = (rotulo, valor, tom) => { const l = el('div'); l.append(el('span', rotulo), valor ? selo(valor, tom) : el('span', '…')); return l; };
  if (!lista) { caixa.append(el('p', 'Consultando a Evolution…', 'email-help')); return caixa; }
  const configurada = lista.configurada !== false && !lista.falha;
  const conectadas = (lista.instancias || []).filter(i => i.conectada).length;
  caixa.append(
   linha('Evolution', configurada ? (conectadas ? `${plural(conectadas, 'instância conectada', 'instâncias conectadas')}` : 'Nenhuma instância conectada') : 'Não configurada', conectadas ? 'success' : 'danger'),
   linha('Envio automático', fila?.envio_ligado ? 'Ligado' : 'Desligado', fila?.envio_ligado ? 'success' : 'warning'),
  );
  if (!configurada) caixa.append(el('p', lista.falha || 'Preencha EVOLUTION_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY em Configurações → Integrações → WhatsApp.', 'email-help'));
  else if (lista.todas === false) caixa.append(el('p', 'A chave da Evolution é de uma instância só, então o Core vê apenas a instância padrão. Para listar todas, use a chave global (AUTHENTICATION_API_KEY da Evolution).', 'email-help'));
  if (fila?.disponivel && !fila.envio_ligado) caixa.append(el('p', 'O envio está desligado: nada sai, as mensagens só acumulam na fila. Para ligar, defina WHATSAPP_ENVIO como "ligado" em Configurações → Integrações → WhatsApp.', 'email-help'));
  return caixa;
 }

 // ---------- instâncias ----------
 function instancias() {
  const faixa = el('div', undefined, 'wa-instancias'); faixa.setAttribute('role', 'group'); faixa.setAttribute('aria-label', 'Instância');
  if (!lista) return faixa;
  if (!(lista.instancias || []).length) { faixa.append(el('p', 'Nenhuma instância encontrada na Evolution.', 'email-empty')); return faixa; }
  for (const i of lista.instancias) {
   const b = el('button', undefined, 'wa-instancia' + (i.name === instancia ? ' active' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(i.name === instancia)); b.dataset.instancia = i.name;
   const topo = el('span', undefined, 'wa-instancia-topo'); topo.append(el('strong', i.name), ...(i.nao_lidas ? [el('span', String(i.nao_lidas), 'wa-nao-lida')] : []));
   const [rotulo, tom] = ESTADOS[i.state] || [i.state, 'neutral'];
   b.append(topo, el('small', [i.profile, i.number].filter(Boolean).join(' · ') || (i.name === lista.padrao ? 'Instância padrão' : ''), 'detail'), selo(rotulo, tom));
   b.onclick = () => { instancia = i.name; guardar(instancia); aberta = null; conversa = null; conversas = null; fila = null; antigas = []; rascunho = ''; carregarDaInstancia(); desenhar(); };
   faixa.append(b);
  }
  return faixa;
 }

 // ---------- Conversas (direto da Evolution: funciona sem webhook e mostra o histórico de antes do Core) ----------
 const STATUS_MSG = { PENDING: 'Enviando', SERVER_ACK: 'Enviada', DELIVERY_ACK: 'Entregue', READ: 'Lida', PLAYED: 'Ouvida', FAILED: 'Falhou', QUEUED: 'Na fila' };
 const hhmm = v => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
 const diaDe = v => {
  const d = new Date(v), h = new Date(), ontem = new Date(h); ontem.setDate(h.getDate() - 1);
  return d.toDateString() === h.toDateString() ? 'Hoje' : d.toDateString() === ontem.toDateString() ? 'Ontem' : d.toLocaleDateString('pt-BR');
 };
 const curto = v => (!v ? '' : diaDe(v) === 'Hoje' ? hhmm(v) : diaDe(v));
 const inicial = c => (c.lead_name || c.name || c.number || '?').trim().charAt(0).toUpperCase();
 const nomeDe = c => c.lead_name || c.name || (c.number ? `+${c.number}` : 'Contato sem telefone');

 async function carregarConversa(jid, { silencioso = false } = {}) {
  try {
   const r = await api(`/api/whatsapp/chat/mensagens?jid=${encodeURIComponent(jid)}${instancia ? `&instance=${encodeURIComponent(instancia)}` : ''}`);
   if (aberta !== jid) return;
   conversa = r; erroConversa = ''; desenhar();
  } catch (e) { if (aberta === jid && !silencioso) { erroConversa = e.message; desenhar(); } }
 }
 async function abrir(jid) {
  aberta = jid; conversa = null; erroConversa = ''; antigas = []; paginaAntiga = 1; rascunho = ''; ajuste = null; desenhar();
  await carregarConversa(jid);
 }
 // Mensagens mais antigas: a próxima página entra ANTES das que já estão na tela, sem pular a rolagem.
 async function verMaisAntigas() {
  if (!aberta || carregandoAntigas) return;
  const jid = aberta; carregandoAntigas = true; desenhar();
  try {
   const r = await api(`/api/whatsapp/chat/mensagens?jid=${encodeURIComponent(jid)}&pagina=${paginaAntiga + 1}${instancia ? `&instance=${encodeURIComponent(instancia)}` : ''}`);
   if (aberta !== jid) return;
   const caixa = host()?.querySelector('.wa-mensagens'); const antes = caixa ? caixa.scrollHeight : 0;
   antigas = [...r.mensagens, ...antigas]; paginaAntiga = r.pagina;
   ajuste = { fixarNoTopo: antes };
  } catch (e) { erroConversa = e.message; }
  carregandoAntigas = false; desenhar();
 }

 function bolha(m) {
  const b = el('div', undefined, `wa-msg ${m.direcao}${m.midia ? ' midia' : ''}${m.pendente ? ' pendente' : ''}`); b.dataset.direcao = m.direcao;
  b.append(el('p', m.texto));
  const rodape = [m.em ? hhmm(m.em) : null, m.direcao === 'out' ? STATUS_MSG[m.status] || null : null].filter(Boolean).join(' · ');
  if (rodape) b.append(el('small', rodape));
  if (m.erro) b.append(el('small', m.erro, 'email-outbox-erro'));
  return b;
 }

 function fio() {
  const painel = el('div', undefined, 'wa-fio');
  if (!aberta) { painel.append(el('p', 'Escolha uma conversa.', 'email-empty')); return painel; }
  if (erroConversa && !conversa) { painel.append(el('p', erroConversa, 'email-help email-outbox-erro')); return painel; }
  if (!conversa) { painel.append(el('p', 'Carregando conversa…', 'email-empty')); return painel; }
  const item = conversas?.conversas.find(c => c.jid === aberta) || {};
  const topo = el('header', undefined, 'wa-fio-topo');
  const quem = el('div'); quem.append(el('strong', conversa.lead_name || item.name || (conversa.number ? `+${conversa.number}` : 'Contato sem telefone')),
   el('small', [conversa.number ? `+${conversa.number}` : 'telefone não disponível', conversa.lead_id ? 'lead do funil' : 'sem lead ligado', `via ${instancia}`].join(' · ')));
  topo.append(quem);
  if (conversa.number) {
   const atendimento = el('div', undefined, 'wa-atendimento');
   atendimento.append(selo(conversa.com_pessoa ? 'Com uma pessoa' : 'Agente atende, se houver', conversa.com_pessoa ? 'warning' : 'neutral'));
   const passar = el('button', conversa.com_pessoa ? 'Devolver ao agente' : 'Assumir conversa', 'secondary'); passar.type = 'button';
   passar.onclick = async () => { passar.disabled = true; try { await api(`/api/whatsapp/conversations/${conversa.number}/${conversa.com_pessoa ? 'devolver' : 'assumir'}${q()}`, 'POST', {}); await carregarConversa(aberta); } catch (e) { erroConversa = e.message; desenhar(); } };
   atendimento.append(passar); topo.append(atendimento);
  }
  const mensagens = el('div', undefined, 'wa-mensagens'); mensagens.setAttribute('role', 'log'); mensagens.setAttribute('aria-label', 'Mensagens da conversa');
  const temMais = paginaAntiga < conversa.paginas;
  if (temMais) {
   const mais = el('button', carregandoAntigas ? 'Carregando…' : 'Ver mensagens mais antigas', 'quiet wa-mais-antigas'); mais.type = 'button'; mais.disabled = carregandoAntigas; mais.onclick = verMaisAntigas;
   mensagens.append(mais);
  } else if ([...antigas, ...conversa.mensagens].length) mensagens.append(el('p', 'Início da conversa.', 'wa-dia'));
  let dia = '';
  for (const m of [...antigas, ...conversa.mensagens]) {
   const d = m.em ? diaDe(m.em) : '';
   if (d && d !== dia) { dia = d; mensagens.append(el('p', d, 'wa-dia')); }
   mensagens.append(bolha(m));
  }
  if (!conversa.mensagens.length && !antigas.length) mensagens.append(el('p', 'Nenhuma mensagem ainda nesta conversa.', 'email-empty'));
  const form = el('form', undefined, 'wa-resposta');
  const podeResponder = Boolean(conversa.number) && !conversa.bloqueado;
  const texto = el('textarea'); texto.rows = 3; texto.maxLength = 4096; texto.disabled = !podeResponder; texto.setAttribute('aria-label', 'Resposta'); texto.value = rascunho;
  texto.placeholder = conversa.bloqueado ? 'Este número pediu para não receber mensagens.' : !conversa.number ? 'Este contato não mostra o telefone, então não dá para responder por aqui.' : 'Escreva a resposta';
  texto.oninput = () => { rascunho = texto.value; };
  const enviar = el('button', 'Enviar', 'primary'); enviar.type = 'submit'; enviar.disabled = !podeResponder;
  const ajuda = el('p', aviso || 'A resposta entra na fila e sai no ritmo do envio automático, se ele estiver ligado.', 'email-help'); aviso = '';
  form.append(texto, enviar, ajuda);
  form.onsubmit = async e => {
   e.preventDefault();
   if (!texto.value.trim()) return;
   enviar.disabled = true;
   try { await api(`/api/whatsapp/conversations/${conversa.number}/responder`, 'POST', { text: texto.value, instance: instancia }); aviso = 'Resposta na fila.'; rascunho = ''; ajuste = null; await carregarConversa(aberta); }
   catch (err) { ajuda.textContent = err.message; ajuda.classList.add('email-outbox-erro'); enviar.disabled = false; }
  };
  painel.append(topo, mensagens, form);
  const plano = ajuste; ajuste = null;
  queueMicrotask(() => { mensagens.scrollTop = plano?.fixarNoTopo != null ? mensagens.scrollHeight - plano.fixarNoTopo : plano?.perto === false ? plano.topo : mensagens.scrollHeight; });
  return painel;
 }

 function painelConversas() {
  const bloco = el('div', undefined, 'wa-conversas');
  bloco.append(instancias());
  if (!instancia) { bloco.append(el('p', 'Escolha uma instância para ver as conversas dela.', 'email-empty')); return bloco; }
  if (!conversas) { bloco.append(el('p', 'Carregando conversas…', 'email-empty')); return bloco; }
  if (!conversas.disponivel) {
   const v = el('div', undefined, 'email-empty');
   v.append(createIcon('message-circle'), el('h2', 'Conversas'), el('p', conversas.falha || 'Não consegui ler as conversas da Evolution.'));
   bloco.append(v); return bloco;
  }
  const caixa = el('section', undefined, 'wa-caixa');
  const itens = el('div', undefined, 'wa-lista'); itens.setAttribute('role', 'list');
  if (!conversas.conversas.length) itens.append(el('p', `Nenhuma conversa em ${instancia} ainda.`, 'email-empty'));
  for (const c of conversas.conversas) {
   const b = el('button', undefined, 'wa-conversa' + (c.jid === aberta ? ' active' : '')); b.type = 'button'; b.setAttribute('role', 'listitem');
   const avatar = el('span', undefined, 'wa-avatar'); avatar.setAttribute('aria-hidden', 'true');
   if (c.foto) { const img = el('img'); img.src = c.foto; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.onerror = () => { img.remove(); avatar.textContent = inicial(c); }; avatar.append(img); } else avatar.textContent = inicial(c);
   const topo = el('span', undefined, 'wa-conversa-topo'); topo.append(el('strong', nomeDe(c)), el('small', curto(c.last_at)));
   const base = el('span', undefined, 'wa-conversa-base'); base.append(el('span', `${c.last_from_me ? 'Você: ' : ''}${cortar(c.last_text, 60)}`));
   if (c.unread) base.append(el('span', String(c.unread), 'wa-nao-lida'));
   const texto = el('span', undefined, 'wa-conversa-texto'); texto.append(topo, base);
   b.append(avatar, texto); b.onclick = () => abrir(c.jid); itens.append(b);
  }
  caixa.append(itens, fio());
  bloco.append(caixa);
  return bloco;
 }

 // Atualiza sozinho a cada 20 s enquanto a aba Conversas está à vista: sem webhook, é assim que o que chegou aparece.
 // O rascunho, o foco e a posição de leitura sobrevivem ao redesenho.
 async function atualizarConversas() {
  if (aba !== 'conversas' || !instancia || !host() || (typeof document !== 'undefined' && document.hidden)) return;
  const ticket = geracao;
  try {
   const r = await api('/api/whatsapp/chat/conversas' + q());
   if (ticket !== geracao || aba !== 'conversas') return;
   const caixa = host().querySelector('.wa-mensagens');
   if (caixa) ajuste = { perto: caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80, topo: caixa.scrollTop };
   const naCaixaDeTexto = document.activeElement?.tagName === 'TEXTAREA';
   if (r.disponivel) conversas = r;
   if (aberta) { const m = await api(`/api/whatsapp/chat/mensagens?jid=${encodeURIComponent(aberta)}${instancia ? `&instance=${encodeURIComponent(instancia)}` : ''}`); if (ticket === geracao && aba === 'conversas') conversa = m; }
   desenhar();
   if (naCaixaDeTexto) { const t = host()?.querySelector('.wa-resposta textarea'); if (t && !t.disabled) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  } catch { /* sem rede por um instante: tenta de novo no próximo ciclo */ }
 }
 const iniciarAtualizacao = () => { relogio ??= setInterval(atualizarConversas, 20000); };

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
  const itens = el('div', undefined, 'email-outbox');
  if (!fila.itens.length) itens.append(el('p', 'Nenhuma mensagem na fila ainda. As automações de lead com a ação "Enviar WhatsApp ao lead" ou "Avisar a equipe no WhatsApp" aparecem aqui.', 'email-empty'));
  for (const m of fila.itens) {
   const linha = el('article', undefined, 'email-outbox-item'); linha.dataset.id = m.id; linha.dataset.status = m.status;
   const topo = el('div', undefined, 'email-outbox-top'); const [rotulo, tom] = SITUACAO[m.status] || [m.status, 'neutral'];
   topo.append(selo(rotulo, tom), el('strong', cortar(m.body_text, 140)));
   const meta = [m.to_name || m.to_number, TIPO[m.kind], m.instance ? `via ${m.instance}` : null, quando(m.sent_at || m.created_at), m.attempts > 1 ? `${m.attempts} tentativas` : null].filter(Boolean).join(' · ');
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
   itens.append(linha);
  }
  caixa.append(nota, itens);
  return caixa;
 }

 function painelAtividade() {
  const bloco = el('div', undefined, 'wa-atividade');
  const barra = el('div', undefined, 'wa-filtro'), rot = el('label', undefined, 'au-espaco'), sel = el('select'); sel.setAttribute('aria-label', 'Instância');
  for (const [v, t] of [['', 'Todas as instâncias'], ...(lista?.instancias || []).map(i => [i.name, i.name])]) { const o = el('option', t); o.value = v; sel.append(o); }
  sel.value = instancia === '*' ? '' : instancia;
  sel.onchange = () => { instancia = sel.value; guardar(instancia); fila = null; carregarDaInstancia(); desenhar(); };
  rot.append(el('span', 'Instância'), sel); barra.append(rot);
  bloco.append(barra, atividade());
  return bloco;
 }

 function painelAgentes() {
  agentes ??= painelDeAgentes({ api, instancias: lista?.instancias || [], reportError });
  return agentes;
 }

 function painelVisao() {
  visao ??= painelDeVisao({
   api, reportError, padrao: () => lista?.padrao || '',
   // "Abrir conversas" leva à aba Conversas já na instância escolhida.
   aoAbrirConversas: nome => { instancia = nome; guardar(nome); aba = 'conversas'; aberta = null; conversa = null; conversas = null; fila = null; carregarDaInstancia(); desenhar(); },
  });
  return visao;
 }

 function desenhar() {
  const root = host(); if (!root) return;
  root.replaceChildren(); root.classList.add('email-hub');
  const intro = el('div', undefined, 'email-intro');
  intro.append(createIcon('message-circle'), el('p', 'Instâncias do WhatsApp, conversas com os leads, o que está na fila e os agentes de IA, pela Evolution API.'));
  const abas = el('div'); abas.id = 'whatsapp-tabs';
  root.append(intro, resumo(), abas);
  const naoLidas = conversas?.nao_lidas;
  mountTabs({
   host: abas, active: aba, label: 'Seções do WhatsApp', prefix: 'whatsapp',
   tabs: [{ key: 'visao', label: 'Visão geral' }, { key: 'conversas', label: 'Conversas', count: Number.isFinite(naoLidas) && naoLidas > 0 ? naoLidas : undefined }, { key: 'atividade', label: 'Atividade' }, { key: 'agentes', label: 'Agentes de IA' }],
   onChange: key => { aba = key; if (key === 'atividade') { fila = null; carregarDaInstancia(); } if (key === 'visao') visao?.recarregar(); desenhar(); },
  });
  const painel = aba === 'visao' ? painelVisao() : aba === 'conversas' ? painelConversas() : aba === 'atividade' ? painelAtividade() : painelAgentes();
  painel.id = `whatsapp-panel-${aba}`; painel.setAttribute('role', 'tabpanel'); painel.setAttribute('aria-labelledby', `whatsapp-tab-${aba}`);
  root.append(painel);
 }

 return { load: carregar, clear() { clearInterval(relogio); relogio = null; antigas = []; rascunho = ''; geracao++; fila = null; lista = null; erro = ''; aviso = ''; conversas = null; aberta = null; conversa = null; erroConversa = ''; agentes = null; visao = null; host()?.replaceChildren(); } };
}
