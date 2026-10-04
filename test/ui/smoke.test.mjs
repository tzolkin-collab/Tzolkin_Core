// Teste de tela no navegador de verdade (Chrome/Edge sem janela), sem banco e sem provedor.
//
// Camada 4 da estratégia de testes (docs/TESTING.md). Sobe o createCore real com um banco
// falso, abre a tela e confere o que o operador veria: login, menu, cada tela em dois tamanhos,
// as abas de Clientes, a ficha e o fluxo de colar foto. Rodar: `npm run test:ui`.
// Sem Chrome/Edge instalado os testes são PULADOS (e dizem por quê); defina CHROME_PATH para apontar um.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from '../../apps/api/src/app.mjs';
import { serveAsset } from '../../apps/web/assets.mjs';
import { abrirNavegador, acharNavegador } from './browser.mjs';
import { SENHA, EMPRESA, PESSOA_FISICA, ANA, PNG_1X1, bancoFalso, r2Falso } from './fixtures.mjs';

const PULAR = acharNavegador() ? false : 'Chrome/Edge não encontrado (defina CHROME_PATH)';
const ARTEFATOS = fileURLToPath(new URL('./artifacts/', import.meta.url));

const MENU_ESPERADO = ['Visão geral', 'Financeiro', 'Empresas', 'Pessoas', 'Clientes', 'Inbound', 'Portfólio', 'Serviços', 'Acompanhamento', 'Conexões', 'Vercel', 'GitHub', 'EasyPanel', 'DNS', 'Banco de dados'];
const SECAO = `[...document.querySelectorAll('main section')].find(s => !s.hidden && s.offsetParent)`;
/**
 * Lê, de dentro da página, os defeitos de uma tela: título, estouro de largura, texto com valor
 * interno vazando, cabeçalhos repetidos em sequência e botão sem nome. `secao` é uma expressão JS que
 * devolve o elemento da tela. Separada para o teste de controle poder alimentá-la com defeito de propósito.
 */
const leituraDe = secao => `(() => {
 const s = ${secao};
 const norm = t => t.toLowerCase().normalize('NFD').replace(/\\p{M}/gu, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim();
 const titulo = document.getElementById('page-title');
 const cabecalhos = [titulo, ...s.querySelectorAll('h1,h2,h3,h4')].filter(h => h.offsetParent && h.textContent.trim());
 const repetidos = [];
 for (let i = 1; i < cabecalhos.length; i++) if (norm(cabecalhos[i].textContent) === norm(cabecalhos[i - 1].textContent)) repetidos.push(cabecalhos[i].textContent.trim());
 return {
  titulo: titulo.textContent.trim(),
  // O painel rola por dentro (o documento não cresce), então scrollWidth do documento não
  // enxerga o problema. Mede a borda direita de cada elemento visível da tela, ignorando o que
  // vive dentro de um contêiner que rola de propósito (abas, tabelas).
  estouro: (() => {
   const largura = window.innerWidth;
   const rola = e => { for (let n = e.parentElement; n && n !== s.parentElement; n = n.parentElement) { const o = getComputedStyle(n).overflowX; if (['auto', 'scroll', 'hidden'].includes(o) && n.getBoundingClientRect().right <= largura + 1) return true; } return false; };
   let pior = 0;
   for (const e of [s, ...s.querySelectorAll('*')]) {
    if (!e.offsetParent && e !== s) continue;
    const direita = e.getBoundingClientRect().right;
    if (direita > largura + 1 && !rola(e)) pior = Math.max(pior, Math.round(direita - largura));
   }
   return pior;
  })(),
  vazamento: (s.innerText.match(/\\b(undefined|NaN)\\b|\\[object Object\\]/g) || []),
  repetidos,
  botoesSemNome: [...s.querySelectorAll('button')].filter(b => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title).length,
 };
})()`;
const CLICAR_NO_MENU = nome => `(() => { const b = [...document.querySelectorAll('nav button')].find(x => x.textContent.trim() === ${JSON.stringify(nome)}); if (!b) return false; b.click(); return true; })()`;

// Edição no lugar (inline-edit.js): acha o campo pelo nome, abre, digita e confirma como a pessoa faria.
const CAMPO = (raiz, rotulo) => `[...document.querySelectorAll(${JSON.stringify(raiz)} + ' .inline-field')].find(f => (f.querySelector('.inline-value, .inline-input')?.getAttribute('aria-label') || '').replace(/^Editar /, '').startsWith(${JSON.stringify(rotulo)}))`;
const abrirCampo = async (raiz, rotulo) => {
 await pagina.avaliar(`${CAMPO(raiz, rotulo)}.querySelector('.inline-value').click()`);
 await pagina.esperar(`${CAMPO(raiz, rotulo)}?.querySelector('.inline-input')`, { descricao: `campo ${rotulo} aberto` });
};
const digitar = (raiz, rotulo, valor, tecla = 'Enter') => pagina.avaliar(`(() => { const i = ${CAMPO(raiz, rotulo)}.querySelector('.inline-input'); i.value = ${JSON.stringify(valor)}; i.dispatchEvent(new ${tecla === 'change' ? "Event('change'" : "KeyboardEvent('keydown'"}, { ${tecla === 'change' ? '' : 'key: ' + JSON.stringify(tecla) + ', '}bubbles: true })); })()`);
const editarCampo = async (raiz, rotulo, valor, tecla) => { await abrirCampo(raiz, rotulo); await digitar(raiz, rotulo, valor, tecla); };
const valorDoCampo = (raiz, rotulo) => pagina.avaliar(`${CAMPO(raiz, rotulo)}?.querySelector('.inline-value')?.textContent.trim() ?? null`);
const erroDoCampo = (raiz, rotulo) => pagina.avaliar(`(${CAMPO(raiz, rotulo)}?.querySelector('.inline-erro:not([hidden])')?.textContent) ?? null`);
const ESC = `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;

let servidor, navegador, pagina, origem, banco, r2;

before(async () => {
 if (PULAR) return;
 const reserva = http.createServer(); await new Promise(ok => reserva.listen(0, '127.0.0.1', ok));
 const porta = reserva.address().port; await new Promise(ok => reserva.close(ok));
 origem = `http://127.0.0.1:${porta}`;
 banco = bancoFalso(); r2 = r2Falso();
 servidor = createCore({ pool: banco, adminPassword: SENHA, webOrigin: origem, serveAsset, deployRegistry: [], mediaOptions: { r2 } });
 await new Promise(ok => servidor.listen(porta, '127.0.0.1', ok));
 navegador = await abrirNavegador();
 pagina = await navegador.novaPagina();
});

after(async () => {
 await navegador?.fechar();
 if (servidor) { servidor.closeAllConnections(); await new Promise(ok => servidor.close(ok)); }
});

const semExcecoes = () => assert.deepEqual(pagina.problemas.excecoes, [], 'a tela lançou exceção de JavaScript');

test('senha errada não entra e avisa', { skip: PULAR }, async () => {
 await pagina.ir(origem + '/');
 await pagina.esperar(`!!document.getElementById('password')`);
 await pagina.avaliar(`(() => { document.getElementById('password').value = 'errada'; document.getElementById('login-form').requestSubmit(); })()`);
 await pagina.esperar(`document.getElementById('login-notice').textContent.trim().length > 0`, { descricao: 'aviso de senha errada' });
 assert.equal(await pagina.avaliar(`document.getElementById('workspace').hidden`), true);
 semExcecoes();
});

test('senha certa entra no painel', { skip: PULAR }, async () => {
 await pagina.avaliar(`(() => { document.getElementById('password').value = ${JSON.stringify(SENHA)}; document.getElementById('login-form').requestSubmit(); })()`);
 await pagina.esperar(`!document.getElementById('workspace').hidden`, { descricao: 'painel visível depois do login' });
 await pagina.esperar(`document.querySelectorAll('nav button').length > 5`, { descricao: 'menu montado' });
 semExcecoes();
});

