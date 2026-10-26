import { selo, tabela } from './data-table.js';

// WhatsApp → Visão geral: a saúde de cada instância da Evolution e o resultado básico do atendimento, numa tabela só.
// Saúde: conectada? o webhook dela aponta para este Core? quando chegou a última mensagem? há fila parada?
// Resultado: quantas pessoas escreveram e quanto tempo levamos para responder (definição na nota abaixo da tabela, e em
// docs/WHATSAPP-FLUXOS-DESENHO.md, seção 5A). Só leitura: nada aqui envia nem altera a Evolution.
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const ESTADOS = { open: ['Conectada', 'success'], connecting: ['Conectando', 'warning'], close: ['Desconectada', 'danger'] };
const PERIODOS = [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias']];

/** "12 min", "3 h 20 min", "2 dias": o tempo como a equipe fala, nunca "0,2 h". */
export function duracao(minutos) {
 if (minutos == null || !Number.isFinite(minutos)) return null;
 const m = Math.round(minutos);
 if (m < 1) return 'menos de 1 min';
 if (m < 60) return `${m} min`;
 if (m < 1440) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; }
 return plural(Math.round(m / 1440), 'dia', 'dias');
}

/** "há 12 min", "há 3 h", "ontem" ou a data; a data completa vai no `title`. */
export function haQuanto(iso, agora = Date.now()) {
 if (!iso) return null;
 const t = new Date(iso).getTime();
 if (!Number.isFinite(t)) return null;
 const min = Math.max(0, Math.round((agora - t) / 60000));
 if (min < 1) return 'agora';
 if (min < 60) return `há ${min} min`;
 if (min < 1440) return `há ${Math.floor(min / 60)} h`;
 if (min < 2880) return 'ontem';
 return new Date(t).toLocaleDateString('pt-BR');
}

/** O selo do webhook: o que a Evolution faz com as mensagens que chegam nessa instância. */
export function seloDoWebhook(w) {
 const s = seloCurto(w);
 if (w?.estado === 'outro' && w.host) s.title = `Aponta para ${w.host}`;
 return s;
}
function seloCurto(w) {
 switch (w?.estado) {
  case 'core': return w.segredo ? selo('Aponta para o Core', 'success') : selo('Core, sem o segredo', 'warning');
  case 'core_sem_evento': return selo('Core, sem mensagens', 'warning');
  case 'outro': return selo('Outro sistema', 'neutral');
  case 'desligado': return selo('Desligado', 'warning');
  case 'sem': return selo('Sem webhook', 'neutral');
  default: return selo('Não consegui ler', 'neutral');
 }
}

/**
 * O que precisa de atenção, só da instância do Core (as outras são de outros sistemas): uma frase por problema, do mais grave ao menos.
 * Função pura, para testar sem tela. `dados` é a resposta de /api/whatsapp/saude.
 */
export function pontosDeAtencao(dados, padrao, conexoes = null) {
 const lista = [];
 const nosso = (dados?.instancias || []).find(i => i.nome === padrao);
 if (!nosso) return lista;
 const { nome, webhook: w, fila, resultado: r } = nosso;
 if (!nosso.conectada) lista.push(['danger', `A instância ${nome} está desconectada: nada sai nem chega até ela ser pareada de novo.`]);
 if (w?.estado === 'sem') lista.push(['danger', `A instância ${nome} não tem webhook: as respostas dos leads não chegam ao Core.`]);
 else if (w?.estado === 'outro') lista.push(['danger', `O webhook de ${nome} aponta para ${w.host || 'outro sistema'} e não para o Core: as respostas dos leads não chegam aqui.`]);
 else if (w?.estado === 'desligado') lista.push(['danger', `O webhook de ${nome} está desligado: as respostas dos leads não chegam ao Core.`]);
 else if (w?.estado === 'core_sem_evento') lista.push(['warning', `O webhook de ${nome} aponta para o Core, mas não envia o evento de mensagem recebida (MESSAGES_UPSERT).`]);
 else if (w?.estado === 'core' && !w.segredo) lista.push(['warning', `O webhook de ${nome} aponta para o Core sem o cabeçalho x-webhook-secret: o Core vai recusar as chamadas.`]);
 if (r?.sem_resposta > 0) lista.push(['warning', `${plural(r.sem_resposta, 'pessoa espera', 'pessoas esperam')} uma resposta nossa em ${nome} (${r.periodo_dias} dias).`]);
 if (fila?.falhas > 0) lista.push(['warning', `${plural(fila.falhas, 'mensagem falhou', 'mensagens falharam')} ao sair por ${nome}: abra Atividade para reenviar.`]);
 if (fila?.na_fila > 0 && !dados.envio_ligado) lista.push(['info', `${plural(fila.na_fila, 'mensagem espera', 'mensagens esperam')} na fila e o envio automático está desligado.`]);
 else if (fila?.na_fila > 0 && fila.mais_antiga_min >= 30) lista.push(['warning', `A fila de ${nome} está parada: a mensagem mais antiga espera há ${duracao(fila.mais_antiga_min)}.`]);
 // Instância do Core sem funil: a conversa nova não vira lead nem aciona fluxo e agente (só vale quando a migração das conexões está no banco).
 if (conexoes?.disponivel && !conexoes.conexoes.some(c => c.instance === nome && c.create_leads)) lista.push(['info', `${nome} não está conectada a nenhum funil: as conversas novas não viram lead, então fluxos e agentes não começam sozinhos. Escolha o funil na coluna Funil.`]);
 return lista;
}

