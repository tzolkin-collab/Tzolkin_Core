// A ponte Markdown <-> Editor.js mora em apps/web/public/markdown-editorjs.js, porque a ficha (no navegador) também precisa dela:
// descrição gravada como Markdown em texto puro é convertida em blocos na hora de desenhar. Uma fonte só, em vez de uma cópia por lado.
// A API continua importando daqui; o contrato (BLOCOS, INLINE) e os testes não mudaram de endereço.
export * from '../../../web/public/markdown-editorjs.js';
