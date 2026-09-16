// Recebimentos de linha de serviço (ADR 0008, fase 1) sem banco.
//
// O que estes testes protegem, em ordem de custo de errar:
//  1. parcelas somam exatamente o contrato, em inteiros, e o vencimento não escorrega;
//  2. só contrato aceito, na versão vista, de linha de serviço, gera plano;
//  3. prévia não grava nada;
//  4. dinheiro só com o dono: aprovar, cobrar, pagar, NFS-e, vencimento e cancelar;
//  5. nada vai a provedor nesta fase, e parcela paga não é cancelada nem recebe segunda nota.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 addMonths, buildPlan, evenInstallments, isoDate, serviceReceivableRoutes, summarize, todayInBrazil,
} from '../../apps/api/src/modules/service-receivables.mjs';

const BOOT = { subject: 'local-bootstrap' };
const MEMBRO = { subject: 'google:membro', email: 'membro@tzolkin.test' };
const CONTRATO = '11111111-1111-4111-8111-111111111111';
const PLANO = '22222222-2222-4222-8222-222222222222';
const PARCELA = '33333333-3333-4333-8333-333333333333';
// 16/09/2026 12:00 em Brasília.
const CLOCK = () => Date.parse('2026-09-16T15:00:00Z');

function rotas() {
 const mapa = new Map();
 const registrar = metodo => (caminho, handler) => mapa.set(`${metodo} ${caminho}`, handler);
 serviceReceivableRoutes({ get: registrar('GET'), post: registrar('POST') }, { clock: CLOCK });
 return mapa;
}

// Banco falso roteado por trecho de SQL; guarda as chamadas para conferir o que foi gravado.
function banco(respostas = []) {
 const chamadas = [];
 return {
  chamadas,
  escreveu: () => chamadas.some(c => /^\s*(INSERT|UPDATE|DELETE)/.test(c.sql)),
  query: async (sql, params) => {
   chamadas.push({ sql, params });
   for (const [trecho, resposta] of respostas)
    if (sql.includes(trecho)) {
     const rows = typeof resposta === 'function' ? resposta(sql, params) : resposta;
     return { rows, rowCount: rows.length };
    }
   return { rows: [], rowCount: 0 };
  },
 };
}

const contrato = (extra = {}) => ({
 id: CONTRATO, version: 2, status: 'active', tenant_id: 't1', product_id: 'mentorias', title: 'Mentoria anual',
 amount_minor: '120000', currency: 'BRL', starts_on: '2026-10-01', ends_on: '2027-09-30',
 accepted_at: new Date('2026-09-10T12:00:00Z'), acceptance_reference: 'e-mail de 10/09', organization_name: 'Cliente', ...extra,
});
const linhaDeServico = [
 ['SELECT id,name FROM products', (_, p) => p[1].includes('service_line') ? [{ id: 'mentorias', name: 'TZOLKIN Mentorias' }] : []],
 ['SELECT name,portfolio_kind FROM products', [{ name: 'TZOLKIN Mentorias', portfolio_kind: 'service_line' }]],
];
const parcela = (extra = {}) => ({
 id: PARCELA, plan_id: PLANO, sequence: 1, amount_minor: '40000', currency: 'BRL', due_on: '2026-10-05', status: 'scheduled',
 external_ref: null, invoice_number: null, revision: 3,
 plan_status: 'approved', provider: 'manual', tenant_id: 't1', contract_id: CONTRATO, contract_status: 'active', ...extra,
});
const corpoPlano = (extra = {}) => ({
 contract_id: CONTRATO, contract_version: 2, provider: 'manual', method: 'pix',
 schedule: { count: 3, first_due_on: '2026-10-05' }, ...extra,
});

test('cálculo: datas e parcelas', () => {
 assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'dia que não existe cai no último');
 assert.equal(addMonths('2024-01-31', 1), '2024-02-29', 'bissexto');
 assert.equal(addMonths('2026-11-30', 3), '2027-02-28', 'virada de ano');
 const lista = evenInstallments(100000, 3, '2026-10-31');
 assert.deepEqual(lista.map(p => p.amount_minor), [33334, 33333, 33333], 'o resto vai na primeira');
 assert.equal(lista.reduce((t, p) => t + p.amount_minor, 0), 100000);
 assert.deepEqual(lista.map(p => p.due_on), ['2026-10-31', '2026-11-30', '2026-12-31']);
 for (const ruim of ['2026-02-30', '26-01-01', '2026-13-01', '1999-12-31', 20261001])
  assert.throws(() => isoDate(ruim), e => e.status === 400, String(ruim));
 assert.equal(todayInBrazil(() => Date.parse('2026-09-17T02:00:00Z')), '2026-09-16', 'ainda é dia 16 em Brasília');
});

