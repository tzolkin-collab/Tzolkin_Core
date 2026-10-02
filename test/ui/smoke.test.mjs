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
import { SENHA, EMPRESA, PESSOA_FISICA, PNG_1X1, bancoFalso, r2Falso } from './fixtures.mjs';

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

test('Clientes: grupos por situação, ação própria e cartão clicável (Empresas e Pessoas seguem telas irmãs)', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Clientes'));
 await pagina.esperar(`document.querySelectorAll('#tenants .client-card').length === 3`, { descricao: 'três clientes' });
 assert.equal(await pagina.avaliar(`document.getElementById('page-title').textContent.trim()`), 'Clientes');
 assert.equal(await pagina.avaliar(`document.getElementById('new-record-label').textContent.trim()`), 'Novo cliente');
 // os encerrados ficam rotulados e depois dos ativos
 const grupos = await pagina.avaliar(`[...document.querySelectorAll('#tenants .client-group-label')].map(g => g.textContent.trim())`);
 assert.deepEqual(grupos, ['Ativos e em implantação · 2', 'Encerrados · 1']);
 // sem botão "Abrir cliente →" repetido: o cartão inteiro é o alvo
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-clients button')].filter(b => /Abrir (cliente|organização)/.test(b.textContent)).length`), 0);
 // Empresas e Pessoas continuam sendo telas próprias, com a ação de cada uma
 for (const [tela, acao] of [['Empresas', 'Nova empresa'], ['Pessoas', 'Nova pessoa']]) {
  await pagina.avaliar(CLICAR_NO_MENU(tela));
  await pagina.esperar(`document.getElementById('page-title').textContent.trim() === ${JSON.stringify(tela)}`);
  assert.equal(await pagina.avaliar(`document.getElementById('new-record-label').textContent.trim()`), acao);
 }
 await pagina.avaliar(CLICAR_NO_MENU('Clientes'));
 await pagina.esperar(`document.querySelectorAll('#tenants .client-card').length === 3`);
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
 await pagina.esperar(`[...document.querySelectorAll('#inbound-panel-leads button')].some(b => b.textContent === 'Abrir detalhe')`, { descricao: 'lead listado' });
 await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads button')].find(b => b.textContent === 'Abrir detalhe').click()`);
 await pagina.esperar(`document.querySelector('#inbound-panel-leads .funnel-panel')`, { descricao: 'painel do funil' });
 const botoes = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .funnel-panel button')].map(b => b.textContent)`);
 assert.deepEqual(botoes, ['Mover', 'Qualificar (vira oportunidade)', 'Descartar']);
 // Um select sem opção vazia precisa vir com a primeira marcada: vazio iria para a API como valor em branco.
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .funnel-panel select')].every(s => s.value !== '')`), true, 'select sem nada marcado');
 assert.equal(await pagina.avaliar(`document.querySelectorAll('#inbound-panel-leads .funnel-track .funnel-chip').length`), 8);
 assert.equal(await pagina.avaliar(`document.querySelector('#inbound-panel-leads .funnel-track .funnel-chip.active').textContent`), 'Novos');
 // Tarefas do lead: a aberta (criada por automação) e a concluída, cada uma com o botão certo, e o formulário de nova.
 assert.deepEqual(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .tasks-panel .task-row')].map(r => r.querySelector('strong').textContent + '|' + r.querySelector('button').textContent + '|' + r.classList.contains('task-done'))`),
  ['Ligar para o lead|Concluir|false', 'Mandar o portfólio|Reabrir|true']);
 assert.match(await pagina.avaliar(`document.querySelector('#inbound-panel-leads .tasks-panel .task-row').innerText`), /criada por automação/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .tasks-panel form button')].map(b => b.textContent).join('|')`), 'Adicionar tarefa');
 // Dados do espaço: os campos ativos do lead aparecem com o valor guardado; o desativado com valor aparece travado.
 const campos = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .data-panel form')][0] && [...document.querySelectorAll('#inbound-panel-leads .data-panel form')][0].innerText`);
 assert.match(campos, /Porte/); assert.match(campos, /Observação/); assert.match(campos, /Campo antigo \(desativado\)/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .data-panel select')][0].value`), 'Micro');
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .data-panel label')].find(l => l.firstChild.textContent.startsWith('Campo antigo')).querySelector('input').disabled`), true);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads .data-panel form button')].map(b => b.textContent).join('|')`), 'Salvar dados — lead', 'sem oportunidade, só o grupo do lead');
 // O formulário antigo só tem o responsável quando o lead está em funil: o estágio vem do funil.
 const rotulos = await pagina.avaliar(`[...document.querySelectorAll('#inbound-panel-leads form.commercial-form > label')].map(l => l.firstChild.textContent)`);
 assert.ok(!rotulos.includes('Estágio') && rotulos.includes('Responsável comercial'), JSON.stringify(rotulos));
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
 semExcecoes();
});

test('Pessoas: o cartão mostra e-mail e telefone, ou diz que faltam; a busca acha por eles; o cadastro pede os dois', { skip: PULAR }, async () => {
 await pagina.tela(1280, 800);
 await pagina.avaliar(CLICAR_NO_MENU('Pessoas'));
 await pagina.esperar(`document.querySelectorAll('#stakeholder-directory .person-card').length === 2`, { descricao: 'duas pessoas listadas' });
 const cartao = nome => `[...document.querySelectorAll('#stakeholder-directory .person-card')].find(c => c.querySelector('h3').textContent === ${JSON.stringify(nome)})`;
 assert.equal(await pagina.avaliar(`${cartao('Ana Contato')}.querySelector('.person-contact').textContent`), 'ana@exemplo.test · 11999990000');
 assert.equal(await pagina.avaliar(`${cartao('Bruno Aluno')}.querySelector('.person-contact').textContent`), 'Sem e-mail nem telefone');
 assert.equal(await pagina.avaliar(`${cartao('Bruno Aluno')}.querySelector('.person-contact').classList.contains('person-no-contact')`), true);
 // a busca acha pelo e-mail
 await pagina.avaliar(`(() => { const i = document.getElementById('people-search'); i.value = 'ana@exemplo'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 await pagina.esperar(`document.querySelectorAll('#stakeholder-directory .person-card').length === 1`, { descricao: 'busca por e-mail' });
 await pagina.avaliar(`(() => { const i = document.getElementById('people-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
 // o cadastro tem os dois campos opcionais
 const campos = await pagina.avaliar(`[...document.querySelectorAll('#stakeholder-form label')].map(l => l.firstChild.textContent.trim()).filter(Boolean)`);
 assert.ok(campos.includes('E-mail (opcional)') && campos.includes('Telefone ou WhatsApp (opcional)'), JSON.stringify(campos));
 assert.equal(await pagina.avaliar(`document.querySelector('#stakeholder-form [name=email]').required`), false);
 semExcecoes();
});

test('ficha da empresa abre pelo cartão e traz o painel de fotos', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-clients .client-card')].find(c => c.textContent.includes('Empresa Alfa')).click()`);
 await pagina.esperar(`document.querySelector('#view-client .photo-panel .photo-zone') && !document.querySelector('#view-client .photo-panel .photo-zone').hidden`, { descricao: 'painel de fotos na ficha' });
 const ficha = await pagina.avaliar(`document.getElementById('view-client').innerText`);
 assert.match(ficha, /Empresa Alfa/);
 assert.match(ficha, /Fotos/);
 // papel e cargo iguais não se repetem: "Aluno", não "Aluno · Aluno"
 assert.doesNotMatch(ficha, /(\b\w+\b) · \1\b/);
 semExcecoes();
});

test('ficha da empresa: o histórico mostra a alteração com o antes e o depois, em português', { skip: PULAR }, async () => {
 const linhas = await pagina.avaliar(`[...document.querySelectorAll('#view-client .history-row')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())`);
 assert.equal(linhas.length, 2);
 assert.match(linhas[0], /^Empresa alterada Relacionamento: Prospect → Cliente · .* · dono@exemplo.test$/);
 assert.match(linhas[1], /^Tempo registrado .* · dono@exemplo.test$/);
 assert.equal(await pagina.avaliar(`[...document.querySelectorAll('#view-client .client-detail-panel h3')].some(h => h.textContent === 'Histórico')`), true);
 semExcecoes();
});

test('ficha da empresa: Editar empresa abre o diálogo com a classificação atual e sem a opção "interna"', { skip: PULAR }, async () => {
 await pagina.avaliar(`[...document.querySelectorAll('#view-client button')].find(b => b.textContent.trim() === 'Editar empresa').click()`);
 await pagina.esperar(`document.querySelector('dialog.tenant-edit-dialog[open]')`, { descricao: 'diálogo de edição aberto' });
 const campo = nome => `[...document.querySelectorAll('dialog.tenant-edit-dialog label')].find(l => l.firstChild.textContent === ${JSON.stringify(nome)}).querySelector('input,select')`;
 assert.equal(await pagina.avaliar(`${campo('Nome')}.value`), 'Empresa Alfa');
 assert.equal(await pagina.avaliar(`${campo('Relacionamento')}.value`), 'customer');
 assert.equal(await pagina.avaliar(`${campo('Tipo de organização')}.value`), 'company');
 assert.equal(await pagina.avaliar(`${campo('Situação')}.value`), 'active');
 assert.deepEqual(await pagina.avaliar(`[...${campo('Relacionamento')}.options].map(o => o.textContent)`), ['Cliente', 'Prospect', 'Parceiro'], 'organização comum não pode virar interna');
 assert.equal(await pagina.avaliar(`${campo('Relacionamento')}.disabled`), false);
 assert.ok((await pagina.avaliar(`document.querySelector('dialog.tenant-edit-dialog small').textContent`)).includes('O identificador (empresa-alfa) não muda'));
 await pagina.avaliar(`document.querySelector('dialog.tenant-edit-dialog .close').click()`);
 await pagina.esperar(`!document.querySelector('dialog.tenant-edit-dialog')`, { descricao: 'diálogo fechado' });
 semExcecoes();
});

test('fotos: colar uma imagem envia, aparece e fica privada; arquivo que não é imagem é recusado', { skip: PULAR }, async () => {
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