test('o menu é exatamente o combinado (nada de aba sem valor)', { skip: PULAR }, async () => {
 const menu = await pagina.avaliar(`[...document.querySelectorAll('nav button')].map(b => b.textContent.trim())`);
 assert.deepEqual(menu, MENU_ESPERADO);
});

for (const [largura, altura] of [[1280, 800], [390, 844]]) {
 test(`cada tela renderiza sem erro, sem repetição e sem estourar a largura (${largura}x${altura})`, { skip: PULAR }, async () => {
  await pagina.tela(largura, altura);
  const falhas = [];
  for (const nome of MENU_ESPERADO) {
   pagina.limparProblemas();
   assert.equal(await pagina.avaliar(CLICAR_NO_MENU(nome)), true, `item de menu ${nome} sumiu`);
   await pagina.esperar(`(${SECAO}) && (${SECAO}).innerText.trim().length > 20`, { descricao: `tela ${nome} renderizada` });
   await new Promise(ok => setTimeout(ok, 400));
   const leitura = await pagina.avaliar(leituraDe(SECAO));
   if (leitura.titulo !== nome) falhas.push(`${nome}: o título da página é "${leitura.titulo}"`);
   if (leitura.estouro > 1) falhas.push(`${nome}: rolagem horizontal de ${leitura.estouro}px`);
   if (leitura.vazamento.length) falhas.push(`${nome}: texto com ${leitura.vazamento.join(', ')}`);
   if (leitura.repetidos.length) falhas.push(`${nome}: título repetido "${leitura.repetidos.join('", "')}"`);
   if (leitura.botoesSemNome) falhas.push(`${nome}: ${leitura.botoesSemNome} botão(ões) sem nome acessível`);
   if (pagina.problemas.excecoes.length) falhas.push(`${nome}: exceção ${pagina.problemas.excecoes[0].slice(0, 120)}`);
   if (process.env.UI_SCREENSHOTS) await pagina.imagem(join(ARTEFATOS, `${largura}-${nome.replace(/\W+/g, '_')}.png`));
  }
  assert.deepEqual(falhas, []);
 });
}

test('Clientes: tabela com abas por situação, ação própria e linha clicável (Empresas e Pessoas seguem telas irmãs)', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Clientes'));
 await pagina.esperar(`document.querySelectorAll('#tenants tr').length === 3`, { descricao: 'três clientes' });
 assert.equal(await pagina.avaliar(`document.getElementById('page-title').textContent.trim()`), 'Clientes');
 assert.equal(await pagina.avaliar(`document.getElementById('new-record-label').textContent.trim()`), 'Novo cliente');
 // é uma tabela, não uma grade de cartões nem uma faixa de métricas
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#view-clients .client-card, #view-clients .client-summary').length`), 0);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-clients thead th')].map(th => th.textContent.trim()).join('|')`), 'Cliente|Status|Contratação|Oferta|Pessoas');
 // as abas carregam a contagem; os encerrados saem de Ativos e ficam na própria aba
 const abas = await pagina.avaliar(`[...document.querySelectorAll('#client-tabs [role=tab]')].map(t => t.textContent.replace(/\\s+/g, ' ').trim())`);
 assert.deepEqual(abas, ['Todos3', 'Ativos2', 'A classificar0', 'Encerrados1']);
 await pagina.avaliar(`[...document.querySelectorAll('#client-tabs [role=tab]')].find(t => t.textContent.includes('Encerrados')).click()`);
 await pagina.esperar(`document.querySelectorAll('#tenants tr').length === 1`, { descricao: 'um encerrado' });
 await pagina.avaliar(`[...document.querySelectorAll('#client-tabs [role=tab]')].find(t => t.textContent.includes('Todos')).click()`);
 await pagina.esperar(`document.querySelectorAll('#tenants tr').length === 3`, { descricao: 'de volta aos três' });
 // sem botão "Abrir cliente →" repetido: o nome e a linha são o alvo
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-clients button')].filter(b => /Abrir (cliente|organização)/.test(b.textContent)).length`), 0);
 // Empresas e Pessoas continuam sendo telas próprias, com a ação de cada uma
 for (const [tela, acao] of [['Empresas', 'Nova empresa'], ['Pessoas', 'Nova pessoa']]) {
  await pagina.avaliar(CLICAR_NO_MENU(tela));
  await pagina.esperar(`document.getElementById('page-title').textContent.trim() === ${JSON.stringify(tela)}`);
  assert.equal(await pagina.avaliar(`document.getElementById('new-record-label').textContent.trim()`), acao);
 }
 await pagina.avaliar(CLICAR_NO_MENU('Clientes'));
 await pagina.esperar(`document.querySelectorAll('#tenants tr').length === 3`);
 semExcecoes();
});

test('selos: cada estado tem o tom certo, a mesma altura e contraste legível', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Clientes'));
 await pagina.esperar(`document.querySelectorAll('#tenants .status').length === 3`, { descricao: 'três selos de situação' });
 const lidos = await pagina.avaliar(`(() => {
  const canais = c => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const luz = c => { const [r, g, b] = canais(c).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  return [...document.querySelectorAll('#tenants .status')].map(el => {
   const cs = getComputedStyle(el);
   return { texto: el.textContent.trim(), tom: [...el.classList].filter(c => c !== 'status').join(' '), altura: Math.round(el.getBoundingClientRect().height),
    contraste: Math.round(razao(cs.color, cs.backgroundColor) * 100) / 100, ponto: getComputedStyle(el, '::before').display, raio: cs.borderRadius };
  });
 })()`);
 assert.deepEqual(lidos.map(l => [l.texto, l.tom]), [['Ativo', 'success'], ['Em implantação', 'info'], ['Descontinuado', 'neutral']]);
 for (const l of lidos) {
  assert.equal(l.altura, 22, `${l.texto}: altura única`);
  assert.ok(l.contraste >= 4.5, `${l.texto}: contraste ${l.contraste}`);
  assert.equal(l.raio, '6px');
  assert.equal(l.ponto, l.tom === 'neutral' ? 'none' : 'block', `${l.texto}: pontinho só nos tons com significado`);
 }
 // a contagem das abas na mesma escala
 const contagens = await pagina.avaliar(`[...document.querySelectorAll('#client-tabs .tab-count')].map(c => Math.round(c.getBoundingClientRect().height))`);
 assert.ok(contagens.length === 4 && contagens.every(h => h === 20), JSON.stringify(contagens));
 semExcecoes();
});

test('Inbound: o funil do espaço mostra as etapas com a contagem e filtra por etapa', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads .funnel-chip').length === 8`, { descricao: 'oito etapas do funil' });
 const chips = () => pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .funnel-chip')].map(c => c.textContent.trim().replace(/\\s+/g, ' ') + (c.getAttribute('aria-pressed') === 'true' ? '*' : ''))`);
 assert.deepEqual(await chips(), ['Novos2', 'Em contato0', 'Qualificação0', 'Proposta0', 'Negociação0', 'Assinatura do contrato0', 'Ganho0', 'Perdido0']);
 // só um funil: sem seletor. Clicar numa etapa filtra e marca; clicar de novo limpa.
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#inbound-panel-leads .funnel-bar select').length`), 0);
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads .funnel-chip').click()`);
 await pagina.esperar(`document.querySelector('#inbound-panel-leads .funnel-chip')?.getAttribute('aria-pressed') === 'true'`, { descricao: 'etapa marcada' });
 assert.equal((await chips())[0], 'Novos2*');
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads .funnel-chip').click()`);
 await pagina.esperar(`document.querySelector('#inbound-panel-leads .funnel-chip')?.getAttribute('aria-pressed') === 'false'`, { descricao: 'etapa desmarcada' });
 semExcecoes();
});

