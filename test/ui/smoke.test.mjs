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
import * as AM from '../../apps/web/public/agenda-model.js';

const PULAR = acharNavegador() ? false : 'Chrome/Edge não encontrado (defina CHROME_PATH)';
const ARTEFATOS = fileURLToPath(new URL('./artifacts/', import.meta.url));

const MENU_ESPERADO = ['Visão geral', 'Financeiro', 'Empresas', 'Pessoas', 'Clientes', 'Inbound', 'Portfólio', 'Serviços', 'Acompanhamento', 'Conexões', 'Vercel', 'GitHub', 'EasyPanel', 'DNS', 'Banco de dados', 'Configurações'];
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

test('celular: sem zoom e sem rolagem lateral da página, em todas as telas', { skip: PULAR }, async () => {
 await pagina.tela(390, 844);
 const base = await pagina.avaliar(`(() => ({
  meta: document.querySelector('meta[name=viewport]').content,
  html: { toque: getComputedStyle(document.documentElement).touchAction, x: getComputedStyle(document.documentElement).overflowX },
  corpo: { toque: getComputedStyle(document.body).touchAction, x: getComputedStyle(document.body).overflowX },
 }))()`);
 assert.match(base.meta, /maximum-scale=1/); assert.match(base.meta, /user-scalable=no/);
 assert.deepEqual([base.html.toque, base.corpo.toque], ['pan-y', 'pan-y'], 'só rolagem vertical na página: sem pinça nem arrasto lateral');
 assert.deepEqual([base.html.x, base.corpo.x], ['clip', 'clip']);
 // Mesmo que algo estoure a largura, a página não anda para o lado
 const andou = await pagina.avaliar(`(() => { const p = document.createElement('div'); p.style.cssText = 'width:3000px;height:10px'; document.body.append(p); window.scrollTo(600, 0); document.documentElement.scrollLeft = 600; document.body.scrollLeft = 600; const x = [window.scrollX, document.documentElement.scrollLeft, document.body.scrollLeft]; p.remove(); return x; })()`);
 assert.deepEqual(andou, [0, 0, 0], 'conteúdo largo demais não pode mover a página para o lado');
 // Campo com menos de 16px faz o iOS dar zoom ao focar
 const pequenos = [];
 for (const nome of MENU_ESPERADO) {
  await pagina.avaliar(CLICAR_NO_MENU(nome));
  await pagina.esperar(`(${SECAO}) && (${SECAO}).innerText.trim().length > 20`, { descricao: `tela ${nome}` });
  await new Promise(ok => setTimeout(ok, 250));
  const achados = await pagina.avaliar(`[...document.querySelectorAll('input, select, textarea')].filter(c => c.offsetParent && !/^(checkbox|radio|range|color|file|hidden)$/.test(c.type) && parseFloat(getComputedStyle(c).fontSize) < 16).map(c => (c.name || c.id || c.type || c.tagName) + ' ' + getComputedStyle(c).fontSize)`);
  if (achados.length) pequenos.push(nome + ': ' + achados.join(', '));
 }
 assert.deepEqual(pequenos, [], 'campos com menos de 16px (o iOS dá zoom ao focar)');
 await pagina.tela(1280, 800);
 semExcecoes();
});

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

// Tema: "sistema" é o padrão e acompanha o aparelho ao vivo; Configurações troca; a escolha sobrevive a recarregar.
const TEMA = `(() => ({ tema: document.documentElement.dataset.theme, pref: document.documentElement.dataset.themePref,
 fundo: getComputedStyle(document.body).backgroundColor, guardado: (() => { try { return localStorage.getItem('tzolkin-tema'); } catch { return 'erro'; } })() }))()`;

test('tema: segue o sistema por padrão, ao vivo', { skip: PULAR }, async () => {
 await pagina.esquema('light');
 await pagina.avaliar(`localStorage.removeItem('tzolkin-tema'); window.TzolkinTema.aplicar()`);
 let t = await pagina.avaliar(TEMA);
 assert.deepEqual([t.tema, t.pref, t.guardado], ['light', 'sistema', null]);
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`, { descricao: 'o sistema foi para escuro e o Core acompanhou' });
 t = await pagina.avaliar(TEMA);
 assert.equal(t.fundo, 'rgb(17, 17, 17)', 'fundo do escuro é o #111 medido no ChatGPT');
 assert.equal(await pagina.avaliar(`getComputedStyle(document.documentElement).colorScheme`), 'dark', 'barras e campos nativos também escurecem');
 semExcecoes();
});

test('tema: Configurações escolhe claro/escuro/sistema e a escolha sobrevive a recarregar', { skip: PULAR }, async () => {
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`!document.getElementById('view-settings').hidden && document.querySelectorAll('#settings-body input[name=tema]').length === 3`, { descricao: 'tela de Configurações' });
 const marcado = () => pagina.avaliar(`document.querySelector('#settings-body input[name=tema]:checked')?.value`);
 const escolher = valor => pagina.avaliar(`(() => { const r = document.querySelector('#settings-body input[value=${valor}]'); r.click(); })()`);
 assert.equal(await marcado(), 'sistema');
 // sistema está escuro; escolher Claro vence o sistema
 await escolher('claro');
 let t = await pagina.avaliar(TEMA);
 assert.deepEqual([t.tema, t.pref, t.guardado], ['light', 'claro', 'claro']);
 assert.equal(t.fundo, 'rgb(255, 255, 255)');
 await pagina.esquema('light');
 await escolher('escuro');
 t = await pagina.avaliar(TEMA);
 assert.deepEqual([t.tema, t.pref, t.guardado], ['dark', 'escuro', 'escuro'], 'Escuro vence o sistema claro');
 // recarrega: o script do <head> já aplica antes do app carregar, sem piscar claro
 pagina.limparProblemas();
 await pagina.ir(origem + '/');
 assert.equal(await pagina.avaliar(`document.documentElement.dataset.theme`), 'dark');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`, { descricao: 'painel depois de recarregar' });
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`document.querySelectorAll('#settings-body input[name=tema]').length === 3`);
 assert.equal(await marcado(), 'escuro', 'a opção marcada reflete a escolha guardada');
 // volta ao padrão: remove a escolha guardada
 await escolher('sistema');
 t = await pagina.avaliar(TEMA);
 assert.deepEqual([t.tema, t.pref, t.guardado], ['light', 'sistema', null]);
 semExcecoes();
});

test('tema escuro: texto, texto apagado e selos mantêm o contraste legível nas telas principais', { skip: PULAR }, async () => {
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`);
 await pagina.tela(1280, 800);
 const LER = `(() => {
  const canais = c => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const luz = c => { const [r, g, b] = canais(c).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  // o fundo de verdade: sobe pela árvore até achar uma cor opaca
  const fundoDe = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(.*, 0\\)|transparent/.test(c)) return c; } return 'rgb(17, 17, 17)'; };
  const par = el => ({ texto: el.textContent.trim().slice(0, 24), cor: razao(getComputedStyle(el).color, fundoDe(el)) });
  const pegar = (seletor, n = 3) => [...document.querySelectorAll(seletor)].filter(e => e.textContent.trim() && e.offsetParent).slice(0, n).map(par);
  return { titulo: pegar('h1'), menu: pegar('.nav-item'), cabecalho: pegar('#client-table th, .tbl th', 2), nomes: pegar('.cell-name strong, .tbl td strong', 2),
   apagado: pegar('.cell-name small, .tbl td small, .page-desc', 2), selos: pegar('#tenants .status', 3), abas: pegar('#client-tabs .tab-count', 2) };
 })()`;
 for (const tela of ['Clientes', 'Empresas', 'Pessoas']) {
  await pagina.avaliar(CLICAR_NO_MENU(tela));
  await pagina.esperar(`document.querySelectorAll('.view:not([hidden]) .tbl tbody tr').length > 0`, { descricao: `linhas de ${tela}` });
  const lido = await pagina.avaliar(LER);
  for (const [grupo, itens] of Object.entries(lido)) for (const item of itens) {
   assert.ok(item.cor >= 4.5, `${tela} / ${grupo} "${item.texto}": contraste ${item.cor}:1 no escuro (mínimo 4,5)`);
  }
  assert.ok(lido.titulo.length > 0 && lido.menu.length > 0, `${tela}: nada foi medido (seletor desatualizado?)`);
 }
 await pagina.esquema('light');
 semExcecoes();
});

test('tema escuro: logo escura e neutra inverte; colorida e clara ficam como estão', { skip: PULAR }, async () => {
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`);
 await pagina.avaliar(CLICAR_NO_MENU('Conexões'));
 await pagina.esperar(`document.querySelectorAll('.view:not([hidden]) img.provider-logo').length >= 3`, { descricao: 'logos dos provedores' });
 const LER = `new Promise(ok => setTimeout(() => ok(Object.fromEntries([...document.querySelectorAll('.view:not([hidden]) img.provider-logo')].map(i => [i.src.split('/').pop(), { marcada: i.getAttribute('data-logo-escura'), filtro: getComputedStyle(i).filter }]))), 600))`;
 const escuro = await pagina.avaliar(LER);
 assert.equal(escuro['github.svg']?.marcada, 'neutra', 'GitHub (#1b1f23) é escura');
 assert.equal(escuro['vercel.svg']?.marcada, 'neutra', 'Vercel (preta) é escura');
 assert.equal(escuro['easypanel.svg']?.marcada, null, 'EasyPanel é colorido e legível: não inverte');
 assert.match(escuro['github.svg'].filtro, /invert\(1\)/, 'no escuro a logo escura é invertida');
 assert.equal(escuro['easypanel.svg'].filtro, 'none');
 await pagina.esquema('light');
 await pagina.esperar(`document.documentElement.dataset.theme === 'light'`);
 const claro = await pagina.avaliar(LER);
 assert.equal(claro['github.svg'].filtro, 'none', 'no claro nada é invertido');
 semExcecoes();
});

// Aba Vercel com dados: o fixture não tem token, então a página recebe uma resposta de /api/deploys montada aqui,
// com um projeto em cada estado que a tela sabe desenhar.
const DEPLOYS_DE_EXEMPLO = JSON.stringify((() => {
 const d = (state, label, extra = {}) => ({ id: 'dpl_' + Math.random().toString(36).slice(2, 8), state, state_label: label, target: 'production', url: 'https://site-exemplo.vercel.app', inspector_url: 'https://vercel.com/x/y', branch: 'main', commit: 'a1b2c3d', commit_message: 'feat(site): nova página de preços', created_at: new Date(Date.now() - 3600e3).toISOString(), ready_substate: null, ...extra });
 const p = (nome, deployments, extra = {}) => ({ provider: 'vercel', project_id: 'prj_' + nome, project: nome, git_connected: true, deployments, ...extra });
 return {
  configured: true, checked_at: new Date().toISOString(),
  providers: [{ provider: 'vercel', status: 'ok', message: null, truncated: 0, incomplete: false }],
  projects: [
   p('tzolkin-site', [d('READY', 'pronto'), d('READY', 'pronto', { commit: 'f00ba12', commit_message: 'fix(mobile): trava zoom' }), d('ERROR', 'falhou', { commit: '9e8d7c6', commit_message: 'chore: atualiza dependências' })]),
   p('tzolkin-core', [d('BUILDING', 'em construção', { target: 'preview', branch: 'ci/testes-automaticos' })]),
   p('educare', [d('ERROR', 'falhou', { commit_message: 'refactor: troca o provedor de e-mail' })]),
   p('landing-antiga', [d('CANCELED', 'cancelado', { target: 'preview' })], { git_connected: false }),
   p('projeto-parado', []),
   p('projeto-parcial', [], { partial: true }),
  ],
 };
})());

const FAVICON_DE_EXEMPLO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#2f9d58"/></svg>').toString('base64');
// /api/deploys e /api/product-favicon respondem aqui, sem rede. Só o projeto "tzolkin-site" tem favicon; os outros
// recebem {href: null}, como o Core responde quando não acha ícone.
const COM_DEPLOYS = `(() => {
 const DEPLOYS = ${DEPLOYS_DE_EXEMPLO};
 const FAVICON = ${JSON.stringify(FAVICON_DE_EXEMPLO)};
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 const json = corpo => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }));
 window.fetch = (url, opcoes) => {
  const u = String(url);
  if (u.startsWith('/api/deploys')) return json(DEPLOYS);
  if (u.startsWith('/api/product-favicon')) return json({ href: u.includes('tzolkin-site') ? FAVICON : null });
  return window.__fetchOriginal(url, opcoes);
 };
})()`;

test('Vercel com dados: cada estado aparece, cabe na tela e o texto é legível nos dois temas', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_DEPLOYS);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`, { descricao: 'painel recarregado com a Vercel de exemplo' });
 await pagina.tela(1280, 900);
 for (const esquema of ['light', 'dark']) {
  await pagina.esquema(esquema);
  await pagina.esperar(`document.documentElement.dataset.theme === '${esquema}'`);
  await pagina.avaliar(CLICAR_NO_MENU('Visão geral'));
  await pagina.avaliar(CLICAR_NO_MENU('Vercel'));
  await pagina.esperar(`document.querySelectorAll('#deploys-list .deploy-card').length === 6`, { descricao: 'seis projetos da Vercel' });
  // Botões e links têm transition de cor (.15s): medir contraste no meio dela dá cor intermediária e falha ao acaso.
  await new Promise(r => setTimeout(r, 600));
  const lido = await pagina.avaliar(`(() => {
   const canais = c => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
   const luz = c => { const [r, g, b] = canais(c).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
   const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
   const fundoDe = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(.*, 0\\)|transparent/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
   const ruins = [];
   for (const el of document.querySelectorAll('#view-vercel *')) {
    if (!el.offsetParent || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cor = razao(getComputedStyle(el).color, fundoDe(el));
    if (cor < 4.5) ruins.push({ texto: el.textContent.trim().slice(0, 40), classe: el.className, cor });
   }
   const secao = document.getElementById('view-vercel');
   return { ruins, estouro: document.documentElement.scrollWidth - document.documentElement.clientWidth, cartoes: secao.querySelectorAll('.deploy-card').length, selos: [...secao.querySelectorAll('.status')].map(s => s.textContent.trim()) };
  })()`);
  assert.equal(lido.estouro <= 0, true, `${esquema}: a tela não pode ter rolagem horizontal`);
  // Encaixe: cabeçalho, linha de dono, deploy e histórico de cada cartão entram pela mesma margem; cartões da mesma fila têm a mesma altura.
  const encaixe = await pagina.avaliar(`(() => [...document.querySelectorAll('#deploys-list .deploy-card')].map(c => {
   const cr = c.getBoundingClientRect(), borda = el => el ? Math.round(el.getBoundingClientRect().left - cr.left) : null;
   const sum = c.querySelector('details.deploy-history > summary');
   return { nome: c.querySelector('h3').textContent, esq: [borda(c.querySelector('header .deploy-head')), borda(c.querySelector('.own-line > *')), borda(c.querySelector('.deploy-row > div > *')), sum ? borda(sum) + Math.round(parseFloat(getComputedStyle(sum).paddingLeft)) : null].filter(v => v !== null), topo: Math.round(cr.top), alt: Math.round(cr.height) };
  }))()`);
  for (const c of encaixe) assert.ok(Math.max(...c.esq) - Math.min(...c.esq) <= 1, `${esquema}: "${c.nome}" começa em pontos diferentes da esquerda: ${c.esq}`);
  const filas = new Map(); for (const c of encaixe) filas.set(c.topo, [...(filas.get(c.topo) || []), c.alt]);
  for (const [topo, alturas] of filas) assert.ok(Math.max(...alturas) - Math.min(...alturas) <= 1, `${esquema}: fila em ${topo}px com alturas diferentes: ${alturas}`);
  assert.deepEqual(lido.ruins, [], `${esquema}: texto com contraste abaixo de 4,5:1 na aba Vercel`);
  // Favicon: o projeto que tem ícone mostra o favicon do site; quem não tem fica com a logo da Vercel.
  // O favicon chega depois dos cartões (a busca é assíncrona): espera, senão o teste corre contra o carregamento.
  await pagina.esperar(`[...document.querySelectorAll('#deploys-list .deploy-card')].some(c => c.querySelector('h3').textContent === 'tzolkin-site' && c.querySelector('.deploy-project-mark img.product-favicon'))`, { descricao: 'favicon do tzolkin-site' });
  const icones = await pagina.avaliar(`(() => Object.fromEntries([...document.querySelectorAll('#deploys-list .deploy-card')].map(c => [c.querySelector('h3').textContent, c.querySelector('.deploy-project-mark img')?.className || 'nenhum'])))()`);
  assert.match(icones['tzolkin-site'], /product-favicon/, `${esquema}: tzolkin-site devia mostrar o favicon do site: ${JSON.stringify(icones)}`);
  assert.match(icones['educare'], /provider-logo/, `${esquema}: educare sem favicon devia ficar com a logo da Vercel: ${JSON.stringify(icones)}`);
  if (process.env.UI_SCREENSHOTS) await pagina.imagem(join(ARTEFATOS, `990-Vercel-${esquema}.png`));
 }
 // Em largura média (sidebar aberta) o cartão não pode ficar espremido: abaixo de 340px o botão, o ambiente e o criador quebram em várias linhas.
 await pagina.tela(1024, 800);
 await pagina.esperar(`document.querySelectorAll('#deploys-list .deploy-card').length === 6`);
 const larguras = await pagina.avaliar(`[...document.querySelectorAll('#deploys-list .deploy-card')].map(c => Math.round(c.getBoundingClientRect().width))`);
 assert.ok(larguras.every(l => l >= 340), 'cartões da Vercel espremidos em 1024px: ' + larguras);
 await pagina.tela(1280, 900);
 await desfazer();
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden`);
 await pagina.esquema('light');
 semExcecoes();
});

