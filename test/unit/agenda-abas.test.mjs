// Acompanhamento: o tipo da atividade virou aba (Call · Task · Registro), a categoria passou a vir da contratação,
// o Local é escolhido numa lista e o link da reunião saiu do formulário (pedido do dono em 2026-10-06).
//
// Camadas 1 e 2 de docs/TESTING.md: as contas e as regras vivem em agenda-model.js e em tracking-model.mjs, e são
// exercitadas direto; do que só existe na tela (o formulário) se lê o fonte, como ux-guards faz. Sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../../apps/web/public/agenda-model.js';
import { KINDS, KINDS_DE_SERIE, activityInput, activityUpdateInput, serieInput } from '../../apps/api/src/platform/tracking-model.mjs';
import { trackingRoutes } from '../../apps/api/src/modules/tracking.mjs';
import { criarDetector, criarDetectorRegistro, COLUNAS_048, TABELAS_048, MENSAGEM_054 } from '../../apps/api/src/platform/agenda-recursos.mjs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const ler = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');
const id = '00000000-0000-4000-8000-000000000001', empresa = '00000000-0000-4000-8000-0000000000aa';
const base = { id, tenant_id: empresa, category: 'mentoria', kind: 'sessao', title: 'Sessão', starts_at: '2026-10-06T10:00:00-03:00', ends_at: '2026-10-06T11:00:00-03:00' };
const falha = (fn, status = 400) => assert.throws(fn, e => e.status === status, `esperava ${status}`);

// ============================== a aba é o tipo ==============================
test('cada tipo gravado abre na aba dele, e a aba grava o tipo de volta', () => {
 assert.deepEqual(M.ABAS, ['call', 'task', 'registro']);
 assert.equal(M.abaDoKind('sessao'), 'call');
 for (const kind of ['tarefa', 'entregavel', 'feature']) assert.equal(M.abaDoKind(kind), 'task', kind);
 assert.equal(M.abaDoKind('registro'), 'registro');
 assert.equal(M.abaDoKind('o-que-vier-depois'), 'task', 'tipo desconhecido cai na aba que mostra mais');
 assert.equal(M.kindDaAba('call'), 'sessao');
 assert.equal(M.kindDaAba('task'), 'tarefa');
 assert.equal(M.kindDaAba('registro'), 'registro');
 // Editar e salvar não pode reescrever o tipo de uma atividade antiga.
 for (const kind of ['entregavel', 'feature', 'tarefa']) assert.equal(M.kindDaAba('task', kind), kind, kind);
 assert.equal(M.kindDaAba('call', 'entregavel'), 'sessao', 'trocar de aba troca o tipo');
 // Ida e volta: toda aba grava um tipo que o banco aceita e que volta para a mesma aba.
 for (const aba of M.ABAS) { const kind = M.kindDaAba(aba); assert.ok(KINDS.includes(kind), kind); assert.equal(M.abaDoKind(kind), aba); }
 assert.ok(M.ABAS.every(aba => M.ROTULO_DA_ABA[aba]), 'toda aba tem rótulo');
});

test('Meet é só de Call; horário é obrigatório fora do Registro', () => {
 assert.equal(M.abaComMeet('call'), true);
 assert.equal(M.abaComMeet('task'), false);
 assert.equal(M.abaComMeet('registro'), false);
 assert.equal(M.abaExigeHorario('call'), true);
 assert.equal(M.abaExigeHorario('task'), true, 'início e prazo são a diferença da Task para o Registro');
 assert.equal(M.abaExigeHorario('registro'), false);
});

