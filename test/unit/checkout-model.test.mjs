import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
 THEME_TOKENS, COPY_FIELDS, FONTS, PAYLOAD_LIMIT,
 validateTheme, validateCopy, mergeTheme, mergeCopy, validateMethods,
 assertPayloadSize, contrastInk, defaultTheme, editorSchema, LAYERS,
} from '../../apps/api/src/platform/checkout-model.mjs';

const erro = (fn, status, trecho) => {
 try { fn(); assert.fail('deveria ter lançado'); }
 catch (error) { assert.equal(error.status, status); if (trecho) assert.match(error.message, trecho); }
};

test('tema aceita só o que sabemos renderizar', () => {
 assert.deepEqual(validateTheme({ color: '#AABBCC' }), { color: '#aabbcc' }, 'cor normalizada em minúsculas');
 erro(() => validateTheme({ color: 'red' }), 400, /Cor inválida/);
 // A injeção que a dupla checagem existe para barrar: o preview recebe tokens
 // por postMessage, sem passar pelo servidor, e a página revalida antes do CSS.
 erro(() => validateTheme({ color: 'red;background:url(x)' }), 400, /Cor inválida/);
 erro(() => validateTheme({ radius: 25 }), 400, /intervalo/);
 erro(() => validateTheme({ radius: 12.5 }), 400, /intervalo/);
 erro(() => validateTheme({ shadow: 'glow' }), 400, /Opção inválida/);
 // Texto livre de fonte era o defeito antigo: gravava e o navegador ignorava.
 erro(() => validateTheme({ font_family: 'Comic Sans' }), 400, /Fonte indisponível/);
 erro(() => validateTheme({ logo_url: 'http://exemplo.com/a.png' }), 400, /https/);
 assert.deepEqual(validateTheme({ logo_url: '' }), { logo_url: '' });
 // A trava real contra campo clandestino é input(): chave desconhecida é 400.
 erro(() => validateTheme({ custom_css: 'body{}' }), 400, /Campos inválidos/);
 erro(() => validateTheme([]), 400);
});

test('copy grava só o que foi escrito e vazio volta ao padrão', () => {
 assert.deepEqual(validateCopy({ headline: '  Oferta  ' }), { headline: 'Oferta' });
 assert.deepEqual(validateCopy({ headline: '' }), {}, 'vazio apaga a personalização em vez de gravar string vazia');
 erro(() => validateCopy({ cta_label: 'x'.repeat(61) }), 400, /Texto inválido/);
 erro(() => validateCopy({ headline_extra: 'a' }), 400, /Campos inválidos/);
 const completo = mergeCopy({ headline: 'Oferta' });
 assert.equal(completo.headline, 'Oferta');
 assert.equal(Object.keys(completo).length, COPY_FIELDS.length, 'leitura devolve todos os campos');
});

test('os padrões são os literais que a página já usa hoje', () => {
 // Regressão de conteúdo: se alguém mudar um destes, a página pública muda de
 // texto para todo mundo que nunca editou o campo. Que seja uma decisão.
 const copy = mergeCopy({});
 assert.equal(copy.cta_label, 'Pagar com cartão');
 assert.equal(copy.security_note, 'Pagamento processado pela Stripe. A confirmação chega por e-mail assim que aprovada.');
 assert.equal(copy.success_title, 'Recebemos seu pagamento');
 assert.equal(copy.cancel_body, 'Nenhuma cobrança foi feita. Você pode tentar novamente.');
 // E os tokens são os valores que estão em checkout.css hoje.
 const tema = mergeTheme({});
 assert.equal(tema.color, '#111827');
 assert.equal(tema.bg, '#f8fafc');
 assert.equal(tema.muted, '#64748b');
 assert.equal(tema.radius, 12);
 assert.equal(tema.width, 420);
 assert.deepEqual(tema, defaultTheme());
 assert.equal(mergeTheme({ color: '#ff0000' }).bg, '#f8fafc', 'editar um token não zera os outros');
});

