// Desempenho de carregamento: compressão e revalidação dos estáticos, JSON comprimido na API e pool
// do banco aquecido. Mede o que o navegador receberia, não só que "alguma coisa roda".
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { serveAsset } from '../../apps/web/assets.mjs';
import { replier } from '../../apps/api/src/platform/http.mjs';
import { manterPoolQuente } from '../../apps/api/src/platform/database.mjs';

// Resposta falsa que registra o que o servidor escreveu.
const resposta = req => {
 const r = { status: null, cabecalhos: {}, corpo: null, req };
 r.writeHead = (status, cabecalhos = {}) => { r.status = status; r.cabecalhos = cabecalhos; };
 r.end = corpo => { r.corpo = corpo; };
 r.setHeader = () => {};
 return r;
};
const pedido = (headers = {}) => ({ headers });

test('estático: sem Accept-Encoding vai inteiro; com br e com gzip vai comprimido e menor', () => {
 const puro = resposta(); serveAsset('/app.js', puro, pedido());
 assert.equal(puro.status, 200);
 assert.equal(puro.cabecalhos['Content-Encoding'], undefined);
 const tamanho = puro.corpo.length;
 assert.ok(tamanho > 50_000, 'o app.js é o maior arquivo do painel');

 const br = resposta(); serveAsset('/app.js', br, pedido({ 'accept-encoding': 'gzip, deflate, br' }));
 assert.equal(br.cabecalhos['Content-Encoding'], 'br');
 assert.ok(br.corpo.length < tamanho * 0.35, `brotli deveria cortar ao menos 65% (${br.corpo.length} de ${tamanho})`);
 assert.equal(brotliDecompressSync(br.corpo).toString(), puro.corpo.toString(), 'descomprimido, é o mesmo arquivo');
 assert.equal(br.cabecalhos['Content-Length'], br.corpo.length);

 const gz = resposta(); serveAsset('/app.js', gz, pedido({ 'accept-encoding': 'gzip' }));
 assert.equal(gz.cabecalhos['Content-Encoding'], 'gzip');
 assert.equal(gunzipSync(gz.corpo).toString(), puro.corpo.toString());
 assert.equal(gz.cabecalhos.Vary, 'Accept-Encoding');
});

test('estático: ETag igual ao do navegador devolve 304 sem corpo', () => {
 const a = resposta(); serveAsset('/style.css', a, pedido());
 const etag = a.cabecalhos.ETag;
 assert.match(etag, /^"[\w-]{22}"$/);
 const b = resposta(); assert.equal(serveAsset('/style.css', b, pedido({ 'if-none-match': etag })), true);
 assert.equal(b.status, 304);
 assert.equal(b.corpo, undefined, '304 não leva corpo');
 // outro ETag: serve de novo
 const c = resposta(); serveAsset('/style.css', c, pedido({ 'if-none-match': '"outro"' }));
 assert.equal(c.status, 200);
});

test('estático: fonte e imagem não são recomprimidas; favicon continua sem cache; fonte dura uma semana', () => {
 const fonte = resposta(); serveAsset('/fonts/inter-latin-wght-normal.woff2', fonte, pedido({ 'accept-encoding': 'br, gzip' }));
 assert.equal(fonte.status, 200);
 assert.equal(fonte.cabecalhos['Content-Encoding'], undefined, 'woff2 já é comprimido');
 assert.equal(fonte.cabecalhos['Content-Type'], 'font/woff2; charset=utf-8');
 assert.equal(fonte.cabecalhos['Cache-Control'], 'public, max-age=604800');
 const fav = resposta(); serveAsset('/favicon.svg', fav, pedido({ 'if-none-match': '"qualquer"' }));
 assert.equal(fav.cabecalhos['Cache-Control'], 'no-store');
 assert.equal(fav.status, 200, 'no-store nunca devolve 304');
});

test('estático: caminho fora do mapa continua não servido', () => {
 assert.equal(serveAsset('/../.env', resposta(), pedido()), false);
 assert.equal(serveAsset('/nao-existe.js', resposta(), pedido()), false);
});

const grande = { itens: Array.from({ length: 200 }, (_, i) => ({ id: i, nome: `Empresa número ${i}`, situacao: 'ativo' })) };

