import { node } from './dom.js';
import { createIcon } from './icons.js';
import { tabela, celulaNome, selo } from './data-table.js';

// WhatsApp → Agentes de IA: a configuração de quem atende. Cada agente tem instrução, contexto do negócio, os funis que atende, as
// ferramentas do Core liberadas, o que pode fazer (texto, áudio, ligação...) e os materiais que pode usar. É só a configuração:
// Com a execução ligada (AGENTES_EXECUCAO) e a chave da Anthropic, o agente ligado responde os leads dos funis que atende, pela instância dele, usando só
// as ferramentas que o motor sabe executar; a resposta entra na fila de envio. As ferramentas e capacidades sem execução ainda aparecem como "em breve".

const NOMES_DE_MODELO = { 'claude-opus-5-5': 'Claude Opus 5.5 (o mais capaz)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (equilíbrio)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (o mais rápido)' };
const RISCO = { baixo: ['Só lê ou anota', 'success'], medio: ['Muda dados', 'warning'], alto: ['Risco alto', 'danger'] };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const icone = nome => { const s = node('span', undefined, 'wf-ic'); s.append(createIcon(nome)); return s; };
const botao = (texto, classe, aoClicar, nomeDoIcone) => { const b = node('button', undefined, classe); b.type = 'button'; if (nomeDoIcone) b.append(icone(nomeDoIcone)); if (texto) b.append(document.createTextNode(texto)); if (aoClicar) b.onclick = aoClicar; return b; };