test('Registro sem data ganha um horário coerente (o banco exige início e fim)', () => {
 const agora = Date.parse('2026-10-06T14:07:30-03:00');
 const h = M.horarioDoRegistro(agora);
 assert.equal(M.paraCampoLocal(h.ini), '2026-10-06T14:00', 'desce ao passo da grade, não inventa minuto quebrado');
 assert.ok(h.fim > h.ini, 'o banco exige fim depois do início');
 assert.equal(M.diaDe(h.ini), '2026-10-06', 'cai no dia em que o registro foi feito');
 assert.equal((h.fim - h.ini) / 60000, 30, 'duração mínima da grade, não um compromisso de uma hora');
 // Virada do dia em Brasília: o registro das 23h50 não escorrega para o dia seguinte.
 const noite = M.horarioDoRegistro(Date.parse('2026-10-06T23:50:00-03:00'));
 assert.equal(M.diaDe(noite.ini), '2026-10-06');
});

// ============================== categoria vem da contratação ==============================
test('a categoria vem da contratação do cliente e sempre é uma das do banco', () => {
 for (const modelo of ['on_demand', 'education', 'consulting', 'advisory', 'product', 'unclassified'])
  assert.ok(M.CATEGORIAS.includes(M.categoriaDaContratacao({ service_model: modelo })), modelo);
 assert.equal(M.categoriaDaContratacao({ service_model: 'education' }), 'mentoria');
 assert.equal(M.categoriaDaContratacao({ service_model: 'advisory' }), 'assessoria', 'assessoria mapeia para assessoria a partir da migração 055');
 assert.equal(M.categoriaDaContratacao(null), 'outro', 'geral da empresa não herda nada');
 assert.equal(M.categoriaDaContratacao({ service_model: 'inventado' }), 'outro');
});

test('a linha que substituiu o campo Categoria diz de onde ela vem', () => {
 assert.equal(M.textoDaCategoria({ service_model: 'education', label: 'Mentoria Alfa' }), 'Categoria Mentoria, da contratação Mentoria Alfa.');
 assert.equal(M.textoDaCategoria(null), 'Categoria Outro: sem contratação, vale o geral da empresa.');
 assert.equal(M.textoDaCategoria({ service_model: 'education', label: 'Mentoria Alfa' }, 'software'), 'Categoria Software, escolhida quando a atividade foi criada.', 'editando, mostra a que está gravada');
 for (const texto of [M.textoDaCategoria(null), M.textoDaCategoria({ service_model: 'product', label: 'X' })]) assert.doesNotMatch(texto, /undefined/);
});

// ============================== local escolhido, não digitado ==============================
test('os locais da lista são os que o Core conhece, sem repetir e em ordem', () => {
 const atividades = [{ location: 'Sala 2' }, { location: 'sala 2' }, { location: '  ' }, { location: null }, { location: 'Café da esquina' }, {}];
 assert.deepEqual(M.locaisConhecidos(atividades, ['Google Meet']), ['Café da esquina', 'Google Meet', 'Sala 2']);
 assert.deepEqual(M.locaisConhecidos(atividades, ['']), ['Café da esquina', 'Sala 2'], 'local padrão vazio não entra');
 assert.deepEqual(M.locaisConhecidos([{ location: 'cafe da esquina' }], ['Café da esquina']), ['Café da esquina'], 'acento e caixa não criam duas opções');
 assert.deepEqual(M.locaisConhecidos(), []);
 assert.deepEqual(M.locaisConhecidos([], ['Escritório', undefined, null]), ['Escritório'], 'o local da atividade aberta pode faltar');
});