export function painelDeVisao({ api, reportError, padrao = () => '', aoAbrirConversas = () => {} }) {
 const raiz = el('div', undefined, 'wa-visao');
 let dias = 7, dados = null, conexoes = null, erro = '', carregando = false, geracao = 0, avisoDoFunil = '';

 async function recarregar() {
  const ticket = ++geracao;
  carregando = true; desenhar();
  try { const [r, c] = await Promise.all([api(`/api/whatsapp/saude?dias=${dias}`), api('/api/whatsapp/conexoes').catch(() => null)]); if (ticket !== geracao) return; dados = r; conexoes = c; erro = ''; }
  catch (e) { if (ticket !== geracao) return; erro = e.message || 'Não consegui carregar.'; reportError?.(e); }
  carregando = false; desenhar();
 }

 function barra() {
  const b = el('div', undefined, 'wa-visao-barra');
  const rot = el('label', undefined, 'au-espaco'), sel = el('select'); sel.setAttribute('aria-label', 'Período');
  for (const [v, t] of PERIODOS) { const o = el('option', t); o.value = String(v); sel.append(o); }
  sel.value = String(dias);
  sel.onchange = () => { dias = Number(sel.value); recarregar(); };
  rot.append(el('span', 'Período'), sel);
  const atualizar = el('button', carregando ? 'Atualizando…' : 'Atualizar', 'secondary'); atualizar.type = 'button'; atualizar.disabled = carregando;
  atualizar.onclick = recarregar;
  b.append(rot, atualizar);
  return b;
 }

 function atencao() {
  const itens = pontosDeAtencao(dados, padrao(), conexoes);
  const bloco = el('section', undefined, 'wa-atencao'); bloco.setAttribute('aria-label', 'O que precisa de atenção');
  if (!itens.length) { bloco.append(el('p', `Nada pede atenção em ${padrao() || 'a instância do Core'}.`, 'email-help')); return bloco; }
  bloco.append(el('h3', 'O que precisa de atenção'));
  const ul = el('ul');
  for (const [tom, texto] of itens) { const li = el('li'); li.append(selo(tom === 'danger' ? 'Urgente' : tom === 'warning' ? 'Atenção' : 'Aviso', tom), el('span', texto)); ul.append(li); }
  bloco.append(ul);
  return bloco;
 }

 function celulaInstancia(i) {
  const c = el('div', undefined, 'wa-inst-nome');
  const topo = el('span', undefined, 'wa-inst-topo');
  topo.append(el('strong', i.nome));
  if (i.nome === padrao()) topo.append(selo('Core', 'info'));
  c.append(topo);
  const apoio = [i.perfil, i.numero].filter(Boolean).join(' · ');
  if (apoio) c.append(el('small', apoio));
  const abrir = el('button', 'Abrir conversas', 'quiet wa-inst-abrir'); abrir.type = 'button'; abrir.setAttribute('aria-label', `Abrir as conversas de ${i.nome}`);
  abrir.onclick = () => aoAbrirConversas(i.nome);
  c.append(abrir);
  return c;
 }

 // Conectar a instância a um funil: a conversa nova que chegar nela vira lead nesse funil (e as automações do funil andam sozinhas).
 function seletorDeFunil(i) {
  if (!conexoes?.disponivel) return null;
  const atual = conexoes.conexoes.find(c => c.instance === i.nome);
  const s = el('select'); s.setAttribute('aria-label', `Funil que recebe as conversas novas de ${i.nome}`);
  for (const [v, t] of [['', 'Não criar leads'], ...conexoes.funis.map(f => [f.id, `${f.space_name} · ${f.name}`])]) { const o = el('option', t); o.value = v; s.append(o); }
  s.value = atual?.create_leads ? atual.pipeline_id : '';
  s.onchange = async () => {
   s.disabled = true; avisoDoFunil = '';
   try {
    if (s.value) await api(`/api/whatsapp/conexoes/${encodeURIComponent(i.nome)}`, 'PUT', { pipeline_id: s.value, create_leads: true });
    else if (atual) await api(`/api/whatsapp/conexoes/${encodeURIComponent(i.nome)}`, 'PUT', { pipeline_id: atual.pipeline_id, create_leads: false });
    avisoDoFunil = s.value ? `${i.nome} conectada: a conversa nova que chegar nela vira lead nesse funil.` : `${i.nome} não cria mais leads.`;
   } catch (e) { avisoDoFunil = e.message; }
   await recarregar();
  };
  const c = el('div', undefined, 'wa-inst-funil'); c.append(s);
  if (atual?.create_leads) c.append(el('small', 'Conversa nova vira lead aqui'));
  return c;
 }

 function tabelaDeInstancias() {
  const colunas = [
   { titulo: 'Instância', celula: celulaInstancia },
   { titulo: 'Estado', celula: i => selo(...(ESTADOS[i.estado] || [i.estado, 'neutral'])) },
   { titulo: 'Webhook', celula: i => seloDoWebhook(i.webhook) },
   { titulo: 'Funil', celula: seletorDeFunil },
   { titulo: 'Última mensagem', celula: i => { const t = haQuanto(i.ultima_mensagem_recebida); if (!t) return null; const s = el('span', t); s.title = new Date(i.ultima_mensagem_recebida).toLocaleString('pt-BR'); return s; } },
   { titulo: 'Pessoas', num: true, celula: i => (dados.banco_disponivel ? String(i.resultado.pessoas_que_escreveram) : null) },
   { titulo: 'Respondidas', num: true, celula: i => (i.resultado.esperas ? `${i.resultado.respondidas} de ${i.resultado.esperas} · ${i.resultado.taxa_resposta}%` : null) },
   { titulo: 'Responde em', num: true, celula: i => duracao(i.resultado.mediana_min) },
   { titulo: 'Fila', celula: i => [i.fila.na_fila ? `${i.fila.na_fila} na fila` : null, i.fila.falhas ? plural(i.fila.falhas, 'falha', 'falhas') : null].filter(Boolean).join(' · ') || null },
   ];
  const t = tabela({ colunas, linhas: dados.instancias, legenda: 'Instâncias do WhatsApp: saúde e resultado' });
  // No celular a tabela vira lista empilhada (CSS): cada campo precisa do próprio nome.
  for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { td.dataset.rotulo = colunas[i].titulo; });
  return t;
 }

 function desenhar() {
  raiz.replaceChildren();
  if (erro) { raiz.append(barra(), el('p', erro, 'email-help email-outbox-erro')); return; }
  if (!dados) { raiz.append(el('p', 'Consultando a Evolution e o atendimento…', 'email-empty')); return; }
  if (dados.configurada === false) { raiz.append(el('p', 'A Evolution não está configurada. Preencha EVOLUTION_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY em Configurações → Integrações → WhatsApp.', 'email-empty')); return; }
  raiz.append(barra(), atencao());
  if (dados.aviso) raiz.append(el('p', dados.aviso, 'email-help'));
  if (dados.todas === false) raiz.append(el('p', 'A chave da Evolution é de uma instância só, então o Core vê apenas a instância padrão. Para listar todas, use a chave global (AUTHENTICATION_API_KEY da Evolution).', 'email-help'));
  if (avisoDoFunil) { const a = el('p', avisoDoFunil, 'email-note'); a.setAttribute('role', 'status'); raiz.append(a); }
  raiz.append(tabelaDeInstancias());
  const nota = el('p', 'Responde em: mediana entre a mensagem de uma pessoa e a nossa primeira resposta depois dela. Várias mensagens seguidas da mesma pessoa contam como uma espera só. Mensagens enviadas pelo celular, fora do Core, ainda não entram na conta.', 'email-help wa-visao-nota');
  raiz.append(nota);
 }

 raiz.recarregar = recarregar;
 recarregar();   // a visão geral é a primeira aba: os dados vêm já na abertura, não só ao trocar de aba
 return raiz;
}