test('capturas: modo escuro nas fichas (espaço, lead, empresa, pessoa)', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`);
 await pagina.tela(1280, 800);
 const foto = nome => pagina.imagem(join(ARTEFATOS, `985-Escuro-${nome}.png`));
 const fechar = `document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`;
 // lead
 await pagina.avaliar(CLICAR_NO_MENU('Inbound'));
 await pagina.esperar(`document.querySelectorAll('#inbound-panel-leads tbody .tbl-name').length > 0`);
 await pagina.avaliar(`document.querySelector('#inbound-panel-leads tbody .tbl-name').click()`);
 await pagina.esperar(`document.querySelector('#peek-lead .funnel-panel')`);
 await new Promise(r => setTimeout(r, 400));
 await foto('Ficha_do_lead');
 await pagina.avaliar(fechar);
 // empresa
 await pagina.avaliar(CLICAR_NO_MENU('Empresas'));
 await pagina.esperar(`document.querySelectorAll('.view:not([hidden]) .tbl tbody .tbl-name').length > 0`);
 await pagina.avaliar(`document.querySelector('.view:not([hidden]) .tbl tbody .tbl-name').click()`);
 await pagina.esperar(`document.querySelector('#client-detail .ficha-dl')`);
 await new Promise(r => setTimeout(r, 700));
 await foto('Ficha_da_empresa');
 await pagina.avaliar(fechar);
 // pessoa
 await pagina.avaliar(CLICAR_NO_MENU('Pessoas'));
 await pagina.esperar(`document.querySelectorAll('.view:not([hidden]) .tbl tbody .tbl-name').length > 0`);
 await pagina.avaliar(`document.querySelector('.view:not([hidden]) .tbl tbody .tbl-name').click()`);
 await new Promise(r => setTimeout(r, 700));
 await foto('Ficha_da_pessoa');
 await pagina.avaliar(fechar);
 // espaço (Portfólio -> abrir gestão)
 await pagina.avaliar(CLICAR_NO_MENU('Portfólio'));
 await pagina.esperar(`document.querySelectorAll('#product-catalog tbody .tbl-name').length >= 2`);
 await pagina.avaliar(`[...document.querySelectorAll('#product-catalog tbody .tbl-name')].find(b => b.textContent === 'Plataforma A').click()`);
 await pagina.esperar(`document.getElementById('page-title').textContent.trim() !== 'Portfólio'`);
 await new Promise(r => setTimeout(r, 700));
 await foto('Ficha_do_espaco');
 await pagina.avaliar(`(() => { const c = document.getElementById('context-select'); c.value = ''; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 await pagina.esquema('light');
 semExcecoes();
});

// ============================== Agenda (Acompanhamento) ==============================
// A agenda é desenhada pelo navegador a partir de /api/tracking. O fixture de tela não tem atividades, então a página
// recebe uma agenda montada aqui (uma semana com sobreposição, evento curto, atravessando a meia-noite, dia inteiro,
// concluído e cancelado) e um /api/tracking simulado que registra o que a tela grava (PUT/POST) e aplica na lista.
const ALTURA_HORA = 48;
function eventosDaSemana() {
 const seg = AM.segundaDe(AM.diaDe(Date.now()));
 const em = (n, hhmm) => new Date(Date.parse(`${AM.somarDias(seg, n)}T${hhmm}:00-03:00`)).toISOString();
 const base = { tenant_id: EMPRESA, tenant_name: 'Empresa Alfa', engagement_id: null, engagement_label: null, status: 'planned', revision: 1 };
 const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
 return [
  { ...base, id: id(1), title: 'Mentoria Alfa — sessão 1', category: 'mentoria', kind: 'sessao', starts_at: em(0, '09:00'), ends_at: em(0, '10:00'), location: 'Sala 2' },
  { ...base, id: id(2), title: 'Revisão de código', category: 'software', kind: 'tarefa', starts_at: em(0, '09:30'), ends_at: em(0, '10:30') },
  { ...base, id: id(3), title: 'Consultoria Beta', category: 'consultoria', kind: 'sessao', starts_at: em(1, '14:00'), ends_at: em(1, '15:30'), description: 'Pauta:\n1. Metas', meeting_url: 'https://meet.google.com/abc-defg-hij' },
  { ...base, id: id(4), title: 'Daily', category: 'outro', kind: 'tarefa', starts_at: em(2, '08:00'), ends_at: em(2, '08:15') },
  { ...base, id: id(5), title: 'Deploy noturno', category: 'software', kind: 'feature', starts_at: em(2, '23:00'), ends_at: em(3, '01:00') },
  { ...base, id: id(6), title: 'Entrega do site', category: 'software', kind: 'entregavel', starts_at: em(1, '00:00'), ends_at: em(5, '00:00') },
  { ...base, id: id(7), title: 'Workshop', category: 'educacional', kind: 'sessao', status: 'done', starts_at: em(4, '16:00'), ends_at: em(4, '17:00') },
  { ...base, id: id(8), title: 'Reunião cancelada', category: 'outro', kind: 'sessao', status: 'cancelled', starts_at: em(5, '10:00'), ends_at: em(5, '11:00') },
 ];
}
const COM_AGENDA = lista => `(() => {
 const EVENTOS = ${JSON.stringify(lista)};
 window.__agenda = { eventos: EVENTOS, gets: [], puts: [], posts: [], tempos: [], recusar: null, semCampos: false, lembretes: false, series: [], seriesPosts: [], seriesPuts: [], seriesFins: [], padrao: [15], meet: false, meets: [], meetFalha: false };
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 const json = (corpo, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
 window.fetch = async (url, opcoes = {}) => {
  const u = String(url), metodo = (opcoes.method || 'GET').toUpperCase();
  if (!u.startsWith('/api/tracking')) return window.__fetchOriginal(url, opcoes);
  const [caminho, consulta] = u.split('?'), partes = caminho.split('/');
  const corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
  if (metodo === 'GET') {
   const q = new URLSearchParams(consulta);
   window.__agenda.gets.push({ from: q.get('from'), to: q.get('to'), tenant: q.get('tenant_id') });
   const de = Date.parse(q.get('from') + 'T00:00:00-03:00'), ate = Date.parse(q.get('to') + 'T00:00:00-03:00');
   const dentro = EVENTOS.filter(e => Date.parse(e.ends_at) > de && Date.parse(e.starts_at) < ate && (!q.get('tenant_id') || e.tenant_id === q.get('tenant_id')));
   return json({ activities: dentro.map(e => ({ ...e })), logs: [], engagements: [], truncated: false, time_zone: 'America/Sao_Paulo', agenda_campos: !window.__agenda.semCampos, agenda_lembretes: window.__agenda.lembretes, series: window.__agenda.lembretes ? window.__agenda.series : [], agenda_prefs: window.__agenda.lembretes ? { default_reminders: window.__agenda.padrao, revision: 1 } : null, google_meet: window.__agenda.meet });
  }
  if (partes[3] === 'series') {
   const a = window.__agenda;
   if (!a.lembretes) return json({ message: 'Lembretes e repetição ainda não estão disponíveis neste banco: falta aplicar a migração 048.' }, 409);
   if (metodo === 'POST' && partes.length === 4) { a.seriesPosts.push(corpo); return json({ series: { ...corpo, revision: 1 }, criadas: 12, repetido: false }); }
   if (metodo === 'PUT') { a.seriesPuts.push({ id: partes[4], corpo }); return json({ series: { id: partes[4] }, atualizadas: 3 }); }
   if (metodo === 'POST' && partes[5] === 'end') { a.seriesFins.push({ id: partes[4], corpo }); return json({ series: { id: partes[4] }, arquivadas: 5 }); }
  }
  if (metodo === 'POST' && partes.length === 3) {
   window.__agenda.posts.push(corpo);
   const novo = { status: 'planned', revision: 1, tenant_name: 'Empresa Alfa', engagement_label: null, location: null, description: null, meeting_url: null, ...corpo };
   EVENTOS.push(novo); return json({ activity: { ...novo } });
  }
  if (metodo === 'POST' && partes[4] === 'meet') {
   const e = EVENTOS.find(x => x.id === partes[3]);
   window.__agenda.meets.push({ id: partes[3], corpo });
   if (window.__agenda.meetFalha) return json({ message: 'O Google não respondeu como esperado. Tente de novo.' }, 502);
   Object.assign(e, { meeting_url: 'https://meet.google.com/abc-defg-hij', google_event_id: 'ev-' + partes[3], revision: e.revision + 1 });
   return json({ activity: { ...e }, meet: e.meeting_url });
  }
  if (metodo === 'POST' && partes[4] === 'time') { window.__agenda.tempos.push({ id: partes[3], corpo }); return json({ log: { ...corpo, activity_id: partes[3] } }); }
  if (metodo === 'PUT') {
   const e = EVENTOS.find(x => x.id === partes[3]);
   if (!e || window.__agenda.recusar === partes[3]) return json({ message: 'Registro alterado ou inexistente. Atualize a agenda.' }, 409);
   window.__agenda.puts.push({ id: partes[3], sub: partes[4] || null, corpo });
   if (partes[4] === 'status') e.status = corpo.status;
   else if (partes[4] === 'engagement') e.engagement_id = corpo.engagement_id;
   else { const { revision, ...campos } = corpo; Object.assign(e, campos); }
   e.revision += 1; return json({ activity: { ...e } });
  }
  return window.__fetchOriginal(url, opcoes);
 };
})()`;
let desfazerAgenda = null;
const NO_AGENDA = `window.__agenda`;
// O painel lateral é position:fixed (offsetParent é sempre null nele): aberto = existe no DOM e tem largura. Fechar o remove do DOM.
const PAINEL_ABERTO = `(() => { const p = document.getElementById('peek-agenda'); return !!p && p.getBoundingClientRect().width > 0; })()`;
const BOTAO_VISAO = v => `[...document.querySelectorAll('#view-tracking .ag-visoes button')].find(b => b.dataset.visao === ${JSON.stringify(v)})`;
const VISAO_ATIVA = `[...document.querySelectorAll('#view-tracking .ag-visoes button')].find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.visao`;
const IR_PARA_AGENDA = async () => {
 await pagina.avaliar(CLICAR_NO_MENU('Acompanhamento'));
 await pagina.esperar(`document.querySelectorAll('#view-tracking .ag-visoes button').length === 4 && !document.querySelector('#view-tracking [aria-busy]')`, { descricao: 'agenda carregada' });
};
const VISOES_ESPERAM = v => `${VISAO_ATIVA} === ${JSON.stringify(v)}`;
// Volta para a semana de hoje antes de cada teste: um teste que falha não pode arrastar os seguintes na visão em que parou.
const SEMANA_DE_HOJE = async () => {
 await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await pagina.avaliar(`(() => { const b = ${BOTAO_VISAO('semana')}; if (b.getAttribute('aria-pressed') !== 'true') b.click(); else [...document.querySelectorAll('#view-tracking .ag-hoje')][0].click(); })()`);
 await pagina.esperar(`${VISAO_ATIVA} === 'semana' && !document.querySelector('#view-tracking [aria-busy]') && document.querySelector('#view-tracking .ag-coluna[data-hoje]') && document.querySelectorAll('#view-tracking .ag-evento').length >= 6`, { descricao: 'semana de hoje' });
};
const clique = (seletor, extra = '') => pagina.avaliar(`(() => { const n = ${seletor}; n.dispatchEvent(new MouseEvent('click', { bubbles: true, ${extra} })); })()`);

test('agenda: a semana põe cada evento no horário certo, com sobreposição, evento curto, virada de dia, faixa de dia inteiro e linha do agora', { skip: PULAR }, async () => {
 desfazerAgenda = await pagina.injetar(COM_AGENDA(eventosDaSemana()));
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-visao'); } catch {}`);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`, { descricao: 'painel recarregado com a agenda de exemplo' });
 await IR_PARA_AGENDA();
 await pagina.esperar(`document.querySelectorAll('#view-tracking .ag-evento').length >= 6`, { descricao: 'eventos na grade' });
 assert.equal(await pagina.avaliar(VISAO_ATIVA), 'semana', 'no desktop a agenda abre na semana');
 const g = await pagina.avaliar(`(() => {
  const todos = [...document.querySelectorAll('#view-tracking .ag-evento')];
  const med = b => { const r = b.getBoundingClientRect(), c = b.parentElement.getBoundingClientRect(); return { topo: Math.round(r.top - c.top), alt: Math.round(r.height), esq: Math.round(r.left - c.left), larg: Math.round(r.width), coluna: Math.round(c.width), dia: b.parentElement.dataset.dia, curto: b.classList.contains('ag-curto'), status: b.dataset.status, tom: b.dataset.tom }; };
  const por = t => todos.filter(b => b.querySelector('.ag-ev-titulo').textContent === t).map(med);
  return { sessao: por('Mentoria Alfa — sessão 1'), revisao: por('Revisão de código'), daily: por('Daily'), deploy: por('Deploy noturno'), cancelada: por('Reunião cancelada'), feito: por('Workshop'), consultoria: por('Consultoria Beta'),
   inteiro: [...document.querySelectorAll('#view-tracking .ag-diainteiro .ag-chip')].map(c => c.textContent), naGrade: todos.map(b => b.querySelector('.ag-ev-titulo').textContent),
   agora: !!document.querySelector('#view-tracking .ag-coluna[data-hoje] .ag-agora'), titulo: document.querySelector('#view-tracking .ag-titulo').textContent, colunas: document.querySelectorAll('#view-tracking .ag-coluna').length,
   cabecalhos: [...document.querySelectorAll('#view-tracking .ag-dia-cab')].map(c => c.dataset.dia),
   camadas: { sessao: Number(todos.find(b => b.querySelector('.ag-ev-titulo').textContent === 'Mentoria Alfa — sessão 1').style.zIndex), revisao: Number(todos.find(b => b.querySelector('.ag-ev-titulo').textContent === 'Revisão de código').style.zIndex) } };
 })()`);
 const perto = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} deveria estar a ${tol}px de ${b}`);
 assert.equal(g.colunas, 7);
 assert.deepEqual(g.cabecalhos, AM.semanaDe(AM.diaDe(Date.now())), 'sete dias, de segunda a domingo, incluindo hoje');
 // 09:00 -> 9h * 48px; 10:00 e 09:30 sobrepõem e dividem a coluna ao meio
 const [s] = g.sessao, [r] = g.revisao;
 perto(s.topo, 9 * ALTURA_HORA); perto(s.alt, ALTURA_HORA - 2);
 perto(r.topo, 9.5 * ALTURA_HORA);
 // 09:00 e 09:30 começam em horas diferentes: cascata (o segundo recua e fica por cima), os dois legíveis, nenhuma fatia estreita
 assert.ok(s.larg > s.coluna * 0.9, `o primeiro usa a largura toda: ${s.larg} de ${s.coluna}`);
 assert.ok(r.larg > s.coluna * 0.6 && r.larg < s.larg, `o segundo é largo o bastante para ler: ${r.larg} de ${s.coluna}`);
 assert.ok(r.esq - s.esq > s.coluna * 0.15, 'o segundo recua para a direita');
 assert.ok(g.camadas.revisao > g.camadas.sessao, 'o que começa depois fica por cima');
 // sem sobreposição, largura inteira
 assert.ok(g.consultoria[0].larg > g.consultoria[0].coluna * 0.9, 'evento sozinho usa a largura toda');
 perto(g.consultoria[0].topo, 14 * ALTURA_HORA); perto(g.consultoria[0].alt, 1.5 * ALTURA_HORA - 2);
 // evento de 15 min: curto, mas legível (altura mínima)
 assert.equal(g.daily[0].curto, true); assert.ok(g.daily[0].alt >= 14, 'não some: ' + g.daily[0].alt);
 // atravessa a meia-noite: um pedaço na quarta (23h até o fim) e outro na quinta (0h a 1h)
 assert.equal(g.deploy.length, 2); assert.notEqual(g.deploy[0].dia, g.deploy[1].dia);
 perto(g.deploy[0].topo, 23 * ALTURA_HORA); perto(g.deploy[1].topo, 0); perto(g.deploy[1].alt, ALTURA_HORA - 2);
 // situação e cor por categoria
 assert.equal(g.cancelada[0].status, 'cancelled'); assert.equal(g.feito[0].status, 'done');
 assert.equal(g.sessao[0].tom, 'accent'); assert.equal(g.revisao[0].tom, 'success'); assert.equal(g.consultoria[0].tom, 'info');
 // prazo de vários dias não ocupa a grade de horas: vai para a faixa de dia inteiro, uma vez em cada dia coberto
 assert.ok(!g.naGrade.includes('Entrega do site'));
 assert.equal(g.inteiro.length, 4); assert.ok(g.inteiro.every(t => t === 'Entrega do site'));
 assert.equal(g.agora, true, 'linha do horário atual na coluna de hoje');
 assert.match(g.titulo, /20\d\d/);
 semExcecoes();
});

test('agenda: visões e navegação (botões, atalhos, mini-calendário) pedem a janela certa ao servidor', { skip: PULAR }, async () => {
 const hojeDia = AM.diaDe(Date.now());
 const ultimaJanela = () => pagina.avaliar(`${NO_AGENDA}.gets.at(-1)`);
 const conta = () => pagina.avaliar(`${NO_AGENDA}.gets.length`);
 const mudarVisao = async v => { const antes = await conta(); await pagina.avaliar(`${BOTAO_VISAO(v)}.click()`); await pagina.esperar(`${NO_AGENDA}.gets.length > ${antes} && ${VISOES_ESPERAM(v)} && !document.querySelector('#view-tracking [aria-busy]')`, { descricao: 'visão ' + v }); };
 const esperarNova = async antes => pagina.esperar(`${NO_AGENDA}.gets.length > ${antes} && !document.querySelector('#view-tracking [aria-busy]')`, { descricao: 'nova consulta' });

 await mudarVisao('dia');
 assert.deepEqual(await ultimaJanela(), { from: hojeDia, to: AM.somarDias(hojeDia, 1), tenant: null });
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#view-tracking .ag-coluna').length`), 1);
 await mudarVisao('mes');
 const mes = AM.janela('mes', hojeDia);
 assert.deepEqual(await ultimaJanela(), { from: mes.from, to: mes.to, tenant: null });
 const celulas = await pagina.avaliar(`document.querySelectorAll('#view-tracking .ag-celula').length`);
 assert.ok(celulas % 7 === 0 && celulas >= 28 && celulas <= 42, 'semanas inteiras: ' + celulas);
 assert.ok(await pagina.avaliar(`[...document.querySelectorAll('#view-tracking .ag-chip-titulo')].some(c => c.textContent === 'Mentoria Alfa — sessão 1')`), 'chip do evento no mês');
 await mudarVisao('agenda');
 const ag = AM.janela('agenda', hojeDia);
 assert.deepEqual(await ultimaJanela(), { from: ag.from, to: ag.to, tenant: null });
 // A agenda lista a partir do dia em foco. Os eventos de exemplo são da semana de hoje (que pode já ter passado, se hoje é domingo):
 // aponta o foco para a segunda-feira pelo mini-calendário.
 let ant = await conta();
 await pagina.avaliar(`(() => { const l = document.querySelector('#view-tracking .ag-lateral'); let b = l.querySelector('.ag-mini-dia[data-dia="${AM.segundaDe(hojeDia)}"]'); if (!b) { l.querySelectorAll('.ag-mini-cab button')[0].click(); b = l.querySelector('.ag-mini-dia[data-dia="${AM.segundaDe(hojeDia)}"]'); } b.click(); })()`);
 await esperarNova(ant);
 const lista = await pagina.avaliar(`({ grupos: document.querySelectorAll('#view-tracking .ag-grupo').length, linhas: [...document.querySelectorAll('#view-tracking .ag-linha-hora')].map(h => h.textContent) })`);
 assert.ok(lista.grupos >= 5, 'dias com evento aparecem agrupados: ' + lista.grupos);
 assert.ok(lista.linhas.includes('Dia todo'), 'prazo de vários dias aparece como "Dia todo"');
 await mudarVisao('semana');
 await SEMANA_DE_HOJE();

 // atalhos de teclado: valem fora de campo, e não valem digitando
 let antes = await conta();
 await pagina.avaliar(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
 await esperarNova(antes);
 const proxima = AM.janela('semana', AM.navegar('semana', hojeDia, 1));
 assert.deepEqual(await ultimaJanela(), { from: proxima.from, to: proxima.to, tenant: null }, 'seta direita = semana seguinte');
 antes = await conta();
 await pagina.avaliar(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
 await esperarNova(antes);
 assert.equal((await ultimaJanela()).from, AM.segundaDe(hojeDia), 't volta para hoje');
 antes = await conta();
 await pagina.avaliar(`(() => { const campo = document.querySelector('#view-tracking .ag-busca input'); campo.focus(); campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true })); })()`);
 await new Promise(r => setTimeout(r, 300));
 assert.equal(await pagina.avaliar(VISAO_ATIVA), 'semana', 'digitar "m" na busca não troca a visão');
 assert.equal(await conta(), antes);
 await pagina.avaliar(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`);
 await pagina.esperar(VISOES_ESPERAM('mes'), { descricao: 'atalho m' });
 await pagina.avaliar(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }))`);
 await pagina.esperar(VISOES_ESPERAM('semana'), { descricao: 'atalho w' });

 // mini-calendário: clicar num dia leva a semana para ele
 const alvo = AM.somarDias(hojeDia, 14);
 antes = await conta();
 await pagina.avaliar(`(() => { const lateral = document.querySelector('#view-tracking .ag-lateral'); let b = lateral.querySelector('.ag-mini-dia[data-dia="${alvo}"]'); if (!b) { lateral.querySelectorAll('.ag-mini-cab button')[1].click(); b = lateral.querySelector('.ag-mini-dia[data-dia="${alvo}"]'); } b.click(); })()`);
 await esperarNova(antes);
 assert.equal((await ultimaJanela()).from, AM.segundaDe(alvo));
 assert.equal(await pagina.avaliar(`document.querySelector('#view-tracking .ag-mini-dia[aria-current="date"]').dataset.dia`), alvo);
 antes = await conta();
 await pagina.avaliar(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))`);
 await esperarNova(antes);

 // filtros do lado do cliente: categoria e busca não vão ao servidor
 await pagina.esperar(`document.querySelectorAll('#view-tracking .ag-evento').length >= 6`);
 const titulosNaGrade = () => pagina.avaliar(`[...document.querySelectorAll('#view-tracking .ag-evento .ag-ev-titulo')].map(t => t.textContent).sort()`);
 const consultasAntes = await conta();
 await pagina.avaliar(`(() => { const c = document.querySelector('#view-tracking .ag-categoria input[data-categoria="software"]'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 const semSoftware = await titulosNaGrade();
 assert.ok(!semSoftware.includes('Revisão de código') && !semSoftware.includes('Deploy noturno'), 'categoria desmarcada some da grade: ' + semSoftware);
 assert.ok(semSoftware.includes('Mentoria Alfa — sessão 1'));
 await pagina.avaliar(`(() => { const c = document.querySelector('#view-tracking .ag-categoria input[data-categoria="software"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.ok((await titulosNaGrade()).includes('Revisão de código'), 'marcar de novo traz de volta');
 await pagina.avaliar(`(() => { const b = document.querySelector('#view-tracking .ag-busca input'); b.value = 'REVISAO'; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 assert.deepEqual(await titulosNaGrade(), ['Revisão de código'], 'busca sem acento e sem caixa');
 await pagina.avaliar(`(() => { const b = document.querySelector('#view-tracking .ag-busca input'); b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 assert.equal(await conta(), consultasAntes, 'filtrar no cliente não faz nova consulta');
 // filtro de cliente vai ao servidor
 await pagina.avaliar(`(() => { const s = [...document.querySelectorAll('#view-tracking .ag-filtros label')].find(l => l.firstChild.textContent === 'Cliente').querySelector('select'); s.value = ${JSON.stringify(PESSOA_FISICA)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 await esperarNova(consultasAntes);
 assert.equal((await ultimaJanela()).tenant, PESSOA_FISICA);
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#view-tracking .ag-evento').length`), 0, 'a outra empresa não tem eventos');
 await pagina.avaliar(`(() => { const s = [...document.querySelectorAll('#view-tracking .ag-filtros label')].find(l => l.firstChild.textContent === 'Cliente').querySelector('select'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 await pagina.esperar(`document.querySelectorAll('#view-tracking .ag-evento').length >= 6`, { descricao: 'eventos de volta' });
 semExcecoes();
});

test('agenda: clicar numa hora vazia abre o formulário com a hora; criar manda o horário de Brasília e só os campos preenchidos', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const dia = AM.somarDias(AM.segundaDe(AM.diaDe(Date.now())), 2);
 await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 // 10h20 numa coluna vazia: o clique arredonda para a meia hora de baixo (10h00) e dá 1h
 await clique(`(() => { const c = document.querySelector('#view-tracking .ag-coluna[data-dia="${dia}"]'); window.__y = c.getBoundingClientRect().top + (10 * 60 + 20) / 60 * ${ALTURA_HORA}; return c; })()`, `clientY: window.__y`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`, { descricao: 'formulário aberto pelo clique' });
 const campoDe = nome => `[...document.querySelectorAll('dialog.tracking-editor label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)}).querySelector('input,select,textarea')`;
 assert.equal(await pagina.avaliar(`${campoDe('Início · Brasília')}.value`), `${dia}T10:00`);
 assert.equal(await pagina.avaliar(`${campoDe('Fim / prazo · Brasília')}.value`), `${dia}T11:00`);
 // início depois do fim: o fim acompanha (mais 1h), como nos calendários
 await pagina.avaliar(`(() => { const i = ${campoDe('Início · Brasília')}; i.value = '${dia}T15:30'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 assert.equal(await pagina.avaliar(`${campoDe('Fim / prazo · Brasília')}.value`), `${dia}T16:30`);
 await pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); };
  set(${campoDe('Título')}, 'Kickoff do projeto'); set(${campoDe('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change'); set(${campoDe('Descrição (opcional)')}, 'Alinhar escopo');
  set(${campoDe('Link da reunião (opcional)')}, 'https://zoom.us/j/123'); document.querySelector('dialog.tracking-editor form').requestSubmit(); })()`);
 await pagina.esperar(`${NO_AGENDA}.posts.length === 1`, { descricao: 'POST enviado' });
 const post = await pagina.avaliar(`${NO_AGENDA}.posts[0]`);
 assert.equal(post.title, 'Kickoff do projeto'); assert.equal(post.tenant_id, EMPRESA); assert.equal(post.category, 'mentoria');
 assert.equal(post.starts_at, new Date(`${dia}T15:30:00-03:00`).toISOString(), 'horário de Brasília convertido para UTC');
 assert.equal(post.ends_at, new Date(`${dia}T16:30:00-03:00`).toISOString());
 assert.equal(post.description, 'Alinhar escopo'); assert.equal(post.meeting_url, 'https://zoom.us/j/123');
 assert.ok(!('location' in post), 'campo vazio não é enviado');
 assert.match(post.id, /^[0-9a-f-]{36}$/);
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`, { descricao: 'formulário fechou' });
 await pagina.esperar(`[...document.querySelectorAll('#view-tracking .ag-ev-titulo')].some(t => t.textContent === 'Kickoff do projeto')`, { descricao: 'evento novo na grade' });
 const topo = await pagina.avaliar(`(() => { const b = [...document.querySelectorAll('#view-tracking .ag-evento')].find(b => b.querySelector('.ag-ev-titulo').textContent === 'Kickoff do projeto'); return Math.round(b.getBoundingClientRect().top - b.parentElement.getBoundingClientRect().top); })()`);
 assert.ok(Math.abs(topo - 15.5 * ALTURA_HORA) <= 2, 'aparece às 15h30: ' + topo);
 // fim antes do início é recusado na tela, sem ir ao servidor
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-acoes .primary').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`);
 await pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); }; set(${campoDe('Título')}, 'Sem sentido'); set(${campoDe('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change'); set(${campoDe('Início · Brasília')}, '${dia}T10:00', 'change'); const f = ${campoDe('Fim / prazo · Brasília')}; f.removeAttribute('min'); f.value = '${dia}T09:00'; document.querySelector('dialog.tracking-editor form').requestSubmit(); })()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor .form-error').textContent.includes('depois do início')`, { descricao: 'aviso de fim antes do início' });
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.posts.length`), 1, 'nada foi enviado');
 await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 semExcecoes();
});

test('agenda: sem a migração 047 o formulário não oferece descrição, local nem link (e volta quando o banco os tem)', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const rotulos = () => pagina.avaliar(`[...document.querySelectorAll('dialog.tracking-editor label')].map(l => l.firstChild.textContent)`);
 const recarregar = async () => { const n = await pagina.avaliar(`${NO_AGENDA}.gets.length`); await pagina.avaliar(`[...document.querySelectorAll('#view-tracking .ag-hoje')][0].click()`); await pagina.esperar(`${NO_AGENDA}.gets.length > ${n} && !document.querySelector('#view-tracking [aria-busy]')`); };
 const abrirEFechar = async () => { await pagina.avaliar(`document.querySelector('#view-tracking .ag-acoes .primary').click()`); await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`); const r = await rotulos(); await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`); return r; };
 await pagina.avaliar(`${NO_AGENDA}.semCampos = true`);
 await recarregar();
 const sem = await abrirEFechar();
 assert.ok(sem.includes('Título') && sem.includes('Início · Brasília'), 'o resto do formulário segue igual: ' + sem);
 for (const campo of ['Descrição (opcional)', 'Local (opcional)', 'Link da reunião (opcional)']) assert.ok(!sem.includes(campo), campo + ' não pode aparecer sem a migração');
 await pagina.avaliar(`${NO_AGENDA}.semCampos = false`);
 await recarregar();
 const com = await abrirEFechar();
 for (const campo of ['Descrição (opcional)', 'Local (opcional)', 'Link da reunião (opcional)']) assert.ok(com.includes(campo), campo + ' aparece quando o banco tem as colunas');
 semExcecoes();
});

test('agenda: arrastar move, esticar muda a duração, Esc cancela e recusa do servidor desfaz', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const ID = '00000000-0000-4000-8000-000000000001';       // Mentoria Alfa, segunda 09:00-10:00
 const medir = () => pagina.avaliar(`(() => { const b = document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]'); const r = b.getBoundingClientRect(), c = b.parentElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, topo: Math.round(r.top - c.top), alt: Math.round(r.height), bottom: r.bottom, dia: b.parentElement.dataset.dia, coluna: c.width, classes: b.className }; })()`);
 const mouse = (tipo, x, y, alvo = 'document') => pagina.avaliar(`${alvo}.dispatchEvent(new PointerEvent('${tipo}', { bubbles: true, clientX: ${x}, clientY: ${y}, button: 0, pointerType: 'mouse', pointerId: 7 }))`);
 const aguardarPut = async n => pagina.esperar(`${NO_AGENDA}.puts.length === ${n}`, { descricao: `PUT nº ${n}` });
 const ultimoPut = () => pagina.avaliar(`${NO_AGENDA}.puts.at(-1)`);
 const iso = (dia, hhmm) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
 const segunda = AM.segundaDe(AM.diaDe(Date.now()));
 const puts0 = await pagina.avaliar(`${NO_AGENDA}.puts.length`);

 // mover 2h para baixo: 96px a 48px/h, grudando de 15 em 15
 let m = await medir(); assert.ok(Math.abs(m.topo - 9 * ALTURA_HORA) <= 2);
 await mouse('pointerdown', m.x, m.y + 8, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`);
 await mouse('pointermove', m.x, m.y + 8 + 2 * ALTURA_HORA);
 assert.match((await medir()).classes, /ag-arrastando/, 'mostra o evento sendo arrastado');
 await mouse('pointerup', m.x, m.y + 8 + 2 * ALTURA_HORA);
 await aguardarPut(puts0 + 1);
 let put = await ultimoPut();
 assert.deepEqual(put.corpo, { revision: 1, starts_at: iso(segunda, '11:00'), ends_at: iso(segunda, '12:00') }, 'só o horário vai, com a revisão lida');
 await pagina.esperar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').style.top === '${11 * ALTURA_HORA}px'`, { descricao: 'evento na nova posição' });
 assert.ok(!(await pagina.avaliar(PAINEL_ABERTO)), 'arrastar não abre o painel');

 // grudar de 15 em 15: 20px (~25 min) vira 30 min
 m = await medir();
 await mouse('pointerdown', m.x, m.y + 8, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`);
 await mouse('pointermove', m.x, m.y + 8 + 20);
 await mouse('pointerup', m.x, m.y + 8 + 20);
 await aguardarPut(puts0 + 2);
 put = await ultimoPut();
 assert.equal(put.corpo.revision, 2, 'a revisão subiu com a gravação anterior');
 assert.equal(put.corpo.starts_at, iso(segunda, '11:30'));

 // mover para a coluna do dia seguinte: +1 dia, mesma hora
 m = await medir();
 await mouse('pointerdown', m.x, m.y + 8, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`);
 await mouse('pointermove', m.x + m.coluna, m.y + 8);
 await mouse('pointerup', m.x + m.coluna, m.y + 8);
 await aguardarPut(puts0 + 3);
 put = await ultimoPut();
 assert.equal(put.corpo.starts_at, iso(AM.somarDias(segunda, 1), '11:30'));
 assert.equal((await medir()).dia, AM.somarDias(segunda, 1), 'caiu na terça');

 // esticar o fim 1h (alça de baixo): só o fim muda
 m = await medir();
 await mouse('pointerdown', m.x, m.bottom - 3, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"] .ag-alca')`);
 await mouse('pointermove', m.x, m.bottom - 3 + ALTURA_HORA);
 assert.match((await medir()).classes, /ag-esticando/);
 await mouse('pointerup', m.x, m.bottom - 3 + ALTURA_HORA);
 await aguardarPut(puts0 + 4);
 put = await ultimoPut();
 assert.equal(put.corpo.starts_at, iso(AM.somarDias(segunda, 1), '11:30'), 'o início fica');
 assert.equal(put.corpo.ends_at, iso(AM.somarDias(segunda, 1), '13:30'), 'o fim ganhou 1h (12:30 -> 13:30)');

 // Esc no meio do arraste: nada é gravado e o evento volta
 // (e o ouvinte de teclado do arraste tem de sair: já vazou uma vez e engolia o Esc da página toda)
 m = await medir();
 await mouse('pointerdown', m.x, m.y + 8, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`);
 await mouse('pointermove', m.x, m.y + 8 + 3 * ALTURA_HORA);
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await mouse('pointerup', m.x, m.y + 8 + 3 * ALTURA_HORA);
 await new Promise(r => setTimeout(r, 200));
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.puts.length`), puts0 + 4, 'Esc cancelou: nenhuma gravação');
 assert.ok(!(await medir()).classes.includes('ag-arrastando'));

 // servidor recusa (409): a tela avisa e o evento volta ao lugar de antes
 const antes = await medir();
 await pagina.avaliar(`${NO_AGENDA}.recusar = ${JSON.stringify(ID)}`);
 await mouse('pointerdown', antes.x, antes.y + 8, `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`);
 await mouse('pointermove', antes.x, antes.y + 8 + 2 * ALTURA_HORA);
 await mouse('pointerup', antes.x, antes.y + 8 + 2 * ALTURA_HORA);
 await pagina.esperar(`document.querySelector('#view-tracking .ag-aviso')`, { descricao: 'aviso de recusa' });
 assert.match(await pagina.avaliar(`document.querySelector('#view-tracking .ag-aviso').textContent`), /alterar o horário.*alterado ou inexistente/);
 assert.equal((await medir()).topo, antes.topo, 'voltou para onde estava');
 await pagina.avaliar(`${NO_AGENDA}.recusar = null`);
 semExcecoes();
});

// ---- lembrete e repetição (migração 048) ----
const CAMPO_DO_FORM = nome => `[...document.querySelectorAll('dialog.tracking-editor label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)}).querySelector('input,select,textarea')`;
const DEFINIR = (c, v, ev = 'change') => `(() => { const c = ${c}; c.value = ${JSON.stringify(v)}; c.dispatchEvent(new Event(${JSON.stringify(ev)}, { bubbles: true })); })()`;
const LEGENDAS = `[...document.querySelectorAll('dialog.tracking-editor legend')].map(l => l.textContent)`;
const RECARREGAR_AGENDA = async () => { const n = await pagina.avaliar(`${NO_AGENDA}.gets.length`); await pagina.avaliar(`[...document.querySelectorAll('#view-tracking .ag-hoje')][0].click()`); await pagina.esperar(`${NO_AGENDA}.gets.length > ${n} && !document.querySelector('#view-tracking [aria-busy]')`); };
const ABRIR_NOVA = async () => { await pagina.avaliar(`document.querySelector('#view-tracking .ag-acoes .primary').click()`); await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`); };
const FECHAR_TUDO = () => pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
const ENVIAR_FORM = () => pagina.avaliar(`document.querySelector('dialog.tracking-editor form').requestSubmit()`);

test('agenda: lembrete e repetição só aparecem quando o banco tem a migração 048', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = false`); await RECARREGAR_AGENDA();
 await ABRIR_NOVA();
 const sem = await pagina.avaliar(LEGENDAS);
 assert.ok(!sem.includes('Lembrete') && !sem.includes('Repetir'), 'sem a 048 nenhum dos dois aparece: ' + sem);
 await FECHAR_TUDO();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true`); await RECARREGAR_AGENDA();
 await ABRIR_NOVA();
 const com = await pagina.avaliar(LEGENDAS);
 assert.ok(com.includes('Lembrete') && com.includes('Repetir'), 'com a 048 aparecem: ' + com);
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Avisar')}.selectedOptions[0].textContent`), 'Padrão da agenda (15 min antes)');
 await FECHAR_TUDO();
 semExcecoes();
});

test('agenda: o lembrete vai na atividade só quando a pessoa foge do padrão', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true; ${NO_AGENDA}.posts.length = 0`); await RECARREGAR_AGENDA();
 const preencher = titulo => pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); }; set(${CAMPO_DO_FORM('Título')}, ${JSON.stringify(titulo)}); set(${CAMPO_DO_FORM('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change'); })()`);
 // padrão: não manda `reminders` (a atividade segue o padrão da agenda)
 await ABRIR_NOVA(); await preencher('Com o padrão');
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.posts.length === 1`);
 assert.ok(!('reminders' in await pagina.avaliar(`${NO_AGENDA}.posts[0]`)));
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);
 // não avisar = lista vazia
 await ABRIR_NOVA(); await preencher('Sem aviso');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Avisar'), 'nenhum'));
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.posts.length === 2`);
 assert.deepEqual((await pagina.avaliar(`${NO_AGENDA}.posts[1]`)).reminders, []);
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);
 // personalizado: 15 min (já marcado) + 1 h + 5 min; com 3 marcados os outros ficam bloqueados (máximo 3)
 await ABRIR_NOVA(); await preencher('Com tres avisos');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Avisar'), 'proprio'));
 const marcar = rotulo => pagina.avaliar(`[...document.querySelectorAll('dialog.tracking-editor .config-chip')].find(l => l.textContent === ${JSON.stringify(rotulo)}).querySelector('input').click()`);
 await marcar('1 hora antes'); await marcar('5 minutos antes');
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('dialog.tracking-editor .config-chip input')].filter(c => c.disabled).length`), 4);
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.posts.length === 3`);
 assert.deepEqual((await pagina.avaliar(`${NO_AGENDA}.posts[2]`)).reminders, [60, 15, 5]);
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);
 semExcecoes();
});