test('buildPlan fecha exatamente com o contrato', () => {
 const c = contrato();
 assert.deepEqual(buildPlan(corpoPlano(), c).installments.map(p => p.amount_minor), [40000, 40000, 40000]);
 const lista = buildPlan(corpoPlano({ schedule: undefined, installments: [
  { amount_minor: 20000, due_on: '2026-10-05' }, { amount_minor: 100000, due_on: '2026-11-05' },
 ] }), c);
 assert.deepEqual(lista.installments.map(p => [p.sequence, p.currency]), [[1, 'BRL'], [2, 'BRL']]);
 const recusa = (corpo, status, padrao) => assert.throws(() => buildPlan(corpo, c), e => e.status === status && padrao.test(e.message), JSON.stringify(corpo));
 recusa(corpoPlano({ schedule: undefined, installments: [{ amount_minor: 100, due_on: '2026-10-05' }] }), 400, /Precisam fechar exatamente/);
 recusa(corpoPlano({ installments: [{ amount_minor: 120000, due_on: '2026-10-05' }] }), 400, /não os dois/);
 recusa(corpoPlano({ schedule: undefined }), 400, /não os dois/);
 recusa(corpoPlano({ schedule: undefined, installments: [
  { amount_minor: 60000, due_on: '2026-11-05' }, { amount_minor: 60000, due_on: '2026-10-05' },
 ] }), 400, /em ordem/);
 recusa(corpoPlano({ schedule: { count: 61, first_due_on: '2026-10-05' } }), 400, /de 1 a 60/);
 recusa(corpoPlano({ schedule: { count: 3, first_due_on: '2026-10-05' }, total_minor: 1 }), 400, /Campos inválidos/);
 recusa(corpoPlano({ provider: 'asaas' }), 409, /ainda não está disponível/);
 recusa(corpoPlano({ method: 'pix_automatic' }), 400, /Meio de pagamento/);
 assert.throws(() => buildPlan(corpoPlano({ schedule: { count: 3, first_due_on: '2026-10-05' } }), contrato({ amount_minor: '2' })),
  e => e.status === 400 && /pequeno demais/.test(e.message));
});

test('summarize separa pago de disponível e conta vencidas', () => {
 const s = summarize([
  { status: 'scheduled', amount_minor: 100, due_on: '2026-09-01', invoice_number: null },
  { status: 'issued', amount_minor: 200, due_on: '2026-10-01', invoice_number: null },
  { status: 'paid', amount_minor: 300, due_on: '2026-08-01', invoice_number: null },
  { status: 'available', amount_minor: 400, due_on: '2026-07-01', invoice_number: '12' },
  { status: 'canceled', amount_minor: 500, due_on: '2026-06-01', invoice_number: null },
 ], '2026-09-16');
 assert.deepEqual(s, {
  scheduled_minor: 100, issued_minor: 200, paid_minor: 300, available_minor: 400, canceled_minor: 500,
  overdue_minor: 100, overdue_count: 1, invoices_pending: 1,
 });
});

test('prévia não grava e recusa contrato fora da regra', async () => {
 const previa = rotas().get('POST /api/service-receivables/preview');
 const db = banco([['FROM commercial_contracts c', [contrato()]], ...linhaDeServico]);
 const r = await previa({ client: db, operator: BOOT, body: corpoPlano() });
 assert.equal(r.body.preview.installments.length, 3);
 assert.ok(!db.escreveu(), 'prévia não grava');
 assert.ok(!('tenant' in r), 'prévia não vira evento de auditoria');

 const recusa = async (linha, extra, status, padrao) => assert.rejects(
  () => previa({ client: banco([['FROM commercial_contracts c', linha ? [linha] : []], ...extra]), operator: BOOT, body: corpoPlano() }),
  e => e.status === status && padrao.test(e.message));
 await recusa(contrato({ version: 3 }), linhaDeServico, 409, /O contrato mudou/);
 await recusa(contrato({ status: 'draft' }), linhaDeServico, 409, /aceito e ativo/);
 await recusa(null, linhaDeServico, 404, /não encontrado/);
 await recusa(contrato({ product_id: 'skiller' }), [
  ['SELECT id,name FROM products', []],
  ['SELECT name,portfolio_kind FROM products', [{ name: 'TZOLKIN Skiller', portfolio_kind: 'product' }]],
 ], 409, /cobra por oferta e checkout/);
});

