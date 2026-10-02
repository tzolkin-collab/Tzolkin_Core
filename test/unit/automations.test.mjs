import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, EVENTS, emitEvent, validateActions } from '../../apps/api/src/platform/automations.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';

test('catálogo: dez eventos e duas ações, e os nomes batem com o CHECK da migração 044', async () => {
 assert.equal(Object.keys(EVENTS).length, 10);
 assert.deepEqual(Object.keys(ACTIONS), ['tarefa.criar', 'responsavel.atribuir']);
 const { readFileSync } = await import('node:fs');
 const sql = readFileSync(new URL('../../db/migrations/044_eventos_e_automacoes.sql', import.meta.url), 'utf8');
 const bloco = sql.slice(sql.indexOf('trigger_event text NOT NULL CHECK'), sql.indexOf('actions jsonb'));
 const noBanco = [...bloco.matchAll(/'([a-z_.]+)'/g)].map(m => m[1]);
 assert.deepEqual(noBanco.sort(), Object.keys(EVENTS).sort(), 'o catálogo do código e o CHECK do banco precisam ser a mesma lista');
});

test('ações: normaliza o certo e recusa o errado; atraso só existe no prazo da tarefa', () => {
 assert.deepEqual(validateActions([{ action: 'tarefa.criar', title: ' Ligar para o lead ' }]), [{ action: 'tarefa.criar', title: 'Ligar para o lead', tag: 'Geral', delay_days: 0 }]);
 assert.deepEqual(validateActions([{ action: 'tarefa.criar', title: 'Enviar proposta', tag: 'Vendas', delay_days: 3 }, { action: 'responsavel.atribuir', owner_id: OWNER }]).map(a => a.action), ['tarefa.criar', 'responsavel.atribuir']);
 for (const ruim of [
  undefined, [], 'x', Array.from({ length: 6 }, () => ({ action: 'tarefa.criar', title: 'ok ok' })),
  [{ action: 'email.enviar' }], [{ action: 'tarefa.criar' }], [{ action: 'tarefa.criar', title: 'x' }], [{ action: 'tarefa.criar', title: 'ok ok', delay_days: -1 }],
  [{ action: 'tarefa.criar', title: 'ok ok', delay_days: 366 }], [{ action: 'tarefa.criar', title: 'ok ok', delay_days: 1.5 }], [{ action: 'tarefa.criar', title: 'ok ok', extra: 1 }],
  [{ action: 'responsavel.atribuir' }], [{ action: 'responsavel.atribuir', owner_id: 'x' }], [{ action: 'responsavel.atribuir', owner_id: OWNER, delay_days: 2 }], [null], [[]],
 ]) assert.throws(() => validateActions(ruim), e => e.status === 400, JSON.stringify(ruim)?.slice(0, 80));
});

// Banco falso: guarda as consultas e responde por trecho do SQL.
function clienteFalso({ automacoes = [], falharEm = () => false, falharSelect = false } = {}) {
 const sql = [];
 return {
  sql,
  async query(texto, params = []) {
   sql.push(texto.trim().split(/\s+/).slice(0, 3).join(' '));
   if (/FROM automations/.test(texto)) { if (falharSelect) throw new Error('relation "automations" does not exist'); return { rows: automacoes, rowCount: automacoes.length }; }
   if (falharEm(texto, params)) throw new Error('falha de teste');
   if (/FROM operator_accounts/.test(texto)) return { rows: [{}], rowCount: 1 };
   return { rows: [], rowCount: 1 };
  },
 };
}

test('motor: roda as automações do evento, cada uma no seu savepoint, e grava a execução', async () => {
 const c = clienteFalso({ automacoes: [
  { id: 'a1', name: 'Ligar', actions: [{ action: 'tarefa.criar', title: 'Ligar', tag: 'Geral', delay_days: 0 }] },
  { id: 'a2', name: 'Dono', actions: [{ action: 'responsavel.atribuir', owner_id: OWNER }] },
 ] });
 const n = await emitEvent(c, 'lead.criado', { spaceId: 'sites', tenantId: TENANT, leadId: 'l1' });
 assert.equal(n, 2);
 assert.deepEqual(c.sql.filter(s => s.startsWith('SAVEPOINT') || s.startsWith('RELEASE')), ['SAVEPOINT emit_event', 'SAVEPOINT automacao', 'RELEASE SAVEPOINT automacao', 'SAVEPOINT automacao', 'RELEASE SAVEPOINT automacao', 'RELEASE SAVEPOINT emit_event']);
 assert.equal(c.sql.filter(s => s.startsWith('INSERT INTO automation_runs')).length, 2);
});

test('motor: uma ação que falha desfaz só aquela automação, registra FAILED e as outras seguem', async () => {
 const resultados = [];
 const c = clienteFalso({
  automacoes: [
   { id: 'a1', name: 'Quebra', actions: [{ action: 'tarefa.criar', title: 'Antes de quebrar', tag: 'Geral', delay_days: 0 }, { action: 'responsavel.atribuir', owner_id: OWNER }] },
   { id: 'a2', name: 'Segue', actions: [{ action: 'tarefa.criar', title: 'Segue', tag: 'Geral', delay_days: 0 }] },
  ],
  falharEm: (texto, params) => /UPDATE commercial_leads/.test(texto),
 });
 const antes = c.query.bind(c);
 c.query = async (t, p) => { if (/INSERT INTO automation_runs/.test(t)) resultados.push([p[0], p[5], p[6]]); return antes(t, p); };
 const n = await emitEvent(c, 'lead.criado', { spaceId: 'sites', tenantId: TENANT, leadId: 'l1' });
 assert.equal(n, 2);
 assert.ok(c.sql.includes('ROLLBACK TO SAVEPOINT'));
 assert.deepEqual(resultados.map(r => [r[0], r[1]]), [['a1', 'FAILED'], ['a2', 'OK']]);
 assert.match(resultados[0][2], /falha de teste/);
 assert.doesNotMatch(resultados[0][2], /Antes de quebrar/, 'o que a automação fez antes de falhar foi desfeito e não é relatado como feito');
});

test('motor: erro no próprio motor (migração 044 ausente) nunca lança: devolve 0 e a transação de quem emitiu segue', async () => {
 const c = clienteFalso({ falharSelect: true });
 assert.equal(await emitEvent(c, 'lead.criado', { spaceId: 'sites', tenantId: TENANT, leadId: 'l1' }), 0);
 assert.ok(c.sql.includes('ROLLBACK TO SAVEPOINT'));
 await assert.rejects(() => emitEvent(clienteFalso(), 'evento.inventado', {}), /desconhecido/);
});

test('motor: sem automação ligada ao evento não grava execução', async () => {
 const c = clienteFalso();
 assert.equal(await emitEvent(c, 'oportunidade.ganha', { spaceId: 'sites', tenantId: TENANT, opportunityId: 'o1' }), 0);
 assert.equal(c.sql.filter(s => s.startsWith('INSERT')).length, 0);
});