test('agenda: repetir toda semana ou todo mês cria uma série com a regra certa', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true; ${NO_AGENDA}.seriesPosts.length = 0; ${NO_AGENDA}.posts.length = 0`); await RECARREGAR_AGENDA();
 const dia = AM.somarDias(AM.segundaDe(AM.diaDe(Date.now())), 2);   // quarta-feira desta semana
 const base = titulo => pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); };
  set(${CAMPO_DO_FORM('Título')}, ${JSON.stringify(titulo)}); set(${CAMPO_DO_FORM('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change');
  set(${CAMPO_DO_FORM('Início · Brasília')}, '${dia}T10:00', 'change'); set(${CAMPO_DO_FORM('Fim / prazo · Brasília')}, '${dia}T11:00', 'change'); })()`);
 await ABRIR_NOVA(); await base('Mentoria semanal');
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Repete')}.value`), '', 'começa sem repetir');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Repete'), 'weekly'));
 const marcados = () => pagina.avaliar(`[...document.querySelectorAll('dialog.tracking-editor .ag-dias input')].filter(c => c.checked).map(c => c.parentElement.textContent)`);
 assert.deepEqual(await marcados(), ['Qua'], 'o dia do evento já vem marcado');
 await pagina.avaliar(`[...document.querySelectorAll('dialog.tracking-editor .ag-dias label')].find(l => l.textContent === 'Seg').querySelector('input').click()`);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Termina'), 'vezes'));
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Quantidade de eventos'), '6', 'input'));
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.seriesPosts.length === 1`, { descricao: 'POST da série' });
 const s = await pagina.avaliar(`${NO_AGENDA}.seriesPosts[0]`);
 assert.equal(s.frequency, 'weekly'); assert.deepEqual(s.weekdays, [0, 2]); assert.equal(s.count_limit, 6); assert.equal(s.interval_n, 1);
 assert.equal(s.start_time, '10:00'); assert.equal(s.duration_minutes, 60); assert.equal(s.starts_on, dia); assert.equal(s.title, 'Mentoria semanal');
 assert.ok(!('reminders' in s) && !('month_day' in s) && !('ends_on' in s));
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.posts.length`), 0, 'série não cria atividade solta');
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);

 // mensal, até uma data, sem aviso
 await ABRIR_NOVA(); await base('Fechamento mensal');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Repete'), 'monthly'));
 const dm = Number(dia.slice(8));
 assert.match(await pagina.avaliar(`document.querySelector('dialog.tracking-editor .ag-repetir .ag-nota').textContent`), new RegExp(`No dia ${dm} de cada mês`));
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Termina'), 'data'));
 await ENVIAR_FORM();   // sem data o formulário recusa, sem ir ao servidor
 await pagina.esperar(`document.querySelector('dialog.tracking-editor .form-error').textContent.includes('até que dia')`);
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.seriesPosts.length`), 1);
 const fim = AM.somarDias(dia, 200);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Data do último evento'), fim));
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Avisar'), 'nenhum'));
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.seriesPosts.length === 2`);
 const m = await pagina.avaliar(`${NO_AGENDA}.seriesPosts[1]`);
 assert.equal(m.frequency, 'monthly'); assert.equal(m.month_day, dm); assert.ok(!('weekdays' in m)); assert.equal(m.ends_on, fim); assert.deepEqual(m.reminders, []);
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);
 semExcecoes();
});