// ============================== preferência de janela (centro, popup, lateral) ==============================
test('a escolha de como mostrar a janela fica neste navegador e recusa valor estranho', async () => {
 const deposito = new Map();
 globalThis.localStorage = { getItem: k => deposito.get(k) ?? null, setItem: (k, v) => deposito.set(k, v), removeItem: k => deposito.delete(k) };
 const prefs = await import('../../apps/web/public/agenda-prefs.js');
 assert.equal(prefs.janelaDoEvento(), 'centro', 'sem escolha, a janela de sempre');
 prefs.definirJanelaDoEvento('lateral');
 assert.equal(prefs.janelaDoEvento(), 'lateral');
 prefs.definirJanelaDoEvento('centro');
 assert.equal(deposito.has('tzolkin-agenda-janela'), false, 'o padrão apaga a chave em vez de gravá-lo');
 prefs.definirJanelaDoEvento('cheia');
 assert.equal(prefs.janelaDoEvento(), 'cheia');
 prefs.definirJanelaDoEvento('gaveta');
 assert.equal(prefs.janelaDoEvento(), 'centro', 'valor inválido não é gravado e a leitura cai no padrão');
 deposito.set('tzolkin-agenda-janela', 'lixo');
 assert.equal(prefs.janelaDoEvento(), 'centro', 'valor velho ou estranho no armazenamento cai no padrão');
 assert.deepEqual(prefs.JANELAS.map(([k]) => k), ['centro', 'cheia', 'lateral']);
 // Armazenamento bloqueado (navegação privada): lê o padrão e não quebra.
 globalThis.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
 assert.equal(prefs.janelaDoEvento(), 'centro');
 assert.doesNotThrow(() => prefs.definirJanelaDoEvento('cheia'));
 delete globalThis.localStorage;
});

// ============================== backend: 'registro' depende da 054 ==============================
test('a validação aceita registro na atividade e recusa numa série', () => {
 assert.deepEqual(KINDS, ['sessao', 'entregavel', 'feature', 'tarefa', 'registro']);
 assert.ok(!KINDS_DE_SERIE.includes('registro'), 'repetir um registro não quer dizer nada');
 assert.equal(activityInput({ ...base, kind: 'registro' }).kind, 'registro');
 assert.equal(activityUpdateInput({ revision: 1, kind: 'registro' }).campos.kind, 'registro');
 const serie = { id, tenant_id: empresa, category: 'outro', kind: 'tarefa', title: 'Fechamento', frequency: 'monthly', month_day: 10, start_time: '09:00', duration_minutes: 30, starts_on: '2026-10-01' };
 assert.equal(serieInput(serie).kind, 'tarefa');
 falha(() => serieInput({ ...serie, kind: 'registro' }));
 falha(() => activityInput({ ...base, kind: 'nao-existe' }));
});

const COM_047_048 = { rows: [{ campos: 3, colunas: COLUNAS_048.length, tabelas: TABELAS_048.length }] };
function banco({ registro = 0, responder = () => null } = {}) {
 const log = [];
 const resp = (sql, params = []) => {
  log.push({ sql, params });
  if (sql.includes('information_schema')) return COM_047_048;
  if (sql.includes('pg_constraint')) return { rows: [{ tipo: registro }] };
  return responder(sql, params) ?? { rows: [], rowCount: 0 };
 };
 return { log, query: async (sql, p) => resp(sql, p), async connect() { return { query: async (sql, p) => resp(sql, p), release() {} }; } };
}
const rotas = () => { const r = {}; trackingRoutes({ get(p, h) { r['GET ' + p] = h; }, post(p, h) { r['POST ' + p] = h; }, put(p, h) { r['PUT ' + p] = h; }, delete(p, h) { r['DELETE ' + p] = h; } }, { detector: criarDetector(), registro: criarDetectorRegistro() }); return r; };
const corpo = b => ({ headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(b)); } });
const chamar = async (rota, extra) => { let resposta; await rota({ reply(s, b) { resposta = { status: s, body: b }; }, operator: { email: 'op@x.com', subject: 's1' }, ...extra }); return resposta; };
const comeco = (db, prefixo) => db.log.filter(q => q.sql.trim().startsWith(prefixo));

test('GET conta à tela se o banco já aceita Registro', async () => {
 const semA054 = banco();
 const r = await chamar(rotas()['GET /api/tracking'], { pool: semA054, url: new URL('http://x/api/tracking?month=2026-10') });
 assert.equal(r.body.agenda_registro, false, 'sem a 054 a tela não oferece a aba');
 const comA054 = banco({ registro: 1 });
 const r2 = await chamar(rotas()['GET /api/tracking'], { pool: comA054, url: new URL('http://x/api/tracking?month=2026-10') });
 assert.equal(r2.body.agenda_registro, true);
 assert.equal(r2.body.agenda_campos, true, 'o detector das outras migrações continua respondendo o que respondia');
});

