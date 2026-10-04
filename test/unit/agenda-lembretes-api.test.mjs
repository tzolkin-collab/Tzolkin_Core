// Agenda: lembretes por atividade, preferências e séries recorrentes (migração 048) — validação, rotas, jobs e coerência com o SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityInput, activityUpdateInput, lembretes, serieInput, serieUpdateInput, serieEncerrarInput, preferenciasInput, LEMBRETES_PERMITIDOS } from '../../apps/api/src/platform/tracking-model.mjs';
import { trackingRoutes } from '../../apps/api/src/modules/tracking.mjs';
import { agendaRoutes, gerarOcorrencias } from '../../apps/api/src/modules/agenda.mjs';
import { enviarLembretes, estenderSeries, iniciarJobsDaAgenda, JANELA_MIN } from '../../apps/api/src/modules/agenda-jobs.mjs';
import { pushRoutes } from '../../apps/api/src/modules/push.mjs';
import { payloadLembrete, textoDaAntecedencia, TOPICOS } from '../../apps/api/src/platform/webpush.mjs';
import { criarDetector, COLUNAS_048, TABELAS_048, MENSAGEM_047, MENSAGEM_048 } from '../../apps/api/src/platform/agenda-recursos.mjs';
import { ocorrencias } from '../../apps/api/src/platform/recorrencia.mjs';
import { createCore } from '../../apps/api/src/app.mjs';

const id = '00000000-0000-4000-8000-000000000001', outroId = '00000000-0000-4000-8000-000000000002', empresa = '00000000-0000-4000-8000-0000000000aa';
const base = { id, tenant_id: empresa, category: 'mentoria', kind: 'sessao', title: 'Sessão', starts_at: '2026-10-05T10:00:00-03:00', ends_at: '2026-10-05T11:00:00-03:00' };
const falha = (fn, status = 400) => assert.throws(fn, e => e.status === status, `esperava ${status}`);
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
const AGORA = Date.parse('2026-10-04T15:00:00Z');          // domingo 12:00 em Brasília; hoje = 2026-10-04
const relogio = () => AGORA;

// ---------- banco simulado ----------
const COM_048 = { rows: [{ campos: 3, colunas: COLUNAS_048.length, tabelas: TABELAS_048.length }] };
const SO_047 = { rows: [{ campos: 3, colunas: 0, tabelas: 0 }] };
const SEM_NADA = { rows: [{ campos: 0, colunas: 0, tabelas: 0 }] };
function banco({ recursos = COM_048, responder = () => null } = {}) {
 const log = [];
 const resp = (sql, params = []) => {
  log.push({ sql, params });
  if (sql.includes('information_schema')) return recursos;
  return responder(sql, params) ?? { rows: [], rowCount: 0 };
 };
 return { log, query: async (sql, params) => resp(sql, params), async connect() { return { query: async (sql, params) => resp(sql, params), release() {} }; } };
}
const fim = (db, prefixo) => db.log.filter(q => q.sql.trim().startsWith(prefixo));
function rotas(opcoes = {}) {
 const r = {}, roteador = { get(p, h) { r['GET ' + p] = h; }, post(p, h) { r['POST ' + p] = h; }, put(p, h) { r['PUT ' + p] = h; } };
 const detector = opcoes.detector ?? criarDetector();
 trackingRoutes(roteador, { detector }); agendaRoutes(roteador, { detector, relogio });
 return r;
}
const chamar = async (rota, extra) => { let resposta; await rota({ reply(s, b) { resposta = { status: s, body: b }; }, operator: { email: 'op@x.com', subject: 's1' }, ...extra }); return resposta; };

// ============================== validação ==============================
test('lembretes: até 3 antecedências da lista, da maior para a menor, sem repetição; [] é "não avisar"', () => {
 assert.deepEqual(lembretes([15, 60, 15]), [60, 15]);
 assert.deepEqual(lembretes([0, 1440, 30]), [1440, 30, 0]);
 assert.deepEqual(lembretes([]), []);
 for (const ruim of [[7], [-5], [1.5], ['15'], [15, 60, 120, 1440], 15, null, 'x', [null], [10081]]) falha(() => lembretes(ruim));
 assert.ok(LEMBRETES_PERMITIDOS.includes(0) && LEMBRETES_PERMITIDOS.includes(10080));
});

test('atividade: sem lembrete = padrão (a chave nem entra); com lista, ela manda; [] = não avisar', () => {
 assert.ok(!('reminders' in activityInput(base)));
 assert.ok(!('reminders' in activityInput({ ...base, reminders: null })));
 assert.deepEqual(activityInput({ ...base, reminders: [15, 60] }).reminders, [60, 15]);
 assert.deepEqual(activityInput({ ...base, reminders: [] }).reminders, []);
 falha(() => activityInput({ ...base, reminders: [7] }));
});

test('edição: reminders null volta ao padrão, [] não avisa, lista inválida é recusada', () => {
 assert.deepEqual(activityUpdateInput({ revision: 1, reminders: null }).campos, { reminders: null });
 assert.deepEqual(activityUpdateInput({ revision: 1, reminders: [] }).campos, { reminders: [] });
 assert.deepEqual(activityUpdateInput({ revision: 1, reminders: [5, 30] }).campos, { reminders: [30, 5] });
 falha(() => activityUpdateInput({ revision: 1, reminders: [7] }));
});

const SERIE = { id, tenant_id: empresa, category: 'mentoria', kind: 'sessao', title: 'Mentoria semanal', frequency: 'weekly', weekdays: [0, 2], start_time: '14:30', duration_minutes: 60, starts_on: '2026-10-05' };
test('série: semanal ou mensal, normalizada, com o que a regra exige', () => {
 const s = serieInput({ ...SERIE, weekdays: [2, 0, 2], reminders: [15] });
 assert.deepEqual([s.frequency, s.weekdays, s.month_day, s.interval_n, s.reminders], ['weekly', [0, 2], null, 1, [15]]);
 const m = serieInput({ id, tenant_id: empresa, category: 'outro', kind: 'tarefa', title: 'Fechamento', frequency: 'monthly', month_day: 31, start_time: '09:00', duration_minutes: 30, starts_on: '2026-10-01', ends_on: '2027-12-31', interval_n: 2 });
 assert.deepEqual([m.frequency, m.month_day, m.weekdays, m.interval_n, m.ends_on], ['monthly', 31, null, 2, '2027-12-31']);
 assert.equal(serieInput({ ...SERIE, engagement_id: '' }).engagement_id, null);
 assert.equal(serieInput({ ...SERIE, count_limit: 10 }).count_limit, 10);
});

