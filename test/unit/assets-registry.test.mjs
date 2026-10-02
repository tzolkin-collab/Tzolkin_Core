// Todo arquivo que o painel carrega precisa estar no mapa de assets.
//
// O servidor só entrega o que está em apps/web/assets.mjs (lista fixa: a URL nunca
// escolhe o caminho). Um módulo novo importado por app.js, ou um CSS novo ligado no
// index.html, sem a linha correspondente lá, responde 404 — e como o import falha, a
// tela inteira deixa de carregar. Nada mais avisava disso: esta é a guarda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { serveAsset } from '../../apps/web/assets.mjs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const ler = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

// Pergunta ao próprio servidor de assets, como o navegador perguntaria.
const existe = caminho => {
 let status = null;
 const res = { writeHead: codigo => { status = codigo; }, end() {}, setHeader() {} };
 try { serveAsset(caminho, res); } catch { return false; }
 return status === 200;
};

test('todo CSS e script ligado no index.html é servido', () => {
 const html = ler('index.html');
 const ligados = [...html.matchAll(/(?:href|src)="(\/[a-z0-9-]+\.(?:css|js))"/g)].map(m => m[1]);
 assert.ok(ligados.length > 15, 'a leitura do index.html falhou, e o teste estaria conferindo nada');
 for (const caminho of ligados) assert.ok(existe(caminho), `${caminho} está no index.html mas não no mapa de assets`);
});

test('todo módulo importado por um módulo do painel é servido', () => {
 const modulos = readdirSync(PUBLIC).filter(nome => nome.endsWith('.js') && nome !== 'sw.js');
 let importacoes = 0;
 for (const nome of modulos) {
  for (const m of ler(nome).matchAll(/from\s+'\.\/([a-z0-9-]+\.js)'/g)) {
   importacoes++;
   assert.ok(existe(`/${m[1]}`), `${nome} importa ${m[1]}, que não está no mapa de assets`);
  }
 }
 assert.ok(importacoes > 20, 'a leitura dos imports falhou, e o teste estaria conferindo nada');
});

test('todo arquivo .js e .css da pasta pública que o painel usa está registrado', () => {
 // Um arquivo esquecido na pasta e fora do mapa é um módulo que ninguém consegue carregar.
 const soltos = readdirSync(PUBLIC).filter(nome => /\.(?:js|css)$/.test(nome) && !existe(`/${nome}`));
 assert.deepEqual(soltos, [], `arquivos fora do mapa de assets: ${soltos.join(', ')}`);
});