test('criar grava plano, parcelas e trilha; plano vivo duplicado vira 409', async () => {
 const criar = rotas().get('POST /api/service-receivables/plans');
 const db = banco([
  ['FROM commercial_contracts c', [contrato()]], ...linhaDeServico,
  ['INSERT INTO service_receivable_plans', (_, p) => [{ id: PLANO, total_minor: String(p[5]), status: 'draft', revision: 1, contract_version: p[1] }]],
  ['INSERT INTO service_installments', (_, p) => p[2].map((s, i) => ({ id: `p${s}`, plan_id: PLANO, sequence: s, amount_minor: String(p[3][i]), due_on: p[4][i], status: 'planned' }))],
 ]);
 const r = await criar({ client: db, operator: MEMBRO_OK(db), body: corpoPlano() });
 assert.equal(r.type, 'service_receivable.plan_created');
 assert.equal(r.tenant, 't1');
 assert.equal(r.body.plan.total_minor, 120000, 'bigint do banco volta como número');
 assert.deepEqual(r.body.plan.installments.map(p => p.amount_minor), [40000, 40000, 40000]);
 const insercao = db.chamadas.find(c => c.sql.includes('INSERT INTO service_receivable_plans'));
 assert.equal(insercao.params[2].acceptance_reference, 'e-mail de 10/09', 'guarda a fotografia do contrato aceito');
 assert.equal(db.chamadas.find(c => c.sql.includes('service_receivable_audit')).params[2], 'plan_created');

 const duplicado = banco([
  ['FROM commercial_contracts c', [contrato()]], ...linhaDeServico,
  ['INSERT INTO service_receivable_plans', () => { throw Object.assign(new Error('dup'), { code: '23505' }); }],
 ]);
 await assert.rejects(() => criar({ client: duplicado, operator: BOOT, body: corpoPlano() }), e => e.status === 409 && /plano de recebimento vivo/.test(e.message));
});

// Membro ativo pode montar rascunho: a consulta de papel devolve member.
function MEMBRO_OK(db) {
 const original = db.query;
 db.query = async (sql, params) => sql.includes('FROM operator_accounts') ? (db.chamadas.push({ sql, params }), { rows: [{ role: 'member' }], rowCount: 1 }) : original(sql, params);
 return MEMBRO;
}

test('dinheiro é do dono: membro não aprova nem mexe em parcela', async () => {
 const r = rotas();
 const membro = () => banco([['FROM operator_accounts', [{ role: 'member' }]]]);
 await assert.rejects(() => r.get('POST /api/service-receivables/plans/:id/approve')({ client: membro(), operator: MEMBRO, params: { id: PLANO }, body: { revision: 1 } }), e => e.status === 403);
 for (const acao of ['issue', 'reschedule', 'payment', 'cancel', 'invoice'])
  await assert.rejects(() => r.get(`POST /api/service-receivables/installments/:id/${acao}`)({ client: membro(), operator: MEMBRO, params: { id: PARCELA }, body: { revision: 3 } }),
   e => e.status === 403, acao);
});

test('aprovar exige rascunho e contrato não cancelado', async () => {
 const aprovar = rotas().get('POST /api/service-receivables/plans/:id/approve');
 const plano = extra => [{ id: PLANO, contract_id: CONTRATO, tenant_id: 't1', status: 'draft', revision: 1, total_minor: '120000', ...extra }];
 await assert.rejects(() => aprovar({ client: banco([['FROM service_receivable_plans p WHERE p.id', plano({ revision: 2 })]]), operator: BOOT, params: { id: PLANO }, body: { revision: 1 } }),
  e => e.status === 409 && /outra pessoa/.test(e.message));
 await assert.rejects(() => aprovar({ client: banco([['FROM service_receivable_plans p WHERE p.id', plano({ status: 'approved' })]]), operator: BOOT, params: { id: PLANO }, body: { revision: 1 } }),
  e => e.status === 409 && /rascunho/.test(e.message));
 await assert.rejects(() => aprovar({ client: banco([
  ['FROM service_receivable_plans p WHERE p.id', plano()], ['SELECT status FROM commercial_contracts', [{ status: 'canceled' }]],
 ]), operator: BOOT, params: { id: PLANO }, body: { revision: 1 } }), e => e.status === 409 && /cancelado/.test(e.message));
 const db = banco([
  ['FROM service_receivable_plans p WHERE p.id', plano()], ['SELECT status FROM commercial_contracts', [{ status: 'active' }]],
  ['UPDATE service_receivable_plans', plano({ status: 'approved', revision: 2 })],
 ]);
 const ok = await aprovar({ client: db, operator: BOOT, params: { id: PLANO }, body: { revision: 1 } });
 assert.equal(ok.body.plan.status, 'approved');
 assert.ok(db.chamadas.some(c => /SET status='scheduled'/.test(c.sql)), 'parcelas passam a ser cobráveis');
});

