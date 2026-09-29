// O identificador sugerido a partir do nome e o campo de tags em chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { slugDoNome, normalizarTag, mountTagInput, MAX_TAGS } from '../../apps/web/public/space-form.js';

test('slugDoNome: minúsculas, sem acento, hífens, começa com letra e cabe em 64', () => {
 assert.equal(slugDoNome('Assessoria de Marca & Design'), 'assessoria-de-marca-design');
 assert.equal(slugDoNome('  Educação Já!  '), 'educacao-ja');
 assert.equal(slugDoNome('2024 Plano'), 'plano', 'não pode começar com número');
 assert.equal(slugDoNome('---'), '');
 assert.equal(slugDoNome(''), '');
 assert.ok(slugDoNome('a'.repeat(200)).length <= 64);
 // O servidor recusa o que não casar com isto; o sugerido tem de passar.
 assert.match(slugDoNome('Consultorias e mentorias'), /^[a-z][a-z0-9-]{1,63}$/);
});

test('normalizarTag espelha o servidor', () => {
 assert.equal(normalizarTag('  Mentoria de Vendas '), 'mentoria-de-vendas');
 assert.equal(normalizarTag('Assessoria!'), 'assessoria');
 assert.equal(normalizarTag('Ação'), 'acao');
 assert.equal(normalizarTag('a'.repeat(50)).length, 30);
 assert.equal(normalizarTag('---'), '');
});

// DOM mínimo de mentira, só o que o campo usa.
class Elemento {
 constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.textContent = ''; this.value = ''; this.dataset = {}; this.attrs = {}; this.disabled = false; this.placeholder = ''; this.parent = null; }
 setAttribute(nome, valor) { this.attrs[nome] = valor; }
 append(...filhos) { for (const filho of filhos) { filho.parent = this; this.children.push(filho); } }
 insertBefore(filho, ref) { filho.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, filho); }
 remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
 querySelectorAll(seletor) { const classe = seletor.replace('.', ''); return this.children.filter(c => c.className === classe); }
 focus() { this.focused = true; }
}
globalThis.document = { createElement: tag => new Elemento(tag) };

const campo = () => {
 const box = new Elemento('div'), input = new Elemento('input'), hidden = new Elemento('input');
 input.dataset.placeholder = 'consultoria, assessoria'; box.append(input);
 const api = mountTagInput({ box, input, hidden });
 const digitar = (texto, tecla) => { input.value = texto; const e = { key: tecla, preventDefault() { this.parado = true; } }; input.onkeydown(e); return e; };
 return { box, input, hidden, api, digitar };
};

test('Enter e vírgula viram chips; o valor oculto é o que o formulário envia', () => {
 const { hidden, api, digitar, input } = campo();
 assert.equal(digitar('Consultoria', 'Enter').parado, true);
 digitar('assessoria', ',');
 assert.deepEqual(api.get(), ['consultoria', 'assessoria']);
 assert.equal(hidden.value, 'consultoria, assessoria');
 assert.equal(input.value, '', 'o campo esvazia depois de adicionar');
});

test('não repete, não aceita tag curta demais e respeita o limite', () => {
 const { api, digitar, input } = campo();
 digitar('mentoria', 'Enter'); digitar('Mentoria', 'Enter'); digitar('x', 'Enter');
 assert.deepEqual(api.get(), ['mentoria']);
 for (let i = 0; i < 12; i++) digitar(`tag${i}`, 'Enter');
 assert.equal(api.get().length, MAX_TAGS);
 assert.equal(input.disabled, true, 'no limite o campo trava');
});

test('Backspace no campo vazio remove a última; com texto, não mexe nas tags', () => {
 const { api, digitar, input } = campo();
 digitar('um', 'Enter'); digitar('dois', 'Enter');
 input.value = 'em-andamento'; input.onkeydown({ key: 'Backspace', preventDefault() {} });
 assert.equal(api.get().length, 2);
 input.value = ''; input.onkeydown({ key: 'Backspace', preventDefault() {} });
 assert.deepEqual(api.get(), ['um']);
});

test('set() normaliza, tira repetidas e corta no limite; o placeholder some quando há tags', () => {
 const { api, hidden, input } = campo();
 api.set(['Consultoria', 'consultoria', 'ASSESSORIA', 'x']);
 assert.deepEqual(api.get(), ['consultoria', 'assessoria']);
 assert.equal(hidden.value, 'consultoria, assessoria');
 assert.equal(input.placeholder, '');
 api.set([]);
 assert.equal(input.placeholder, 'consultoria, assessoria');
 assert.equal(api.get().length, 0);
});