test('agenda: evento de série mostra "Repete" e o lembrete, edita só este ou os próximos, e encerra com confirmação', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const ID = '00000000-0000-4000-8000-000000000002';   // Revisão de código
 const SERIE = 'aaaaaaaa-0000-4000-8000-000000000001';
 await pagina.avaliar(`(() => { const a = ${NO_AGENDA}; a.lembretes = true; a.seriesPuts.length = 0; a.seriesFins.length = 0; a.puts.length = 0;
  a.series = [{ id: '${SERIE}', frequency: 'weekly', interval_n: 1, weekdays: [0, 2], descricao: 'Toda segunda e quarta', revision: 4, ended_at: null }];
  Object.assign(a.eventos.find(e => e.id === '${ID}'), { series_id: '${SERIE}', reminders: [60, 15] }); })()`);
 await RECARREGAR_AGENDA();
 assert.equal(await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"] .ag-repete')?.textContent`), '↻', 'marca de série no evento');
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO);
 const linhas = await pagina.avaliar(`Object.fromEntries([...document.querySelectorAll('#peek-agenda .ficha-dl dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent.trim()]))`);
 assert.equal(linhas['Repete'], 'Toda segunda e quarta'); assert.equal(linhas['Lembrete'], '1 h e 15 min antes');

 // "este e os próximos": só o título vai, para a série, com a revisão dela
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Editar').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`);
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Aplicar a')}.value`), 'um');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Aplicar a'), 'proximos'));
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Título'), 'Revisão semanal', 'input'));
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.seriesPuts.length === 1`, { descricao: 'PUT da série' });
 assert.deepEqual(await pagina.avaliar(`${NO_AGENDA}.seriesPuts[0]`), { id: SERIE, corpo: { revision: 4, title: 'Revisão semanal' } });
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.puts.length`), 0, 'não mexeu na atividade avulsa');
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);

 // mudar o dia só vale para "só este evento"
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Editar').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Aplicar a'), 'proximos'));
 const d0 = await pagina.avaliar(`${CAMPO_DO_FORM('Início · Brasília')}.value`);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Início · Brasília'), AM.somarDias(d0.slice(0, 10), 1) + 'T' + d0.slice(11)));
 await ENVIAR_FORM();
 await pagina.esperar(`document.querySelector('dialog.tracking-editor .form-error').textContent.includes('Só este evento')`);
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.seriesPuts.length`), 1);
 await FECHAR_TUDO();

 // encerrar: pede confirmação e só depois envia
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Encerrar repetição').click()`);
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.seriesFins.length`), 0, 'o primeiro clique só pergunta');
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].map(b => b.textContent.trim())`), ['Voltar', 'Só os próximos a partir deste', 'Todos os próximos']);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Todos os próximos').click()`);
 await pagina.esperar(`${NO_AGENDA}.seriesFins.length === 1`);
 assert.deepEqual(await pagina.avaliar(`${NO_AGENDA}.seriesFins[0]`), { id: SERIE, corpo: { revision: 4 } });
 await pagina.avaliar(`(() => { const a = ${NO_AGENDA}; delete a.eventos.find(e => e.id === '${ID}').series_id; a.series = []; a.lembretes = false; })()`);
 await RECARREGAR_AGENDA();
 await FECHAR_TUDO();
 semExcecoes();
});