test('ações de parcela respeitam a situação', async () => {
 const r = rotas();
 const acao = (nome, linha, body, extra = []) => r.get(`POST /api/service-receivables/installments/:id/${nome}`)({
  client: banco([['FROM service_installments i\n     JOIN', [linha]], ['UPDATE service_installments i', (_, p) => [{ ...linha, status: 'x', revision: 4 }]], ...extra]),
  operator: BOOT, params: { id: PARCELA }, body: { revision: 3, ...body },
 });
 await assert.rejects(() => acao('issue', parcela({ plan_status: 'draft' }), { external_ref: 'cobre-1' }), e => e.status === 409 && /aprovado/.test(e.message));
 await assert.rejects(() => acao('issue', parcela({ provider: 'asaas' }), { external_ref: 'cobre-1' }), e => e.status === 409 && /processador integrado/.test(e.message));
 await assert.rejects(() => acao('issue', parcela({ contract_status: 'canceled' }), { external_ref: 'cobre-1' }), e => e.status === 409 && /cancelado/.test(e.message));
 await assert.rejects(() => acao('issue', parcela(), { external_ref: 'cobre-1', external_url: 'http://link' }), e => e.status === 400 && /https/.test(e.message));
 await assert.doesNotReject(() => acao('issue', parcela(), { external_ref: 'cobre-1', external_url: 'https://pay.exemplo/abc' }));
 await assert.rejects(() => acao('reschedule', parcela({ status: 'issued' }), { due_on: '2026-10-10' }), e => e.status === 409 && /sem cobrança/.test(e.message));
 await assert.rejects(() => acao('payment', parcela(), { paid_on: '2026-09-17' }), e => e.status === 400 && /futuro/.test(e.message));
 await assert.doesNotReject(() => acao('payment', parcela({ status: 'issued' }), { paid_on: '2026-09-16' }));
 await assert.rejects(() => acao('cancel', parcela({ status: 'paid' }), { reason: 'desistiu' }), e => e.status === 409 && /estorno/.test(e.message));
 await assert.rejects(() => acao('invoice', parcela(), { number: '123', issued_on: '2026-09-16' }), e => e.status === 409 && /cobrada ou paga/.test(e.message));
 await assert.rejects(() => acao('invoice', parcela({ status: 'paid', invoice_number: '99' }), { number: '123', issued_on: '2026-09-16' }), e => e.status === 409 && /já tem a NFS-e 99/.test(e.message));
 await assert.rejects(() => acao('payment', parcela(), { paid_on: '2026-09-16', available: true }), e => e.status === 400 && /Campos inválidos/.test(e.message), 'disponível não entra por aqui');
 await assert.rejects(() => r.get('POST /api/service-receivables/installments/:id/issue')({
  client: banco([['FROM service_installments i\n     JOIN', [parcela()]], ['UPDATE service_installments i', () => { throw Object.assign(new Error('dup'), { code: '23505' }); }]]),
  operator: BOOT, params: { id: PARCELA }, body: { revision: 3, external_ref: 'repetida' },
 }), e => e.status === 409 && /outra parcela/.test(e.message));
});

test('cancelar plano com parcela movimentada vira 409; rascunho o membro descarta', async () => {
 const cancelar = rotas().get('POST /api/service-receivables/plans/:id/cancel');
 const plano = extra => [{ id: PLANO, contract_id: CONTRATO, tenant_id: 't1', status: 'approved', revision: 5, total_minor: '1', ...extra }];
 await assert.rejects(() => cancelar({ client: banco([
  ['FROM service_receivable_plans p WHERE p.id', plano()], ["status IN ('issued','paid','available')", [{ n: 2 }]],
 ]), operator: BOOT, params: { id: PLANO }, body: { revision: 5, reason: 'refazer' } }), e => e.status === 409 && /2 parcela/.test(e.message));
 await assert.rejects(() => cancelar({ client: banco([
  ['FROM operator_accounts', [{ role: 'member' }]], ['FROM service_receivable_plans p WHERE p.id', plano()],
 ]), operator: MEMBRO, params: { id: PLANO }, body: { revision: 5, reason: 'refazer' } }), e => e.status === 403, 'aprovado só o dono cancela');
 const db = banco([
  ['FROM operator_accounts', [{ role: 'member' }]], ['FROM service_receivable_plans p WHERE p.id', plano({ status: 'draft' })],
  ["status IN ('issued','paid','available')", [{ n: 0 }]], ['UPDATE service_receivable_plans', plano({ status: 'canceled' })],
 ]);
 const ok = await cancelar({ client: db, operator: MEMBRO, params: { id: PLANO }, body: { revision: 5, reason: 'valores errados' } });
 assert.equal(ok.body.plan.status, 'canceled');
});