test('a tinta sobre a cor principal é calculada, não escolhida', () => {
 assert.equal(contrastInk('#111827'), '#ffffff');
 assert.equal(contrastInk('#000000'), '#ffffff');
 // O caso que motiva existir: amarelo com texto branco seria ilegível.
 assert.equal(contrastInk('#ffff00'), '#111827');
 assert.equal(contrastInk('#ffffff'), '#111827');
});

test('o teto de payload dispara com erro que diz o que fazer', () => {
 const gordo = { copy: { security_note: 'á'.repeat(5000) } };
 erro(() => assertPayloadSize(gordo), 400, /Encurte os textos/);
 // Conta BYTES, não caracteres: 5000 acentos são 10 000 bytes em UTF-8 e passam
 // do teto, enquanto 5000 caracteres não passariam. É exatamente aqui que erra
 // quem dimensiona o orçamento por length.
 assert.equal(JSON.stringify(gordo).length < PAYLOAD_LIMIT, true, '5000 caracteres cabem…');
 assert.ok(Buffer.byteLength(JSON.stringify(gordo), 'utf8') > PAYLOAD_LIMIT, '…mas 10 000 bytes não');
 assert.ok(assertPayloadSize({ theme: defaultTheme(), copy: {} }) < PAYLOAD_LIMIT);
});

test('um tema e uma copy inteiros cabem no orçamento, com folga', () => {
 // O pior caso realista: todo token editado e todo texto no limite máximo.
 const copy = Object.fromEntries(COPY_FIELDS.map(f => [f.key, 'á'.repeat(f.max)]));
 const bytes = Buffer.byteLength(JSON.stringify({ theme: defaultTheme(), copy }), 'utf8');
 assert.ok(bytes < 16384, `pior caso ${bytes} bytes precisa caber no limite de transporte`);
});

test('métodos de pagamento formam uma lista sem repetição e não vazia', () => {
 assert.deepEqual(validateMethods(['card', 'pix']), ['card', 'pix']);
 erro(() => validateMethods([]), 400, /ao menos uma/);
 erro(() => validateMethods(['card', 'card']), 400, /inválida/);
 erro(() => validateMethods(['cripto']), 400, /inválida/);
});

test('o descritor do editor é fechado e coerente com o validador', () => {
 const schema = editorSchema();
 assert.equal(schema.theme_tokens.length, THEME_TOKENS.length);
 assert.equal(schema.payload_limit, PAYLOAD_LIMIT);
 // Só prometemos fonte que conseguimos servir: enquanto nada for auto-hospedado,
 // a lista tem uma entrada só, e é a do sistema.
 assert.deepEqual(FONTS.map(f => f.id), ['system']);
 for (const token of schema.theme_tokens) assert.doesNotThrow(() => validateTheme({ [token.key]: token.default }));
});

test('as camadas do modelo e as marcadas na página são exatamente as mesmas', () => {
 // O id da camada é o contrato entre checkout.js (que marca data-layer) e o
 // editor (que casa por ele). Divergir quebraria o clique na prévia em silêncio:
 // o elemento existiria e nada aconteceria ao clicar.
 const fonte = readFileSync(new URL('../../apps/web/public/checkout.js', import.meta.url), 'utf8');
 const marcadas = new Set([...fonte.matchAll(/(?:camada\([^,]+,\s*|vazio\(\s*)'([a-z_]+)'/g)].map(m => m[1]));
 const declaradas = new Set(LAYERS.map(l => l.id));
 assert.deepEqual([...marcadas].sort(), [...declaradas].sort());
 // Toda camada precisa de propósito escrito: é o que a torna útil na tela.
 for (const layer of LAYERS) {
  assert.ok(layer.label && layer.purpose, `camada ${layer.id} sem rótulo ou propósito`);
  for (const chave of layer.copy) assert.ok(COPY_FIELDS.some(f => f.key === chave), `camada ${layer.id} cita copy inexistente: ${chave}`);
  for (const chave of layer.theme) assert.ok(THEME_TOKENS.some(t => t.key === chave), `camada ${layer.id} cita token inexistente: ${chave}`);
 }
});