test('gravar Registro sem a 054 no banco dá 409 com texto claro, não erro de CHECK', async () => {
 const insere = sql => sql.startsWith('INSERT INTO service_activities') ? { rows: [{ ...base, kind: 'registro' }] } : null;
 const semA054 = banco({ responder: insere });
 await assert.rejects(() => chamar(rotas()['POST /api/tracking'], { pool: semA054, req: corpo({ ...base, kind: 'registro' }) }), e => e.status === 409 && e.message === MENSAGEM_054);
 assert.equal(comeco(semA054, 'INSERT INTO service_activities').length, 0, 'nem tentou inserir');
 assert.ok(semA054.log.some(q => q.sql.includes('ROLLBACK')), 'a transação volta atrás');
 const comA054 = banco({ registro: 1, responder: insere });
 const r = await chamar(rotas()['POST /api/tracking'], { pool: comA054, req: corpo({ ...base, kind: 'registro' }) });
 assert.equal(r.status, 200);
 assert.equal(comeco(comA054, 'INSERT INTO service_activities').length, 1);
 // Os tipos de sempre não perguntam nada ao banco sobre a 054 e gravam como antes.
 const sessao = banco({ responder: insere });
 await chamar(rotas()['POST /api/tracking'], { pool: sessao, req: corpo(base) });
 assert.equal(comeco(sessao, 'INSERT INTO service_activities').length, 1);
});

test('trocar o tipo de uma atividade para Registro também espera a 054', async () => {
 const atualiza = sql => sql.startsWith('UPDATE service_activities') ? { rows: [{ ...base, revision: 2 }] } : null;
 const semA054 = banco({ responder: atualiza });
 await assert.rejects(() => chamar(rotas()['PUT /api/tracking/:id'], { pool: semA054, params: { id }, req: corpo({ revision: 1, kind: 'registro' }) }), e => e.status === 409 && e.message === MENSAGEM_054);
 assert.equal(comeco(semA054, 'UPDATE service_activities').length, 0);
 const comA054 = banco({ registro: 1, responder: atualiza });
 const r = await chamar(rotas()['PUT /api/tracking/:id'], { pool: comA054, params: { id }, req: corpo({ revision: 1, kind: 'registro' }) });
 assert.equal(r.status, 200);
});

test('detector da 054: pergunta uma vez, lembra o sim e volta a perguntar enquanto é não', async () => {
 let t = 0, perguntas = 0, resposta = { rows: [{ tipo: 0 }] };
 const d = criarDetectorRegistro({ ttl: 1000, relogio: () => t });
 const db = { query: async sql => { perguntas++; assert.match(sql, /pg_constraint/); return resposta; } };
 assert.equal(await d(db), false);
 assert.equal(await d(db), false);
 assert.equal(perguntas, 1, 'o não é lembrado pelo ttl');
 t = 1500; resposta = { rows: [{ tipo: 1 }] };
 assert.equal(await d(db), true, 'depois do ttl enxerga a migração nova');
 t = 10000; resposta = { rows: [{ tipo: 0 }] };
 assert.equal(await d(db), true, 'o sim não volta a falso');
 assert.equal(perguntas, 2, 'e não pergunta mais');
 const vazio = criarDetectorRegistro();
 assert.equal(await vazio({ query: async () => ({ rows: [] }) }), false, 'banco que não responde nada não vira sim');
});

