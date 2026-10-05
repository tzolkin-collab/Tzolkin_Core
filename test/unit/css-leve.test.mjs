// Regra de desempenho: nada de desfoque de fundo (vidro) nos estilos do painel. backdrop-filter e filter: blur() fazem o navegador
// reprocessar tudo que está atrás do elemento a cada quadro; janelas, painéis e menus ficam pesados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const sem = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('nenhum CSS do painel usa backdrop-filter nem filter: blur()', () => {
 const achados = [];
 for (const nome of readdirSync(PUBLIC).filter(n => n.endsWith('.css'))) {
  const css = sem(readFileSync(new URL(nome, PUBLIC), 'utf8'));
  if (/backdrop-filter/i.test(css)) achados.push(`${nome}: backdrop-filter`);
  if (/(^|[;{\s])(-webkit-)?filter\s*:[^;}]*blur\(/i.test(css)) achados.push(`${nome}: filter: blur()`);
 }
 assert.deepEqual(achados, []);
});

test('o fundo das janelas é o --scrim do tema, chapado', () => {
 const css = sem(readFileSync(new URL('design.css', PUBLIC), 'utf8'));
 const bloco = css.match(/dialog::backdrop\s*\{([^}]*)\}/)[1];
 assert.match(bloco, /background:\s*var\(--scrim\)/);
 assert.ok(!/filter/i.test(bloco));
});