export function painelDeAgentes({ api, instancias, reportError }) {
 const raiz = node('div', undefined, 'ia-raiz');
 let dados = null, exec = null, editando = null, aviso = '';

 async function carregar() {
  raiz.replaceChildren(node('p', 'Carregando agentes…', 'detail'));
  try { [dados, exec] = await Promise.all([api('/api/whatsapp/agents'), api('/api/whatsapp/agents/execucao').catch(() => null)]); } catch (e) { raiz.replaceChildren(node('p', e.message, 'notice-inline')); return; }
  desenhar();
 }
 const nomeDoFunil = id => { const f = dados.funis.find(x => x.id === id); return f ? f.name : 'funil arquivado'; };

 const SITUACAO_DO_TURNO = { done: ['Respondeu', 'success'], skipped: ['Pulou', 'neutral'], failed: ['Falhou', 'danger'], queued: ['Na fila', 'info'], running: ['Rodando', 'info'] };
 const quando = v => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

 /** O que está ligado de verdade: a execução, a chave da Anthropic e o envio das respostas. Sem isto o agente salvo não responde. */
 function estadoDaExecucao() {
  const caixa = node('section', undefined, 'whatsapp-estado');
  if (!exec) { caixa.append(node('p', 'Não consegui consultar o estado da execução agora.', 'email-help')); return caixa; }
  const linha = (rotulo, ok, sim, nao) => { const l = node('div'); l.append(node('span', rotulo), selo(ok ? sim : nao, ok ? 'success' : 'warning')); return l; };
  caixa.append(linha('Execução dos agentes', exec.ligada, 'Ligada', 'Desligada'), linha('Chave da Anthropic', exec.com_chave, 'Configurada', 'Faltando'), linha('Envio das respostas', exec.envio_ligado, 'Ligado', 'Desligado'));
  if (!exec.ligada || !exec.com_chave) caixa.append(node('p', 'Hoje nenhum agente responde: para ligar, preencha ANTHROPIC_API_KEY e defina AGENTES_EXECUCAO como "ligado" em Configurações → Integrações → Claude (agentes de IA).', 'email-help'));
  else if (!exec.envio_ligado) caixa.append(node('p', 'Os agentes já escrevem as respostas, mas o envio do WhatsApp está desligado: elas ficam na fila (WHATSAPP_ENVIO).', 'email-help'));
  if (exec.aviso) caixa.append(node('p', exec.aviso, 'email-help'));
  return caixa;
 }

 function turnos() {
  const caixa = node('section', undefined, 'ia-turnos');
  caixa.append(node('h3', 'Últimas execuções'));
  if (!exec?.disponivel) { caixa.append(node('p', exec?.aviso || 'Ainda sem execuções.', 'detail')); return caixa; }
  if (!exec.turnos.length) { caixa.append(node('p', 'Nenhuma execução ainda. Cada resposta de um agente aparece aqui, com as ferramentas que ele usou.', 'empty-list')); return caixa; }
  caixa.append(tabela({
   legenda: 'Últimas execuções dos agentes',
   linhas: exec.turnos,
   colunas: [
    { titulo: 'Quando', celula: t => quando(t.finished_at || t.created_at) },
    { titulo: 'Agente', celula: t => celulaNome({ nome: t.agent_name, apoio: `${t.instance || 'padrão'} · ${t.number}` }) },
    { titulo: 'Situação', celula: t => selo(...(SITUACAO_DO_TURNO[t.status] || [t.status, 'neutral'])) },
    { titulo: 'O que fez', celula: t => (t.reply ? `“${t.reply.length > 90 ? `${t.reply.slice(0, 87)}…` : t.reply}”` : (t.note || '—')) },
    { titulo: 'Ferramentas', celula: t => ((t.tools_used || []).length ? t.tools_used.join(', ') : '—') },
    { titulo: 'Tokens', num: true, celula: t => String((t.input_tokens || 0) + (t.output_tokens || 0)) },
   ],
  }));
  return caixa;
 }

 function lista() {
  const caixa = node('div', undefined, 'ia-lista');
  const topo = node('div', undefined, 'au-topo');
  topo.append(node('p', 'Quem atende no WhatsApp: cada agente tem instruções, o contexto do negócio, os funis que atende, as ferramentas do Core que pode usar e o que pode fazer na conversa.', 'detail'));
  topo.append(botao('Novo agente', 'primary', () => { editando = {}; desenhar(); }, 'plus'));
  caixa.append(topo, estadoDaExecucao());
  if (aviso) { const a = node('p', aviso, 'email-note'); a.setAttribute('role', 'status'); caixa.append(a); aviso = ''; }
  if (!dados.disponivel) { const v = node('div', undefined, 'email-empty'); v.append(createIcon('bot'), node('h2', 'Agentes de IA'), node('p', dados.aviso)); caixa.append(v); return caixa; }
  if (!dados.agents.length) { caixa.append(node('p', 'Nenhum agente ainda. Crie o primeiro em "Novo agente".', 'empty-list')); return caixa; }
  caixa.append(tabela({
   legenda: 'Agentes de IA',
   linhas: dados.agents,
   aoAbrir: a => { editando = a; desenhar(); },
   colunas: [
    { titulo: 'Agente', celula: a => celulaNome({ nome: a.name, apoio: a.description || NOMES_DE_MODELO[a.model] || a.model, aoAbrir: () => { editando = a; desenhar(); } }) },
    { titulo: 'Instância', celula: a => a.instance || 'Padrão' },
    { titulo: 'Funis', celula: a => (a.pipelines.length ? a.pipelines.map(nomeDoFunil).join(', ') : 'Nenhum') },
    { titulo: 'Ferramentas', celula: a => { const c = node('span', undefined, 'ia-ferramentas'); c.append(document.createTextNode(plural(a.tools.length, 'ferramenta', 'ferramentas')), ...(a.tools.length ? [selo(...RISCO[a.risco])] : [])); return c; } },
    { titulo: 'Situação', celula: a => selo(a.is_active ? 'Ligado' : 'Desligado', a.is_active ? 'success' : 'neutral') },
   ],
  }));
  caixa.append(turnos());
  return caixa;
 }

 // ---------- formulário ----------
 function formulario() {
  const a = editando, novo = !a.id, c = dados.catalogo;
  const form = node('form', undefined, 'commercial-form ia-form');
  const topo = node('div', undefined, 'au-topo'); topo.append(node('h3', novo ? 'Novo agente' : `Agente · ${a.name}`)); form.append(topo);
  const rotulo = (texto, el, ajuda) => { const l = node('label', texto); l.append(el); if (ajuda) l.append(node('small', ajuda, 'detail')); return l; };
  const entrada = (valor, extra = {}) => Object.assign(node('input'), { type: 'text', value: valor ?? '' }, extra);
  const area = (valor, linhas, extra = {}) => Object.assign(node('textarea'), { rows: linhas, value: valor ?? '' }, extra);
  const secao = (titulo, ajuda) => { const s = node('section', undefined, 'ia-secao'); s.append(node('h4', titulo)); if (ajuda) s.append(node('p', ajuda, 'detail')); form.append(s); return s; };

  const s1 = secao('Quem é');
  const nome = entrada(a.name, { required: true, maxLength: 80 }), descricao = entrada(a.description, { maxLength: 300 });
  const instancia = node('select'); for (const [v, t] of [['', 'Instância padrão'], ...instancias.map(i => [i.name, `${i.name}${i.conectada ? '' : ' (desconectada)'}`])]) { const o = node('option', t); o.value = v; instancia.append(o); } instancia.value = a.instance || '';
  const modelo = node('select'); for (const m of c.modelos) { const o = node('option', NOMES_DE_MODELO[m] || m); o.value = m; modelo.append(o); } modelo.value = a.model || 'claude-sonnet-5-5';
  s1.append(rotulo('Nome', nome), rotulo('Descrição (opcional)', descricao), rotulo('Atende na instância', instancia, 'O número de WhatsApp pelo qual este agente conversa.'), rotulo('Modelo', modelo));

  const s2 = secao('O que ele sabe', 'As instruções dizem como se comportar; o contexto é o que ele precisa saber do negócio para responder bem.');
  const instrucoes = area(a.instructions, 8, { required: true, maxLength: 8000, placeholder: 'Você é a Sofia, da Tzolkin. Responda curto, em português, e nunca prometa preço. Se o lead pedir proposta, junte nome, empresa e o que ele quer, e chame uma pessoa.' });
  const contexto = area(a.context, 6, { maxLength: 8000, placeholder: 'O que a empresa faz, serviços e faixas de preço, prazos, o que NÃO fazemos, perguntas frequentes…' });
  s2.append(rotulo('Instruções', instrucoes), rotulo('Contexto do negócio', contexto));

  const s3 = secao('Quais funis ele atende', 'Ele só conversa com leads e oportunidades destes funis.');
  const funisEscolhidos = new Set(a.pipelines || []);
  if (!dados.funis.length) s3.append(node('p', 'Nenhum funil ativo. Crie em CRM → Fluxo.', 'empty-list'));
  const porEspaco = new Map(); for (const f of dados.funis) (porEspaco.get(f.space_name) ?? porEspaco.set(f.space_name, []).get(f.space_name)).push(f);
  for (const [espaco, lista] of porEspaco) {
   const g = node('div', undefined, 'ia-grupo'); g.append(node('strong', espaco));
   for (const f of lista) { const l = node('label', undefined, 'ia-opcao'), cx = Object.assign(node('input'), { type: 'checkbox', checked: funisEscolhidos.has(f.id) }); cx.onchange = () => (cx.checked ? funisEscolhidos.add(f.id) : funisEscolhidos.delete(f.id)); l.append(cx, node('span', f.name)); g.append(l); }
   s3.append(g);
  }

  const s4 = secao('Ferramentas do Core', 'O que ele pode fazer no Core por conta própria. Libere só o que ele precisa: as de risco alto mexem com dinheiro ou falam por fora. As marcadas "Em breve" ficam salvas, mas o agente ainda não as usa.');
  const ferramentas = new Set(a.tools || []);
  for (const [id, f] of Object.entries(c.ferramentas)) {
   const l = node('label', undefined, 'ia-opcao ia-opcao-grande' + (f.execucao === false ? ' is-embreve' : '')), cx = Object.assign(node('input'), { type: 'checkbox', checked: ferramentas.has(id) }); cx.onchange = () => (cx.checked ? ferramentas.add(id) : ferramentas.delete(id));
   const t = node('span', undefined, 'ia-opcao-texto'); t.append(node('strong', f.nome), node('small', f.descricao, 'detail')); l.append(cx, t, ...(f.execucao === false ? [selo('Em breve', 'neutral')] : []), selo(...RISCO[f.risco])); s4.append(l);
  }

  const s5 = secao('O que ele pode fazer na conversa', 'Hoje ele conversa por texto. Áudio, imagem, documento e ligação dependem de voz e mídia conectadas e aparecem como "Em breve".');
  const capacidades = { ...(a.abilities || {}) }; if (novo && capacidades.texto === undefined) capacidades.texto = true;
  for (const [id, cap] of Object.entries(c.capacidades)) {
   const l = node('label', undefined, 'ia-opcao ia-opcao-grande' + (cap.execucao === false ? ' is-embreve' : '')), cx = Object.assign(node('input'), { type: 'checkbox', checked: capacidades[id] === true }); cx.onchange = () => { capacidades[id] = cx.checked; };
   const t = node('span', undefined, 'ia-opcao-texto'); t.append(node('strong', cap.nome), node('small', cap.descricao, 'detail')); l.append(cx, t, ...(cap.execucao === false ? [selo('Em breve', 'neutral')] : [])); s5.append(l);
  }

  const s6 = secao('Materiais que ele pode usar', 'Documentos, imagens, áudios e links que ele pode mandar ou consultar. O Core guarda o link, não o arquivo.');
  const linhas = node('div', undefined, 'ia-materiais'), materiais = [...(a.assets || []).map(m => ({ ...m, url: m.url || '', when: m.when || '' }))];
  const desenharMateriais = () => {
   linhas.replaceChildren();
   if (!materiais.length) linhas.append(node('p', 'Nenhum material.', 'detail'));
   materiais.forEach((m, i) => {
    const l = node('div', undefined, 'ia-material');
    const n = Object.assign(node('input'), { type: 'text', value: m.name, placeholder: 'Nome', maxLength: 80 }), k = node('select');
    for (const [v, t] of Object.entries(c.tipos)) { const o = node('option', t); o.value = v; k.append(o); } k.value = m.kind;
    const u = Object.assign(node('input'), { type: 'url', value: m.url, placeholder: 'https://… (link do arquivo)' }), q = Object.assign(node('input'), { type: 'text', value: m.when, placeholder: 'Quando usar (ex.: quando pedirem valores)', maxLength: 300 });
    n.oninput = () => { m.name = n.value; }; k.onchange = () => { m.kind = k.value; u.hidden = k.value === 'texto'; }; u.oninput = () => { m.url = u.value; }; q.oninput = () => { m.when = q.value; }; u.hidden = m.kind === 'texto';
    const tirar = botao('Remover', 'quiet', () => { materiais.splice(i, 1); desenharMateriais(); }); tirar.setAttribute('aria-label', `Remover o material ${m.name || i + 1}`);
    l.append(n, k, u, q, tirar); linhas.append(l);
   });
  };
  desenharMateriais();
  s6.append(linhas, botao('Adicionar material', 'secondary', () => { materiais.push({ name: '', kind: 'documento', url: '', when: '' }); desenharMateriais(); }, 'plus'));

  const s7 = secao('Ligar');
  const ligado = Object.assign(node('input'), { type: 'checkbox', checked: a.is_active === true }), l7 = node('label', undefined, 'ia-opcao');
  l7.append(ligado, node('span', 'Agente ligado')); s7.append(l7, node('p', 'Ligado, ele responde os leads destes funis nesta instância, quando a execução estiver ligada. Se uma pessoa responder uma conversa, ele sai dela até alguém devolver.', 'detail'));

  const enviar = node('button', novo ? 'Criar agente' : 'Salvar agente', 'primary'); enviar.type = 'submit';
  const rodape = node('div', undefined, 'au-acoes'); rodape.append(enviar, botao('Cancelar', 'quiet', () => { editando = null; desenhar(); })); form.append(rodape);
  form.onsubmit = async e => {
   e.preventDefault(); enviar.disabled = true;
   const corpo = { name: nome.value, description: descricao.value.trim() || null, instance: instancia.value || null, model: modelo.value, instructions: instrucoes.value, context: contexto.value.trim() || null,
    pipelines: [...funisEscolhidos], tools: [...ferramentas], abilities: capacidades, assets: materiais.filter(m => m.name.trim() || m.url.trim()).map(m => ({ name: m.name, kind: m.kind, url: m.kind === 'texto' ? null : m.url, when: m.when.trim() || null })), is_active: ligado.checked };
   try {
    if (novo) await api('/api/whatsapp/agents', 'POST', corpo); else await api('/api/whatsapp/agents/' + a.id, 'PUT', { ...corpo, version: a.version });
    aviso = novo ? `Agente "${corpo.name}" criado.` : `Agente "${corpo.name}" salvo.`; editando = null; await carregar();
   } catch (err) { form.querySelector('[role=alert]')?.remove(); const p = node('p', err.message, 'notice-inline'); p.setAttribute('role', 'alert'); form.prepend(p); enviar.disabled = false; }
  };
  return form;
 }

 function desenhar() { raiz.replaceChildren(editando ? formulario() : lista()); }

 carregar().catch(reportError);
 return raiz;
}