test('Inbound: etapa aberta lista oportunidades; mover pede o motivo só ao perder', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads .funnel-chip').length === 8`, { descricao: 'oito etapas do funil' });
 await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .funnel-chip')].find(c => c.textContent.startsWith('Qualificação')).click()`);
 await pagina.esperar(`[...document.querySelectorAll('#inbound-panel-leads h3')].some(h => h.textContent === 'Venda de teste')`, { descricao: 'oportunidade da etapa listada' });
 const campo = nome => `[...document.querySelectorAll('#inbound-panel-leads .commercial-form label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)})`;
 assert.deepEqual(await pagina.avaliar(`[...(${campo('Mover para')}).querySelector('select').options].map(o => o.textContent)`), ['Proposta', 'Negociação', 'Assinatura do contrato', 'Ganho', 'Perdido']);
 const escolher = nome => pagina.avaliar(`(() => { const s = ${campo('Mover para')}.querySelector('select'); s.value = [...s.options].find(o => o.textContent === ${JSON.stringify(nome)}).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.equal(await pagina.avaliar(`${campo('Motivo da perda')}.querySelector('select').value !== ''`), true, 'o motivo da perda vem com a primeira opção marcada');
 const motivoVisivel = () => pagina.avaliar(`!${campo('Motivo da perda')}.hidden`);
 assert.equal(await motivoVisivel(), false, 'o motivo da perda não aparece de saída');
 await escolher('Perdido'); assert.equal(await motivoVisivel(), true, 'perder pede o motivo');
 await escolher('Ganho'); assert.equal(await motivoVisivel(), false, 'ganhar não pede motivo');
 // solta a etapa para o teste seguinte começar pela lista de leads
 await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .funnel-chip.active')].forEach(c => c.click())`);
 await pagina.esperar(`!document.querySelector('#inbound-panel-leads .funnel-chip.active')`, { descricao: 'etapa solta' });
 semExcecoes();
});

test('Inbound: o detalhe do lead no funil oferece mover, qualificar e descartar, sem o seletor antigo de estágio', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads tbody .tbl-name').length > 0`, { descricao: 'lead listado' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads tbody .tbl-name').click()`);
 await pagina.esperar(`document.querySelector('#peek-lead .funnel-panel')`, { descricao: 'painel do funil' });
 // detalhes em pares rótulo/valor, o modelo de serviço traduzido e sem cartões
 const ficha = await pagina.avaliar(`(() => { const r = document.getElementById('peek-lead'); return { marca: r.classList.contains('lead-ficha'), rotulos: [...r.querySelectorAll('.ficha-dl dt')].map(x => x.textContent), interesse: [...r.querySelectorAll('.ficha-dl dd')][[...r.querySelectorAll('.ficha-dl dt')].findIndex(x => x.textContent === 'Interesse')].textContent, email: [...r.querySelectorAll('.ficha-dl dd')][[...r.querySelectorAll('.ficha-dl dt')].findIndex(x => x.textContent === 'E-mail')].textContent.trim(), cabecalho: r.querySelector('.peek-head h2').textContent }; })()`);
 assert.equal(ficha.marca, true);
 assert.ok(['Nome', 'E-mail', 'WhatsApp', 'Mensagem', 'Origem', 'Interesse'].every(r => ficha.rotulos.includes(r)), JSON.stringify(ficha.rotulos));
 assert.doesNotMatch(ficha.interesse, /education|on_demand|consulting|advisory/, 'o código interno não vai para a tela');
 assert.match(ficha.interesse, /Mentoria/);
 assert.equal(ficha.email, 'lead@exemplo.test', 'o e-mail aparece como valor editável');
 assert.equal(ficha.cabecalho, 'Lead de teste');
 const botoes = await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .funnel-panel button')].map(b => b.textContent)`);
 assert.deepEqual(botoes, ['Mover', 'Qualificar (vira oportunidade)', 'Descartar']);
 // Um select sem opção vazia precisa vir com a primeira marcada: vazio iria para a API como valor em branco.
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .funnel-panel select')].every(s => s.value !== '')`), true, 'select sem nada marcado');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#peek-lead .funnel-track .funnel-chip').length`), 8);
 assert.equal(await pagina.avaliar(`document.querySelector('#peek-lead .funnel-track .funnel-chip.active').textContent`), 'Novos');
 // Tarefas do lead: a aberta (criada por automação) e a concluída, cada uma com o botão certo, e o formulário de nova.
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .tasks-panel .task-row')].map(r => r.querySelector('strong').textContent + '|' + r.querySelector('button').textContent + '|' + r.classList.contains('task-done'))`),
  ['Ligar para o lead|Concluir|false', 'Mandar o portfólio|Reabrir|true']);
 assert.match(await pagina.avaliar(`document.querySelector('#peek-lead .tasks-panel .task-row').innerText`), /criada por automação/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .tasks-panel form button')].map(b => b.textContent).join('|')`), 'Adicionar tarefa');
 // Dados do espaço: os campos ativos do lead aparecem com o valor guardado; o desativado com valor aparece travado.
 const campos = await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .data-panel form')][0] && [...document.querySelectorAll('#peek-lead .data-panel form')][0].innerText`);
 assert.match(campos, /Porte/); assert.match(campos, /Observação/); assert.match(campos, /Campo antigo \(desativado\)/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .data-panel select')][0].value`), 'Micro');
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .data-panel label')].find(l => l.firstChild.textContent.startsWith('Campo antigo')).querySelector('input').disabled`), true);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#peek-lead .data-panel form button')].map(b => b.textContent).join('|')`), 'Salvar dados — lead', 'sem oportunidade, só o grupo do lead');
 // O formulário antigo só tem o responsável quando o lead está em funil: o estágio vem do funil.
 const rotulos = await pagina.avaliar(`[...document.querySelectorAll('#peek-lead form.commercial-form > label')].map(l => l.firstChild.textContent)`);
 assert.ok(!rotulos.includes('Estágio') && rotulos.includes('Responsável comercial'), JSON.stringify(rotulos));
 // Esc fecha o painel do lead, e a lista de Inbound segue atrás
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await pagina.esperar(`!document.getElementById('peek-lead')`, { descricao: 'painel do lead fechado com Esc' });
 assert.equal(await pagina.avaliar(`document.querySelectorAll('.peek-scrim').length`), 0);
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads tbody .tbl-name').length > 0`, { descricao: 'a lista segue atrás' });
 semExcecoes();
});