test('série: recusa o que não faz sentido', () => {
 const ruins = [
  { frequency: 'daily' }, { frequency: undefined },
  { weekdays: [] }, { weekdays: [7] }, { weekdays: [-1] }, { weekdays: [1.5] }, { weekdays: 'seg' }, { weekdays: undefined },
  { month_day: 15 },                                            // semanal não usa dia do mês
  { start_time: '24:00' }, { start_time: '9:00' }, { start_time: '14:60' }, { start_time: undefined },
  { duration_minutes: 4 }, { duration_minutes: 1441 }, { duration_minutes: 30.5 },
  { starts_on: '2026-02-30' }, { starts_on: '26-10-05' }, { starts_on: undefined },
  { ends_on: '2026-10-04' },                                    // fim antes do início
  { count_limit: 0 }, { count_limit: 367 }, { count_limit: 1.5 },
  { interval_n: 0 }, { interval_n: 13 },
  { id: 'x' }, { tenant_id: 'x' }, { title: 'a' }, { category: 'x' }, { kind: 'x' },
  { cor: 'vermelho' }, { meeting_url: 'http://x.com' }, { reminders: [7] },
 ];
 for (const r of ruins) falha(() => serieInput({ ...SERIE, ...r }), 400);
 // mensal não usa dias da semana; e exige o dia do mês
 const M = { ...SERIE, frequency: 'monthly', month_day: 10 }; delete M.weekdays;
 serieInput(M);
 for (const r of [{ weekdays: [0] }, { month_day: 0 }, { month_day: 32 }, { month_day: undefined }]) falha(() => serieInput({ ...M, ...r }));
});

test('série: edição, encerramento e preferências', () => {
 assert.deepEqual(serieUpdateInput({ revision: 2, title: 'Novo título', start_time: '10:00', duration_minutes: 45, reminders: null }).campos, { title: 'Novo título', start_time: '10:00', duration_minutes: 45, reminders: null });
 for (const ruim of [{ revision: 2 }, { title: 'sem revisão' }, { revision: 2, frequency: 'monthly' }, { revision: 2, weekdays: [1] }, { revision: 2, starts_on: '2026-10-05' }, { revision: 0, title: 'ok ok' }, { revision: 2, start_time: '99:00' }]) falha(() => serieUpdateInput(ruim));
 assert.deepEqual(serieEncerrarInput({ revision: 3 }), { revision: 3, from: null });
 assert.equal(serieEncerrarInput({ revision: 3, from: '2026-10-12T17:30:00-03:00' }).from, '2026-10-12T20:30:00.000Z');
 for (const ruim of [{}, { revision: 0 }, { revision: 1, from: 'ontem' }, { revision: 1, extra: 1 }]) falha(() => serieEncerrarInput(ruim));
 assert.deepEqual(preferenciasInput({ revision: 1, default_reminders: [15, 60] }), { revision: 1, default_reminders: [60, 15] });
 assert.deepEqual(preferenciasInput({ revision: 1, default_reminders: [] }).default_reminders, []);
 for (const ruim of [{ default_reminders: [15] }, { revision: 1 }, { revision: 1, default_reminders: [7] }, { revision: 1, default_reminders: null }]) falha(() => preferenciasInput(ruim));
});

