// O contrato da descrição da atividade: editor, ficha e Markdown falam dos MESMOS tipos de bloco.
//
// Este é o guarda do defeito que o dono relatou ("listas e outros tipos de linhas .md quebram e ficam
// desformatados na ficha"). A causa não era um conversor errado: era não existir contrato. Cada camada
// tinha a sua lista privada de tipos — o editor registrava nove ferramentas de bloco, a ficha desenhava
// nove, e a ponte de Markdown só sabia construir quatro — e nada comparava as três. Então toda
// ferramenta nova no editor virava, em silêncio, um bloco que o bot não sabia mandar nem ler e que a
// ficha não sabia desenhar.
//
// Por isso nenhuma lista é copiada para cá. As três vêm do próprio código:
//  1. `FERRAMENTAS_DE_BLOCO` + `BLOCO_EMBUTIDO`, lidos do fonte de apps/web/public/agenda-evento.js
//     (o módulo importa de esm.sh, não dá para carregar fora do navegador — mesma técnica do guarda
//     de ícones em icons-registry.test.mjs);
//  2. `DESENHOS`, importado de apps/web/public/agenda-descricao.js com um DOM de mentira;
//  3. `BLOCOS`, importado de apps/api/src/platform/markdown-editorjs.mjs.
// Registrar ferramenta no editor sem ensinar a ficha e o conversor quebra o primeiro teste daqui.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCOS, INLINE, inlineParaHtml, inlineParaMarkdown, markdownParaEditorJs, editorJsParaMarkdown } from '../../apps/api/src/platform/markdown-editorjs.mjs';

// DOM de mentira, só o que a ficha usa. O parser devolve o texto do HTML inline — basta para provar
// que o bloco desenhou algo legível, que é o que o teste pergunta.
class Falso {
 constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.className = ''; this.style = {}; }
 append(...nos) { this.children.push(...nos); }
 addEventListener() {}
}
const semTags = html => String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
 .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
globalThis.document = { createElement: tag => new Falso(tag), createTextNode: texto => ({ tag: '#texto', textContent: texto, children: [] }) };
globalThis.DOMParser = class {
 parseFromString(html) {
  const t = semTags(html ?? '');
  return { body: { childNodes: t ? [{ tag: '#texto', textContent: t, children: [] }] : [] } };
 }
};
const { DESENHOS, renderDescricao, paraOEditor } = await import('../../apps/web/public/agenda-descricao.js');

const texto = no => (no ? [no.textContent || '', ...(no.children || []).map(texto)].join(' ').replace(/\s+/g, ' ').trim() : '');
const tags = no => (no ? [no.tag, ...(no.children || []).flatMap(tags)].filter(t => t !== '#texto') : []);