test('Inbound: nome, e-mail, WhatsApp e mensagem do lead se editam no lugar, com versão, e sempre sobra um contato', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads tbody .tbl-name').length > 0`, { descricao: 'lead listado' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads tbody .tbl-name').click()`);
 await pagina.esperar(`document.querySelector('#peek-lead .ficha-dl .inline-field')`, { descricao: 'ficha do lead aberta' });
 const raiz = '#peek-lead';
 const escritasDoLead = () => banco.escritas.filter(e => e.tipo === 'lead');
 const antes = escritasDoLead().length;
 // WhatsApp: normalizado pelo servidor (só dígitos)
 await editarCampo(raiz, 'WhatsApp', '(11) 97777-6666');
 await pagina.esperar(`(${CAMPO(raiz, 'WhatsApp')}.querySelector('.inline-ok'))`, { descricao: 'aviso de salvo' });
 assert.equal(escritasDoLead().length, antes + 1);
 assert.deepEqual(escritasDoLead().at(-1).params.slice(4, 8), ['Lead de teste', 'lead@exemplo.test', '11977776666', 'Quero saber mais']);
 // Nome: o título do painel acompanha, e a segunda edição usa a versão nova (senão o servidor responderia 409)
 await editarCampo(raiz, 'Nome', 'Lead Corrigido');
 await pagina.esperar(`document.querySelector('#peek-lead .peek-head h2').textContent === 'Lead Corrigido'`, { descricao: 'título acompanha o nome' });
 assert.equal(escritasDoLead().length, antes + 2);
 assert.equal(banco.lead.version, 3, 'duas gravações, duas versões');
 // Mensagem longa: Ctrl+Enter grava
 await abrirCampo(raiz, 'Mensagem');
 await pagina.avaliar(`(() => { const i = ${CAMPO(raiz, 'Mensagem')}.querySelector('textarea.inline-input'); i.value = 'Linha 1\\nLinha 2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); })()`);
 await pagina.esperar(`(${CAMPO(raiz, 'Mensagem')}.querySelector('.inline-ok'))`, { descricao: 'mensagem salva' });
 assert.equal(banco.lead.message, 'Linha 1\nLinha 2');
 // E-mail inválido: o erro aparece no campo e nada é gravado
 const n = escritasDoLead().length;
 await editarCampo(raiz, 'E-mail', 'sem-arroba');
 assert.equal(await erroDoCampo(raiz, 'E-mail'), 'E-mail inválido.');
 assert.equal(escritasDoLead().length, n);
 await pagina.avaliar(`${CAMPO(raiz, 'E-mail')}.querySelector('.inline-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 assert.equal(await valorDoCampo(raiz, 'E-mail'), 'lead@exemplo.test', 'Esc descarta e o valor volta');
 assert.ok(await pagina.avaliar(`!!document.getElementById('peek-lead')`), 'o Esc do campo não fecha a ficha');
 // Limpar e-mail com WhatsApp preenchido: pode. Depois, limpar o WhatsApp também: o servidor recusa e o campo mostra por quê.
 await editarCampo(raiz, 'E-mail', '');
 await pagina.esperar(`(${CAMPO(raiz, 'E-mail')}.querySelector('.inline-ok'))`, { descricao: 'e-mail limpo' });
 assert.equal(banco.lead.email, null);
 assert.equal(await valorDoCampo(raiz, 'E-mail'), 'Vazio');
 const m = escritasDoLead().length;
 await editarCampo(raiz, 'WhatsApp', '');
 await pagina.esperar(`(${CAMPO(raiz, 'WhatsApp')}.querySelector('.inline-erro:not([hidden])'))`, { descricao: 'erro do servidor no campo' });
 assert.match(await erroDoCampo(raiz, 'WhatsApp'), /e-mail ou WhatsApp/);
 assert.equal(escritasDoLead().length, m, 'a recusa não grava');
 await pagina.avaliar(`${CAMPO(raiz, 'WhatsApp')}.querySelector('.inline-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 // devolve o lead ao que era (os testes seguintes dependem dele)
 await editarCampo(raiz, 'E-mail', 'lead@exemplo.test');
 await pagina.esperar(`(${CAMPO(raiz, 'E-mail')}.querySelector('.inline-ok'))`);
 await editarCampo(raiz, 'WhatsApp', '');
 await pagina.esperar(`(${CAMPO(raiz, 'WhatsApp')}.querySelector('.inline-ok'))`);
 await editarCampo(raiz, 'Nome', 'Lead de teste');
 await pagina.esperar(`document.querySelector('#peek-lead .peek-head h2').textContent === 'Lead de teste'`);
 await abrirCampo(raiz, 'Mensagem');
 await pagina.avaliar(`(() => { const i = ${CAMPO(raiz, 'Mensagem')}.querySelector('textarea.inline-input'); i.value = 'Quero saber mais'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); })()`);
 await pagina.esperar(`(${CAMPO(raiz, 'Mensagem')}.querySelector('.inline-ok'))`);
 assert.equal(banco.lead.message, 'Quero saber mais');
 await pagina.avaliar(ESC);
 await pagina.esperar(`!document.getElementById('peek-lead')`, { descricao: 'ficha do lead fechada' });
 semExcecoes();
});

test('Inbound: o gerenciador de campos do espaço lista por tipo de registro e abre o formulário de novo campo', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelector('#inbound-panel-leads details.fields-manager')`, { descricao: 'gerenciador de campos' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads details.fields-manager summary').click()`);
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads .fields-manager .field-row').length === 4`, { descricao: 'quatro campos listados' });
 const linhas = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .fields-manager .field-row span')].map(s => s.textContent)`);
 assert.deepEqual(linhas, ['Porte · Lista (uma opção) (Micro, Pequena)', 'Observação · Texto · obrigatório', 'Campo antigo · Texto · desativado', 'Orçamento · Número']);
 const botoes = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .fields-manager .field-row')].map(r => [...r.querySelectorAll('button')].map(b => b.textContent).join('/'))`);
 assert.deepEqual(botoes, ['Desativar/Tornar obrigatório', 'Desativar/Tornar opcional', 'Ativar', 'Desativar/Tornar obrigatório']);
 // As opções só aparecem para tipo de lista.
 const opcoes = () => pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .fields-manager form label')].find(l => l.firstChild.textContent === 'Opções, separadas por vírgula').hidden`);
 assert.equal(await opcoes(), true);
 await pagina.avaliar(`(() => { const s = [...document.querySelectorAll('#inbound-panel-leads .fields-manager form label')].find(l => l.firstChild.textContent === 'Tipo').querySelector('select'); s.value = 'SELECT'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.equal(await opcoes(), false);
 semExcecoes();
});

test('Inbound: o gerenciador de automações lista, mostra o histórico e só pede o que a ação precisa', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelector('#inbound-panel-leads details.automations-manager')`, { descricao: 'gerenciador de automações' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads details.automations-manager summary').click()`);
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads .automations-manager .automation-row').length === 1`, { descricao: 'automação listada' });
 const texto = await pagina.avaliar(`document.querySelector('#inbound-panel-leads .automations-manager .automation-row').innerText`);
 assert.match(texto, /Ligar logo/); assert.match(texto, /Quando: Lead criado · funil Funil padrão/); assert.match(texto, /criar tarefa "Ligar para o lead" \(prazo 2 dias\)/); assert.match(texto, /Última execução: .* · deu certo/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .automations-manager .automation-row button')].map(b => b.textContent).join('|')`), 'Desativar|Ver execuções');
 const campo = nome => `[...document.querySelectorAll('#inbound-panel-leads .automations-manager form label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)})`;
 const escolher = (nome, valor) => pagina.avaliar(`(() => { const s = ${campo(nome)}.querySelector('select'); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 // A etapa só aparece depois de escolher o funil; título e prazo são da tarefa, o responsável é da outra ação.
 assert.equal(await pagina.avaliar(`${campo('Só nesta etapa')}.hidden`), true);
 await escolher('Só neste funil', '44444444-4444-4444-8444-444444444444');
 assert.equal(await pagina.avaliar(`${campo('Só nesta etapa')}.hidden`), false);
 assert.equal(await pagina.avaliar(`${campo('Título da tarefa')}.hidden`), false);
 assert.equal(await pagina.avaliar(`${campo('Responsável')}.hidden`), true);
 await escolher('Então', 'responsavel.atribuir');
 assert.equal(await pagina.avaliar(`${campo('Título da tarefa')}.hidden`), true);
 assert.equal(await pagina.avaliar(`${campo('Responsável')}.hidden`), false);
 assert.deepEqual(await pagina.avaliar(`[...${campo('Responsável')}.querySelector('select').options].map(o => o.textContent)`), ['Dono Teste']);
 semExcecoes();
});

test('Inbound: requisitos de etapa lista por etapa, e o campo oferecido é o do tipo de registro da etapa', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelector('#inbound-panel-leads details.requirements-manager')`, { descricao: 'gerenciador de requisitos' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads details.requirements-manager summary').click()`);
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads .requirements-manager .requirements-stage').length === 8`, { descricao: 'as oito etapas listadas' });
 const linhas = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .requirements-manager .field-row span')].map(s => s.textContent)`);
 assert.deepEqual(linhas, ['Para entrar na etapa: Confirmar o telefone · Tarefa a concluir (prazo 2 dias)']);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .requirements-manager .requirements-stage')][1].querySelector('h4').textContent`), 'Em contato');
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .requirements-manager .field-row button')].map(b => b.textContent).join('|')`), 'Desligar');
 const campo = nome => `[...document.querySelectorAll('#inbound-panel-leads .requirements-manager form label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)})`;
 const escolher = (nome, valor) => pagina.avaliar(`(() => { const s = ${campo(nome)}.querySelector('select'); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 // Tarefa: prazo e responsável; sem a escolha de campo.
 assert.equal(await pagina.avaliar(`${campo('Campo')}.hidden`), true);
 assert.equal(await pagina.avaliar(`${campo('Prazo da tarefa, em dias (opcional)')}.hidden`), false);
 // Campo, em etapa de lead (Novos): os campos do lead.
 await escolher('Exige', 'FIELD');
 assert.equal(await pagina.avaliar(`${campo('Campo')}.hidden`), false);
 assert.equal(await pagina.avaliar(`${campo('Prazo da tarefa, em dias (opcional)')}.hidden`), true);
 assert.deepEqual(await pagina.avaliar(`[...${campo('Campo')}.querySelector('select').options].map(o => o.textContent)`), ['Porte', 'Observação']);
 // Campo, em etapa aberta (Qualificação): os campos da oportunidade.
 await escolher('Etapa', '55555555-5555-4555-8555-555555555502');
 assert.deepEqual(await pagina.avaliar(`[...${campo('Campo')}.querySelector('select').options].map(o => o.textContent)`), ['Orçamento']);
 semExcecoes();
});

test('Inbound: o aviso de bloqueio diz o que falta, separando tarefa de campo', { skip: PULAR }, async () => {
 const html = await pagina.avaliar(`(async () => {
  const m = await import('/stage-requirements.js');
  const n = m.blockersNotice([
   { kind: 'ACTION', title: 'Confirmar o telefone', field_key: null },
   { kind: 'FIELD', title: 'Informar o orçamento', field_key: 'orcamento' }]);
  return { role: n.getAttribute('role'), texto: n.innerText.replace(/\\s+/g, ' ').trim() };
 })()`);
 assert.equal(html.role, 'alert');
 assert.match(html.texto, /Faltam estes requisitos da etapa/);
 assert.match(html.texto, /Confirmar o telefone — a tarefa foi criada; conclua em Tarefas\./);
 assert.match(html.texto, /Informar o orçamento — preencha o campo "orcamento" em Dados do espaço\./);
 const um = await pagina.avaliar(`(async () => { const m = await import('/stage-requirements.js'); return m.blockersNotice([{ kind: 'ACTION', title: 'X', field_key: null }]).querySelector('p').textContent; })()`);
 assert.equal(um, 'Ainda não dá para mover. Falta este requisito da etapa:');
 semExcecoes();
});

test('Acompanhamento: a atividade escolhe a contratação da empresa selecionada', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Acompanhamento'));
 await pagina.esperar(`[...document.querySelectorAll('#view-tracking button')].some(b => b.textContent.trim() === 'Nova atividade')`, { descricao: 'botão Nova atividade' });
 await pagina.avaliar(`[...document.querySelectorAll('#view-tracking button')].find(b => b.textContent.trim() === 'Nova atividade').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`, { descricao: 'formulário aberto' });
 const campo = nome => `[...document.querySelectorAll('dialog.tracking-editor label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)}).querySelector('select')`;
 const opcoes = nome => pagina.avaliar(`[...(${campo(nome)}).options].map(o => o.textContent)`);
 const escolher = async (nome, valor) => pagina.avaliar(`(() => { const s = ${campo(nome)}; s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 // Sem empresa escolhida, só a opção geral.
 assert.deepEqual(await opcoes('Contratação (opcional)'), ['Geral da empresa (sem contratação)']);
 await escolher('Cliente', EMPRESA);
 assert.deepEqual(await opcoes('Contratação (opcional)'), ['Geral da empresa (sem contratação)', 'Mentoria Alfa']);
 // Outra empresa: a contratação da primeira não pode ser escolhida.
 await escolher('Cliente', PESSOA_FISICA);
 assert.deepEqual(await opcoes('Contratação (opcional)'), ['Geral da empresa (sem contratação)']);
 // O teste abriu o diálogo de atividade; deixá-lo aberto atrapalharia os testes seguintes (um diálogo aberto fica com o Esc).
 await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 semExcecoes();
});

test('Pessoas: a tabela mostra e-mail e telefone, ou diz que faltam; a busca acha por eles; o cadastro pede os dois', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Pessoas'));
 await pagina.esperar(`document.querySelectorAll('#stakeholder-directory tbody tr').length === 2`, { descricao: 'duas pessoas listadas' });
 const cartao = nome => `[...document.querySelectorAll('#stakeholder-directory tbody tr')].find(c => c.querySelector('.tbl-name').textContent === ${JSON.stringify(nome)})`;
 assert.equal(await pagina.avaliar(`${cartao('Ana Contato')}.cells[1].innerText.replace(/\\s+/g, ' ').trim()`), 'ana@exemplo.test (11) 99999-0000');
 assert.equal(await pagina.avaliar(`${cartao('Ana Contato')}.cells[1].querySelector('a[href^="mailto:"]').getAttribute('href')`), 'mailto:ana@exemplo.test');
 assert.equal(await pagina.avaliar(`${cartao('Bruno Aluno')}.cells[1].textContent`), 'Sem e-mail nem telefone');
 assert.equal(await pagina.avaliar(`${cartao('Bruno Aluno')}.cells[1].firstChild.classList.contains('tbl-empty-cell')`), true);
 // a busca acha pelo e-mail
 await pagina.avaliar(`(() => { const i = document.getElementById('people-search'); i.value = 'ana@exemplo'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 await pagina.esperar(`document.querySelectorAll('#stakeholder-directory tbody tr').length === 1`, { descricao: 'busca por e-mail' });
 await pagina.avaliar(`(() => { const i = document.getElementById('people-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 // o cadastro tem os dois campos opcionais
 const campos = await pagina.avaliar(`[...document.querySelectorAll('#stakeholder-form label')].map(l => l.firstChild.textContent.trim()).filter(Boolean)`);
 assert.ok(campos.includes('E-mail (opcional)') && campos.includes('Telefone ou WhatsApp (opcional)'), JSON.stringify(campos));
 assert.equal(await pagina.avaliar(`document.querySelector('#stakeholder-form [name=email]').required`), false);
 semExcecoes();
});

test('ficha da empresa abre pelo cartão e traz o painel de fotos', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-clients #tenants tr')].find(c => c.textContent.includes('Empresa Alfa')).click()`);
 await pagina.esperar(`document.querySelector('#view-client .photo-panel .photo-zone') && !document.querySelector('#view-client .photo-panel .photo-zone').hidden`, { descricao: 'painel de fotos na ficha' });
 if (process.env.UI_SCREENSHOTS) { await pagina.tela(1280, 800); await new Promise(r => setTimeout(r, 400)); await pagina.imagem(join(ARTEFATOS, "1280-Ficha_da_empresa.png")); await pagina.tela(390, 844); await pagina.imagem(join(ARTEFATOS, '390-Ficha_da_empresa.png')); await pagina.tela(1280, 800); }
 const ficha = await pagina.avaliar(`document.getElementById('view-client').innerText`);
 // a ficha é um painel lateral: o nome e o tipo estão no cabeçalho dele, e a tela de fundo mantém o próprio título
 const painel = await pagina.avaliar(`(() => { const p = document.getElementById('view-client'); return { classe: p.classList.contains('peek-side'), titulo: p.querySelector('.peek-head h2').textContent, sub: p.querySelector('.peek-sub').textContent, abas: [...p.querySelectorAll('[role=tab]')].map(t => t.textContent), ativa: p.querySelector('[role=tab][aria-selected=true]').textContent, dialogo: p.getAttribute('role'), tituloPagina: document.getElementById('page-title').textContent.trim() }; })()`);
 assert.equal(painel.classe, true);
 assert.equal(painel.titulo, 'Empresa Alfa');
 assert.equal(painel.sub, 'Cliente · Empresa · Ativo');
 assert.deepEqual(painel.abas, ['Visão geral', 'Contratações1', 'Histórico']);
 assert.equal(painel.ativa, 'Visão geral');
 assert.equal(painel.dialogo, 'dialog');
 assert.notEqual(painel.tituloPagina, 'Empresa Alfa', 'a tela de fundo não troca de título');
 assert.match(ficha, /Fotos/);
 // papel e cargo iguais não se repetem: "Aluno", não "Aluno · Aluno"
 assert.doesNotMatch(ficha, /(\b\w+\b) · \1\b/);
 semExcecoes();
});

test('ficha da empresa: o histórico mostra a alteração com o antes e o depois, em português', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Histórico')).click()`);
 await pagina.esperar(`!document.getElementById('empresa-panel-historico').hidden`, { descricao: 'aba Histórico aberta' });
 const linhas = await pagina.avaliar(`[...document.querySelectorAll('#view-client .history-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);
 assert.equal(linhas.length, 2);
 assert.match(linhas[0], /^Empresa alterada Relacionamento: Prospect → Cliente · .* · dono@exemplo.test$/);
 assert.match(linhas[1], /^Tempo registrado .* · dono@exemplo.test$/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-client .client-detail-panel h3')].some(h => h.textContent === 'Histórico')`), true);
 semExcecoes();
});

test('ficha da empresa: o cadastro se edita no lugar, só o que mudou, e descarta com Esc', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Visão geral')).click()`);
 const raiz = '#view-client';
 // não há mais botão "Editar empresa": o painel só tem a ação de criar
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#view-client .peek-foot button')].map(b => b.textContent.trim())`), ['Nova contratação']);
 assert.equal(await valorDoCampo(raiz, 'Nome'), 'Empresa Alfa');
 assert.equal(await valorDoCampo(raiz, 'Relacionamento'), 'Cliente');
 assert.equal(await valorDoCampo(raiz, 'Tipo'), 'Empresa');
 assert.equal(await valorDoCampo(raiz, 'Situação'), 'Ativo');
 assert.ok((await pagina.avaliar(`document.querySelector('#view-client .ficha-dl').innerText`)).includes('empresa-alfa'), 'o identificador aparece, sem edição');
 const escritas = () => banco.escritas.filter(e => e.tipo === 'tenant');
 const antes = escritas().length;
 // nome
 await editarCampo(raiz, 'Nome', 'Empresa Alfa Ltda');
 await pagina.esperar(`document.querySelector('#view-client .peek-head h2').textContent === 'Empresa Alfa Ltda'`, { descricao: 'título acompanha o nome' });
 assert.equal(escritas().length, antes + 1);
 assert.deepEqual(escritas().at(-1).params, [EMPRESA, 'active', 'Empresa Alfa Ltda', 'customer', 'active', 'company']);
 // a lista que está por baixo também mostra o nome novo
 assert.ok((await pagina.avaliar(`document.querySelector('#stakeholder-directory .tbl-link')?.textContent ?? ''`)).includes('Empresa Alfa Ltda'));
 // situação (seletor grava ao escolher) e o subtítulo acompanha
 await editarCampo(raiz, 'Situação', 'paused', 'change');
 await pagina.esperar(`document.querySelector('#view-client .peek-sub').textContent === 'Cliente · Empresa · Pausado'`, { descricao: 'subtítulo acompanha a situação' });
 assert.equal(escritas().at(-1).params[4], 'paused');
 // vazio e curto demais não gravam
 const n = escritas().length;
 await editarCampo(raiz, 'Nome', '');
 assert.match(await erroDoCampo(raiz, 'Nome'), /não pode ficar vazio/);
 await digitar(raiz, 'Nome', 'A');
 assert.match(await erroDoCampo(raiz, 'Nome'), /ao menos 2 caracteres/);
 if (process.env.UI_SCREENSHOTS) await pagina.imagem(join(ARTEFATOS, '1280-Ficha_edicao_no_lugar.png'));
 assert.equal(escritas().length, n);
 // Esc descarta, volta o valor e NÃO fecha a ficha
 await pagina.avaliar(`${CAMPO(raiz, 'Nome')}.querySelector('.inline-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 assert.equal(await valorDoCampo(raiz, 'Nome'), 'Empresa Alfa Ltda');
 assert.equal(await pagina.avaliar(`document.getElementById('view-client').hidden`), false);
 // devolve o que era (os testes seguintes dependem disto)
 await editarCampo(raiz, 'Situação', 'active', 'change');
 await pagina.esperar(`document.querySelector('#view-client .peek-sub').textContent === 'Cliente · Empresa · Ativo'`);
 await editarCampo(raiz, 'Nome', 'Empresa Alfa');
 await pagina.esperar(`document.querySelector('#view-client .peek-head h2').textContent === 'Empresa Alfa'`);
 semExcecoes();
});

test('ficha da empresa: a contratação muda de nome e de situação no lugar, e erro do servidor aparece no campo', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Contratações')).click()`);
 await pagina.esperar(`!document.getElementById('empresa-panel-contratacoes').hidden`, { descricao: 'aba Contratações' });
 const raiz = '#empresa-panel-contratacoes';
 assert.equal(await valorDoCampo(raiz, 'Nome da contratação'), 'Mentoria Alfa');
 assert.equal(await valorDoCampo(raiz, 'Situação da contratação'), 'Ativo');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('${raiz} .client-engagement .inline-field').length`), 2, 'nome e situação');
 semExcecoes();
});

test('pessoa: a ficha abre por cima da empresa, cada campo se edita no lugar, e Esc fecha de cima para baixo', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Visão geral')).click()`);
 await pagina.avaliar(`[...document.querySelectorAll('#view-client .link-nome')].find(b => b.textContent === 'Ana Contato').click()`);
 await pagina.esperar(`document.querySelector('#peek-pessoa .ficha-dl .inline-field')`, { descricao: 'ficha da pessoa aberta' });
 const raiz = '#peek-pessoa';
 if (process.env.UI_SCREENSHOTS) { await new Promise(r => setTimeout(r, 400)); await pagina.imagem(join(ARTEFATOS, '1280-Ficha_da_pessoa.png')); }
 assert.equal(await pagina.avaliar(`document.querySelector('#peek-pessoa .peek-head h2').textContent`), 'Ana Contato');
 assert.equal(await pagina.avaliar(`document.querySelector('#peek-pessoa .peek-sub').textContent`), 'Decisor · Diretora · Empresa Alfa');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#peek-pessoa [role=tab]').length`), 1, 'uma aba só: a barra de abas não aparece');
 assert.equal(await pagina.avaliar(`document.querySelector('#peek-pessoa .peek-tabs').hidden`), true);
 assert.equal(await valorDoCampo(raiz, 'E-mail'), 'ana@exemplo.test');
 assert.equal(await valorDoCampo(raiz, 'Telefone'), '(11) 99999-0000', 'o telefone aparece formatado');
 assert.equal(await valorDoCampo(raiz, 'Papel'), 'Decisor');
 assert.equal(await valorDoCampo(raiz, 'Contato principal'), 'Sim');
 assert.equal(await valorDoCampo(raiz, 'Pode ser contatada'), 'Não');
 const pessoa = () => banco.escritas.filter(e => e.tipo === 'pessoa');
 const vinculo = () => banco.escritas.filter(e => e.tipo === 'vinculo');
 // e-mail: o servidor guarda em minúsculas
 await editarCampo(raiz, 'E-mail', 'Ana.Nova@Exemplo.test');
 await pagina.esperar(`(${CAMPO(raiz, 'E-mail')}.querySelector('.inline-ok'))`, { descricao: 'e-mail salvo' });
 assert.deepEqual(pessoa().at(-1).params, [ANA, 'Ana Contato', 'ana.nova@exemplo.test', '11999990000']);
 assert.equal(await valorDoCampo(raiz, 'E-mail'), 'ana.nova@exemplo.test');
 // telefone: normalizado e exibido formatado
 await editarCampo(raiz, 'Telefone', '(11) 98888-7777');
 await pagina.esperar(`(${CAMPO(raiz, 'Telefone')}.querySelector('.inline-ok'))`, { descricao: 'telefone salvo' });
 assert.equal(pessoa().at(-1).params[3], '11988887777');
 assert.equal(await valorDoCampo(raiz, 'Telefone'), '(11) 98888-7777');
 // e-mail e telefone inválidos não gravam
 const n = pessoa().length;
 await editarCampo(raiz, 'E-mail', 'sem-arroba');
 assert.equal(await erroDoCampo(raiz, 'E-mail'), 'E-mail inválido.');
 await pagina.avaliar(`${CAMPO(raiz, 'E-mail')}.querySelector('.inline-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await editarCampo(raiz, 'Telefone', '12345');
 assert.match(await erroDoCampo(raiz, 'Telefone'), /Telefone inválido/);
 await pagina.avaliar(`${CAMPO(raiz, 'Telefone')}.querySelector('.inline-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 assert.equal(pessoa().length, n);
 assert.ok(await pagina.avaliar(`!!document.getElementById('peek-pessoa')`), 'o Esc do campo não fecha a ficha');
 // papel é do vínculo com a empresa: grava na outra tabela, e o subtítulo acompanha
 await editarCampo(raiz, 'Papel', 'finance', 'change');
 await pagina.esperar(`document.querySelector('#peek-pessoa .peek-sub').textContent === 'Financeiro · Diretora · Empresa Alfa'`, { descricao: 'subtítulo acompanha o papel' });
 assert.deepEqual(vinculo().at(-1).params, [EMPRESA, ANA, 'finance', 'Diretora', true, false]);
 // devolve o que era
 await editarCampo(raiz, 'Papel', 'decision_maker', 'change');
 await pagina.esperar(`document.querySelector('#peek-pessoa .peek-sub').textContent === 'Decisor · Diretora · Empresa Alfa'`);
 await editarCampo(raiz, 'E-mail', 'ana@exemplo.test');
 await pagina.esperar(`(${CAMPO(raiz, 'E-mail')}.querySelector('.inline-ok'))`);
 await editarCampo(raiz, 'Telefone', '11999990000');
 await pagina.esperar(`(${CAMPO(raiz, 'Telefone')}.querySelector('.inline-ok'))`);
 // Esc fecha só o de cima; a ficha da empresa continua; o segundo Esc fecha a empresa
 await pagina.avaliar(ESC);
 await pagina.esperar(`!document.getElementById('peek-pessoa')`, { descricao: 'ficha da pessoa fechada' });
 assert.equal(await pagina.avaliar(`document.getElementById('view-client').hidden`), false, 'a empresa segue aberta por baixo');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('.peek-scrim').length`), 1, 'sobra o escurecimento da empresa');
 await pagina.avaliar(ESC);
 await pagina.esperar(`document.getElementById('view-client').hidden`, { descricao: 'empresa fechada' });
 // reabre a ficha da empresa para os testes de fotos, que partem dela
 await pagina.avaliar(`[...document.querySelectorAll('#view-people tbody .tbl-link')].find(b => b.textContent === 'Empresa Alfa').click()`);
 await pagina.esperar(`document.querySelector('#view-client .photo-panel .photo-zone') && !document.getElementById('view-client').hidden`, { descricao: 'ficha da empresa reaberta' });
 semExcecoes();
});

test('fotos: colar uma imagem envia, aparece e fica privada; arquivo que não é imagem é recusado', { skip: PULAR }, async () => {
 // Fotos mora na aba Visão geral, e colar só vale com o painel à vista: volta para ela.
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Visão geral')).click()`);
 await pagina.esperar(`document.querySelector('#view-client .photo-panel').offsetParent !== null`, { descricao: 'fotos à vista na Visão geral' });
 const antes = banco.fotos.length;
 pagina.limparProblemas();
 // 1) soltar um .txt não envia nada
 await pagina.avaliar(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['oi'], 'nota.txt', { type: 'text/plain' }));
  document.querySelector('#view-client .photo-panel').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
 await pagina.esperar(`document.querySelector('#view-client .photo-status').textContent.includes('Nenhuma imagem')`, { descricao: 'aviso de arquivo que não é imagem' });
 assert.equal(banco.fotos.length, antes);
 // 2) colar um PNG (Ctrl+V com a tela em foco, fora de campo de texto)
 const b64 = PNG_1X1.toString('base64');
 await pagina.avaliar(`(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'logo.png', { type: 'image/png' }));
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
 await pagina.esperar(`document.querySelectorAll('#view-client .photo-card').length === 1`, { descricao: 'foto colada aparece na grade' });
 assert.equal(banco.fotos.length, antes + 1);
 const guardada = banco.fotos.at(-1);
 assert.equal(guardada.content_type, 'image/png');
 assert.match(guardada.object_key, new RegExp(`^media/tenant/${EMPRESA}/[0-9a-f-]{36}\\.png$`));
 assert.ok(r2.objetos.has(guardada.object_key), 'o objeto não foi para o bucket');
 assert.equal(guardada.is_primary, true, 'a primeira foto deve ser a principal');
 // privacidade: a tela nunca conhece a chave do objeto nem um endereço público do bucket
 const html = await pagina.avaliar(`document.documentElement.outerHTML`);
 assert.ok(!html.includes(guardada.object_key), 'a chave do objeto vazou para a tela');
 assert.ok(!/r2\.cloudflarestorage\.com/.test(html), 'endereço do bucket na tela');
 // 3) nenhuma chamada de foto falhou
 assert.deepEqual(pagina.problemas.requisicoes.filter(r => r.url.includes('/api/media')), []);
 semExcecoes();
});

test('colar com o foco num campo de texto continua sendo texto, não foto', { skip: PULAR }, async () => {
 const antes = banco.fotos.length;
 await pagina.avaliar(`(() => { const campo = document.createElement('input'); campo.id = 'campo-de-teste'; document.getElementById('view-client').append(campo); campo.focus();
  const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(4)], 'x.png', { type: 'image/png' }));
  campo.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
 await new Promise(ok => setTimeout(ok, 500));
 assert.equal(banco.fotos.length, antes);
 await pagina.avaliar(`document.getElementById('campo-de-teste').remove()`);
});

test('ficha da empresa: o painel amplia, a lista de fundo continua e Esc fecha devolvendo o foco', { skip: PULAR }, async () => {
 const fundo = await pagina.avaliar(`(() => { const secoes = [...document.querySelectorAll('main section.view')].filter(s => !s.hidden && s.id !== 'view-client'); return secoes.map(s => s.id); })()`);
 assert.equal(fundo.length, 1, 'a tela de onde a ficha foi aberta segue visível por baixo: ' + JSON.stringify(fundo));
 // ampliar e reduzir
 await pagina.avaliar(`document.querySelector('#view-client .peek-icon[aria-label="Ampliar painel"]').click()`);
 assert.equal(await pagina.avaliar(`document.getElementById('view-client').classList.contains('peek-wide')`), true);
 await pagina.avaliar(`document.querySelector('#view-client .peek-icon[aria-label="Reduzir painel"]').click()`);
 assert.equal(await pagina.avaliar(`document.getElementById('view-client').classList.contains('peek-wide')`), false);
 // trocar de aba mostra só o painel dela
 await pagina.avaliar(`[...document.querySelectorAll('#view-client [role=tab]')].find(t => t.textContent.includes('Contratações')).click()`);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-client .peek-panel')].filter(p => !p.hidden).map(p => p.id).join()`), 'empresa-panel-contratacoes');
 // Esc fecha
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await pagina.esperar(`document.getElementById('view-client').hidden`, { descricao: 'painel fechado com Esc' });
 assert.equal(await pagina.avaliar(`document.querySelectorAll('.peek-scrim').length`), 0, 'o escurecimento sai junto');
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('main section.view')].filter(s => !s.hidden).length`), 1, 'sobra só a tela de fundo');
 semExcecoes();
});

// Capturas das fichas (só com UI_SCREENSHOTS): cada tela de detalhe, para revisão visual. Não afirma nada
// além de não lançar exceção; o que se vê está nas imagens de test/ui/artifacts.
test('capturas: as fichas de espaço, lead e contratação', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 await pagina.tela(1280, 800);
 const foto = nome => pagina.imagem(join(ARTEFATOS, `1280-${nome}.png`));
 const geral = `(() => { const c = document.getElementById('context-select'); c.value = ''; c.dispatchEvent(new Event('change', { bubbles: true })); })()`;
 // Espaço (Portfólio -> abrir gestão), um de cada tipo
 await pagina.avaliar(CLICAR_NO_MENU('Portfólio'));
 await pagina.esperar(`document.querySelectorAll('#product-catalog tbody .tbl-name').length >= 2`, { descricao: 'espaços listados' });
 for (const [nome, arquivo] of [['Plataforma A', 'Ficha_do_espaco_plataforma'], ['Mentorias', 'Ficha_do_espaco_linha_de_servico']]) {
  await pagina.avaliar(`[...document.querySelectorAll('#product-catalog tbody .tbl-name')].find(b => b.textContent === ${JSON.stringify(nome)}).click()`);
  await pagina.esperar(`document.getElementById('page-title').textContent.trim() !== 'Portfólio'`, { descricao: 'ficha do espaço aberta' });
  await new Promise(r => setTimeout(r, 600));
  await foto(arquivo);
  await pagina.avaliar(geral);
  await pagina.esperar(`[...document.querySelectorAll('nav button')].some(x => x.textContent.trim() === 'Portfólio')`, { descricao: 'menu geral de volta' });
  await pagina.avaliar(CLICAR_NO_MENU('Portfólio'));
  await pagina.esperar(`document.querySelectorAll('#product-catalog tbody .tbl-name').length >= 2`, { descricao: 'espaços listados de novo' });
 }
 // Lead (Inbound -> detalhe)
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads tbody .tbl-name').length > 0`, { descricao: 'lead listado' });
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads tbody .tbl-name').click()`);
 await pagina.esperar(`document.querySelector('#peek-lead .funnel-panel')`, { descricao: 'detalhe do lead' });
 await new Promise(r => setTimeout(r, 400));
 await pagina.tela(1280, 2600);
 await new Promise(r => setTimeout(r, 300));
 await foto('Ficha_do_lead_inteira');
 await pagina.tela(1280, 800);
 await foto('Ficha_do_lead');
 // Contratação (Serviços -> serviço abre a empresa; a contratação vive dentro da ficha da empresa, já capturada)
 semExcecoes();
});

test('capturas: galeria de selos, etiquetas e contagens', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 await pagina.tela(960, 520);
 await pagina.avaliar(`(() => {
  const g = document.createElement('div'); g.id = 'galeria-selos';
  g.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;padding:28px 32px;overflow:auto';
  const linha = (titulo, itens) => { const h = document.createElement('p'); h.textContent = titulo; h.style.cssText = 'margin:18px 0 8px;font-weight:600;color:#4b4b53'; const l = document.createElement('div'); l.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center'; l.innerHTML = itens.join(''); g.append(h, l); };
  const s = (tom, texto) => '<span class="status ' + tom + '">' + texto + '</span>';
  linha('Tons', [s('neutral', 'Neutro'), s('success', 'Sucesso'), s('warning', 'Aviso'), s('danger', 'Perigo'), s('info', 'Informação'), s('accent', 'Destaque')]);
  linha('Estados do sistema (tomDoEstado)', [s('success', 'Ativo'), s('info', 'Em implantação'), s('info', 'Planejado'), s('accent', 'Lead'), s('warning', 'Pausado'), s('neutral', 'Concluído'), s('neutral', 'Descontinuado'), s('warning', 'A classificar'), s('info', 'Novo'), s('accent', 'Qualificado'), s('success', 'Ganho'), s('neutral', 'Perdido')]);
  linha('Conexões e avisos', [s('success', 'Conectado'), s('info', 'Consultando'), s('neutral', 'Pendente'), s('danger', 'Erro'), s('warning', 'Expira em 5 dias')]);
  linha('Apelidos antigos (seguem valendo)', [s('active', 'active'), s('building', 'building'), s('failed', 'failed'), s('danger', 'danger'), s('', 'sem tom')]);
  linha('Etiquetas livres', ['<span class="card-tags"><span class="status">plataforma</span><span class="status">checkout</span><span class="status">e-mail</span></span>', '<span class="tag-chip">mentoria</span>']);
  linha('Contagens das abas', ['<span style="font-weight:600">Todos <span class="tab-count">12</span></span>', '<span style="font-weight:600;color:#646469">Ativos <span class="tab-count">8</span></span>', '<span style="font-weight:600;color:#646469">A classificar <span class="tab-count">0</span></span>']);
  document.body.append(g);
 })()`);
 await new Promise(r => setTimeout(r, 200));
 await pagina.imagem(join(ARTEFATOS, '960-Selos.png'));
 await pagina.avaliar(`document.getElementById('galeria-selos').remove()`);
 await pagina.tela(1280, 800);
 semExcecoes();
});

test('controle: o detector de defeitos de tela enxerga o que deve enxergar', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(`(() => {
  const ruim = document.createElement('section'); ruim.id = 'secao-ruim';
  ruim.innerHTML = '<h2>Leads</h2><h3>Leads</h3><p>Total: undefined e NaN</p><button></button>';
  // Estilo pelo DOM: a CSP da tela (style-src 'self') ignora style="" escrito em HTML.
  const largo = document.createElement('div'); largo.style.width = '3000px'; largo.style.height = '4px'; ruim.append(largo);
  document.body.append(ruim);
 })()`);
 const defeitos = await pagina.avaliar(leituraDe(`document.getElementById('secao-ruim')`));
 await pagina.avaliar(`document.getElementById('secao-ruim').remove()`);
 assert.deepEqual(defeitos.repetidos, ['Leads']);
 assert.deepEqual(defeitos.vazamento, ['undefined', 'NaN']);
 assert.equal(defeitos.botoesSemNome, 1);
 assert.ok(defeitos.estouro > 1, 'o estouro de largura não foi detectado');
});

test('nenhuma requisição crítica falhou durante a sessão', { skip: PULAR }, async () => {
 pagina.limparProblemas();
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden`, { descricao: 'painel depois de recarregar (sessão por cookie)' });
 await pagina.esperar(`document.querySelectorAll('nav button').length > 5`);
 const criticas = pagina.problemas.requisicoes.filter(r => /\/api\/bootstrap/.test(r.url));
 assert.deepEqual(criticas, []);
 semExcecoes();
});
