// Detecção de logo escura (logo-tema.js): só marca marca escura e neutra sobre fundo transparente.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logoEscura, classificarLogo } from '../../apps/web/public/logo-tema.js';

// 32x32 transparente; pinta uma fração com a cor dada. `fundo` pinta tudo (imagem de fundo cheio).
const imagem = ({ cor, fracao = 0.3, fundo = null }) => {
 const total = 32 * 32, p = new Uint8ClampedArray(total * 4);
 if (fundo) for (let i = 0; i < total; i++) p.set([...fundo, 255], i * 4);
 for (let i = 0; i < Math.round(total * fracao); i++) p.set([...cor, 255], i * 4);
 return p;
};

test('logo preta ou cinza-escura sobre fundo transparente é escura (GitHub #1b1f23, Vercel #000)', () => {
 assert.equal(logoEscura(imagem({ cor: [27, 31, 35] })), true);
 assert.equal(logoEscura(imagem({ cor: [0, 0, 0] })), true);
 assert.equal(logoEscura(imagem({ cor: [60, 60, 60], fracao: 0.6 })), true);
});

test('logo colorida não inverte, nem escura (Stripe #635bff, azul-marinho, vermelho escuro)', () => {
 assert.equal(logoEscura(imagem({ cor: [99, 91, 255] })), false);
 assert.equal(logoEscura(imagem({ cor: [16, 32, 96] })), false, 'azul-marinho: inverter daria amarelo');
 assert.equal(logoEscura(imagem({ cor: [120, 10, 10] })), false);
});

test('logo clara ou de cinza médio/claro fica como está', () => {
 assert.equal(logoEscura(imagem({ cor: [255, 255, 255] })), false);
 assert.equal(logoEscura(imagem({ cor: [200, 200, 200] })), false);
 assert.equal(logoEscura(imagem({ cor: [140, 140, 140] })), false);
});

test('imagem de fundo cheio ou quase vazia não é invertida', () => {
 assert.equal(logoEscura(imagem({ cor: [255, 255, 255], fracao: 0.2, fundo: [0, 0, 0] })), false, 'ícone com fundo próprio (tile preto com glifo branco)');
 assert.equal(logoEscura(imagem({ cor: [0, 0, 0], fracao: 0.002 })), false, 'quase transparente: nada a decidir');
 assert.equal(logoEscura(new Uint8ClampedArray(32 * 32 * 4)), false, 'totalmente transparente');
});

test('logo colorida e escura (BTG azul-marinho, Nubank roxo-escuro) ganha placa, não inversão', () => {
 assert.equal(classificarLogo(imagem({ cor: [16, 32, 96] })), 'cor');
 assert.equal(classificarLogo(imagem({ cor: [90, 10, 150] })), 'cor');
 assert.equal(classificarLogo(imagem({ cor: [27, 31, 35] })), 'neutra');
 assert.equal(classificarLogo(imagem({ cor: [99, 91, 255] })), null, 'Stripe: colorida e legível, fica como está');
 assert.equal(classificarLogo(imagem({ cor: [200, 30, 40] })), null, 'vermelho vivo: legível no escuro');
 assert.equal(classificarLogo(imagem({ cor: [255, 255, 255], fundo: [16, 32, 96] })), null, 'tile colorido com glifo claro tem fundo próprio');
 assert.equal(logoEscura(imagem({ cor: [16, 32, 96] })), false, 'a colorida nunca é "invertida"');
});