test('API: JSON grande vai em gzip quando o navegador aceita, e descomprime para o mesmo JSON', () => {
 const r = resposta({ headers: { 'accept-encoding': 'gzip, br' } });
 replier(r)(200, grande);
 assert.equal(r.status, 200);
 assert.equal(r.cabecalhos['Content-Encoding'], 'gzip');
 assert.equal(r.cabecalhos.Vary, 'Accept-Encoding');
 const original = JSON.stringify(grande);
 assert.ok(r.corpo.length < original.length * 0.3, 'JSON repetitivo deveria cortar mais de 70%');
 assert.equal(r.cabecalhos['Content-Length'], r.corpo.length);
 assert.deepEqual(JSON.parse(gunzipSync(r.corpo).toString()), grande);
});

test('API: resposta pequena, ou navegador sem gzip, ou sem req (teste), segue em texto puro', () => {
 const pequena = resposta({ headers: { 'accept-encoding': 'gzip' } }); replier(pequena)(200, { ok: true });
 assert.equal(pequena.corpo, '{"ok":true}');
 assert.equal(pequena.cabecalhos['Content-Encoding'], undefined);
 const semGzip = resposta({ headers: { 'accept-encoding': 'identity' } }); replier(semGzip)(200, grande);
 assert.equal(semGzip.corpo, JSON.stringify(grande));
 const semReq = resposta(undefined); replier(semReq)(201, grande);
 assert.equal(semReq.status, 201);
 assert.equal(semReq.corpo, JSON.stringify(grande));
});

test('pool: abre as conexões na partida, as mantém em uso e para quando mandam', async () => {
 let consultas = 0, emVoo = 0, picoSimultaneo = 0;
 const pool = { query: async sql => { assert.equal(sql, 'SELECT 1'); consultas++; emVoo++; picoSimultaneo = Math.max(picoSimultaneo, emVoo); await new Promise(r => setTimeout(r, 5)); emVoo--; } };
 const parar = await manterPoolQuente(pool, { conexoes: 3, intervaloMs: 20 });
 assert.equal(consultas, 3, 'na partida abre as 3 de uma vez');
 assert.equal(picoSimultaneo, 3, 'em paralelo, para o pool abrir 3 conexões e não reusar uma só');
 await new Promise(r => setTimeout(r, 70));
 assert.ok(consultas >= 6, `deveria repetir a cada intervalo (${consultas})`);
 parar();
 const depois = consultas;
 await new Promise(r => setTimeout(r, 60));
 assert.equal(consultas, depois, 'depois de parar, não consulta mais');
});

test('pool: banco que falha no aquecimento não derruba a partida', async () => {
 const pool = { query: async () => { throw new Error('banco fora'); } };
 const parar = await manterPoolQuente(pool, { conexoes: 2, intervaloMs: 1000 });
 assert.equal(typeof parar, 'function');
 parar();
});

// O servidor local e o de produção passam estas opções ao abrir o banco. A política de transporte do
// `openDatabase` só aceita uma lista curta de opções de pool, e uma opção fora dela derruba a partida
// (aconteceu com `keepAlive`). Este teste usa o mesmo conjunto de opções dos dois pontos de entrada.
import { readFileSync } from 'node:fs';
import { openDatabase } from '../../apps/api/src/platform/database.mjs';

test('pool: as opções que o servidor local e o de produção passam são aceitas pela política de transporte', async () => {
 class Client { constructor(c) { this.config = c; } async connect() { this.connection = { stream: { encrypted: true, authorized: true } }; } async end() {} }
 class Pool { constructor(c) { this.options = c; } }
 const opcoes = { max: 5, connectionTimeoutMillis: 8000, idleTimeoutMillis: 300_000 };
 const { pool } = await openDatabase({ connectionString: 'postgres://u:p@db.example.invalid/x', mode: 'require', ...opcoes }, { Client, Pool });
 assert.equal(pool.options.idleTimeoutMillis, 300_000, 'a ociosidade longa chega ao pool');
 await assert.rejects(openDatabase({ connectionString: 'postgres://u:p@db.example.invalid/x', mode: 'require', ...opcoes, keepAlive: true }, { Client, Pool }), /não permitida/);
 for (const arquivo of ['server.mjs', 'production.mjs']) {
  const fonte = readFileSync(new URL(`../../apps/api/src/${arquivo}`, import.meta.url), 'utf8');
  assert.match(fonte, /idleTimeoutMillis\s*:\s*300_000/, `${arquivo} deve usar a ociosidade longa`);
  assert.doesNotMatch(fonte, /keepAlive/, `${arquivo} não pode passar opção fora da política`);
  assert.match(fonte, /manterPoolQuente\(pool\)/, `${arquivo} deve aquecer o pool`);
 }
});
