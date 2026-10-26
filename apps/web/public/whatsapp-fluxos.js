import { node } from './dom.js';
import { createIcon } from './icons.js';
import { tabela, celulaNome, selo } from './data-table.js';

// WhatsApp → Fluxos: sequências de mensagens com espera, iniciadas por uma automação ("Iniciar fluxo", que leva os dados do lead).
// Automação é o motor geral do CRM; fluxo é a conversa no WhatsApp. O resultado volta para as automações: "pessoa respondeu" e
// "fluxo acabou sem resposta" são eventos que outra automação pode usar. Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md, seção 4.0.

const SITUACAO = { rascunho: ['Rascunho', 'neutral'], teste: ['Em teste', 'warning'], ativo: ['Ativo', 'success'], arquivado: ['Arquivado', 'neutral'] };
const SITUACAO_DA_EXECUCAO = { running: ['Em andamento', 'info'], done: ['Concluída', 'success'], stopped: ['Encerrada', 'neutral'], failed: ['Falhou', 'danger'] };
const RESULTADO = { respondeu: 'Respondeu', sem_resposta: 'Sem resposta', suprimido: 'Número bloqueado', erro: 'Erro' };
const VARIAVEIS = '{{name}}, {{first_name}}, {{email}}, {{whatsapp}}, {{company_name}}, {{product_name}}, {{dados.interesse}}, {{dados.mensagem_do_lead}}';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const quando = v => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const icone = nome => { const s = node('span', undefined, 'wf-ic'); s.append(createIcon(nome)); return s; };
const botao = (texto, classe, aoClicar, nomeDoIcone) => { const b = node('button', undefined, classe); b.type = 'button'; if (nomeDoIcone) b.append(icone(nomeDoIcone)); if (texto) b.append(document.createTextNode(texto)); if (aoClicar) b.onclick = aoClicar; return b; };

/** Uma espera em minutos vira o par (número, unidade) mais natural: 1440 -> (1, dias), 90 -> (90, min), 120 -> (2, h). */
export function paraUnidade(minutos) {
 if (minutos % 1440 === 0) return [minutos / 1440, 1440];
 if (minutos % 60 === 0) return [minutos / 60, 60];
 return [minutos, 1];
}
/** Resumo de um fluxo para a lista: "3 mensagens, 1 espera (1 h)". */
export function resumoDosPassos(steps) {
 const m = steps.filter(p => p.tipo === 'mensagem').length, esperas = steps.filter(p => p.tipo === 'espera');
 const total = esperas.reduce((n, p) => n + p.minutos, 0);
 const [n, u] = paraUnidade(total);
 return `${plural(m, 'mensagem', 'mensagens')}${esperas.length ? `, ${plural(esperas.length, 'espera', 'esperas')} (${n} ${u === 1440 ? (n === 1 ? 'dia' : 'dias') : u === 60 ? 'h' : 'min'} no total)` : ''}`;
}
/** Resultado do fluxo, que é o que importa: de quem terminou, quantos responderam. */
export function resultadoDoFluxo(f) {
 const terminaram = (f.responderam || 0) + (f.sem_resposta || 0);
 if (!f.iniciados) return null;
 return terminaram ? `${f.iniciados} iniciados · ${Math.round(((f.responderam || 0) / terminaram) * 100)}% responderam` : `${f.iniciados} iniciados · sem resultado ainda`;
}

/** "Lead criado · Funil padrão", ou "Só manual" quando o fluxo não tem gatilho. Gatilho desligado (fluxo em rascunho) diz isso. */
export function textoDoGatilho(f, dados) {
 const g = f.gatilho;
 if (!g) return 'Só manual';
 const nome = dados?.eventos?.[g.event] || g.event;
 const funil = g.pipeline_id ? dados?.funis?.find(x => x.id === g.pipeline_id)?.name : null;
 return `${[nome, funil].filter(Boolean).join(' · ')}${g.ativo ? '' : ' (desligado)'}`;
}

