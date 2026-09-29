// O componente de abas (estilo Stripe) e o uso dele em Inbound.
//
// Sem navegador: um DOM mínimo de mentira basta para exercitar o que importa — os
// papéis de acessibilidade, a aba ativa, o clique e o teclado. O casamento entre os
// ids que o componente gera e os painéis do index.html é afirmado pelo fonte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class Elemento {
 constructor(tag) { this.tag = tag; this.attrs = new Map(); this.children = []; this.className = ''; this.textContent = ''; this.focused = false; this.tabIndex = 0; this.classes = new Set(); }
 setAttribute(nome, valor) { this.attrs.set(nome, String(valor)); }
 getAttribute(nome) { return this.attrs.get(nome); }
 append(...filhos) { this.children.push(...filhos); }
 replaceChildren(...filhos) { this.children = filhos; }
 focus() { this.focused = true; }
 get classList() { return { toggle: (nome, ligado) => { if (ligado) this.classes.add(nome); else this.classes.delete(nome); } }; }
}
globalThis.document = { createElement: tag => new Elemento(tag), createTextNode: texto => ({ texto }) };
const { mountTabs } = await import('../../apps/web/public/tabs.js');

const montar = (abas = [{ key: 'leads', label: 'Leads' }, { key: 'campaigns', label: 'Campanhas' }, { key: 'x', label: 'Outra' }], ativa = 'leads') => {
 const host = new Elemento('div'); host.id = 'inbound-tabs';
 const mudancas = [];
 const controle = mountTabs({ host, tabs: abas, active: ativa, onChange: chave => mudancas.push(chave), label: 'Seções de Inbound', prefix: 'inbound' });
 const lista = host.children[0], botoes = lista.children;
 return { host, lista, botoes, mudancas, controle };
};

test('desenha uma tablist com uma aba por tópico, com os papéis de acessibilidade', () => {
 const { lista, botoes } = montar();
 assert.equal(lista.getAttribute('role'), 'tablist');
 assert.equal(lista.getAttribute('aria-label'), 'Seções de Inbound');
 assert.equal(botoes.length, 3);
 for (const botao of botoes) assert.equal(botao.getAttribute('role'), 'tab');
 assert.equal(botoes[0].id, 'inbound-tab-leads');
 assert.equal(botoes[0].getAttribute('aria-controls'), 'inbound-panel-leads');
});

test('só a aba ativa está selecionada e entra na ordem de Tab', () => {
 const { botoes } = montar();
 assert.deepEqual([...botoes].map(b => b.getAttribute('aria-selected')), ['true', 'false', 'false']);
 assert.deepEqual([...botoes].map(b => b.tabIndex), [0, -1, -1]);
});

test('aba ativa desconhecida cai na primeira', () => {
 const { botoes } = montar(undefined, 'nao-existe');
 assert.equal(botoes[0].getAttribute('aria-selected'), 'true');
});

test('clicar troca a aba e avisa uma vez; clicar na ativa não avisa', () => {
 const { botoes, mudancas } = montar();
 botoes[1].onclick(); botoes[1].onclick();
 assert.deepEqual(mudancas, ['campaigns']);
 assert.deepEqual([...botoes].map(b => b.getAttribute('aria-selected')), ['false', 'true', 'false']);
});

test('setas, Home e End movem o foco e a seleção, com volta nas pontas', () => {
 const { botoes, mudancas } = montar();
 const tecla = (botao, key) => { const evento = { key, preventDefault() { this.parado = true; } }; botao.onkeydown(evento); return evento; };
 assert.equal(tecla(botoes[0], 'ArrowRight').parado, true);
 assert.equal(botoes[1].focused, true);
 tecla(botoes[1], 'End'); assert.equal(botoes[2].focused, true);
 tecla(botoes[2], 'ArrowRight'); assert.equal(botoes[0].getAttribute('aria-selected'), 'true', 'passa da última para a primeira');
 tecla(botoes[0], 'ArrowLeft'); assert.equal(botoes[2].getAttribute('aria-selected'), 'true', 'passa da primeira para a última');
 tecla(botoes[2], 'Home'); assert.equal(botoes[0].getAttribute('aria-selected'), 'true');
 assert.equal(mudancas.length, 5);
 // Tecla que não é de navegação não é engolida.
 assert.equal(tecla(botoes[0], 'a').parado, undefined);
});

test('select() muda a aba por código sem disparar onChange', () => {
 const { controle, botoes, mudancas } = montar();
 controle.select('campaigns');
 assert.equal(controle.active, 'campaigns');
 assert.equal(botoes[1].getAttribute('aria-selected'), 'true');
 assert.deepEqual(mudancas, []);
});

test('um painel compartilhado: todas as abas apontam para o mesmo id', () => {
 const host = new Elemento('div'); host.id = 'portfolio-tabs';
 mountTabs({ host, tabs: [{ key: 'all', label: 'Todos' }, { key: 'x', label: 'Outra' }], active: 'all', onChange() {}, label: 'Tipos', prefix: 'portfolio', panelId: 'product-catalog' });
 const botoes = host.children[0].children;
 assert.deepEqual([...botoes].map(b => b.getAttribute('aria-controls')), ['product-catalog', 'product-catalog']);
});

test('contagem opcional aparece na aba', () => {
 const { botoes } = montar([{ key: 'a', label: 'Todos', count: 12 }, { key: 'b', label: 'Empresas', count: 0 }]);
 assert.equal(botoes[0].children.at(-1).textContent, '12');
 assert.equal(botoes[1].children.at(-1).textContent, '0');
});

// --- Inbound: Campanhas é uma aba, não uma tela ---------------------------------
const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const fonte = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

test('Inbound tem os dois painéis que o componente aponta, e Campanhas deixou de ser tela', () => {
 const html = fonte('index.html'), app = fonte('app.js');
 for (const id of ['inbound-tabs', 'inbound-panel-leads', 'inbound-panel-campaigns']) assert.ok(html.includes(`id="${id}"`), `falta #${id} no index.html`);
 assert.ok(html.includes('aria-labelledby="inbound-tab-leads"') && html.includes('aria-labelledby="inbound-tab-campaigns"'));
 assert.match(app, /prefix: 'inbound'/);
 assert.ok(!html.includes('id="view-campaigns"') && !html.includes('id="view-product-campaigns"'), 'as seções antigas de Campanhas saíram');
 assert.ok(!/section: 'view-campaigns'|section: 'view-product-campaigns'/.test(app), 'Campanhas não é mais uma tela de navegação');
 // O endereço antigo continua funcionando: abre a aba certa.
 assert.match(app, /pedida === 'campaigns'/);
 // Item sem capacidade comercial ainda alcança Campanhas.
 assert.match(app, /'product-inbound':\['commercial','operate'\]/);
});