test('agenda: teclado move e estica o evento focado, Ctrl+Z e "Desfazer" devolvem o horário, ? abre os atalhos e / busca', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const ID = '00000000-0000-4000-8000-000000000003';   // Consultoria Beta, terça 14:00–15:30
 await pagina.avaliar(`${NO_AGENDA}.puts.length = 0`);
 const tecla = (alvo, key, extra = '') => pagina.avaliar(`(() => { const n = ${alvo}; n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ${extra} })); })()`);
 const EV = `document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]')`;
 const horario = () => pagina.avaliar(`(() => { const p = ${NO_AGENDA}.puts.at(-1); return p && [p.corpo.starts_at, p.corpo.ends_at]; })()`);
 const ini0 = Date.parse(await pagina.avaliar(`${NO_AGENDA}.eventos.find(e => e.id === '${ID}').starts_at`));
 const fim0 = Date.parse(await pagina.avaliar(`${NO_AGENDA}.eventos.find(e => e.id === '${ID}').ends_at`));
 // ↓ move 15 min
 await tecla(EV, 'ArrowDown');
 await pagina.esperar(`${NO_AGENDA}.puts.length === 1`);
 assert.deepEqual(await horario(), [new Date(ini0 + 15 * 60000).toISOString(), new Date(fim0 + 15 * 60000).toISOString()]);
 await pagina.esperar(`document.querySelector('#view-tracking .ag-toast')`, { descricao: 'aviso com Desfazer' });
 assert.equal(await pagina.avaliar(`document.activeElement?.dataset?.id`), ID, 'o foco volta para o evento depois de gravar');
 // → move 1 dia; Shift+↓ estica o fim
 await tecla(EV, 'ArrowRight');
 await pagina.esperar(`${NO_AGENDA}.puts.length === 2`);
 assert.deepEqual(await horario(), [new Date(ini0 + 15 * 60000 + 86400000).toISOString(), new Date(fim0 + 15 * 60000 + 86400000).toISOString()]);
 await tecla(EV, 'ArrowDown', 'shiftKey: true');
 await pagina.esperar(`${NO_AGENDA}.puts.length === 3`);
 assert.deepEqual(await horario(), [new Date(ini0 + 15 * 60000 + 86400000).toISOString(), new Date(fim0 + 30 * 60000 + 86400000).toISOString()]);
 // Ctrl+Z devolve o horário anterior (só a última mudança)
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
 await pagina.esperar(`${NO_AGENDA}.puts.length === 4`);
 assert.deepEqual(await horario(), [new Date(ini0 + 15 * 60000 + 86400000).toISOString(), new Date(fim0 + 15 * 60000 + 86400000).toISOString()]);
 assert.equal(await pagina.avaliar(`!!document.querySelector('#view-tracking .ag-toast')`), false, 'desfazer não oferece desfazer de novo');
 // botão Desfazer
 await tecla(EV, 'ArrowUp');
 await pagina.esperar(`${NO_AGENDA}.puts.length === 5 && document.querySelector('#view-tracking .ag-toast')`);
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-toast button').click()`);
 await pagina.esperar(`${NO_AGENDA}.puts.length === 6`);
 // volta ao original para não vazar para os outros testes
 await tecla(EV, 'ArrowLeft'); await pagina.esperar(`${NO_AGENDA}.puts.length === 7`);
 await tecla(EV, 'ArrowUp'); await pagina.esperar(`${NO_AGENDA}.puts.length === 8`);
 assert.deepEqual(await horario(), [new Date(ini0).toISOString(), new Date(fim0).toISOString()]);
 await pagina.avaliar(`${NO_AGENDA}.eventos.find(e => e.id === '${ID}').revision = 1`);   // os outros testes esperam a revisão de origem

 // atalhos: ? abre a ajuda, Esc fecha; / foca a busca
 await pagina.avaliar(`document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))`);
 await pagina.esperar(`document.querySelector('dialog.ag-atalhos[open]')`);
 assert.ok((await pagina.avaliar(`document.querySelector('dialog.ag-atalhos').textContent`)).includes('Desfazer a última mudança'));
 await pagina.avaliar(`document.querySelector('dialog.ag-atalhos').close()`);
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`);
 assert.equal(await pagina.avaliar(`document.activeElement.type`), 'search');
 await pagina.avaliar(`document.activeElement.blur()`);
 semExcecoes();
});

test('agenda: com a conta Google conectada o formulário oferece a sala do Meet; sem ela, não', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true; ${NO_AGENDA}.meet = false; ${NO_AGENDA}.meets.length = 0; ${NO_AGENDA}.posts.length = 0`); await RECARREGAR_AGENDA();
 await ABRIR_NOVA();
 assert.ok(!(await pagina.avaliar(LEGENDAS)).includes('Videoconferência'), 'sem conta conectada não aparece');
 await FECHAR_TUDO();
 await pagina.avaliar(`${NO_AGENDA}.meet = true`); await RECARREGAR_AGENDA();
 await ABRIR_NOVA();
 assert.ok((await pagina.avaliar(LEGENDAS)).includes('Videoconferência'));
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Sala')}.value`), '', 'começa sem sala');
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Convidados (e-mails, separados por vírgula)')}.parentElement.hidden`), true, 'convidados só depois de escolher a sala');
 await pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); }; set(${CAMPO_DO_FORM('Título')}, 'Reunião com Meet'); set(${CAMPO_DO_FORM('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change'); })()`);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Sala'), 'meet'));
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Convidados (e-mails, separados por vírgula)')}.parentElement.hidden`), false);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Convidados (e-mails, separados por vírgula)'), 'ana@empresa.com, bia@empresa.com', 'input'));
 // com repetição escolhida a sala sai (vale para atividade avulsa)
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Repete'), 'weekly'));
 assert.equal(await pagina.avaliar(`document.querySelector('dialog.tracking-editor .ag-meet').hidden`), true);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Repete'), ''));
 assert.equal(await pagina.avaliar(`document.querySelector('dialog.tracking-editor .ag-meet').hidden`), false);
 await ENVIAR_FORM();
 await pagina.esperar(`${NO_AGENDA}.meets.length === 1`, { descricao: 'pedido da sala' });
 const post = await pagina.avaliar(`${NO_AGENDA}.posts[0]`);
 assert.equal(post.title, 'Reunião com Meet'); assert.ok(!('meeting_url' in post), 'o link vem do Google, não do formulário');
 assert.deepEqual(await pagina.avaliar(`${NO_AGENDA}.meets[0].corpo`), { convidados: 'ana@empresa.com, bia@empresa.com' });
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.meets[0].id`), post.id, 'a sala é criada para a atividade que acabou de ser gravada');
 await pagina.esperar(`!document.querySelector('dialog.tracking-editor[open]')`);
 semExcecoes();
});

test('agenda: se o Google falhar depois de salvar, a atividade fica e a tela avisa; o painel oferece criar a sala depois', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true; ${NO_AGENDA}.meet = true; ${NO_AGENDA}.meetFalha = true; ${NO_AGENDA}.meets.length = 0; ${NO_AGENDA}.posts.length = 0`); await RECARREGAR_AGENDA();
 await ABRIR_NOVA();
 await pagina.avaliar(`(() => { const set = (c, v, ev = 'input') => { c.value = v; c.dispatchEvent(new Event(ev, { bubbles: true })); }; set(${CAMPO_DO_FORM('Título')}, 'Sala que falha'); set(${CAMPO_DO_FORM('Cliente')}, ${JSON.stringify(EMPRESA)}, 'change'); })()`);
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Sala'), 'meet'));
 await ENVIAR_FORM();
 await pagina.esperar(`document.querySelector('#view-tracking .ag-aviso')?.textContent.includes('a sala do Meet não foi criada')`, { descricao: 'aviso de falha do Meet' });
 assert.match(await pagina.avaliar(`document.querySelector('#view-tracking .ag-aviso').textContent`), /A atividade foi salva/);
 assert.equal(await pagina.avaliar(`${NO_AGENDA}.posts.length`), 1, 'a atividade foi gravada uma vez só');
 // painel: botão "Criar sala do Meet" quando há conta e a atividade ainda não tem
 await pagina.avaliar(`${NO_AGENDA}.meetFalha = false`);
 const ID = '00000000-0000-4000-8000-000000000004';   // Daily
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO);
 assert.ok(await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].some(b => b.textContent.trim() === 'Adicionar videoconferência do Meet')`));
 assert.ok(!(await pagina.avaliar(`document.querySelector('#peek-agenda').textContent`)).includes('Google Agenda'), 'sem sala não há linha do Google Agenda');
 const antes = await pagina.avaliar(`${NO_AGENDA}.meets.length`);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Adicionar videoconferência do Meet').click()`);
 await pagina.esperar(`${NO_AGENDA}.meets.length === ${antes + 1}`);
 await pagina.esperar(`document.querySelector('#peek-agenda').textContent.includes('Evento criado e sincronizado')`, { descricao: 'painel mostra a sincronização' });
 assert.ok(!(await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].some(b => b.textContent.trim() === 'Adicionar videoconferência do Meet')`)), 'depois de criada, o botão some');
 assert.ok((await pagina.avaliar(`document.querySelector('#peek-agenda a')?.href`)).includes('meet.google.com'), 'o link do Meet aparece nos detalhes');
 await pagina.avaliar(`(() => { const a = ${NO_AGENDA}; a.meet = false; const e = a.eventos.find(x => x.id === '${ID}'); delete e.google_event_id; delete e.meeting_url; e.revision = 1; })()`);
 await RECARREGAR_AGENDA();
 await FECHAR_TUDO();
 semExcecoes();
});

test('agenda: com "Meet em toda atividade nova" ligado em Configurações o formulário abre com a sala marcada', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`${NO_AGENDA}.lembretes = true; ${NO_AGENDA}.meet = true`); await RECARREGAR_AGENDA();
 await pagina.avaliar(`try { localStorage.setItem('tzolkin-agenda-meet-auto', '1'); } catch {}`);
 await ABRIR_NOVA();
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Sala')}.value`), 'meet', 'abre com a sala marcada');
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Convidados (e-mails, separados por vírgula)')}.parentElement.hidden`), false, 'e já mostra os convidados');
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Sala')}.selectedOptions[0].textContent`), 'Adicionar videoconferência do Google Meet');
 await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Sala'), ''));   // dá para desmarcar antes de salvar
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Convidados (e-mails, separados por vírgula)')}.parentElement.hidden`), true);
 await FECHAR_TUDO();
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-meet-auto'); } catch {}`);
 await ABRIR_NOVA();
 assert.equal(await pagina.avaliar(`${CAMPO_DO_FORM('Sala')}.value`), '', 'desligado, abre sem sala');
 await FECHAR_TUDO();
 await pagina.avaliar(`${NO_AGENDA}.meet = false`); await RECARREGAR_AGENDA();
 semExcecoes();
});

test('resposta que não é JSON (servidor reiniciando, página de erro do proxy) vira mensagem clara, não "Unexpected token"', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 await pagina.avaliar(`window.__fetchSalvo = window.fetch; window.fetch = async (u, o) => (String(u).includes('/status') ? new Response('<!DOCTYPE html><html><body>Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } }) : window.__fetchSalvo(u, o))`);
 const ID = '00000000-0000-4000-8000-000000000004';
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Concluir').click()`);
 await pagina.esperar(`document.querySelector('#peek-agenda .form-error')?.textContent.length > 0`);
 const msg = await pagina.avaliar(`document.querySelector('#peek-agenda .form-error').textContent`);
 assert.match(msg, /O servidor não respondeu direito \(código 502\)/);
 assert.ok(!msg.includes('Unexpected token') && !msg.includes('DOCTYPE'));
 await pagina.avaliar(`window.fetch = window.__fetchSalvo`);
 await FECHAR_TUDO();
 semExcecoes();
});

test('agenda: o painel do evento mostra os detalhes, conclui, edita só o que mudou e registra tempo', { skip: PULAR }, async () => {
 await SEMANA_DE_HOJE();
 const ID = '00000000-0000-4000-8000-000000000003';      // Consultoria Beta, com descrição e link
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').click()`);
 await pagina.esperar(PAINEL_ABERTO, { descricao: 'painel aberto' });
 const painel = await pagina.avaliar(`(() => { const p = document.getElementById('peek-agenda'); const dl = p.querySelector('.ficha-dl'); return { titulo: p.querySelector('h2').textContent, abas: [...p.querySelectorAll('[role=tab]')].map(t => t.textContent.trim()), linhas: Object.fromEntries([...dl.querySelectorAll('dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent.trim()])), link: dl.querySelector('a')?.outerHTML, botoes: [...p.querySelectorAll('footer button')].map(b => b.textContent.trim()) }; })()`);
 assert.equal(painel.titulo, 'Consultoria Beta');
 assert.deepEqual(painel.abas.map(t => t.replace(/\d+$/, '')), ['Detalhes', 'Tempo']);
 assert.match(painel.linhas['Quando'], /14:00 – 15:30 \(1 h 30 min\)/);
 assert.equal(painel.linhas['Cliente'], 'Empresa Alfa'); assert.equal(painel.linhas['Categoria'], 'Consultoria'); assert.equal(painel.linhas['Situação'], 'Planejado');
 assert.equal(painel.linhas['Descrição'], 'Pauta:\n1. Metas', 'a descrição mantém as quebras de linha');
 assert.match(painel.link, /href="https:\/\/meet\.google\.com\/abc-defg-hij"/); assert.match(painel.link, /rel="noopener noreferrer"/); assert.match(painel.link, /target="_blank"/);
 assert.ok(!('Local' in painel.linhas), 'campo sem valor não aparece');
 assert.deepEqual(painel.botoes, ['Editar', 'Cancelar atividade', 'Concluir']);

 // concluir: PUT de situação com a revisão lida; o painel passa a oferecer "Reabrir"
 const puts0 = await pagina.avaliar(`${NO_AGENDA}.puts.length`);
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Concluir').click()`);
 await pagina.esperar(`${NO_AGENDA}.puts.length === ${puts0 + 1}`, { descricao: 'PUT de situação' });
 assert.deepEqual(await pagina.avaliar(`${NO_AGENDA}.puts.at(-1)`), { id: ID, sub: 'status', corpo: { status: 'done', revision: 1 } });
 await pagina.esperar(`[...document.querySelectorAll('#peek-agenda footer button')].some(b => b.textContent.trim() === 'Reabrir')`, { descricao: 'painel mostra Reabrir' });
 assert.equal(await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="${ID}"]').dataset.status`), 'done', 'a grade também mudou');

 // editar: o formulário vem preenchido, a empresa fica travada e só o campo alterado vai
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda footer button')].find(b => b.textContent.trim() === 'Editar').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`, { descricao: 'formulário de edição' });
 const campoDe = nome => `[...document.querySelectorAll('dialog.tracking-editor label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)}).querySelector('input,select,textarea')`;
 assert.equal(await pagina.avaliar(`document.querySelector('dialog.tracking-editor h2').textContent`), 'Editar atividade');
 assert.equal(await pagina.avaliar(`${campoDe('Título')}.value`), 'Consultoria Beta');
 assert.equal(await pagina.avaliar(`${campoDe('Cliente')}.disabled`), true);
 assert.equal(await pagina.avaliar(`${campoDe('Link da reunião (opcional)')}.value`), 'https://meet.google.com/abc-defg-hij');
 await pagina.avaliar(`(() => { const t = ${campoDe('Título')}; t.value = 'Consultoria Beta — revisão'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('dialog.tracking-editor form').requestSubmit(); })()`);
 await pagina.esperar(`${NO_AGENDA}.puts.length === ${puts0 + 2}`, { descricao: 'PUT de edição' });
 assert.deepEqual(await pagina.avaliar(`${NO_AGENDA}.puts.at(-1)`), { id: ID, sub: null, corpo: { revision: 2, title: 'Consultoria Beta — revisão' } }, 'só o título muda, com a revisão que subiu ao concluir');
 await pagina.esperar(`document.querySelector('#peek-agenda h2').textContent === 'Consultoria Beta — revisão'`, { descricao: 'painel com o título novo' });

 // tempo: aba própria, formulário inline
 await pagina.avaliar(`[...document.querySelectorAll('#peek-agenda [role=tab]')].find(t => t.textContent.startsWith('Tempo')).click()`);
 await pagina.avaliar(`(() => { const f = document.querySelector('#peek-agenda .ag-tempo'); const set = (rotulo, v) => { const c = [...f.querySelectorAll('label')].find(l => l.firstChild.textContent === rotulo).querySelector('input'); c.value = v; c.dispatchEvent(new Event('input', { bubbles: true })); }; set('Minutos trabalhados', '45'); set('Descrição do trabalho', 'Revisão da proposta'); f.requestSubmit(); })()`);
 await pagina.esperar(`${NO_AGENDA}.tempos.length === 1`, { descricao: 'apontamento enviado' });
 const tempo = await pagina.avaliar(`${NO_AGENDA}.tempos[0]`);
 assert.equal(tempo.id, ID); assert.equal(tempo.corpo.minutes, 45); assert.equal(tempo.corpo.note, 'Revisão da proposta'); assert.match(tempo.corpo.worked_on, /^\d{4}-\d{2}-\d{2}$/);
 // Esc fecha o painel e devolve o foco
 const antesDoEsc = await pagina.avaliar(`({ dialogos: document.querySelectorAll('dialog[open]').length, paineis: [...document.querySelectorAll('.peek-side')].map(p => p.id || p.className), ativo: document.activeElement?.tagName + '.' + document.activeElement?.className })`);
 assert.equal(antesDoEsc.dialogos, 0, 'nenhum diálogo aberto antes do Esc: ' + JSON.stringify(antesDoEsc));
 await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
 await new Promise(r => setTimeout(r, 400));
 const depoisDoEsc = await pagina.avaliar(`({ painel: !!document.getElementById('peek-agenda'), scrims: document.querySelectorAll('.peek-scrim').length, paineisNaPagina: [...document.querySelectorAll('.peek-side')].map(p => p.id) })`);
 assert.equal(depoisDoEsc.painel, false, 'o painel deveria ter fechado: ' + JSON.stringify(depoisDoEsc));
 semExcecoes();
});