// ============================== coerência com o SQL ==============================
const sql048 = readFileSync(new URL('../../db/migrations/048_agenda_lembretes_e_series.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('migração 048: as listas do código são as do banco (antecedências, tópicos, colunas e tabelas)', () => {
 const listas = [...sql048.matchAll(/ARRAY\[((?:\d+,?)+)\]/g)].map(m => m[1].split(',').map(Number)).filter(l => l.length > 7);
 assert.ok(listas.length >= 3, 'preferências, séries e atividades têm o CHECK de antecedências');
 for (const l of listas) assert.deepEqual(l, [...LEMBRETES_PERMITIDOS], 'o CHECK do banco e LEMBRETES_PERMITIDOS são a mesma lista');
 assert.match(sql048, new RegExp(`ARRAY\\[${TOPICOS.map(t => `'${t}'`).join(',')}\\]::text\\[\\]`), 'tópicos de push do CHECK = TOPICOS do código');
 for (const coluna of COLUNAS_048) assert.match(sql048, new RegExp(`ADD COLUMN IF NOT EXISTS ${coluna}\\b`), `coluna ${coluna} criada na 048`);
 for (const tabela of TABELAS_048) assert.match(sql048, new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\b`), `tabela ${tabela} criada na 048`);
});

test('migração 048: só adiciona e é repetível (nada de apagar, conceder ou reescrever dados)', () => {
 const semComentario = sql048.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
 for (const proibido of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bALTER\s+TABLE\s+\w+\s+(ALTER|RENAME)\b/i, /^\s*UPDATE\b/im])
  assert.doesNotMatch(semComentario, proibido, String(proibido));
 const drops = semComentario.match(/DROP\s+CONSTRAINT[^;]*/gi) || [];
 assert.deepEqual(drops.map(d => d.replace(/\s+/g, ' ')), ['DROP CONSTRAINT IF EXISTS push_subscriptions_topics_valid'], 'o único DROP é o CHECK de tópicos, recriado na sequência');
 for (const m of semComentario.matchAll(/CREATE TABLE (?!IF NOT EXISTS)(\w+)/gi)) assert.fail('CREATE TABLE sem IF NOT EXISTS: ' + m[1]);
 for (const m of semComentario.matchAll(/ADD COLUMN (?!IF NOT EXISTS)/gi)) assert.fail('ADD COLUMN sem IF NOT EXISTS');
});

// ============================== detecção das migrações ==============================
test('detector: 047 e 048 são independentes, a 048 exige a 047, e verdadeiro nunca volta a falso', async () => {
 const pergunta = async (linhas, ttl = 60000) => { const d = criarDetector({ ttl, relogio: () => 0 }); return d({ query: async () => linhas }); };
 assert.deepEqual(await pergunta(SEM_NADA), { campos: false, lembretes: false });
 assert.deepEqual(await pergunta(SO_047), { campos: true, lembretes: false });
 assert.deepEqual(await pergunta(COM_048), { campos: true, lembretes: true });
 assert.deepEqual(await pergunta({ rows: [{ campos: 0, colunas: 5, tabelas: 4 }] }), { campos: false, lembretes: false }, '048 sem a 047 não vale');
 assert.deepEqual(await pergunta({ rows: [{ campos: 3, colunas: 4, tabelas: 4 }] }), { campos: true, lembretes: false }, 'faltou uma coluna da 048');
 assert.deepEqual(await pergunta({ rows: [{ campos: 3, colunas: 5, tabelas: 3 }] }), { campos: true, lembretes: false }, 'faltou uma tabela da 048');
 let t = 0, perguntas = 0, resposta = SEM_NADA;
 const d = criarDetector({ ttl: 1000, relogio: () => t });
 const db = { query: async () => { perguntas++; return resposta; } };
 await d(db); await d(db); assert.equal(perguntas, 1, 'falso é lembrado pelo ttl');
 t = 1500; resposta = COM_048; assert.equal((await d(db)).lembretes, true, 'depois do ttl enxerga a migração nova');
 resposta = SEM_NADA; t = 10000; await d(db); assert.equal(perguntas, 2, 'verdadeiro não pergunta mais');
 assert.equal((await d(db)).lembretes, true, 'e não volta a falso');
});

// ============================== rotas de atividade ==============================
test('GET: com a 048 filtra as arquivadas e devolve as séries da janela e o padrão de lembrete; sem a 048 é como antes', async () => {
 const serieDoBanco = { id: outroId, frequency: 'weekly', interval_n: 1, weekdays: [0, 2], start_time: '14:30', duration_minutes: 60, ends_on: '2026-12-31' };
 const db = banco({ responder: (sql) => sql.includes('FROM service_activities a JOIN tenants') ? { rows: [{ id, series_id: outroId }] } : sql.includes('FROM service_activity_series') ? { rows: [serieDoBanco] } : sql.includes('agenda_preferences') ? { rows: [{ default_reminders: [30], revision: 4 }] } : null });
 const r = await chamar(rotas()['GET /api/tracking'], { pool: db, url: new URL('http://x/api/tracking?from=2026-10-05&to=2026-10-12') });
 assert.match(fim(db, 'SELECT a.*')[0].sql, /AND a\.archived_at IS NULL/);
 assert.equal(r.body.agenda_lembretes, true); assert.equal(r.body.agenda_campos, true);
 assert.deepEqual(r.body.series, [{ ...serieDoBanco, descricao: 'Toda segunda e quarta, até 31/12/2026' }], 'a regra vem com o texto pronto'); assert.deepEqual(r.body.agenda_prefs, { default_reminders: [30], revision: 4 });
 assert.deepEqual(fim(db, 'SELECT id,frequency')[0].params, [[outroId]], 'só pede as séries que aparecem na janela');

 const antigo = banco({ recursos: SO_047 });
 const r2 = await chamar(rotas()['GET /api/tracking'], { pool: antigo, url: new URL('http://x/api/tracking?month=2026-10') });
 assert.doesNotMatch(fim(antigo, 'SELECT a.*')[0].sql, /archived_at/, 'sem a 048 a coluna nem é citada');
 assert.equal(r2.body.agenda_lembretes, false); assert.deepEqual(r2.body.series, []); assert.equal(r2.body.agenda_prefs, null);
 assert.equal(fim(antigo, 'SELECT id,frequency').length, 0);
});

test('POST de atividade: lembretes entram no INSERT; sem a 048 a API recusa com a mensagem certa; sem lembretes nada muda', async () => {
 const db = banco({ responder: sql => sql.startsWith('INSERT INTO service_activities') ? { rows: [{ ...base }] } : null });
 const post = rotas()['POST /api/tracking'];
 await chamar(post, { pool: db, req: corpo({ ...base, reminders: [15, 60] }) });
 const ins = fim(db, 'INSERT INTO service_activities')[0];
 assert.match(ins.sql, /\(id,tenant_id,category,kind,title,starts_at,ends_at,engagement_id,reminders\)/);
 assert.deepEqual(ins.params.at(-1), [60, 15]);
 const antigo = banco({ recursos: SO_047, responder: sql => sql.startsWith('INSERT INTO service_activities') ? { rows: [{ ...base }] } : null });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking'], { pool: antigo, req: corpo({ ...base, reminders: [15] }) }), e => e.status === 409 && e.message === MENSAGEM_048);
 await assert.rejects(() => chamar(rotas()['POST /api/tracking'], { pool: banco({ recursos: SEM_NADA }), req: corpo({ ...base, description: 'x' }) }), e => e.status === 409 && e.message === MENSAGEM_047);
 await chamar(rotas()['POST /api/tracking'], { pool: antigo, req: corpo(base) });
 assert.equal(fim(antigo, 'INSERT INTO service_activities').length, 1, 'sem lembrete e sem campo novo, grava normalmente mesmo sem a 048');
});

test('POST idempotente com lembretes: o mesmo pedido de novo devolve o que existe (lista compara por conteúdo, não por referência)', async () => {
 const gravada = { ...base, starts_at: new Date(base.starts_at), ends_at: new Date(base.ends_at), engagement_id: null, reminders: [60, 15] };
 const db = banco({ responder: sql => sql.startsWith('INSERT INTO service_activities') ? { rows: [] } : sql.startsWith('SELECT * FROM service_activities') ? { rows: [gravada] } : null });
 const r = await chamar(rotas()['POST /api/tracking'], { pool: db, req: corpo({ ...base, reminders: [15, 60] }) });
 assert.equal(r.status, 200);
 await assert.rejects(() => chamar(rotas()['POST /api/tracking'], { pool: db, req: corpo({ ...base, reminders: [15] }) }), e => e.status === 409);
});

test('PUT de atividade: marca a ocorrência de série como "mexida à mão" quando a 048 existe, e nunca cita a coluna quando não existe', async () => {
 const com = banco({ responder: sql => sql.startsWith('UPDATE service_activities') ? { rows: [{ ...base, revision: 2 }] } : null });
 await chamar(rotas()['PUT /api/tracking/:id'], { pool: com, params: { id }, req: corpo({ revision: 1, title: 'Só o título' }) });
 assert.match(fim(com, 'UPDATE service_activities')[0].sql, /series_detached=\(series_detached OR series_id IS NOT NULL\)/);
 await chamar(rotas()['PUT /api/tracking/:id'], { pool: com, params: { id }, req: corpo({ revision: 1, reminders: null }) });
 const up = fim(com, 'UPDATE service_activities')[1];
 assert.match(up.sql, /SET reminders=\$3,series_detached=/); assert.deepEqual(up.params, [id, 1, null]);
 const antigo = banco({ recursos: SO_047, responder: sql => sql.startsWith('UPDATE service_activities') ? { rows: [{ ...base, revision: 2 }] } : null });
 await chamar(rotas()['PUT /api/tracking/:id'], { pool: antigo, params: { id }, req: corpo({ revision: 1, title: 'Só o título' }) });
 assert.doesNotMatch(fim(antigo, 'UPDATE service_activities')[0].sql, /series_detached/);
 await assert.rejects(() => chamar(rotas()['PUT /api/tracking/:id'], { pool: antigo, params: { id }, req: corpo({ revision: 1, reminders: [15] }) }), e => e.status === 409 && e.message === MENSAGEM_048);
});

// ============================== preferências ==============================
test('preferências: GET diz se está disponível; PUT grava com revisão e recusa sem a 048', async () => {
 const antigo = banco({ recursos: SO_047 });
 const r0 = await chamar(rotas()['GET /api/agenda/preferencias'], { pool: antigo });
 assert.deepEqual(r0.body, { disponivel: false, default_reminders: [15], revision: 1 });
 const db = banco({ responder: sql => sql.startsWith('SELECT default_reminders') ? { rows: [{ default_reminders: [60], revision: 3 }] } : sql.startsWith('UPDATE agenda_preferences') ? { rows: [{ default_reminders: [30, 5], revision: 4 }] } : null });
 assert.deepEqual((await chamar(rotas()['GET /api/agenda/preferencias'], { pool: db })).body, { disponivel: true, default_reminders: [60], revision: 3 });
 const r = await chamar(rotas()['PUT /api/agenda/preferencias'], { pool: db, req: corpo({ revision: 3, default_reminders: [5, 30] }) });
 assert.deepEqual(r.body, { disponivel: true, default_reminders: [30, 5], revision: 4 });
 const up = fim(db, 'UPDATE agenda_preferences')[0];
 assert.deepEqual(up.params, [[30, 5], 'op@x.com', 3], 'lista ordenada, quem alterou e a revisão lida');
 const velho = banco({ responder: () => null });
 await assert.rejects(() => chamar(rotas()['PUT /api/agenda/preferencias'.replace('preferencias', 'preferencias')], { pool: velho, req: corpo({ revision: 1, default_reminders: [15] }) }), e => e.status === 409 && /alteradas por outra pessoa/.test(e.message));
 await assert.rejects(() => chamar(rotas()['PUT /api/agenda/preferencias'], { pool: antigo, req: corpo({ revision: 1, default_reminders: [15] }) }), e => e.status === 409 && e.message === MENSAGEM_048);
 await assert.rejects(() => chamar(rotas()['PUT /api/agenda/preferencias'], { pool: db, req: corpo({ revision: 1, default_reminders: [7] }) }), e => e.status === 400);
});

// ============================== séries ==============================
test('criar série: grava a regra, gera as ocorrências no horário de Brasília, guarda até onde gerou e audita', async () => {
 const db = banco({ responder: (sql, p) => {
  if (sql.startsWith('INSERT INTO service_activity_series')) return { rows: [{ id }] };
  if (sql.startsWith('INSERT INTO service_activities')) return { rows: p[10].map(() => ({ id: 'x' })), rowCount: p[10].length };
  if (sql.startsWith('UPDATE service_activity_series SET generated_until')) return { rows: [{ id, generated_until: p[1] }] };
  return null;
 } });
 const r = await chamar(rotas()['POST /api/tracking/series'], { pool: db, req: corpo({ ...SERIE, count_limit: 4, reminders: [15] }) });
 assert.equal(r.body.criadas, 4); assert.equal(r.body.repetido, false);
 const ins = fim(db, 'INSERT INTO service_activities')[0];
 assert.match(ins.sql, /unnest\(\$11::timestamptz\[\],\$12::timestamptz\[\],\$13::int\[\]\)/);
 assert.match(ins.sql, /ON CONFLICT DO NOTHING/);
 const [inicios, fins, ordinais] = [ins.params[10], ins.params[11], ins.params[12]];
 assert.deepEqual(inicios, ['2026-10-05T17:30:00.000Z', '2026-10-07T17:30:00.000Z', '2026-10-12T17:30:00.000Z', '2026-10-14T17:30:00.000Z'], 'segunda e quarta, 14:30 de Brasília');
 assert.deepEqual(fins, ['2026-10-05T18:30:00.000Z', '2026-10-07T18:30:00.000Z', '2026-10-12T18:30:00.000Z', '2026-10-14T18:30:00.000Z'], '60 min depois');
 assert.deepEqual(ordinais, [0, 1, 2, 3]);
 assert.deepEqual([ins.params[0], ins.params[3], ins.params[4], ins.params[8], ins.params[9]], [empresa, 'sessao', 'Mentoria semanal', [15], id], 'cada ocorrência herda os dados e o lembrete da série');
 assert.equal(fim(db, 'UPDATE service_activity_series SET generated_until')[0].params[1], '2026-10-14');
 assert.equal(fim(db, 'INSERT INTO service_activity_series_audit').length, 1);
 assert.deepEqual(db.log.map(q => q.sql.trim().split(/\s+/)[0]).filter(x => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(x)), ['BEGIN', 'COMMIT']);
});

test('criar série sem fim: gera 13 meses à frente; o mesmo pedido de novo não duplica; outro conteúdo no mesmo id é conflito', async () => {
 const dbSemFim = banco({ responder: (sql, p) => sql.startsWith('INSERT INTO service_activity_series') ? { rows: [{ id }] } : sql.startsWith('INSERT INTO service_activities') ? { rows: [], rowCount: p[10].length } : sql.startsWith('UPDATE service_activity_series SET generated_until') ? { rows: [{ id }] } : null });
 const r = await chamar(rotas()['POST /api/tracking/series'], { pool: dbSemFim, req: corpo({ ...SERIE, weekdays: [0] }) });
 assert.ok(r.body.criadas >= 57 && r.body.criadas <= 58, 'uma por semana por ~13 meses: ' + r.body.criadas);
 const existente = { id, tenant_id: empresa, title: 'Mentoria semanal', frequency: 'weekly' };
 const repetido = banco({ responder: sql => sql.startsWith('SELECT * FROM service_activity_series') ? { rows: [existente] } : null });
 const r2 = await chamar(rotas()['POST /api/tracking/series'], { pool: repetido, req: corpo(SERIE) });
 assert.deepEqual([r2.body.repetido, r2.body.criadas], [true, 0]);
 assert.equal(fim(repetido, 'INSERT INTO service_activities').length, 0, 'não gera de novo');
 const outra = banco({ responder: sql => sql.startsWith('SELECT * FROM service_activity_series') ? { rows: [{ ...existente, title: 'Outra' }] } : null });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series'], { pool: outra, req: corpo(SERIE) }), e => e.status === 409);
});

test('criar série: recusa sem a 048, contratação de outra empresa e repetição que não gera data nenhuma', async () => {
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series'], { pool: banco({ recursos: SO_047 }), req: corpo(SERIE) }), e => e.status === 409 && e.message === MENSAGEM_048);
 const outraEmpresa = banco({ responder: sql => sql.startsWith('SELECT tenant_id,archived_at') ? { rows: [{ tenant_id: outroId, archived_at: null }] } : null });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series'], { pool: outraEmpresa, req: corpo({ ...SERIE, engagement_id: outroId }) }), e => e.status === 400);
 const arquivada = banco({ responder: sql => sql.startsWith('SELECT tenant_id,archived_at') ? { rows: [{ tenant_id: empresa, archived_at: new Date() }] } : null });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series'], { pool: arquivada, req: corpo({ ...SERIE, engagement_id: outroId }) }), e => e.status === 400);
 const vazia = banco({ responder: sql => sql.startsWith('INSERT INTO service_activity_series') ? { rows: [{ id }] } : null });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series'], { pool: vazia, req: corpo({ ...SERIE, weekdays: [0], starts_on: '2026-10-07', ends_on: '2026-10-09' }) }), e => e.status === 400 && /nenhuma data/.test(e.message));
 assert.ok(vazia.log.some(q => q.sql.trim() === 'ROLLBACK'), 'a série vazia não fica gravada');
});

test('editar série: troca os dados das próximas ocorrências planejadas e não mexidas; o horário preserva o dia de cada uma', async () => {
 const db = banco({ responder: (sql, p) => sql.startsWith('UPDATE service_activity_series') ? { rows: [{ id, hhmm: '10:00', duration_minutes: 45 }] } : sql.startsWith('UPDATE service_activities') ? { rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 } : null });
 const r = await chamar(rotas()['PUT /api/tracking/series/:id'], { pool: db, params: { id }, req: corpo({ revision: 2, title: 'Novo', start_time: '10:00', duration_minutes: 45, reminders: [30] }) });
 assert.equal(r.body.atualizadas, 2);
 const s = fim(db, 'UPDATE service_activity_series')[0];
 assert.match(s.sql, /SET title=\$3,start_time=\$4,duration_minutes=\$5,reminders=\$6,revision=revision\+1/);
 assert.match(s.sql, /ended_at IS NULL/, 'série encerrada não se edita');
 assert.deepEqual(s.params, [id, 2, 'Novo', '10:00', 45, [30]]);
 const a = fim(db, 'UPDATE service_activities')[0];
 assert.match(a.sql, /a\.series_id=\$1 AND a\.status='planned' AND a\.series_detached=false AND a\.archived_at IS NULL AND a\.starts_at>=\$2::timestamptz/);
 assert.match(a.sql, /title=\$3,reminders=\$4/);
 assert.match(a.sql, /starts_at=\(\(a\.starts_at AT TIME ZONE 'America\/Sao_Paulo'\)::date \+ \$5::time\) AT TIME ZONE 'America\/Sao_Paulo'/);
 assert.match(a.sql, /ends_at=\(\(\(a\.starts_at AT TIME ZONE 'America\/Sao_Paulo'\)::date \+ \$5::time\) AT TIME ZONE 'America\/Sao_Paulo'\) \+ \(\$6::int \* interval '1 minute'\)/);
 assert.deepEqual(a.params, [id, new Date(AGORA).toISOString(), 'Novo', [30], '10:00', 45]);
 assert.equal(fim(db, 'INSERT INTO service_activity_series_audit').length, 1);
});

test('editar série: só lembretes não mexe em horário; só horário não mexe nos outros campos; revisão velha é 409', async () => {
 const db = banco({ responder: sql => sql.startsWith('UPDATE service_activity_series') ? { rows: [{ id, hhmm: '14:30', duration_minutes: 60 }] } : sql.startsWith('UPDATE service_activities') ? { rows: [], rowCount: 0 } : null });
 await chamar(rotas()['PUT /api/tracking/series/:id'], { pool: db, params: { id }, req: corpo({ revision: 1, reminders: null }) });
 const a = fim(db, 'UPDATE service_activities')[0];
 assert.doesNotMatch(a.sql, /starts_at=/); assert.match(a.sql, /reminders=\$3/); assert.deepEqual(a.params.slice(2), [null]);
 await chamar(rotas()['PUT /api/tracking/series/:id'], { pool: db, params: { id }, req: corpo({ revision: 1, duration_minutes: 90 }) });
 const b = fim(db, 'UPDATE service_activities')[1];
 assert.doesNotMatch(b.sql, /title=|reminders=/); assert.match(b.sql, /starts_at=/);
 const velha = banco({ responder: () => null });
 await assert.rejects(() => chamar(rotas()['PUT /api/tracking/series/:id'], { pool: velha, params: { id }, req: corpo({ revision: 1, title: 'ok ok' }) }), e => e.status === 409);
 await assert.rejects(() => chamar(rotas()['PUT /api/tracking/series/:id'], { pool: banco({ recursos: SO_047 }), params: { id }, req: corpo({ revision: 1, title: 'ok ok' }) }), e => e.status === 409 && e.message === MENSAGEM_048);
 await assert.rejects(() => chamar(rotas()['PUT /api/tracking/series/:id'], { pool: db, params: { id: 'x' }, req: corpo({ revision: 1, title: 'ok ok' }) }), e => e.status === 400);
});

test('encerrar série: arquiva as futuras planejadas (a role não apaga), preserva o passado e aceita "a partir deste evento"', async () => {
 const db = banco({ responder: sql => sql.startsWith('UPDATE service_activity_series') ? { rows: [{ id }] } : sql.startsWith('UPDATE service_activities') ? { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rowCount: 3 } : null });
 const r = await chamar(rotas()['POST /api/tracking/series/:id/end'], { pool: db, params: { id }, req: corpo({ revision: 2 }) });
 assert.equal(r.body.arquivadas, 3);
 const a = fim(db, 'UPDATE service_activities')[0];
 assert.match(a.sql, /SET archived_at=now\(\)/); assert.match(a.sql, /status='planned' AND archived_at IS NULL AND starts_at>=\$2::timestamptz/);
 assert.doesNotMatch(a.sql, /DELETE/i);
 assert.deepEqual(a.params, [id, new Date(AGORA).toISOString()], 'sem "from", a partir de agora');
 await chamar(rotas()['POST /api/tracking/series/:id/end'], { pool: db, params: { id }, req: corpo({ revision: 3, from: '2026-10-12T14:30:00-03:00' }) });
 assert.equal(fim(db, 'UPDATE service_activities')[1].params[1], '2026-10-12T17:30:00.000Z');
 assert.match(fim(db, 'UPDATE service_activity_series')[0].sql, /ended_at IS NULL/, 'encerrar duas vezes dá 409');
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series/:id/end'], { pool: banco({ responder: () => null }), params: { id }, req: corpo({ revision: 1 }) }), e => e.status === 409);
 await assert.rejects(() => chamar(rotas()['POST /api/tracking/series/:id/end'], { pool: banco({ recursos: SEM_NADA }), params: { id }, req: corpo({ revision: 1 }) }), e => e.status === 409 && e.message === MENSAGEM_048);
});

test('gerarOcorrencias: só da posição pedida em diante (é o que o job usa para estender sem duplicar)', async () => {
 const chamadas = [];
 const c = { query: async (sql, p) => { chamadas.push(p); return { rows: p[10].map(() => ({})), rowCount: p[10].length }; } };
 const serie = { ...SERIE, weekdays: [0], start_time: '14:30', duration_minutes: 60, count_limit: 6 };
 const todas = ocorrencias(serie, '2026-10-04');
 const r = await gerarOcorrencias(c, serie, { hoje: '2026-10-04', desdeOrdinal: 4 });
 assert.equal(r.criadas, 2); assert.deepEqual(chamadas[0][12], [4, 5]); assert.equal(r.ultimoDia, todas.at(-1).dia);
 assert.deepEqual(await gerarOcorrencias(c, serie, { hoje: '2026-10-04', desdeOrdinal: 6 }), { criadas: 0, ultimoDia: null }, 'nada a gerar: nem consulta o banco');
 assert.equal(chamadas.length, 1);
});

// ============================== lembretes ==============================
const venceu = (extra = {}) => ({ id, title: 'Mentoria Alfa', starts_at: new Date('2026-10-05T17:30:00Z'), empresa: 'Empresa Alfa', minutos: 15, ...extra });
test('lembretes: manda o push dos vencidos com título, empresa e horário, e registra quantos aparelhos receberam', async () => {
 const enviados = [];
 const db = banco({ responder: sql => sql.includes('agenda_reminders_sent') && sql.includes('WITH padrao') ? { rows: [venceu(), venceu({ id: outroId, title: 'Workshop', minutos: 0 })] } : null });
 const r = await enviarLembretes(db, { enviar: () => {}, detector: criarDetector(), agora: relogio, notificar: async (pool, topico, payload) => { enviados.push({ topico, payload }); return { enviados: 2 }; } });
 assert.deepEqual(r, { devidos: 2, enviados: 4, falhas: 0 });
 assert.deepEqual(enviados.map(e => e.topico), ['agenda.lembrete', 'agenda.lembrete']);
 assert.deepEqual(enviados[0].payload, { title: 'Daqui a 15 min — Mentoria Alfa', body: 'Empresa Alfa · 14:30', tag: `agenda:${id}:15`, view: 'tracking' });
 assert.equal(enviados[1].payload.title, 'Agora — Workshop');
 const consulta = db.log.find(q => q.sql.includes('WITH padrao'));
 assert.deepEqual(consulta.params, [new Date(AGORA).toISOString(), JANELA_MIN]);
 assert.deepEqual(fim(db, 'UPDATE agenda_reminders_sent')[0].params, [id, 15, 2], 'quantos aparelhos receberam');
});

test('lembretes: a consulta só pega atividade planejada e não arquivada, usa o padrão quando a atividade não escolheu, e grava antes de enviar', async () => {
 const db = banco();
 await enviarLembretes(db, { enviar: () => {}, agora: relogio, notificar: async () => ({ enviados: 0 }) });
 const sql = db.log.find(q => q.sql.includes('WITH padrao')).sql.replace(/\s+/g, ' ');
 assert.match(sql, /a\.status='planned' AND a\.archived_at IS NULL/);
 assert.match(sql, /unnest\(COALESCE\(a\.reminders,\(SELECT m FROM padrao\),ARRAY\[\]::int\[\]\)\)/, 'NULL = padrão; {} = não avisar');
 assert.match(sql, /a\.starts_at-\(x\.min\*interval '1 minute'\)<=\$1::timestamptz/);
 assert.match(sql, /a\.starts_at-\(x\.min\*interval '1 minute'\)>\$1::timestamptz-\(\$2::int\*interval '1 minute'\)/, 'janela: não manda aviso muito atrasado');
 assert.match(sql, /INSERT INTO agenda_reminders_sent\(activity_id,minutes\) SELECT id,minutos FROM candidatas ON CONFLICT DO NOTHING RETURNING/, 'a linha de "enviado" só volta para quem a gravou primeiro: um aviso só');
 assert.match(sql, /JOIN novas n ON n\.activity_id=c\.id AND n\.minutes=c\.minutos/, 'só envia o que acabou de registrar');
});

test('lembretes: push desligado, banco sem a 048 e falha de um envio não derrubam nada', async () => {
 const db = banco();
 assert.deepEqual(await enviarLembretes(db, { enviar: null }), { desligado: true });
 assert.equal(db.log.length, 0, 'sem chaves VAPID nem consulta o banco');
 assert.deepEqual(await enviarLembretes(banco({ recursos: SO_047 }), { enviar: () => {}, notificar: async () => assert.fail() }), { indisponivel: true });
 let n = 0;
 const dois = banco({ responder: sql => sql.includes('WITH padrao') ? { rows: [venceu(), venceu({ id: outroId })] } : null });
 const r = await enviarLembretes(dois, { enviar: () => {}, agora: relogio, notificar: async () => { if (++n === 1) throw new Error('serviço de push fora do ar'); return { enviados: 1 }; } });
 assert.deepEqual(r, { devidos: 2, enviados: 1, falhas: 1 }, 'o segundo ainda sai');
});

// ============================== extensão das séries ==============================
test('estender séries: gera só da posição seguinte à última, em transação por série, e uma série com erro não impede as outras', async () => {
 const regra = (idSerie, ultimo) => ({ ...SERIE, id: idSerie, weekdays: [0], count_limit: null, ends_on: null, start_time: '14:30', duration_minutes: 60, starts_on: '2026-10-05', ultimo, engagement_id: null, description: null, location: null, meeting_url: null, reminders: null, interval_n: 1, month_day: null });
 const lista = [regra(id, 56), regra(outroId, 3)];
 const comandos = [], inserts = [];
 let falhar = id;
 const db = {
  query: async sql => ({ rows: sql.includes('FROM service_activity_series s') ? lista : [] }),
  async connect() { return { release() {}, query: async (sql, p) => {
   comandos.push(sql.trim().split(/\s+/)[0]);
   if (sql.startsWith('INSERT INTO service_activities')) { if (p[9] === falhar) throw new Error('banco recusou'); inserts.push({ serie: p[9], ordinais: p[12] }); return { rows: p[10].map(() => ({})), rowCount: p[10].length }; }
   return { rows: [], rowCount: 0 };
  } }; },
 };
 // (a detecção usa db.query; o fake devolve rows vazias para ela, então passa um detector pronto)
 const detector = async () => ({ campos: true, lembretes: true });
 const r = await estenderSeries(db, { detector, agora: relogio });
 assert.deepEqual([r.series, r.falhas], [2, 1], 'a primeira falhou');
 assert.ok(comandos.includes('ROLLBACK'), 'a que falhou desfaz');
 assert.equal(inserts.length, 1); assert.equal(inserts[0].serie, outroId);
 assert.equal(inserts[0].ordinais[0], 4, 'continua da posição 4 (a última gerada era a 3)');
 assert.deepEqual(inserts[0].ordinais, inserts[0].ordinais.map((_, i) => 4 + i), 'posições contínuas');
 assert.ok(r.criadas > 40, 'estendeu até o horizonte: ' + r.criadas);
 falhar = null;
 const semNada = await estenderSeries({ ...db, query: async () => ({ rows: [] }) }, { detector });
 assert.deepEqual(semNada, { series: 0, criadas: 0, falhas: 0 });
 assert.deepEqual(await estenderSeries(db, { detector: async () => ({ campos: true, lembretes: false }) }), { indisponivel: true });
});

test('jobs da agenda: o ciclo seguinte não se sobrepõe ao que ainda está rodando, e dá para desligar', async () => {
 let consultas = 0, liberar;
 const trava = new Promise(ok => { liberar = ok; });
 const db = { query: async sql => { if (sql.includes('WITH padrao')) { consultas++; await trava; } return { rows: [] }; } };
 const logs = [];
 const parar = iniciarJobsDaAgenda({ pool: db, enviar: () => {}, detector: async () => ({ campos: true, lembretes: true }), log: { log: m => logs.push(m), error: m => logs.push(m) }, cadaMs: 5, seriesCadaMs: 3600000, primeiraSerieEmMs: 3600000 });
 await new Promise(r => setTimeout(r, 60));
 assert.equal(consultas, 1, 'enquanto o primeiro não termina, os outros ciclos esperam');
 liberar(); await new Promise(r => setTimeout(r, 30));
 const depois = consultas;
 parar(); await new Promise(r => setTimeout(r, 40));
 assert.equal(consultas, depois, 'depois de desligar não roda mais');
});

test('jobs da agenda: erro vira log e o servidor continua', async () => {
 const logs = [];
 const db = { query: async () => { throw new Error('banco caiu'); } };
 const parar = iniciarJobsDaAgenda({ pool: db, enviar: () => {}, detector: async () => ({ lembretes: true }), log: { log() {}, error: (...a) => logs.push(a.join(' ')) }, cadaMs: 5, seriesCadaMs: 3600000, primeiraSerieEmMs: 3600000 });
 await new Promise(r => setTimeout(r, 40)); parar();
 assert.ok(logs.some(l => /lembretes falhou/.test(l) && /banco caiu/.test(l)), logs.join('|'));
});

// ============================== texto do aviso ==============================
test('texto do lembrete: quanto falta, no tom de um aviso', () => {
 const t = Object.fromEntries([0, 5, 15, 30, 60, 120, 1440, 2880, 10080].map(m => [m, textoDaAntecedencia(m)]));
 assert.deepEqual(t, { 0: 'Agora', 5: 'Daqui a 5 min', 15: 'Daqui a 15 min', 30: 'Daqui a 30 min', 60: 'Daqui a 1 h', 120: 'Daqui a 2 h', 1440: 'Amanhã', 2880: 'Em 2 dias', 10080: 'Em 1 semana' });
});

test('payload do lembrete: só título, empresa e horário (nada de descrição, local ou link na tela bloqueada); uma tag por atividade e antecedência', () => {
 const p = payloadLembrete({ titulo: 'Mentoria', empresa: 'Alfa', inicio: Date.parse('2026-10-05T17:30:00Z'), minutos: 60, atividadeId: id });
 assert.deepEqual(p, { title: 'Daqui a 1 h — Mentoria', body: 'Alfa · 14:30', tag: `agenda:${id}:60`, view: 'tracking' });
 assert.deepEqual(Object.keys(p).sort(), ['body', 'tag', 'title', 'view']);
 assert.notEqual(payloadLembrete({ titulo: 'x', empresa: '', inicio: 0, minutos: 15, atividadeId: id }).tag, payloadLembrete({ titulo: 'x', empresa: '', inicio: 0, minutos: 60, atividadeId: id }).tag, 'dois lembretes da mesma atividade são duas notificações');
 assert.equal(payloadLembrete({ titulo: 'x'.repeat(300), empresa: 'y'.repeat(300), inicio: 0, minutos: 0, atividadeId: id }).title.length <= 120, true);
 assert.equal(payloadLembrete({ titulo: 'Meia-noite', empresa: '', inicio: Date.parse('2026-10-05T03:00:00Z'), minutos: 0, atividadeId: id }).body, '00:00', 'sem empresa, só a hora; e a hora é a de Brasília');
});

// ============================== push: status do aparelho ==============================
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
test('push/status: diz se ESTE aparelho está assinado por quem pediu, sem devolver endpoint nem chaves', async () => {
 const registro = {}; const roteador = { get() {}, put() {}, delete() {}, post(p, h, o) { registro[p] = { h, o }; } };
 pushRoutes(roteador, { config: { publicKey: 'p', privateKey: 'k', subject: 'https://x.com' } });
 const { h, o } = registro['/api/push/status'];
 assert.deepEqual(o, { transactional: true, audit: false }, 'rota transacional, sem auditoria (assinatura não é de organização)');
 const consultas = [];
 const client = { query: async (sql, p) => { consultas.push(p); return { rows: p[1] === 's1' ? [{ id, topics: ['agenda.lembrete'] }] : [] }; } };
 let r = await h({ client, body: { endpoint: ENDPOINT }, operator: { subject: 's1' } });
 assert.deepEqual(r.response, { subscribed: true, id, topics: ['agenda.lembrete'] });
 assert.ok(!JSON.stringify(r).includes(ENDPOINT) && !/p256dh|auth/.test(JSON.stringify(r)));
 r = await h({ client, body: { endpoint: ENDPOINT }, operator: { subject: 'outra-pessoa' } });
 assert.deepEqual(r.response, { subscribed: false }, 'o aparelho de outro operador não aparece');
 assert.deepEqual(consultas.map(p => p[1]), ['s1', 'outra-pessoa'], 'sempre filtrado pelo operador da sessão');
 for (const ruim of [{ endpoint: 'http://fcm.googleapis.com/x' }, { endpoint: 'https://evil.com/x' }, { endpoint: 'https://fcm.googleapis.com:8443/x' }, {}, { endpoint: ENDPOINT, extra: 1 }])
  await assert.rejects(() => h({ client, body: ruim, operator: { subject: 's1' } }), e => e.status === 400);
});

// ============================== as rotas existem e pedem login ==============================
test('rotas novas registradas no Core e protegidas por sessão', async () => {
 const servidor = createCore({ pool: { query() { assert.fail('sem sessão não consulta o banco'); } }, adminPassword: 'test-agenda-password-only', deployRegistry: [] });
 await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
 const base = `http://127.0.0.1:${servidor.address().port}`;
 try {
  const chama = async (metodo, caminho) => (await fetch(base + caminho, { method: metodo, headers: { 'content-type': 'application/json', origin: base }, body: metodo === 'GET' ? undefined : '{}' })).status;
  for (const [m, c] of [['GET', '/api/agenda/preferencias'], ['PUT', '/api/agenda/preferencias'], ['POST', '/api/tracking/series'], ['PUT', `/api/tracking/series/${id}`], ['POST', `/api/tracking/series/${id}/end`], ['POST', '/api/push/status'], ['PUT', `/api/tracking/${id}`]])
   assert.equal(await chama(m, c), 401, `${m} ${c} deveria pedir login (401), não 404/405`);
 } finally { servidor.closeAllConnections(); await new Promise(ok => servidor.close(ok)); }
});
