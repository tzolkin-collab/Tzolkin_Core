import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, carryOver, definitionInput, normalizeValue, updateInput, validateSpaceData } from '../../apps/api/src/platform/space-fields.mjs';

const campo = (key, type, extra = {}) => ({ key, label: key.toUpperCase(), type, options: null, required: false, is_active: true, position: 0, ...extra });

test('definição: chave, tipo, entidade e opções são conferidos', () => {
 const ok = { space_id: 'sites', entity: 'lead', key: 'porte', label: 'Porte', type: 'SELECT', options: ['Micro', 'Pequena'] };
 assert.deepEqual(definitionInput(ok), { entity: 'lead', key: 'porte', label: 'Porte', type: 'SELECT', options: ['Micro', 'Pequena'], required: false });
 for (const ruim of [{ entity: 'tenant' }, { key: 'Porte' }, { key: '1porte' }, { key: 'a'.repeat(41) }, { type: 'JSON' }, { options: undefined }, { options: [] }, { options: ['A', 'a'] }, { required: 'sim' }, { extra: 1 }])
  assert.throws(() => definitionInput({ ...ok, ...ruim }), e => e.status === 400);
 assert.throws(() => definitionInput({ ...ok, type: 'TEXT' }), e => e.status === 400, 'só campo de lista tem opções');
 assert.equal(definitionInput({ ...ok, type: 'TEXT', options: undefined }).options, null);
});

test('edição: só rótulo, opções, obrigatório, ativo e posição; chave e tipo não entram', () => {
 const f = { label: 'Porte', type: 'SELECT', options: ['A'], required: false, is_active: true, position: 2 };
 assert.deepEqual(updateInput({ version: 1, is_active: false }, f), { label: 'Porte', options: ['A'], required: false, is_active: false, position: 2 });
 assert.deepEqual(updateInput({ version: 1, options: ['A', 'B'], label: 'Novo' }, f).options, ['A', 'B']);
 for (const ruim of [{ key: 'x' }, { type: 'TEXT' }, { entity: 'lead' }, { position: -1 }, { is_active: 'sim' }, { options: [] }])
  assert.throws(() => updateInput({ version: 1, ...ruim }, f), e => e.status === 400);
 assert.throws(() => updateInput({ version: 1, options: ['x'] }, { ...f, type: 'TEXT', options: null }), e => e.status === 400);
});

test('valor de cada tipo: aceita o certo, recusa o errado e trata vazio como sem valor', () => {
 const casos = [
  [campo('t', 'TEXT'), [['  oi  ', 'oi']], [1, 'a'.repeat(501), 'a\u0000b']],
  [campo('n', 'NUMBER'), [[12.5, 12.5], [0, 0]], ['12', NaN, Infinity, 1e13]],
  [campo('d', 'DATE'), [['2026-10-02', '2026-10-02']], ['2026-02-30', '02/10/2026', 20261002]],
  [campo('s', 'SELECT', { options: ['A', 'B'] }), [['A', 'A']], ['C', ['A'], 1]],
  [campo('m', 'MULTISELECT', { options: ['A', 'B'] }), [[['A', 'B'], ['A', 'B']]], [['A', 'A'], ['C'], 'A', ['A', 'B', 'A']]],
  [campo('b', 'BOOLEAN'), [[false, false], [true, true]], ['true', 1, 0]],
  [campo('l', 'LINK'), [['https://exemplo.com/x', 'https://exemplo.com/x']], ['exemplo.com', 'javascript:alert(1)', 'ftp://x.com', 'http://']],
 ];
 for (const [f, bom, ruins] of casos) {
  for (const [entrada, saida] of bom) assert.deepEqual(normalizeValue(f, entrada), saida, `${f.type} ${JSON.stringify(entrada)}`);
  for (const r of ruins) assert.throws(() => normalizeValue(f, r), e => e.status === 400, `${f.type} deveria recusar ${JSON.stringify(r)}`);
  for (const vazio of [null, undefined, '']) assert.equal(normalizeValue(f, vazio), null);
 }
 assert.equal(normalizeValue(campo('t', 'TEXT'), '   '), null, 'só espaços = sem valor');
 assert.equal(normalizeValue(campo('m', 'MULTISELECT', { options: ['A'] }), []), null, 'lista vazia = sem valor');
});

test('dados do espaço: chave desconhecida ou desativada é 400; obrigatório exige; edição não exige os outros', () => {
 const campos = [campo('porte', 'TEXT'), campo('antigo', 'TEXT', { is_active: false }), campo('cnpj', 'TEXT', { required: true })];
 assert.deepEqual(validateSpaceData(campos, { porte: 'Micro', cnpj: '1' }), { porte: 'Micro', cnpj: '1' });
 assert.throws(() => validateSpaceData(campos, { porte: 'Micro', cnpj: '1', outro: 'x' }), e => e.status === 400 && /desconhecido/.test(e.message));
 assert.throws(() => validateSpaceData(campos, { cnpj: '1', antigo: 'x' }), e => e.status === 400, 'campo desativado não recebe valor novo');
 assert.throws(() => validateSpaceData(campos, { porte: 'Micro' }), e => e.status === 400 && /obrigatório/.test(e.message));
 assert.throws(() => validateSpaceData(campos, undefined), e => e.status === 400, 'sem dados também falta o obrigatório');
 assert.throws(() => validateSpaceData(campos, [1]), e => e.status === 400);
 // edição: não exige os outros obrigatórios, mas não deixa apagar um
 assert.deepEqual(validateSpaceData(campos, { porte: 'Pequena' }, { enforceRequired: false }), { porte: 'Pequena' });
 assert.throws(() => validateSpaceData(campos, { cnpj: '' }, { enforceRequired: false }), e => e.status === 400);
 assert.deepEqual(validateSpaceData([campo('porte', 'TEXT')], { porte: '' }), {}, 'vazio some');
});

test('levar adiante: só chave com o mesmo tipo e opção válida; aplicar edição apaga, mantém e preserva campo desativado', () => {
 const destino = [campo('orcamento', 'NUMBER'), campo('porte', 'SELECT', { options: ['A'] }), campo('site', 'TEXT', { is_active: false })];
 assert.deepEqual(carryOver(destino, { orcamento: 10, porte: 'Z', site: 'x', so_no_lead: 1 }), { orcamento: 10 }, 'opção que o destino não tem, campo desativado e chave que o destino não define ficam para trás');
 assert.deepEqual(carryOver(destino, { orcamento: 'dez' }), {}, 'tipo diferente não leva');
 assert.deepEqual(carryOver(destino, null), {});
 const validados = { porte: 'B' };
 assert.deepEqual(applyChanges({ porte: 'A', antigo: 'guardado', cnpj: '1' }, { porte: 'B', cnpj: '' }, validados), { porte: 'B', antigo: 'guardado' });
});
