// Todo ícone que o painel pede precisa existir em icons.js.
//
// createIcon(nome) cai em 'layers' quando o nome não existe: um erro de digitação (ou
// um ícone novo esquecido) não quebra nada, não lança erro e some dentro da tela como
// um pictograma errado. Esta é a guarda: lê o fonte, junta todos os nomes pedidos e
// confere contra os definidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const ler = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

const icons = ler('icons.js');
const definidos = new Set();
for (const m of icons.matchAll(/(?:^|[,{\s])"?([a-z][a-z0-9-]*)"?\s*:\s*\[\[/gm)) definidos.add(m[1]);
const aliases = icons.match(/const aliases=\{([^}]*)\}/)?.[1] || '';
for (const m of aliases.matchAll(/([a-z][a-z0-9-]*)\s*:\s*'[a-z][a-z0-9-]*'/g)) definidos.add(m[1]);

test('a leitura de icons.js achou os ícones (senão o teste conferiria nada)', () => {
 assert.ok(definidos.size > 40, `só ${definidos.size} ícones lidos`);
 for (const nome of ['layers', 'globe', 'server', 'cloud', 'repo', 'briefcase', 'people']) assert.ok(definidos.has(nome), nome);
});

test('todo createIcon/deliveryIcon com nome literal pede um ícone que existe', () => {
 const faltando = [];
 let pedidos = 0;
 for (const arquivo of readdirSync(PUBLIC).filter(nome => nome.endsWith('.js') && nome !== 'icons.js')) {
  for (const m of ler(arquivo).matchAll(/(?:createIcon|deliveryIcon)\(\s*'([a-z][a-z0-9-]*)'/g)) {
   pedidos++;
   if (!definidos.has(m[1])) faltando.push(`${arquivo}: ${m[1]}`);
  }
 }
 assert.ok(pedidos > 15, 'a leitura dos pedidos falhou');
 assert.deepEqual(faltando, []);
});

test('o mapa de ícones do menu e o registro de tipos do portfólio só usam ícones que existem', () => {
 const app = ler('app.js');
 const mapa = app.match(/createIcon\(\(\{([^}]*)\}\)\[key\]\)/)?.[1];
 assert.ok(mapa, 'não achei o mapa de ícones do menu em app.js');
 const doMenu = [...mapa.matchAll(/:\s*'([a-z][a-z0-9-]*)'/g)].map(m => m[1]);
 const doRegistro = [...readFileSync(new URL('../../apps/api/src/modules/catalog.mjs', import.meta.url), 'utf8').matchAll(/icon:\s*'([a-z][a-z0-9-]*)'/g)].map(m => m[1]);
 assert.ok(doMenu.length > 20 && doRegistro.length === 4, 'a leitura falhou');
 assert.deepEqual([...doMenu, ...doRegistro].filter(nome => !definidos.has(nome)), []);
 // O menu de DNS tem um globo, não o ícone de link externo que era o mais parecido.
 assert.match(mapa, /dns:'globe'/);
});