test('agenda: legível no claro e no escuro em todas as visões, sem estouro de largura no celular', { skip: PULAR }, async () => {
 const LER = `(() => {
  const canais = c => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const luz = c => { const [r, g, b] = canais(c).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const fundoDe = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(.*, 0\\)|transparent/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  const ruins = [];
  for (const el of document.querySelectorAll('#view-tracking *')) {
   if (!el.offsetParent || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
   let c; try { c = razao(getComputedStyle(el).color, fundoDe(el)); } catch (e) { ruins.push('ERRO ' + getComputedStyle(el).color + ' | ' + fundoDe(el) + ' .' + el.className); continue; }
   if (c < 4.5) ruins.push(c + ' "' + el.textContent.trim().slice(0, 30) + '" .' + String(el.className).split(' ')[0]);
  }
  const largos = [...document.querySelectorAll('#view-tracking *')].filter(e => e.offsetParent && !e.closest('.ag-rolagem') && e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map(e => e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' direita=' + Math.round(e.getBoundingClientRect().right));
  return { ruins: ruins.slice(0, 8), estouro: document.documentElement.scrollWidth - document.documentElement.clientWidth, largos };
 })()`;
 await pagina.tela(1280, 900);
 for (const esquema of ['light', 'dark']) {
  await pagina.esquema(esquema);
  await pagina.esperar(`document.documentElement.dataset.theme === '${esquema === 'dark' ? 'dark' : 'light'}'`);
  for (const visao of ['semana', 'dia', 'mes', 'agenda']) {
   await pagina.avaliar(`${BOTAO_VISAO(visao)}.click()`);
   await pagina.esperar(`${VISOES_ESPERAM(visao)} && !document.querySelector('#view-tracking [aria-busy]')`);
   await new Promise(r => setTimeout(r, 450));   // transições de cor (.15s) assentam antes de medir
   const l = await pagina.avaliar(LER);
   assert.deepEqual(l.ruins, [], `${esquema} / ${visao}: texto abaixo de 4,5:1`);
   assert.ok(l.estouro <= 0, `${esquema} / ${visao}: rolagem horizontal de ${l.estouro}px; estouram: ${l.largos.join(' | ')}`);
  }
 }
 await pagina.esquema('light');
 // celular: abre no dia, cabe na tela, e a semana também cabe
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-visao'); } catch {}`);
 await pagina.tela(390, 844);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden`);
 await IR_PARA_AGENDA();
 await pagina.esperar(`document.querySelectorAll('#view-tracking .ag-coluna').length >= 1`);
 assert.equal(await pagina.avaliar(VISAO_ATIVA), 'dia', 'no celular abre na visão Dia');
 for (const visao of ['dia', 'semana', 'mes', 'agenda']) {
  await pagina.avaliar(`${BOTAO_VISAO(visao)}.click()`);
  await pagina.esperar(`${VISOES_ESPERAM(visao)} && !document.querySelector('#view-tracking [aria-busy]')`);
  await new Promise(r => setTimeout(r, 300));
  const l = await pagina.avaliar(LER);
  assert.ok(l.estouro <= 0, `celular / ${visao}: rolagem horizontal de ${l.estouro}px; estouram: ${l.largos.join(' | ')}`);
  assert.deepEqual(l.ruins, [], `celular / ${visao}: texto abaixo de 4,5:1`);
 }
 const alturaDosBotoes = await pagina.avaliar(`[...document.querySelectorAll('#view-tracking .ag-visoes button, #view-tracking .ag-acoes .primary')].map(b => Math.round(b.getBoundingClientRect().height))`);
 assert.ok(alturaDosBotoes.every(h => h >= 40), 'alvo de toque de pelo menos 40px: ' + alturaDosBotoes);
 await pagina.tela(1280, 900);
 await desfazerAgenda?.();
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-visao'); } catch {}`);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden`, { descricao: 'painel de volta ao normal' });
 semExcecoes();
});

// ---- Configurações → Notificações ----
const COM_PUSH = `(() => {
 const estado = window.__push = { subs: [], puts: [], deletes: [], testes: 0, prefsPuts: [], permissao: 'default', pedidos: 0, habilitado: true, lembretes: true, padrao: [15], revisao: 1, desinscrito: 0 };
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 const json = (corpo, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
 const assinatura = { endpoint: 'https://push.exemplo.test/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; }, unsubscribe() { estado.desinscrito++; assinatura.ativa = false; return Promise.resolve(true); }, ativa: false };
 estado.assinatura = assinatura;
 const registro = { pushManager: { getSubscription: () => Promise.resolve(assinatura.ativa ? assinatura : null), subscribe: opcoes => { estado.opcoes = { userVisibleOnly: opcoes.userVisibleOnly, bytes: opcoes.applicationServerKey.length }; assinatura.ativa = true; return Promise.resolve(assinatura); } } };
 Object.defineProperty(navigator.serviceWorker, 'ready', { configurable: true, get: () => Promise.resolve(registro) });
 Object.defineProperty(Notification, 'permission', { configurable: true, get: () => estado.permissao });
 Notification.requestPermission = () => { estado.pedidos++; if (estado.permissao === 'default') estado.permissao = 'granted'; return Promise.resolve(estado.permissao); };
 window.fetch = async (url, opcoes = {}) => {
  const u = String(url), metodo = (opcoes.method || 'GET').toUpperCase(), corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
  if (u === '/api/push/config') return json({ enabled: estado.habilitado, publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', topics: ['commercial.lead', 'agenda.lembrete'] });
  if (u === '/api/push/status') return json(assinatura.ativa && estado.subs.length ? { subscribed: true, id: 'dddddddd-0000-4000-8000-000000000001', topics: estado.subs[0] } : { subscribed: false });
  if (u === '/api/push/subscriptions' && metodo === 'PUT') { estado.puts.push(corpo); estado.subs = [corpo.topics]; return json({ ok: true, id: 'dddddddd-0000-4000-8000-000000000001', topics: corpo.topics }); }
  if (u.startsWith('/api/push/subscriptions/') && metodo === 'DELETE') { estado.deletes.push(u); estado.subs = []; return json({ ok: true }); }
  if (u === '/api/push/test') { estado.testes++; return json({ enviados: 1, revogados: 0, falhas: 0 }); }
  if (u === '/api/agenda/preferencias' && metodo === 'GET') return json({ disponivel: estado.lembretes, default_reminders: estado.padrao, revision: estado.revisao });
  if (u === '/api/agenda/preferencias' && metodo === 'PUT') { estado.prefsPuts.push(corpo); estado.padrao = corpo.default_reminders; estado.revisao += 1; return json({ disponivel: true, default_reminders: estado.padrao, revision: estado.revisao }); }
  return window.__fetchOriginal(url, opcoes);
 };
})()`;
const IR_PARA_CONFIG = async () => {
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`!document.getElementById('view-settings').hidden && document.querySelector('#settings-body .cfg-item')`, { descricao: 'configurações abertas' });
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=notificacoes]').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .config-notif')`, { descricao: 'seção Notificações' });
 await pagina.esperar(`document.querySelector('#settings-body .config-bloco')`, { descricao: 'notificações desenhadas' });
};
const BOTAO_CONFIG = texto => `[...document.querySelectorAll('#settings-body button')].find(b => b.textContent.trim() === ${JSON.stringify(texto)})`;

test('configurações: a casca lista as seções com o escopo de cada uma e troca de seção sem recarregar', { skip: PULAR }, async () => {
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-item') && document.querySelector('#settings-body input[name=tema]')`);
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .cfg-item')].map(b => b.textContent)`), ['Aparência', 'Notificações', 'Aplicativo', 'Teclado', 'Integrações', 'Agenda']);
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[aria-current=page]').textContent`), 'Aparência', 'abre na primeira seção');
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-escopo').textContent`), 'Só neste navegador');
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=notificacoes]').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-titulo-secao').textContent === 'Notificações'`);
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-escopo').textContent`), 'Sua conta');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body input[name=tema]').length`), 0, 'a seção anterior saiu');
 assert.notEqual(await pagina.avaliar(`document.activeElement.className`), 'cfg-titulo-secao', 'trocar de seção não rouba o foco da lista');
 // sai e volta: o painel lembra a seção em que a pessoa estava
 await pagina.avaliar(CLICAR_NO_MENU('Visão geral'));
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-titulo-secao')?.textContent === 'Notificações'`);
 semExcecoes();
});

test('configurações → Aplicativo: só leitura, mostra o estado e oferece instalar só quando o navegador deixa', { skip: PULAR }, async () => {
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-item')`);
 // O Chrome real pode já ter oferecido a instalação: troca o guardião por um que diz que não há oferta, para o teste não depender disso.
 await pagina.avaliar(`window.__instalarReal = window.TzolkinInstalar; window.TzolkinInstalar = { pronto: () => false, pedir: async () => null }`);
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=aplicativo]').click()`);
 await pagina.esperar(`document.querySelectorAll('#settings-body .cfg-linha').length === 3`);
 const texto = () => pagina.avaliar(`document.querySelector('#settings-body .cfg-lista').textContent`);
 assert.match(await texto(), /Aberto no navegador/);
 assert.match(await texto(), /chrome:\/\/apps/);
 assert.match(await texto(), /não usa Local, Câmera nem Microfone/);
 assert.equal(await pagina.avaliar(`!![...document.querySelectorAll('#settings-body button')].find(b => b.textContent === 'Instalar o Core')`), false, 'sem o evento do navegador não há botão');
 // com o evento de instalação guardado, o botão aparece e chama o prompt do navegador
 await pagina.avaliar(`window.TzolkinInstalar = window.__instalarReal`);
 await pagina.avaliar(`(() => { window.__instalou = 0; const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__instalou++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); })()`);
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=aparencia]').click()`);
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=aplicativo]').click()`);
 await pagina.esperar(`[...document.querySelectorAll('#settings-body button')].find(b => b.textContent === 'Instalar o Core')`);
 await pagina.avaliar(`[...document.querySelectorAll('#settings-body button')].find(b => b.textContent === 'Instalar o Core').click()`);
 await pagina.esperar(`window.__instalou === 1`);
 semExcecoes();
});

const ABRIR_SECAO = async id => {
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-item')`);
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=${id}]').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-item[data-secao=${id}]').getAttribute('aria-current') === 'page' && document.querySelector('#settings-body .cfg-conteudo').children.length`);
};

test('configurações → Agenda: lembrete padrão (espaço) e preferências deste navegador, cada bloco com o seu selo', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-inicio'); localStorage.removeItem('tzolkin-agenda-duracao'); } catch {}`);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await ABRIR_SECAO('agenda');
 await pagina.esperar(`document.querySelector('#settings-body .config-chip')`, { descricao: 'lembrete padrão carregado' });
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body .cfg-cab .cfg-escopo').length`), 0, 'seção de escopo misto não tem selo no título');
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .config-bloco')].map(b => b.querySelector('.config-sub').textContent + ' | ' + b.querySelector('.cfg-escopo').textContent)`),
  ['Lembrete padrão | Todo o espaço', 'Ao abrir a agenda | Só neste navegador', 'Atividade nova | Só neste navegador', 'Videoconferência | Só neste navegador']);
 // lembrete padrão: 15 min vem marcado; marcar 1 h grava a lista (maior primeiro) com a revisão lida
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .config-chip input')].filter(c => c.checked).map(c => c.parentElement.textContent)`), ['15 minutos antes']);
 await pagina.avaliar(`[...document.querySelectorAll('#settings-body .config-chip')].find(l => l.textContent === '1 hora antes').querySelector('input').click()`);
 await pagina.esperar(`window.__push.prefsPuts.length === 1`);
 assert.deepEqual(await pagina.avaliar(`window.__push.prefsPuts[0]`), { revision: 1, default_reminders: [60, 15] });
 await pagina.esperar(`document.querySelector('#settings-body .config-bloco .config-ajuda').textContent.includes('1 h e 15 min antes')`);
 // visão inicial e duração padrão: guardadas neste navegador
 const definir = (rotulo, valor) => pagina.avaliar(`(() => { const s = [...document.querySelectorAll('#settings-body .cfg-seletor')].find(l => l.firstChild.textContent === ${JSON.stringify(rotulo)}).querySelector('select'); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
 await definir('Visão inicial', 'mes');
 await definir('Duração padrão', '30');
 assert.equal(await pagina.avaliar(`localStorage.getItem('tzolkin-agenda-inicio')`), 'mes');
 assert.equal(await pagina.avaliar(`localStorage.getItem('tzolkin-agenda-duracao')`), '30');
 // a agenda obedece: abre no mês e o formulário novo dura 30 min
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await IR_PARA_AGENDA();
 assert.equal(await pagina.avaliar(VISAO_ATIVA), 'mes', 'abre na visão escolhida, mesmo que a última usada fosse outra');
 await pagina.avaliar(`document.querySelector('#view-tracking .ag-acoes .primary').click()`);
 await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`);
 const ini = await pagina.avaliar(`${CAMPO_DO_FORM('Início · Brasília')}.value`), fim = await pagina.avaliar(`${CAMPO_DO_FORM('Fim / prazo · Brasília')}.value`);
 assert.equal((Date.parse(fim + ':00-03:00') - Date.parse(ini + ':00-03:00')) / 60000, 30, 'duração padrão aplicada');
 await FECHAR_TUDO();
 // voltar ao padrão apaga as chaves
 await ABRIR_SECAO('agenda');
 await pagina.esperar(`document.querySelector('#settings-body .cfg-seletor')`);
 await definir('Visão inicial', ''); await definir('Duração padrão', '60');
 assert.equal(await pagina.avaliar(`[localStorage.getItem('tzolkin-agenda-inicio'), localStorage.getItem('tzolkin-agenda-duracao')].join()`), ',', 'valores padrão não ficam gravados');
 semExcecoes();
 await desfazer?.();
});

const COM_GOOGLE = estado => `(() => {
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 window.__google = { estado: ${JSON.stringify(estado)}, authorize: 0, disconnect: 0 };
 const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
 window.fetch = async (url, o = {}) => {
  const u = String(url);
  if (u === '/api/google/calendar/status') return json(sessionStorage.getItem('__gdisc') ? { ...window.__google.estado, conectado: false } : window.__google.estado);
  if (u === '/api/google/calendar/authorize') { window.__google.authorize++; return json({ url: '/?secao=integracoes&google=ok' }); }
  if (u === '/api/google/calendar/disconnect') { sessionStorage.setItem('__gdisc', '1'); return json({ ok: true }); }
  if (u === '/api/integrations/status') return json({ integracoes: [] });
  return window.__fetchOriginal(url, o);
 };
})()`;

const COM_CREDENCIAIS = estado => `(() => {
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 const E = window.__cred = Object.assign({ migracao: true, chave: true, testes: [], puts: [], deletes: [], gerar: [], pushTem: false, recusar: false, vercelOrigem: 'servidor', easypanelUrl: 'https://painel.exemplo.test' }, ${JSON.stringify(estado || {})});
 const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
 const integ = (id, nome, grupo, tela) => ({ id, nome, grupo, para: 'Para ' + nome + '.', estado: 'configurado', faltando: [], opcionais_ausentes: [], tela });
 window.fetch = async (url, o = {}) => {
  const u = String(url), m = (o.method || 'GET').toUpperCase(), corpo = o.body ? JSON.parse(o.body) : {};
  if (u === '/api/google/calendar/status') return json({ cliente: false, chave: false, migracao: false, disponivel: false, conectado: false });
  if (u === '/api/integrations/status') return json({ integracoes: [integ('stripe', 'Stripe', 'Cobrança', 'finance'), integ('vercel', 'Vercel', 'Tecnologia', 'vercel'), integ('github', 'GitHub', 'Tecnologia', 'github'), integ('easypanel', 'EasyPanel', 'Tecnologia', 'easypanel'), integ('hostinger', 'Hostinger (DNS)', 'Tecnologia', 'dns'), integ('push', 'Notificações push', 'Avisos', null)] });
  if (u === '/api/integrations/credentials' && m === 'GET') {
   const campo = (nome, rotulo, secreto, origem, extra = {}) => ({ nome, rotulo, secreto, obrigatorio: nome !== 'VERCEL_TEAM_ID' && nome !== 'HOSTINGER_DNS_ZONE', ajuda: null, origem, definido: origem !== null, ...(secreto ? {} : { valor: origem ? (extra.valor ?? '') : '' }), ...(origem === 'tela' ? { impressao: 'abcd1234abcd1234', atualizado_por: 'gustavo@exemplo.test', atualizado_em: '2026-10-04T15:00:00Z' } : {}) });
   return json({ migracao: E.migracao, chave: E.chave, provedores: [
    { id: 'vercel', nome: 'Vercel', campos: [campo('VERCEL_TOKEN', 'Token', true, E.vercelOrigem), campo('VERCEL_TEAM_ID', 'ID do time (opcional)', false, null)], historico: E.vercelOrigem === 'tela' ? [{ nome: 'VERCEL_TOKEN', acao: 'set', por: 'gustavo@exemplo.test', em: '2026-10-04T15:00:00Z' }] : [] },
    { id: 'github', nome: 'GitHub', campos: [campo('GITHUB_TOKEN', 'Token', true, null)], historico: [] },
    { id: 'easypanel', nome: 'EasyPanel', campos: [campo('EASYPANEL_URL', 'Endereço do painel', false, 'servidor', { valor: E.easypanelUrl }), campo('EASYPANEL_TOKEN', 'Token da API', true, 'servidor')], historico: [] },
    { id: 'hostinger', nome: 'Hostinger (DNS)', campos: [campo('HOSTINGER_API_KEY', 'Chave da API', true, null), campo('HOSTINGER_DNS_ZONE', 'Zona de DNS', false, null)], historico: [] },
    { id: 'push', nome: 'Notificações push', campos: [campo('VAPID_PUBLIC_KEY', 'Chave pública', false, E.pushTem ? 'tela' : null, { valor: 'BPUBLICA' }), campo('VAPID_PRIVATE_KEY', 'Chave privada', true, E.pushTem ? 'tela' : null), campo('VAPID_SUBJECT', 'Assunto', false, E.pushTem ? 'tela' : null, { valor: 'https://core.exemplo.test' })], historico: [] },
   ] });
  }
  if (u === '/api/integrations/credentials/test') { E.testes.push(corpo); return json(E.recusar ? { ok: false, mensagem: 'Não foi possível validar: A Vercel recusou o token.' } : { ok: true, mensagem: 'A Vercel respondeu (há projetos visíveis).' }); }
  if (u === '/api/integrations/credentials' && m === 'PUT') { E.puts.push(corpo); if (E.recusar) return json({ message: 'Não foi possível validar: A Vercel recusou o token.' }, 422); E.vercelOrigem = 'tela'; return json({ ok: true, mensagem: 'A Vercel respondeu (há projetos visíveis).', campos: Object.keys(corpo.valores) }); }
  if (u === '/api/integrations/credentials/push/gerar') { E.gerar.push(corpo); E.pushTem = true; return json({ ok: true, publica: 'BPUBLICA', assunto: 'https://core.exemplo.test', aparelhos_desativados: corpo.confirmar ? 2 : 0 }); }
  if (u.startsWith('/api/integrations/credentials/') && m === 'DELETE') { E.deletes.push(u); E.vercelOrigem = 'servidor'; return json({ ok: true }); }
  return window.__fetchOriginal(url, o);
 };
})()`;