// ============================== a migração 054 ==============================
test('a 054 só troca o CHECK do tipo da atividade, e a lista casa com a do código', () => {
 const sql = readFileSync(new URL('../../db/migrations/054_acompanhamento_registro.sql', import.meta.url), 'utf8');
 const semComentario = sql.replace(/--.*$/gm, '');
 const drops = (semComentario.match(/DROP\s+CONSTRAINT[^;]*/gi) || []).map(d => d.replace(/\s+/g, ' '));
 assert.deepEqual(drops, ['DROP CONSTRAINT IF EXISTS service_activities_kind_check'], 'o único DROP é o CHECK que é recriado na linha seguinte');
 for (const proibido of [/DROP TABLE/i, /DROP COLUMN/i, /\bDELETE\b/i, /\bUPDATE\b/i, /CREATE TABLE/i]) assert.doesNotMatch(semComentario, proibido, `a migração não deveria ter ${proibido}`);
 assert.doesNotMatch(semComentario, /service_activity_series/, 'série não aceita registro: o CHECK dela fica como está');
 assert.doesNotMatch(semComentario, /\b(BEGIN|COMMIT)\b/, 'a transação é do migrate.mjs, não do arquivo');
 const lista = semComentario.match(/CHECK \(kind IN \(([^)]*)\)\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
 assert.deepEqual(lista, KINDS, 'a lista do banco e a do código são a mesma');
 assert.match(sql, /APLICADA em 2026-10-07/, 'o cabeçalho registra quando foi aplicada ao banco compartilhado');
});

// ============================== o que só existe na tela ==============================
test('o formulário da atividade não pergunta mais categoria, tipo nem link da reunião', () => {
 const fonte = ler('agenda-evento.js');
 const campos = [...fonte.matchAll(/campo\((\w+), '([^']*)'/g)].map(m => m[2]);
 assert.ok(campos.length >= 6, 'a leitura dos campos do formulário falhou');
 for (const sumiu of ['Categoria', 'Tipo', 'Link da reunião (opcional)']) assert.ok(!campos.includes(sumiu), `${sumiu} saiu do formulário`);
 for (const ficou of ['Título', 'Cliente', 'Contratação (opcional)', 'Descrição (opcional)']) assert.ok(campos.includes(ficou), `${ficou} continua no formulário`);
 // O link sai do formulário, mas não do dado nem da visualização.
 assert.match(fonte, /rotulo: 'Link da reunião'/, 'a visualização continua mostrando o link já gravado');
 assert.ok(!/meeting_url:/.test(fonte.replace(/^.*engagement_service_model.*$/gm, '')), 'nada no editor grava meeting_url: quem cria a sala é o Google');
});

test('as abas do tipo são acessíveis de teclado porque usam o componente de abas da casa', () => {
 const fonte = ler('agenda-evento.js');
 assert.match(fonte, /import \{ mountTabs \} from '\.\/tabs\.js'/);
 assert.match(fonte, /host: abasHost, tabs: abasDoTipo\.map/);
 assert.match(fonte, /panelId: form\.id/, 'as abas apontam para o painel que elas comandam');
 assert.match(fonte, /form\.setAttribute\('role', 'tabpanel'\)/);
 assert.match(fonte, /aria-labelledby/);
 // Os três ícones ao lado do X existem em icons.js (icons-registry confere nome por nome; aqui confere que são três).
 const icones = fonte.match(/const ICONE_DA_JANELA = Object\.freeze\(\{([^}]*)\}/)[1];
 assert.deepEqual([...icones.matchAll(/'([a-z-]+)'/g)].map(m => m[1]), ['window-center', 'fullscreen', 'window-side']);
 const definidos = ler('icons.js');
 for (const nome of ['window-center', 'fullscreen', 'window-side']) assert.ok(definidos.includes(`"${nome}":[[`), nome);
});

test('cada modo de janela tem a classe que o CSS desenha', () => {
 const css = readFileSync(new URL('tracking.css', PUBLIC), 'utf8');
 for (const classe of ['ag-janela-cheia', 'ag-janela-lateral']) assert.ok(css.includes('.' + classe), classe);
 assert.match(css, /\.ag-janelas button\[aria-pressed="true"\]/, 'o modo escolhido se vê no ícone');
 assert.match(css, /\.ag-abas/, 'a barra de abas do diálogo tem recuo próprio (ela fica fora do formulário)');
});