export function painelDeFluxos({ api, instancias = [], reportError }) {
 const raiz = node('div', undefined, 'fl-raiz');
 let dados = null, editando = null, aviso = '', erro = '', execucoes = null, teste = '';

 async function carregar() {
  raiz.replaceChildren(node('p', 'Carregando fluxos…', 'detail'));
  try { dados = await api('/api/whatsapp/fluxos'); erro = ''; } catch (e) { erro = e.message; reportError?.(e); }
  desenhar();
 }
 async function carregarExecucoes(id) {
  execucoes = null;
  try { execucoes = (await api(`/api/whatsapp/fluxos/${id}/execucoes`)).execucoes || []; } catch { execucoes = []; }
  if (editando?.id === id) desenhar();
 }
 const abrir = f => { editando = f; teste = ''; execucoes = null; desenhar(); if (f.id) carregarExecucoes(f.id); };

 function lista() {
  const caixa = node('div', undefined, 'fl-lista');
  const topo = node('div', undefined, 'au-topo');
  topo.append(node('p', 'Sequências de mensagens no WhatsApp, com espera entre elas. Uma automação do CRM inicia o fluxo e leva os dados do lead; o resultado (respondeu ou não) volta para as automações.', 'detail'));
  topo.append(botao('Novo fluxo', 'primary', () => abrir({}), 'plus'));
  caixa.append(topo);
  if (aviso) { const a = node('p', aviso, 'email-note'); a.setAttribute('role', 'status'); caixa.append(a); aviso = ''; }
  if (erro) { caixa.append(node('p', erro, 'email-help email-outbox-erro')); return caixa; }
  if (!dados.disponivel) { const v = node('div', undefined, 'email-empty'); v.append(createIcon('git-branch'), node('h2', 'Fluxos'), node('p', dados.aviso)); caixa.append(v); return caixa; }
  if (!dados.fluxos.length) { caixa.append(node('p', 'Nenhum fluxo ainda. Crie o primeiro em "Novo fluxo", comece em teste e depois coloque no ar.', 'empty-list')); return caixa; }
  caixa.append(tabela({
   legenda: 'Fluxos de WhatsApp',
   linhas: dados.fluxos,
   aoAbrir: abrir,
   colunas: [
    { titulo: 'Fluxo', celula: f => celulaNome({ nome: f.name, apoio: f.space_name, aoAbrir: () => abrir(f) }) },
    { titulo: 'Situação', celula: f => selo(...(SITUACAO[f.status] || [f.status, 'neutral'])) },
    { titulo: 'Começa quando', celula: f => textoDoGatilho(f, dados) },
    { titulo: 'Passos', celula: f => resumoDosPassos(f.steps) },
    { titulo: 'Em andamento', num: true, celula: f => (f.em_andamento ? String(f.em_andamento) : null) },
    { titulo: 'Resultado', celula: f => resultadoDoFluxo(f) },
   ],
  }));
  return caixa;
 }

 // ---------- formulário ----------
 function formulario() {
  const f = editando, novo = !f.id;
  const passos = (f.steps || [{ tipo: 'mensagem', texto: '' }]).map(p => ({ ...p }));
  const form = node('form', undefined, 'commercial-form ia-form fl-form');
  const topo = node('div', undefined, 'au-topo'); topo.append(node('h3', novo ? 'Novo fluxo' : `Fluxo · ${f.name}`), botao('Voltar à lista', 'secondary', () => { editando = null; desenhar(); })); form.append(topo);
  const rotulo = (texto, el, ajuda) => { const l = node('label', texto); l.append(el); if (ajuda) l.append(node('small', ajuda, 'detail')); return l; };
  const secao = (titulo, ajuda) => { const s = node('section', undefined, 'ia-secao'); s.append(node('h4', titulo)); if (ajuda) s.append(node('p', ajuda, 'detail')); form.append(s); return s; };
  const lista = (opcoes, valor) => { const s = node('select'); for (const [v, t] of opcoes) { const o = node('option', t); o.value = v; s.append(o); } s.value = valor; return s; };

  const s1 = secao('O fluxo');
  const nome = Object.assign(node('input'), { type: 'text', required: true, maxLength: 120, value: f.name ?? '' });
  const espaco = lista((dados.espacos || []).map(e => [e.id, e.name]), f.space_id || dados.espacos?.[0]?.id || ''); espaco.disabled = !novo;
  const situacao = lista([['rascunho', 'Rascunho: ainda não começa para ninguém'], ['teste', 'Em teste: roda inteiro, mas NÃO envia nada (cada espera vale 1 minuto)'], ['ativo', 'Ativo: envia de verdade'], ...(novo ? [] : [['arquivado', 'Arquivado']])], f.status || 'rascunho');
  const instancia = lista([['', 'Instância padrão'], ...instancias.map(i => [i.name, `${i.name}${i.conectada ? '' : ' (desconectada)'}`])], f.instance || '');
  const parar = Object.assign(node('input'), { type: 'checkbox', checked: f.stop_on_reply ?? true });
  const linhaParar = node('label', undefined, 'ia-opcao'); linhaParar.append(parar, node('span', 'Parar quando a pessoa responder (e observar 24 h depois da última mensagem para dar o resultado)'));
  s1.append(rotulo('Nome', nome), rotulo('Espaço', espaco, novo ? 'Quem pode iniciar o fluxo: automações deste espaço. Não muda depois.' : 'O espaço de um fluxo não muda.'), rotulo('Situação', situacao), rotulo('Número que envia', instancia), linhaParar);

  const sg = secao('Quando o fluxo começa', 'Escolha o gatilho aqui mesmo: o Core cria a automação por trás e todo lead que cumprir isto entra no fluxo sozinho (quando ele está em teste ou ativo). Sem gatilho, o fluxo só começa quando você inicia para um número ou quando uma automação do CRM o inicia.');
  const g = f.gatilho || {};
  const opcoes = pares => pares.map(([v, t]) => { const o = node('option', t); o.value = v; return o; });
  const gEvento = lista([['', 'Nenhum: só começa manualmente ou por outra automação'], ...Object.entries(dados.eventos || {})], g.event || '');
  const gFunil = lista([], ''), gEtapa = lista([], '');
  const rFunil = rotulo('Só neste funil', gFunil), rEtapa = rotulo('Só nesta etapa', gEtapa);
  const funisDoEspaco = () => (dados.funis || []).filter(x => x.space_id === espaco.value);
  const preencherEtapas = () => { const fu = funisDoEspaco().find(x => x.id === gFunil.value); gEtapa.replaceChildren(...opcoes([['', 'Qualquer etapa'], ...(fu ? fu.etapas.map(e => [e.id, e.name]) : [])])); };
  const preencherFunis = () => { gFunil.replaceChildren(...opcoes([['', 'Qualquer funil do espaço'], ...funisDoEspaco().map(x => [x.id, x.name])])); preencherEtapas(); };
  const mostrarGatilho = () => { rFunil.hidden = !gEvento.value; rEtapa.hidden = !gEvento.value || gEvento.value !== 'lead.mudou_de_etapa' || !gFunil.value; };
  preencherFunis(); gFunil.value = g.pipeline_id || ''; if (gFunil.value !== (g.pipeline_id || '')) gFunil.value = ''; preencherEtapas(); gEtapa.value = g.stage_id || '';
  gEvento.onchange = mostrarGatilho; gFunil.onchange = () => { preencherEtapas(); mostrarGatilho(); }; espaco.onchange = () => { preencherFunis(); mostrarGatilho(); };
  mostrarGatilho();
  sg.append(rotulo('Quando', gEvento), rFunil, rEtapa);

  const s2 = secao('Passos', `Mensagem e espera, na ordem. Dados que você pode usar no texto: ${VARIAVEIS}. O fluxo precisa terminar com uma mensagem.`);
  const area = node('div', undefined, 'fl-passos'); s2.append(area);
  const erroDoForm = node('p', undefined, 'email-help email-outbox-erro'); erroDoForm.hidden = true;
  function desenharPassos() {
   area.replaceChildren();
   passos.forEach((p, i) => {
    const linha = node('div', undefined, `fl-passo ${p.tipo}`); linha.dataset.passo = String(i + 1);
    linha.append(node('span', String(i + 1), 'fl-passo-n'));
    if (p.tipo === 'mensagem') {
     const t = Object.assign(node('textarea'), { rows: 3, maxLength: 1000, value: p.texto ?? '', placeholder: 'Oi, {{first_name}}! Vi seu interesse em {{dados.interesse}}…' }); t.setAttribute('aria-label', `Mensagem do passo ${i + 1}`);
     t.oninput = () => { p.texto = t.value; };
     linha.append(node('strong', 'Mensagem', 'fl-passo-tipo'), t);
    } else {
     const [n0, u0] = paraUnidade(p.minutos || 10);
     const n = Object.assign(node('input'), { type: 'number', min: '1', max: '43200', value: String(n0) }); n.setAttribute('aria-label', `Tempo de espera do passo ${i + 1}`);
     const u = lista([['1', 'minutos'], ['60', 'horas'], ['1440', 'dias']], String(u0)); u.setAttribute('aria-label', `Unidade da espera do passo ${i + 1}`);
     const atualiza = () => { p.minutos = Math.round(Number(n.value) * Number(u.value)); };
     n.oninput = atualiza; u.onchange = atualiza; atualiza();
     const grupo = node('span', undefined, 'fl-espera'); grupo.append(n, u);
     linha.append(node('strong', 'Esperar', 'fl-passo-tipo'), grupo);
    }
    const acoes = node('span', undefined, 'fl-passo-acoes');
    acoes.append(botao('Subir', 'quiet', () => { if (i > 0) { [passos[i - 1], passos[i]] = [passos[i], passos[i - 1]]; desenharPassos(); } }), botao('Descer', 'quiet', () => { if (i < passos.length - 1) { [passos[i + 1], passos[i]] = [passos[i], passos[i + 1]]; desenharPassos(); } }), botao('Remover', 'quiet', () => { passos.splice(i, 1); desenharPassos(); }));
    linha.append(acoes); area.append(linha);
   });
   const adicionar = node('div', undefined, 'fl-adicionar');
   adicionar.append(botao('Adicionar mensagem', 'secondary', () => { passos.push({ tipo: 'mensagem', texto: '' }); desenharPassos(); }, 'plus'), botao('Adicionar espera', 'secondary', () => { passos.push({ tipo: 'espera', minutos: 60 }); desenharPassos(); }, 'plus'));
   area.append(adicionar);
  }
  desenharPassos();

  const salvar = node('button', novo ? 'Criar fluxo' : 'Salvar alterações', 'primary'); salvar.type = 'submit';
  form.append(erroDoForm, salvar);
  form.onsubmit = async e => {
   e.preventDefault(); salvar.disabled = true; erroDoForm.hidden = true;
   const corpo = { name: nome.value, status: situacao.value, stop_on_reply: parar.checked, instance: instancia.value || null, steps: passos, gatilho: gEvento.value ? { event: gEvento.value, pipeline_id: gFunil.value || null, stage_id: gEtapa.value || null } : null, ...(novo ? { space_id: espaco.value } : { version: f.version, space_id: f.space_id }) };
   try {
    await api(novo ? '/api/whatsapp/fluxos' : `/api/whatsapp/fluxos/${f.id}`, novo ? 'POST' : 'PUT', corpo);
    aviso = novo ? (gEvento.value ? 'Fluxo criado. Ele começa sozinho quando o gatilho acontecer (em teste ou ativo).' : 'Fluxo criado, sem gatilho: ele só começa quando você iniciar para um número ou quando uma automação do CRM o iniciar.') : 'Alterações salvas. Quem já está no fluxo termina com os passos de quando entrou.';
    editando = null; await carregar();
   } catch (err) { erroDoForm.textContent = err.message; erroDoForm.hidden = false; salvar.disabled = false; }
  };

  if (!novo && ['teste', 'ativo'].includes(f.status)) form.append(blocoDeTeste(f));
  if (!novo) form.append(blocoDeExecucoes(f));
  return form;
 }

 // Início manual: um número SEU, sem lead. Em fluxo ativo isso envia de verdade.
 function blocoDeTeste(f) {
  const s = node('section', undefined, 'ia-secao fl-teste');
  s.append(node('h4', 'Iniciar para um número'), node('p', f.status === 'teste' ? 'O fluxo está em teste: roda inteiro e mostra o que enviaria, sem mandar nada.' : 'ATENÇÃO: o fluxo está ativo, então isto envia de verdade para o número informado.', 'detail'));
  const numero = Object.assign(node('input'), { type: 'text', placeholder: '(31) 99999-0000', maxLength: 30 }); numero.setAttribute('aria-label', 'Número de WhatsApp');
  const nome = Object.assign(node('input'), { type: 'text', placeholder: 'Nome (para {{name}})', maxLength: 120 }); nome.setAttribute('aria-label', 'Nome da pessoa');
  const go = botao('Iniciar', 'secondary');
  const msg = node('p', teste, 'email-help'); msg.setAttribute('role', 'status');
  const linha = node('div', undefined, 'fl-teste-linha'); linha.append(numero, nome, go);
  go.onclick = async () => {
   go.disabled = true; msg.classList.remove('email-outbox-erro');
   try { const r = await api(`/api/whatsapp/fluxos/${f.id}/iniciar-teste`, 'POST', { number: numero.value, name: nome.value }); teste = r.mensagem; msg.textContent = teste; carregarExecucoes(f.id); }
   catch (e) { msg.textContent = e.message; msg.classList.add('email-outbox-erro'); }
   go.disabled = false;
  };
  s.append(linha, msg);
  return s;
 }

 function blocoDeExecucoes(f) {
  const s = node('section', undefined, 'ia-secao fl-execucoes');
  s.append(node('h4', 'Execuções'));
  if (execucoes === null) { s.append(node('p', 'Carregando…', 'detail')); return s; }
  if (!execucoes.length) { s.append(node('p', 'Ninguém entrou neste fluxo ainda. Cada pessoa que entrar aparece aqui, com o passo em que está e o resultado.', 'empty-list')); return s; }
  const t = tabela({
   legenda: 'Execuções do fluxo',
   linhas: execucoes,
   colunas: [
    { titulo: 'Começou', celula: r => quando(r.started_at) },
    { titulo: 'Pessoa', celula: r => celulaNome({ nome: r.lead_name || `+${r.number}`, apoio: r.lead_name ? `+${r.number}` : 'início manual' }) },
    { titulo: 'Passo', num: true, celula: r => `${Math.min(r.step, r.passos)} de ${r.passos}` },
    { titulo: 'Situação', celula: r => { const c = node('span', undefined, 'ia-ferramentas'); c.append(selo(...(SITUACAO_DA_EXECUCAO[r.status] || [r.status, 'neutral']))); if (r.dry_run) c.append(selo('Teste', 'warning')); return c; } },
    { titulo: 'Resultado', celula: r => (r.outcome ? RESULTADO[r.outcome] : r.status === 'running' ? `Próximo passo ${quando(r.run_after)}` : null) },
    { titulo: 'O que aconteceu', celula: r => { const l = Array.isArray(r.log) ? r.log.at(-1) : null; return l ? l.nota : null; } },
   ],
  });
  // No celular a tabela vira lista empilhada (CSS): cada campo precisa do próprio nome.
  const titulos = [...t.querySelectorAll('thead th')].map(th => th.textContent);
  for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { td.dataset.rotulo = titulos[i]; });
  s.append(t);
  return s;
 }

 function desenhar() {
  raiz.replaceChildren();
  if (!dados && !erro) { raiz.append(node('p', 'Carregando fluxos…', 'detail')); return; }
  raiz.append(editando && dados?.disponivel ? formulario() : lista());
 }

 raiz.recarregar = carregar;
 carregar();
 return raiz;
}
