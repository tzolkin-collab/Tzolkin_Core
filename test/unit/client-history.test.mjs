import test from 'node:test';
import assert from 'node:assert/strict';
import { TIPOS, describe } from '../../apps/web/public/client-history.js';

test('histórico: tipo conhecido vira texto em português; desconhecido aparece como veio', () => {
 assert.deepEqual(describe({ source: 'empresa', type: 'engagement.created', details: null }), { title: 'Contratação criada', detail: '' });
 assert.equal(describe({ source: 'empresa', type: 'algo.novo', details: null }).title, 'algo.novo');
 assert.equal(describe({ source: 'atividade', type: 'time_logged', details: null }).title, 'Tempo registrado');
 // o mesmo nome "created" é de coisas diferentes em cada trilha
 assert.equal(describe({ source: 'atividade', type: 'created', details: null }).title, 'Atividade criada');
 assert.equal(describe({ source: 'empresa', type: 'created', details: null }).title, 'created');
 assert.ok(Object.keys(TIPOS).length > 15);
});

test('histórico: alteração de classificação mostra de quê para quê, com os rótulos da tela', () => {
 const d = describe({ source: 'empresa', type: 'tenant.updated', details: {
  before: { name: 'Acme', relationship_kind: 'prospect', lifecycle_status: 'lead' },
  after: { name: 'Acme Ltda', relationship_kind: 'customer', lifecycle_status: 'onboarding' } } });
 assert.equal(d.title, 'Empresa alterada');
 assert.equal(d.detail, 'Nome: Acme → Acme Ltda · Relacionamento: Prospect → Cliente · Ciclo de vida: Lead → Em implantação');
 assert.equal(describe({ source: 'empresa', type: 'tenant.updated', details: { before: { name: null }, after: { name: 'Novo' } } }).detail, 'Nome: — → Novo');
 assert.equal(describe({ source: 'empresa', type: 'tenant.updated', details: {} }).detail, '', 'detalhe sem antes e depois não inventa texto');
});
