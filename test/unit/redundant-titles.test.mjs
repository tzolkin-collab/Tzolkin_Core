// Nenhuma tela repete o próprio título num cabeçalho dentro dela.
//
// O topo da página já diz "Clientes"; um <h2>Clientes</h2> logo abaixo, e um card
// "Clientes 5" ao lado, dizem a mesma palavra três vezes. Esta guarda lê o título de
// cada tela (CONTEXTS, em app.js) e os cabeçalhos da seção dela (index.html) e recusa
// o cabeçalho que repete o título ou o contém. A frase que explica a tela é um
// parágrafo, não um cabeçalho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', PUBLIC), 'utf8');
const app = readFileSync(new URL('app.js', PUBLIC), 'utf8');

const norm = texto => texto.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// título de cada tela, por seção: `chave: { title: 'X', section: 'view-x' ... }`
const telas = new Map();
for (const m of app.matchAll(/title:\s*'([^']+)',\s*section:\s*'(view-[\w-]+)'/g)) telas.set(m[2], m[1]);
// o mesmo `view-x` serve a mais de uma tela (Inbound, por exemplo): vale o primeiro título

const secoes = [...html.matchAll(/<section id="(view-[\w-]+)"[^>]*>([\s\S]*?)(?=\n<section id="view-|\n<\/main>)/g)];

test('a leitura achou as telas e as seções (senão o teste conferiria nada)', () => {
 assert.ok(telas.size > 20, `só ${telas.size} telas lidas de CONTEXTS`);
 assert.ok(secoes.length > 20, `só ${secoes.length} seções lidas do index.html`);
});

test('nenhum cabeçalho dentro de uma tela repete o título dela', () => {
 const repetidos = [];
 for (const [id, corpo] of secoes) {
  const titulo = telas.get(id);
  if (!titulo) continue;
  const a = norm(titulo);
  for (const m of corpo.matchAll(/<(h2|h3)[^>]*>([^<]+)<\/\1>/g)) {
   const b = norm(m[2]);
   if (b && (b === a || b.includes(a) || a.includes(b))) repetidos.push(`${id} ("${titulo}") repete em <${m[1]}>${m[2].trim()}</${m[1]}>`);
  }
 }
 assert.deepEqual(repetidos, []);
});

test('o card de resumo de Clientes não se chama "Clientes"', () => {
 // Era o caso que motivou a guarda: título, card e cabeçalho com a mesma palavra.
 assert.ok(!/\[\s*'Clientes'\s*,\s*customers\.length\s*\]/.test(app), 'o primeiro card de Clientes repete o título');
});

test('a Visão geral não tem dois cabeçalhos que dizem "o que merece atenção"', () => {
 const atencao = [...html.matchAll(/<h[23][^>]*>([^<]*aten[cç][ãa]o[^<]*)<\/h[23]>/gi)].map(m => m[1].trim());
 assert.equal(atencao.length, 1, `cabeçalhos de atenção: ${JSON.stringify(atencao)}`);
});