const EVENTO = readFileSync(new URL('../../apps/web/public/agenda-evento.js', import.meta.url), 'utf8');
/** Chaves do primeiro nível de um objeto literal do fonte (uma chave por linha, a dois espaços). */
const chavesDoFonte = nome => {
 const corpo = EVENTO.match(new RegExp(`const ${nome} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
 assert.ok(corpo, `não achei ${nome} no fonte de agenda-evento.js — o guarda estaria conferindo nada`);
 return [...corpo.matchAll(/^ {2}([A-Za-z_]\w*):/gm)].map(m => m[1]).sort();
};
const embutido = EVENTO.match(/const BLOCO_EMBUTIDO = '([a-z]+)'/)?.[1];

test('o editor, a ficha e a ponte de Markdown conhecem exatamente os mesmos tipos de bloco', () => {
 assert.ok(embutido, 'não achei BLOCO_EMBUTIDO no fonte de agenda-evento.js');
 const doEditor = [...chavesDoFonte('FERRAMENTAS_DE_BLOCO'), embutido].sort();
 const daFicha = Object.keys(DESENHOS).sort();
 const doMarkdown = Object.keys(BLOCOS).sort();
 // Leitura sã: sem isto, um regex que não casa nada faria os três conjuntos vazios coincidirem.
 assert.ok(doEditor.length >= 9, `só ${doEditor.length} ferramentas de bloco lidas do fonte`);
 assert.deepEqual(daFicha, doEditor, 'a ficha (DESENHOS) e o editor (FERRAMENTAS_DE_BLOCO) divergem');
 assert.deepEqual(doMarkdown, doEditor, 'a ponte de Markdown (BLOCOS) e o editor divergem');
});

test('as marcas inline do editor têm par no Markdown, e o par volta igual nos dois sentidos', () => {
 const doEditor = chavesDoFonte('FERRAMENTAS_INLINE');
 assert.ok(doEditor.length >= 1, 'não li ferramenta inline nenhuma do fonte');
 for (const nome of doEditor) assert.ok(INLINE[nome], `a ferramenta inline "${nome}" não tem par em INLINE`);
 for (const [nome, { markdown, html }] of Object.entries(INLINE)) {
  assert.equal(inlineParaHtml(markdown), html, `${nome}: o Markdown do bot não virou a marca do editor`);
  assert.equal(inlineParaMarkdown(html), markdown, `${nome}: a marca do editor não voltou ao Markdown`);
 }
});

test('todo tipo de bloco vai para o Markdown e volta sem perder o tipo', () => {
 for (const [tipo, bloco] of Object.entries(BLOCOS)) {
  const md = String(bloco.paraMarkdown(bloco.exemplo));
  assert.ok(md.trim(), `${tipo}: o exemplo virou Markdown vazio — o bloco desapareceria para o bot`);
  assert.ok(!md.includes('{"'), `${tipo}: vazou JSON no Markdown`);
  const json = markdownParaEditorJs(md);
  assert.ok(json, `${tipo}: o Markdown ${JSON.stringify(md)} não produziu bloco nenhum`);
  const tipos = JSON.parse(json).blocks.map(b => b.type);
  assert.deepEqual(tipos, [tipo], `${tipo}: o Markdown ${JSON.stringify(md)} voltou como ${tipos.join(',') || '(nada)'}`);
  assert.equal(editorJsParaMarkdown(json), md, `${tipo}: a ida e volta mudou o Markdown`);
 }
});

test('a ficha desenha todo tipo de bloco, nenhum vazio e nenhum em JSON cru', () => {
 for (const [tipo, bloco] of Object.entries(BLOCOS)) {
  const no = renderDescricao(JSON.stringify({ blocks: [{ type: tipo, data: bloco.exemplo }] }));
  assert.ok(no, `${tipo}: a ficha não desenhou nada`);
  assert.ok(!texto(no).includes('{"'), `${tipo}: a ficha mostrou JSON cru`);
  // A divisória é a única sem texto: ela É uma linha.
  if (tipo === 'delimiter') assert.ok(tags(no).includes('hr'), 'a divisória não virou <hr>');
  else assert.ok(texto(no), `${tipo}: a ficha desenhou um bloco vazio`);
 }
});

test('bloco de tipo desconhecido mostra o texto na ficha e no Markdown, nunca vazio nem JSON', () => {
 // `attaches` é uma ferramenta que o editor ainda não tem: o caminho honesto do dia em que tiver.
 const raw = JSON.stringify({ blocks: [{ type: 'attaches', data: { title: 'Contrato assinado', file: { name: 'contrato.pdf', size: 12345 } } }] });
 const t = texto(renderDescricao(raw));
 assert.match(t, /Contrato assinado/);
 assert.match(t, /contrato\.pdf/);
 assert.match(t, /attaches/, 'a ficha não diz qual tipo ficou sem desenho');
 assert.ok(!t.includes('{"'), 'a ficha mostrou JSON cru');
 assert.equal(editorJsParaMarkdown(raw), 'Contrato assinado contrato.pdf');
});

test('texto legado (sem blocos) continua aparecendo como texto, na ficha e na volta ao bot', () => {
 assert.equal(texto(renderDescricao('anotação antiga em texto puro')), 'anotação antiga em texto puro');
 assert.equal(renderDescricao(''), null);
 assert.equal(editorJsParaMarkdown('anotação antiga em texto puro'), 'anotação antiga em texto puro');
});

test('lista aninhada chega plana ao editor, porque a ferramenta de lista é plana', () => {
 // Sem este achatamento o @editorjs/list@1.9.0 desenharia o carimbo de objeto virado texto e a gravação seguinte
 // apagaria o texto do item — é o que torna seguro a ficha e o bot guardarem o aninhamento.
 const dados = JSON.parse(markdownParaEditorJs('- pai\n  - filho\n    - neto\n- irmão'));
 assert.deepEqual(dados.blocks[0].data.items, [{ content: 'pai', items: [{ content: 'filho', items: ['neto'] }] }, 'irmão']);
 assert.deepEqual(paraOEditor(dados).blocks[0].data.items, ['pai', 'filho', 'neto', 'irmão']);
 assert.deepEqual(tags(renderDescricao(JSON.stringify(dados))), ['div', 'ul', 'li', 'ul', 'li', 'ul', 'li', 'li']);
});