test('configurações → Integrações: configurar uma credencial pela tela (testar, salvar, remover) sem nunca mostrar o segredo', { skip: PULAR }, async () => {
 const abrir = async estado => {
  const d = await pagina.injetar(COM_CREDENCIAIS(estado));
  await pagina.tela(1280, 900);
  await pagina.ir(origem + '/');
  await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
  await ABRIR_SECAO('integracoes');
  await pagina.esperar(`document.querySelectorAll('#settings-body .cfg-integracao').length === 6`, { descricao: 'cartões' });
  return d;
 };
 const cartao = id => `document.querySelector('#settings-body .cfg-integracao[data-integracao=${id}]')`;
 const abrirForm = async id => { await pagina.avaliar(`${cartao(id)}.querySelector('button[data-acao=configurar]').click()`); await pagina.esperar(`${cartao(id)}.querySelector('.cfg-cred-form')`); };
 const digitar = (id, nome, valor) => pagina.avaliar(`(() => { const i = ${cartao(id)}.querySelector('input[name=${nome}]'); i.value = ${JSON.stringify(valor)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 const botaoDoForm = (id, texto) => `[...${cartao(id)}.querySelectorAll('.cfg-cred-form button')].find(b => b.textContent === ${JSON.stringify(texto)})`;
 let d = await abrir({});
 assert.equal(await pagina.avaliar(`!!${cartao('stripe')}.querySelector('button[data-acao=configurar]')`), false, 'só quem já pode ser configurado pela tela ganha o botão');
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-integracao[data-integracao=vercel] button').textContent`), 'Abrir', 'o botão de abrir continua primeiro');
 await abrirForm('vercel');
 const campos = await pagina.avaliar(`[...${cartao('vercel')}.querySelectorAll('.cfg-cred-campo')].map(l => ({ nome: l.querySelector('input').name, tipo: l.querySelector('input').type, valor: l.querySelector('input').value, dica: l.querySelector('small').textContent, placeholder: l.querySelector('input').placeholder }))`);
 assert.deepEqual(campos.map(c => [c.nome, c.tipo, c.valor]), [['VERCEL_TOKEN', 'password', ''], ['VERCEL_TEAM_ID', 'text', '']], 'segredo é campo de senha e vem vazio');
 assert.match(campos[0].dica, /Vem do servidor/); assert.match(campos[0].placeholder, /sobrepor/);
 if (process.env.UI_SCREENSHOTS) {
  await pagina.avaliar(`${cartao('vercel')}.scrollIntoView({ block: 'start' })`);
  for (const esq of ['light', 'dark']) { await pagina.esquema(esq); await new Promise(r => setTimeout(r, 400)); await pagina.imagem(join(ARTEFATOS, `1012-Integracoes-formulario-${esq === 'dark' ? 'Escuro' : 'Claro'}.png`)); }
  await pagina.esquema('light');
 }
 // nada digitado: pede para preencher, sem ir ao servidor
 await pagina.avaliar(`${botaoDoForm('vercel', 'Salvar')}.click()`);
 await pagina.esperar(`${cartao('vercel')}.querySelector('.config-aviso').textContent.includes('Preencha')`);
 assert.equal(await pagina.avaliar(`window.__cred.puts.length`), 0);
 // testar manda só o que mudou
 await digitar('vercel', 'VERCEL_TOKEN', 'token-novo-1234567');
 await pagina.avaliar(`${botaoDoForm('vercel', 'Testar')}.click()`);
 await pagina.esperar(`window.__cred.testes.length === 1`);
 assert.deepEqual(await pagina.avaliar(`window.__cred.testes[0]`), { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-novo-1234567' } });
 await pagina.esperar(`${cartao('vercel')}.querySelector('.config-aviso').textContent.includes('A Vercel respondeu')`);
 assert.equal(await pagina.avaliar(`window.__cred.puts.length`), 0, 'testar não grava');
 // provedor recusa: mostra o motivo, nada muda
 await pagina.avaliar(`window.__cred.recusar = true`);
 await pagina.avaliar(`${botaoDoForm('vercel', 'Salvar')}.click()`);
 await pagina.esperar(`${cartao('vercel')}.querySelector('.config-aviso').textContent.includes('recusou o token')`);
 assert.equal(await pagina.avaliar(`${cartao('vercel')}.querySelector('.config-aviso').classList.contains('erro')`), true);
 assert.equal(await pagina.avaliar(`${cartao('vercel')}.dataset.estado`), 'configurado');
 await pagina.avaliar(`window.__cred.recusar = false`);
 // salvar: grava, a tela se redesenha e passa a dizer que vem da tela
 await pagina.avaliar(`${botaoDoForm('vercel', 'Salvar')}.click()`);
 await pagina.esperar(`window.__cred.puts.length === 2`);
 assert.deepEqual(await pagina.avaliar(`window.__cred.puts[1]`), { provider: 'vercel', valores: { VERCEL_TOKEN: 'token-novo-1234567' } });
 await pagina.esperar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent.includes('Salvo.')`, { descricao: 'aviso de salvo' });
 assert.match(await pagina.avaliar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent`), /30 segundos/);
 await abrirForm('vercel');
 const depois = await pagina.avaliar(`${cartao('vercel')}.querySelector('.cfg-cred-campo small').textContent`);
 assert.match(depois, /Definido pela tela por gustavo@exemplo\.test/); assert.match(depois, /impressão abcd1234/);
 assert.equal(await pagina.avaliar(`${cartao('vercel')}.querySelector('input[name=VERCEL_TOKEN]').value`), '', 'o segredo salvo não volta para o campo');
 assert.ok(!(await pagina.avaliar(`document.getElementById('settings-body').innerHTML`)).includes('token-novo-1234567'), 'o valor digitado não fica na página depois de salvar');
 assert.match(await pagina.avaliar(`${cartao('vercel')}.querySelector('.cfg-cred-hist').textContent`), /VERCEL_TOKEN definido por gustavo/);
 // remover da tela: volta ao servidor
 await pagina.avaliar(`${cartao('vercel')}.querySelector('.cfg-cred-remover').click()`);
 await pagina.esperar(`window.__cred.deletes.length === 1`);
 assert.equal(await pagina.avaliar(`window.__cred.deletes[0]`), '/api/integrations/credentials/vercel/VERCEL_TOKEN');
 await pagina.esperar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent.includes('Removido da tela')`);
 // campo que não é segredo vem preenchido e pode ser editado
 await abrirForm('easypanel');
 assert.equal(await pagina.avaliar(`${cartao('easypanel')}.querySelector('input[name=EASYPANEL_URL]').value`), 'https://painel.exemplo.test');
 assert.equal(await pagina.avaliar(`${cartao('easypanel')}.querySelector('input[name=EASYPANEL_TOKEN]').type`), 'password');
 semExcecoes();
 await d?.();

 // sem chave ou sem migração: o formulário explica e não deixa salvar
 d = await abrir({ chave: false });
 await abrirForm('github');
 assert.match(await pagina.avaliar(`${cartao('github')}.querySelector('.config-aviso').textContent`), /CORE_SECRETS_KEY/);
 assert.equal(await pagina.avaliar(`${botaoDoForm('github', 'Salvar')}.disabled`), true);
 assert.equal(await pagina.avaliar(`${botaoDoForm('github', 'Testar')}.disabled`), true);
 await d?.();
 d = await abrir({ migracao: false });
 await abrirForm('hostinger');
 assert.match(await pagina.avaliar(`${cartao('hostinger')}.querySelector('.config-aviso').textContent`), /migração 050/);
 assert.equal(await pagina.avaliar(`${botaoDoForm('hostinger', 'Salvar')}.disabled`), true);
 semExcecoes();
 await d?.();
});

test('configurações → Integrações → Notificações push: gerar as chaves VAPID pela tela, com confirmação quando já existem', { skip: PULAR }, async () => {
 const abrir = async estado => {
  const d = await pagina.injetar(COM_CREDENCIAIS(estado));
  await pagina.tela(1280, 900);
  await pagina.ir(origem + '/');
  await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
  await ABRIR_SECAO('integracoes');
  await pagina.esperar(`document.querySelectorAll('#settings-body .cfg-integracao').length === 6`, { descricao: 'cartões' });
  return d;
 };
 const cartao = `document.querySelector('#settings-body .cfg-integracao[data-integracao=push]')`;
 const botao = texto => `[...${cartao}.querySelectorAll('.cfg-cred-form button')].find(b => b.textContent.startsWith(${JSON.stringify(texto)}))`;
 const abrirForm = async () => { await pagina.avaliar(`${cartao}.querySelector('button[data-acao=configurar]').click()`); await pagina.esperar(`${cartao}.querySelector('.cfg-cred-form')`); };
 // sem chaves: gera direto, sem pedir confirmação
 let d = await abrir({ pushTem: false });
 await abrirForm();
 assert.deepEqual(await pagina.avaliar(`[...${cartao}.querySelectorAll('.cfg-cred-campo input')].map(i => [i.name, i.type])`), [['VAPID_PUBLIC_KEY', 'text'], ['VAPID_PRIVATE_KEY', 'password'], ['VAPID_SUBJECT', 'text']], 'a chave privada é campo de senha');
 await pagina.avaliar(`${botao('Gerar chaves')}.click()`);
 await pagina.esperar(`window.__cred.gerar.length === 1`);
 assert.deepEqual(await pagina.avaliar(`window.__cred.gerar[0]`), { confirmar: false });
 await pagina.esperar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent.includes('Chaves geradas')`);
 assert.match(await pagina.avaliar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent`), /privada ficou só no servidor/);
 assert.ok(!(await pagina.avaliar(`document.getElementById('settings-body').innerHTML`)).includes('PRIVADA-SECRETA'), 'a privada nunca chega à tela');
 await d?.();
 // com chaves: o primeiro clique só avisa; o segundo confirma
 d = await abrir({ pushTem: true });
 await abrirForm();
 await pagina.avaliar(`${botao('Gerar chaves novas')}.click()`);
 assert.equal(await pagina.avaliar(`window.__cred.gerar.length`), 0, 'o primeiro clique não gera');
 assert.match(await pagina.avaliar(`${cartao}.querySelector('.config-aviso').textContent`), /desativa os aparelhos que já ativaram/);
 assert.ok(await pagina.avaliar(`!!${botao('Confirmar')}`));
 await pagina.avaliar(`${botao('Confirmar')}.click()`);
 await pagina.esperar(`window.__cred.gerar.length === 1`);
 assert.deepEqual(await pagina.avaliar(`window.__cred.gerar[0]`), { confirmar: true, subject: 'https://core.exemplo.test' }, 'o assunto que está no campo vai junto');
 await pagina.esperar(`document.querySelector('#settings-body .cfg-integracoes > .config-aviso').textContent.includes('2 aparelho(s) foram desativados')`);
 semExcecoes();
 await d?.();
});

test('configurações → Notificações: assinatura do navegador feita com a chave antiga é descartada e refeita com a atual', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 // o navegador ainda guarda uma assinatura feita com OUTRA chave pública; o servidor não a conhece
 await pagina.avaliar(`(() => { const a = window.__push.assinatura; a.ativa = true; a.options = { applicationServerKey: new Uint8Array(65).fill(7).buffer }; })()`);
 await IR_PARA_CONFIG();
 assert.ok(await pagina.avaliar(`!!${BOTAO_CONFIG('Ativar neste aparelho')}`));
 await pagina.avaliar(`${BOTAO_CONFIG('Ativar neste aparelho')}.click()`);
 await pagina.esperar(`window.__push.puts.length === 1`);
 assert.equal(await pagina.avaliar(`window.__push.desinscrito`), 1, 'a assinatura antiga foi cancelada');
 assert.deepEqual(await pagina.avaliar(`window.__push.opcoes`), { userVisibleOnly: true, bytes: 65 }, 'e uma nova foi feita com a chave atual');
 semExcecoes();
 await desfazer?.();
});

test('configurações → Integrações → Google: explica o que falta, conecta, mostra a conta e desconecta', { skip: PULAR }, async () => {
 const textoDoBloco = () => pagina.avaliar(`document.querySelector('#settings-body .cfg-google').textContent`);
 const abrir = async estado => {
  await pagina.avaliar(`try { sessionStorage.removeItem('__gdisc'); } catch {}`);
  const d = await pagina.injetar(COM_GOOGLE(estado));
  await pagina.tela(1280, 900);
  await pagina.ir(origem + '/');
  await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
  await ABRIR_SECAO('integracoes');
  await pagina.esperar(`document.querySelector('#settings-body .cfg-google .cfg-linha-texto strong')`, { descricao: 'bloco do Google' });
  return d;
 };
 let d = await abrir({ cliente: true, chave: true, migracao: false, disponivel: false, conectado: false });
 assert.match(await textoDoBloco(), /Indisponível/); assert.match(await textoDoBloco(), /migração 049/);
 await d?.();
 d = await abrir({ cliente: false, chave: false, migracao: true, disponivel: false, conectado: false });
 assert.match(await textoDoBloco(), /Incompleto/); assert.match(await textoDoBloco(), /GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET e CORE_SECRETS_KEY/);
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body .cfg-google button').length`), 0);
 await d?.();
 // pronto e não conectada: o botão pede o endereço e navega; na volta (google=ok) a tela avisa
 d = await abrir({ cliente: true, chave: true, migracao: true, disponivel: true, conectado: false });
 assert.match(await textoDoBloco(), /Não conectada/);
 await pagina.avaliar(`[...document.querySelectorAll('#settings-body .cfg-google button')].find(b => b.textContent === 'Conectar conta Google').click()`);
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelector('#settings-body .cfg-google .config-aviso')?.textContent.includes('Conta Google conectada')`, { descricao: 'aviso de retorno do Google' });
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-titulo-secao').textContent`), 'Integrações', 'a volta abre a seção certa');
 assert.ok(!(await pagina.avaliar(`location.search`)).includes('google'), 'o código sai da barra de endereço');
 await d?.();
 // conectada: mostra o e-mail e desconecta
 d = await abrir({ cliente: true, chave: true, migracao: true, disponivel: true, conectado: true, email: 'eu@exemplo.test' });
 assert.match(await textoDoBloco(), /Conectada como eu@exemplo\.test/);
 assert.ok(!(await textoDoBloco()).includes('token'), 'nenhum token na tela');
 await pagina.avaliar(`[...document.querySelectorAll('#settings-body .cfg-google button')].find(b => b.textContent === 'Desconectar').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-google')?.textContent.includes('Não conectada')`, { descricao: 'depois de desconectar volta a oferecer conectar' });
 assert.ok(!(await textoDoBloco()).includes('eu@exemplo.test'));
 semExcecoes();
 await d?.();
});

test('configurações → Agenda: a opção de Meet automático é guardada neste navegador', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-meet-auto'); } catch {}`);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await ABRIR_SECAO('agenda');
 await pagina.esperar(`document.querySelector('#settings-body input[name=meet-auto]')`);
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body input[name=meet-auto]').checked`), false);
 await pagina.avaliar(`document.querySelector('#settings-body input[name=meet-auto]').click()`);
 assert.equal(await pagina.avaliar(`localStorage.getItem('tzolkin-agenda-meet-auto')`), '1');
 await pagina.avaliar(`document.querySelector('#settings-body input[name=meet-auto]').click()`);
 assert.equal(await pagina.avaliar(`localStorage.getItem('tzolkin-agenda-meet-auto')`), null, 'desligar apaga a chave');
 semExcecoes();
 await desfazer?.();
});

test('configurações → Agenda sem a migração 048 explica; Notificações aponta para o padrão da agenda; Teclado lista os atalhos', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await pagina.avaliar(`window.__push.lembretes = false`);
 await ABRIR_SECAO('agenda');
 await pagina.esperar(`document.querySelector('#settings-body .cfg-conteudo').textContent.includes('migração 048')`);
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body .config-chip').length`), 0, 'sem a 048 não há caixas de lembrete');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body .cfg-seletor').length`), 2, 'o que é do navegador segue disponível');
 // Notificações → botão leva para a Agenda
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=notificacoes]').click()`);
 await pagina.esperar(`[...document.querySelectorAll('#settings-body button')].find(b => b.textContent === 'Escolher o lembrete padrão')`);
 await pagina.avaliar(`[...document.querySelectorAll('#settings-body button')].find(b => b.textContent === 'Escolher o lembrete padrão').click()`);
 await pagina.esperar(`document.querySelector('#settings-body .cfg-titulo-secao').textContent === 'Agenda'`);
 // Teclado
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-item[data-secao=teclado]').click()`);
 await pagina.esperar(`document.querySelectorAll('#settings-body .cfg-atalhos kbd').length > 8`);
 const texto = await pagina.avaliar(`document.querySelector('#settings-body .cfg-atalhos').textContent`);
 assert.ok(texto.includes('Nova atividade') && texto.includes('Desfazer a última mudança de horário'));
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-escopo').textContent`), 'Só neste navegador');
 semExcecoes();
 await desfazer?.();
});

