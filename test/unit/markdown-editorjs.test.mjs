import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownParaEditorJs, editorJsParaMarkdown } from '../../apps/api/src/platform/markdown-editorjs.mjs';

test('Markdown do bot vira blocos do Editor.js que a tela renderiza', () => {
 const data = JSON.parse(markdownParaEditorJs('## Pauta\n\nTexto com **negrito** e [link](https://exemplo.com)\n\n- [x] Feito\n- [ ] Pendente\n\n- item A\n- item B\n\n1. um\n2. dois'));
 assert.deepEqual(data.blocks.map(b => b.type), ['header', 'paragraph', 'checklist', 'list', 'list']);
 assert.equal(data.blocks[0].data.level, 2);
 assert.equal(data.blocks[1].data.text, 'Texto com <b>negrito</b> e <a href="https://exemplo.com">link</a>');
 assert.deepEqual(data.blocks[2].data.items, [{ text: 'Feito', checked: true }, { text: 'Pendente', checked: false }]);
 assert.equal(data.blocks[3].data.style, 'unordered');
 assert.equal(data.blocks[4].data.style, 'ordered');
});

test('Markdown: HTML do bot é escapado (a tela transforma o texto em DOM)', () => {
 const data = JSON.parse(markdownParaEditorJs('<img src=x onerror=alert(1)>'));
 assert.equal(data.blocks[0].data.text, '&lt;img src=x onerror=alert(1)&gt;');
});

test('Markdown vazio vira null; texto que já é Editor.js não é reconvertido pela volta', () => {
 assert.equal(markdownParaEditorJs('  \n '), null);
 assert.equal(editorJsParaMarkdown('texto puro legado'), 'texto puro legado');
 assert.equal(editorJsParaMarkdown('{"nao":"editor"}'), '{"nao":"editor"}');
 assert.equal(editorJsParaMarkdown(null), null);
});

test('Editor.js da tela volta ao bot como Markdown e sobrevive à ida e volta', () => {
 const daTela = JSON.stringify({ blocks: [
  { type: 'header', data: { text: 'Decisões', level: 2 } },
  { type: 'paragraph', data: { text: 'Fechamos <b>escopo</b>&nbsp;v1' } },
  { type: 'checklist', data: { items: [{ text: 'Enviar proposta', checked: false }, { text: 'Assinar', checked: true }] } },
  { type: 'list', data: { style: 'ordered', items: ['a', 'b'] } },
 ] });
 const md = editorJsParaMarkdown(daTela);
 assert.equal(md, '## Decisões\n\nFechamos **escopo** v1\n\n- [ ] Enviar proposta\n- [x] Assinar\n\n1. a\n2. b');
 assert.equal(editorJsParaMarkdown(markdownParaEditorJs(md)), md);
});