const COM_INTEGRACOES = `(() => {
 window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
 const itens = [
  { id: 'google-login', nome: 'Login com Google', grupo: 'Acesso', para: 'Quem entra no Core.', estado: 'configurado', faltando: [], opcionais_ausentes: [], tela: null },
  { id: 'stripe', nome: 'Stripe', grupo: 'Cobrança', para: 'Cobranças.', estado: 'configurado', faltando: [], opcionais_ausentes: ['STRIPE_WEBHOOK_SECRET'], tela: 'finance' },
  { id: 'asaas', nome: 'Asaas', grupo: 'Cobrança', para: 'Cobranças pelo Asaas.', estado: 'nao_configurado', faltando: ['ASAAS_API_KEY'], opcionais_ausentes: [], tela: 'finance' },
  { id: 'meta', nome: 'Meta (anúncios)', grupo: 'Marketing', para: 'Campanhas.', estado: 'configurado', faltando: [], opcionais_ausentes: [], tela: null, conta: { conectada: false } },
  { id: 'vercel', nome: 'Vercel', grupo: 'Tecnologia', para: 'Deploys.', estado: 'configurado', faltando: [], opcionais_ausentes: [], tela: 'vercel' },
  { id: 'easypanel', nome: 'EasyPanel', grupo: 'Tecnologia', para: 'Serviços.', estado: 'parcial', faltando: ['EASYPANEL_TOKEN'], opcionais_ausentes: [], tela: 'easypanel' },
  { id: 'push', nome: 'Notificações push', grupo: 'Avisos', para: 'Avisos.', estado: 'nao_configurado', faltando: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'], opcionais_ausentes: [], tela: null },
 ];
 window.fetch = async (url, opcoes = {}) => {
  if (String(url) === '/api/integrations/status') return new Response(JSON.stringify({ integracoes: itens }), { status: 200, headers: { 'content-type': 'application/json' } });
  return window.__fetchOriginal(url, opcoes);
 };
})()`;

test('configurações → Integrações: estado de cada serviço, o que falta e atalho para a tela de operação', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_INTEGRACOES);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await ABRIR_SECAO('integracoes');
 await pagina.esperar(`document.querySelectorAll('#settings-body .cfg-integracao').length === 7`, { descricao: 'sete integrações' });
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-escopo').textContent`), 'Todo o espaço');
 assert.equal(await pagina.avaliar(`document.querySelector('#settings-body .cfg-resumo').textContent`), '4 de 7 integrações ligadas.');
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .cfg-grupo-integracao h3')].map(h => h.textContent)`), ['Google Agenda e Meet', 'Acesso', 'Cobrança', 'Marketing', 'Tecnologia', 'Avisos']);
 const linha = id => pagina.avaliar(`(() => { const c = document.querySelector('#settings-body .cfg-integracao[data-integracao=${id}]'); return { estado: c.dataset.estado, selo: c.querySelector('.status').textContent, texto: c.textContent, botao: !!c.querySelector('button') }; })()`);
 const asaas = await linha('asaas');
 assert.equal(asaas.selo, 'Não configurado'); assert.match(asaas.texto, /Falta definir no EasyPanel: ASAAS_API_KEY\./); assert.equal(asaas.botao, true);
 const ep = await linha('easypanel');
 assert.equal(ep.selo, 'Incompleto'); assert.match(ep.texto, /EASYPANEL_TOKEN/);
 assert.match((await linha('stripe')).texto, /Opcional, ainda não definido: STRIPE_WEBHOOK_SECRET/);
 assert.match((await linha('meta')).texto, /Nenhuma conta conectada ainda/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .cfg-integracao[data-integracao=push] button')].some(b => b.textContent === 'Abrir')`), false, 'sem tela de operação, sem botão Abrir');
 assert.match(await pagina.avaliar(`document.querySelector('#settings-body .cfg-nota:last-child').textContent`), /nunca aparecem aqui/);
 // "Abrir" leva para a tela de operação
 await pagina.avaliar(`document.querySelector('#settings-body .cfg-integracao[data-integracao=vercel] button').click()`);
 await pagina.esperar(`!document.getElementById('view-vercel').hidden`, { descricao: 'tela Vercel aberta' });
 assert.equal(await pagina.avaliar(`document.getElementById('page-title').textContent.trim()`), 'Vercel');
 semExcecoes();
 await desfazer?.();
});

test('configurações: ligar, escolher assuntos, testar e desligar as notificações deste aparelho', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await IR_PARA_CONFIG();
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .config-sub')].map(h => h.textContent)`), ['Neste aparelho', 'Quando avisar']);
 // ainda não assinado: só o botão de ativar
 assert.ok(await pagina.avaliar(`!!${BOTAO_CONFIG('Ativar neste aparelho')}`));
 assert.ok(await pagina.avaliar(`!${BOTAO_CONFIG('Enviar teste')}`));
 await pagina.avaliar(`${BOTAO_CONFIG('Ativar neste aparelho')}.click()`);
 await pagina.esperar(`window.__push.puts.length === 1`, { descricao: 'assinatura enviada' });
 const p = await pagina.avaliar(`window.__push`);
 assert.equal(p.pedidos, 1); assert.deepEqual(p.opcoes, { userVisibleOnly: true, bytes: 65 }, 'chave VAPID decodificada em 65 bytes');
 assert.deepEqual(p.puts[0].topics, ['commercial.lead', 'agenda.lembrete']);
 assert.equal(p.puts[0].subscription.endpoint, 'https://push.exemplo.test/abc');
 await pagina.esperar(`${BOTAO_CONFIG('Desativar neste aparelho')}`, { descricao: 'tela passa a oferecer desativar' });
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#settings-body .config-opcao input[type=checkbox]')].map(c => c.checked)`), [true, true]);
 // desligar um assunto manda a lista nova; desligar os dois é recusado na tela
 await pagina.avaliar(`document.querySelectorAll('#settings-body .config-opcao input[type=checkbox]')[0].click()`);
 await pagina.esperar(`window.__push.puts.length === 2`);
 assert.deepEqual(await pagina.avaliar(`window.__push.puts[1].topics`), ['agenda.lembrete']);
 await pagina.avaliar(`document.querySelectorAll('#settings-body .config-opcao input[type=checkbox]')[1].click()`);
 await pagina.esperar(`document.querySelector('#settings-body .config-aviso').textContent.includes('pelo menos um')`);
 assert.equal(await pagina.avaliar(`window.__push.puts.length`), 2, 'nada foi enviado');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#settings-body .config-opcao input[type=checkbox]')[1].checked`), true, 'o último assunto volta marcado');
 // teste
 await pagina.avaliar(`${BOTAO_CONFIG('Enviar teste')}.click()`);
 await pagina.esperar(`window.__push.testes === 1 && document.querySelector('#settings-body .config-aviso').textContent.includes('Teste enviado')`);
 // desativar
 await pagina.avaliar(`${BOTAO_CONFIG('Desativar neste aparelho')}.click()`);
 await pagina.esperar(`window.__push.deletes.length === 1 && ${BOTAO_CONFIG('Ativar neste aparelho')}`);
 assert.equal(await pagina.avaliar(`window.__push.desinscrito`), 1, 'o navegador também cancelou a assinatura');
 semExcecoes();
 await desfazer?.();
});

test('configurações: explica por que não dá para ligar (servidor sem chaves, permissão bloqueada) e a agenda sem a 048', { skip: PULAR }, async () => {
 const desfazer = await pagina.injetar(COM_PUSH);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 const texto = () => pagina.avaliar(`document.querySelector('#settings-body .config-notif').textContent`);
 await pagina.avaliar(`window.__push.habilitado = false; window.__push.lembretes = false`);
 await IR_PARA_CONFIG();
 assert.match(await texto(), /faltam as chaves VAPID/);
 assert.ok(await pagina.avaliar(`!${BOTAO_CONFIG('Ativar neste aparelho')}`), 'sem chaves não oferece o botão');
 await pagina.avaliar(`window.__push.habilitado = true; window.__push.permissao = 'denied'; window.__push.lembretes = true; document.getElementById('open-settings').click()`);
 await pagina.avaliar(`(() => { const b = [...document.querySelectorAll('nav button')].find(n => n.textContent.includes('Visão geral')); b?.click(); })()`);
 await IR_PARA_CONFIG();
 await pagina.esperar(`document.querySelector('#settings-body .config-notif').textContent.includes('bloqueadas neste navegador')`, { descricao: 'aviso de permissão bloqueada' });
 assert.ok(await pagina.avaliar(`!${BOTAO_CONFIG('Ativar neste aparelho')}`));
 semExcecoes();
 await desfazer?.();
});

test('capturas: notificações em Configurações e o formulário com lembrete e repetição, claro e escuro, desktop e celular', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 const LER = `(() => {
  const canais = c => c.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const luz = c => { const [r, g, b] = canais(c).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const razao = (a, b) => { const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const fundoDe = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(.*, 0\\)|transparent/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  const ruins = [];
  for (const el of document.querySelectorAll('#view-tracking *, #view-settings *')) {
   if (!el.offsetParent || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
   let c; try { c = razao(getComputedStyle(el).color, fundoDe(el)); } catch (e) { ruins.push('ERRO ' + getComputedStyle(el).color + ' | ' + fundoDe(el) + ' .' + el.className); continue; }
   if (c < 4.5) ruins.push(c + ' "' + el.textContent.trim().slice(0, 30) + '" .' + String(el.className).split(' ')[0]);
  }
  return { ruins: ruins.slice(0, 8), estouro: document.documentElement.scrollWidth - document.documentElement.clientWidth };
 })()`;
 const sufixo = e => (e === 'dark' ? 'Escuro' : 'Claro');
 const nomeTela = (largura) => (largura < 500 ? 'celular' : 'desktop');
 for (const [larg, alt] of [[1280, 900], [390, 844]]) {
  let desfazer = await pagina.injetar(COM_PUSH);
  await pagina.tela(larg, alt);
  await pagina.ir(origem + '/');
  await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
  await IR_PARA_CONFIG();
  await pagina.avaliar(`${BOTAO_CONFIG('Ativar neste aparelho')}.click()`);
  await pagina.esperar(`${BOTAO_CONFIG('Desativar neste aparelho')}`);
  for (const esquema of ['light', 'dark']) {
   await pagina.esquema(esquema);
   await pagina.esperar(`document.documentElement.dataset.theme === '${esquema}'`);
   await new Promise(r => setTimeout(r, 400));
   const l = await pagina.avaliar(LER);
   assert.ok(l.estouro <= 0, `${nomeTela(larg)} / ${esquema}: rolagem horizontal de ${l.estouro}px`);
   assert.deepEqual(l.ruins, [], `${nomeTela(larg)} / ${esquema}: texto abaixo de 4,5:1`);
   await pagina.imagem(join(ARTEFATOS, `1010-Config-notificacoes-${nomeTela(larg)}-${sufixo(esquema)}.png`));
  }
  await desfazer?.();
  desfazer = await pagina.injetar(COM_AGENDA(eventosDaSemana()));
  await pagina.ir(origem + '/');
  await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
  await IR_PARA_AGENDA();
  await pagina.avaliar(`${NO_AGENDA}.lembretes = true`);
  await RECARREGAR_AGENDA();
  await ABRIR_NOVA();
  await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Repete'), 'weekly'));
  await pagina.avaliar(DEFINIR(CAMPO_DO_FORM('Avisar'), 'proprio'));
  for (const esquema of ['light', 'dark']) {
   await pagina.esquema(esquema);
   await pagina.esperar(`document.documentElement.dataset.theme === '${esquema}'`);
   await new Promise(r => setTimeout(r, 400));
   await pagina.avaliar(`document.querySelector('dialog.tracking-editor .ag-repetir').scrollIntoView({ block: 'center' })`);
   await new Promise(r => setTimeout(r, 200));
   const l = await pagina.avaliar(LER);
   assert.deepEqual(l.ruins, [], `${nomeTela(larg)} / ${esquema}: formulário com texto abaixo de 4,5:1`);
   await pagina.imagem(join(ARTEFATOS, `1011-Agenda-repetir-${nomeTela(larg)}-${sufixo(esquema)}.png`));
  }
  await FECHAR_TUDO();
  await desfazer?.();
 }
 await pagina.tela(1280, 900);
 await pagina.esquema('light');
 semExcecoes();
});

test('capturas: a agenda (semana, dia, mês, agenda, painel e formulário) em claro e escuro, desktop e celular', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 const sufixo = e => (e === 'dark' ? 'Escuro' : 'Claro');
 const desfazer = await pagina.injetar(COM_AGENDA(eventosDaSemana()));
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-visao'); } catch {}`);
 await pagina.tela(1280, 900);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden && document.querySelectorAll('nav button').length > 5`);
 await IR_PARA_AGENDA();
 for (const esquema of ['light', 'dark']) {
  await pagina.esquema(esquema);
  await pagina.esperar(`document.documentElement.dataset.theme === '${esquema}'`);
  for (const visao of ['semana', 'dia', 'mes', 'agenda']) {
   await pagina.avaliar(`${BOTAO_VISAO(visao)}.click()`);
   await pagina.esperar(`${VISOES_ESPERAM(visao)} && !document.querySelector('#view-tracking [aria-busy]')`);
   await new Promise(r => setTimeout(r, 500));
   await pagina.imagem(join(ARTEFATOS, `1000-Agenda-${visao}-${sufixo(esquema)}.png`));
  }
  await pagina.avaliar(`${BOTAO_VISAO('semana')}.click()`);
  await pagina.esperar(`${VISOES_ESPERAM('semana')} && document.querySelectorAll('#view-tracking .ag-evento').length >= 6`);
  await pagina.avaliar(`document.querySelector('#view-tracking .ag-evento[data-id="00000000-0000-4000-8000-000000000003"]').click()`);
  await pagina.esperar(PAINEL_ABERTO);
  await new Promise(r => setTimeout(r, 400));
  await pagina.imagem(join(ARTEFATOS, `1001-Agenda-painel-${sufixo(esquema)}.png`));
  await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await pagina.avaliar(`document.querySelector('#view-tracking .ag-acoes .primary').click()`);
  await pagina.esperar(`document.querySelector('dialog.tracking-editor[open]')`);
  await new Promise(r => setTimeout(r, 300));
  await pagina.imagem(join(ARTEFATOS, `1002-Agenda-formulario-${sufixo(esquema)}.png`));
  await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
  await pagina.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))`);
  await pagina.esperar(`document.querySelector('dialog.ag-atalhos[open]')`);
  await new Promise(r => setTimeout(r, 300));
  await pagina.imagem(join(ARTEFATOS, `1004-Agenda-atalhos-${sufixo(esquema)}.png`));
  await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 }
 await pagina.tela(390, 844);
 for (const esquema of ['light', 'dark']) {
  await pagina.esquema(esquema);
  await pagina.esperar(`document.documentElement.dataset.theme === '${esquema}'`);
  for (const visao of ['dia', 'agenda', 'mes']) {
   await pagina.avaliar(`${BOTAO_VISAO(visao)}.click()`);
   await pagina.esperar(`${VISOES_ESPERAM(visao)} && !document.querySelector('#view-tracking [aria-busy]')`);
   await new Promise(r => setTimeout(r, 500));
   await pagina.imagem(join(ARTEFATOS, `1003-Agenda-celular-${visao}-${sufixo(esquema)}.png`));
  }
 }
 await pagina.esquema('light');
 await pagina.tela(1280, 900);
 await desfazer();
 await pagina.avaliar(`try { localStorage.removeItem('tzolkin-agenda-visao'); } catch {}`);
 await pagina.ir(origem + '/');
 await pagina.esperar(`!document.getElementById('workspace').hidden`);
 semExcecoes();
});

test('capturas: modo escuro nas telas principais', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`);
 await pagina.tela(1280, 800);
 for (const [tela, arquivo] of [['Clientes', '970-Escuro-Clientes.png'], ['Empresas', '971-Escuro-Empresas.png'], ['Pessoas', '972-Escuro-Pessoas.png'], ['Financeiro', '973-Escuro-Financeiro.png'], ['Visão geral', '974-Escuro-VisaoGeral.png']]) {
  await pagina.avaliar(CLICAR_NO_MENU(tela));
  await new Promise(r => setTimeout(r, 500));
  await pagina.imagem(join(ARTEFATOS, arquivo));
 }
 await pagina.avaliar(`document.getElementById('open-settings').click()`);
 await new Promise(r => setTimeout(r, 300));
 await pagina.imagem(join(ARTEFATOS, '975-Escuro-Configuracoes.png'));
 await pagina.esquema('light');
 semExcecoes();
});

test('capturas: modo escuro nos formulários e diálogos', { skip: PULAR || !process.env.UI_SCREENSHOTS }, async () => {
 await pagina.esquema('dark');
 await pagina.esperar(`document.documentElement.dataset.theme === 'dark'`);
 await pagina.tela(1280, 900);
 for (const [tela, arquivo] of [['Portfólio', '977-Escuro-Portfolio.png'], ['Serviços', '978-Escuro-Servicos.png'], ['Acompanhamento', '979-Escuro-Acompanhamento.png'], ['Conexões', '980-Escuro-Conexoes.png'], ['Vercel', '981-Escuro-Vercel.png'], ['DNS', '982-Escuro-DNS.png'], ['Banco de dados', '983-Escuro-Banco.png'], ['Inbound', '984-Escuro-Inbound.png']]) {
  await pagina.avaliar(CLICAR_NO_MENU(tela));
  await new Promise(r => setTimeout(r, 500));
  await pagina.imagem(join(ARTEFATOS, arquivo));
 }
 for (const id of ['tenant-dialog', 'stakeholder-dialog', 'engagement-dialog', 'space-dialog', 'member-dialog']) {
  await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.getElementById('${id}').showModal()`);
  await new Promise(r => setTimeout(r, 250));
  await pagina.imagem(join(ARTEFATOS, `976-Escuro-${id}.png`));
 }
 await pagina.avaliar(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
 await pagina.esquema('light');
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
