import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateIntake, commercialIntakeRoutes, canonical } from '../../apps/api/src/modules/commercial-intake.mjs';
import { digest } from '../../apps/api/src/platform/session.mjs';

const base = () => ({
 lead: { name: 'Maria Silva', email: 'maria@clinica.com.br', whatsapp: '31999990000' },
 organization: { name: 'Clínica Sorriso', slug: 'clinica-sorriso', organization_type: 'company' },
 stakeholder: { role: 'owner' },
 commercial: { product_id: 'sites', service_model: 'on_demand', label: 'Site' },
 attribution: { source_system: 'tzolkin-sites', source_ref: 'lead-1', channel: 'website', utm_source: 'meta', utm_medium: 'cpc', utm_campaign: 'corretor-lancamento', landing_page: '/corretores', referrer: 'https://l.instagram.com' },
 privacy: {},
});
const comAtribuicao = extra => { const b = base(); Object.assign(b.attribution, extra); return b; };
const intake = b => validateIntake(b, 'sites');
const ERRO400 = { status: 400 };

const FBP = 'fb.1.1727700000000.1234567890';
const FBC = 'fb.1.1727700000000.IwAR0abcdefghijklmnopq';
const COMPLETA = {
 utm_term: 'site para corretor', utm_tzolkin: 'Sites.Corretor',
 meta_campaign_id: '120210000000001', meta_adset_id: '120210000000002', meta_ad_id: 120210000000003,
 fbclid: 'IwAR0abcdefghijklmnopq', gclid: 'Cj0KCQjw_abc123', fbc: FBC, fbp: FBP,
 session_key: 'a1b2c3d4-e5f6-7890', first_touch_at: '2026-09-25T12:00:00Z',
 last_touch: { at: '2026-10-01T10:00:00Z', utm_source: 'meta', utm_campaign: 'corretor-lancamento', utm_tzolkin: 'sites.corretor', meta_ad_id: '120210000000003', landing_page: '/corretores' },
 session: { first_seen_at: '2026-09-25T12:00:00Z', last_seen_at: '2026-10-01T10:05:00Z', pageviews: 7, duration_seconds: 412, consent: 'granted',
  events: [{ name: 'ViewContent', at: '2026-10-01T10:00:10Z', event_id: 'vc.123' }, { name: 'Lead', at: '2026-10-01T10:05:00Z', event_id: 'ld.456' }] },
 geo: { city: 'Belo Horizonte', region: 'MG', country: 'BR', latitude: -19.91667, longitude: -43.93333, precision: 'ip' },
};

test('pedido ANTIGO gera a mesma atribuição de antes: 7 chaves, sem campo novo (o hash de idempotência não muda)', () => {
 const v = intake(base());
 assert.deepEqual(Object.keys(v.attribution).sort(), ['channel', 'landing_page', 'referrer', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source']);
 assert.equal(v.attribution.utm_content, null, 'os 7 campos de sempre continuam null quando ausentes');
 // o mesmo pedido, normalizado duas vezes, tem o mesmo hash
 assert.equal(digest(canonical(intake(base()))), digest(canonical(v)));
});

test('a atribuição completa é aceita e normalizada', () => {
 const v = intake(comAtribuicao(COMPLETA));
 const a = v.attribution;
 assert.equal(a.utm_tzolkin, 'sites.corretor', 'minúsculo');
 assert.equal(a.meta_ad_id, '120210000000003', 'id numérico vira texto');
 assert.equal(a.utm_term, 'site para corretor');
 assert.equal(a.fbp, FBP); assert.equal(a.fbc, FBC);
 assert.equal(a.session_key, 'a1b2c3d4-e5f6-7890');
 assert.equal(a.first_touch_at, '2026-09-25T12:00:00.000Z');
 assert.equal(a.last_touch.utm_tzolkin, 'sites.corretor');
 assert.equal(a.last_touch.at, '2026-10-01T10:00:00.000Z');
 assert.equal(a.session.events.length, 2);
 assert.equal(a.session.pageviews, 7);
 // coordenada por IP: ~1 km (2 casas). Mais que isso seria precisão inventada.
 assert.deepEqual(a.geo, { city: 'Belo Horizonte', region: 'MG', country: 'BR', latitude: -19.92, longitude: -43.93, precision: 'ip' });
});

test('o pedido estendido tem hash diferente do antigo, e o mesmo pedido estendido tem sempre o mesmo hash', () => {
 const antigo = digest(canonical(intake(base())));
 const novo = digest(canonical(intake(comAtribuicao(COMPLETA))));
 assert.notEqual(antigo, novo);
 assert.equal(novo, digest(canonical(intake(comAtribuicao(structuredClone(COMPLETA))))));
});

test('chave desconhecida é recusada em todos os níveis (nada de "aceitar e ignorar")', () => {
 assert.throws(() => intake(comAtribuicao({ campo_inventado: 1 })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ last_touch: { campo_inventado: 1 } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ session: { campo_inventado: 1 } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ session: { events: [{ name: 'Lead', campo_inventado: 1 }] } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ geo: { campo_inventado: 1, precision: 'ip' } })), ERRO400);
});

test('ids da Meta só aceitam dígitos (nome de campanha não é id)', () => {
 for (const campo of ['meta_campaign_id', 'meta_adset_id', 'meta_ad_id']) {
  assert.throws(() => intake(comAtribuicao({ [campo]: 'corretor-lancamento' })), ERRO400, campo);
  assert.throws(() => intake(comAtribuicao({ [campo]: '123' })), ERRO400, campo + ' curto');
  assert.throws(() => intake(comAtribuicao({ [campo]: '1'.repeat(30) })), ERRO400, campo + ' longo');
 }
 assert.throws(() => intake(comAtribuicao({ last_touch: { meta_ad_id: 'x' } })), ERRO400);
});

test('utm_tzolkin: "<produto>.<nicho>" em minúsculo, sem espaço nem símbolo', () => {
 assert.equal(intake(comAtribuicao({ utm_tzolkin: 'sites.corretor' })).attribution.utm_tzolkin, 'sites.corretor');
 assert.equal(intake(comAtribuicao({ utm_tzolkin: 'sites.corretor-sp_2' })).attribution.utm_tzolkin, 'sites.corretor-sp_2');
 for (const ruim of ['sites corretor', 'sites/corretor', '.sites', 'sites;drop', 'x'.repeat(81)]) assert.throws(() => intake(comAtribuicao({ utm_tzolkin: ruim })), ERRO400, ruim);
});

test('fbp e fbc (cookies do pixel) exigem consentimento registrado; fbclid e gclid (URL) não', () => {
 // sem sessão, ou com consentimento negado/pendente: recusado
 assert.throws(() => intake(comAtribuicao({ fbp: FBP })), { status: 400, message: /consentimento/ });
 assert.throws(() => intake(comAtribuicao({ fbc: FBC, session: { consent: 'denied' } })), { status: 400, message: /consentimento/ });
 assert.throws(() => intake(comAtribuicao({ fbp: FBP, session: { consent: 'pending' } })), { status: 400, message: /consentimento/ });
 // com consentimento: aceito
 assert.equal(intake(comAtribuicao({ fbp: FBP, fbc: FBC, session: { consent: 'granted' } })).attribution.fbp, FBP);
 // vindos da URL, não dependem do aceite de cookies
 const v = intake(comAtribuicao({ fbclid: 'IwAR0abcdefghijklmnopq', gclid: 'Cj0KCQjw_abc123', session: { consent: 'denied' } }));
 assert.equal(v.attribution.fbclid, 'IwAR0abcdefghijklmnopq');
 assert.equal(v.attribution.gclid, 'Cj0KCQjw_abc123');
 // formato
 assert.throws(() => intake(comAtribuicao({ fbp: 'qualquer-coisa', session: { consent: 'granted' } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ fbc: 'fb.1.abc', session: { consent: 'granted' } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ fbclid: 'com espaço!' })), ERRO400);
});

test('localização: sempre com a precisão, coordenada válida e arredondada pelo que a fonte realmente sabe', () => {
 const geo = g => intake(comAtribuicao({ geo: g })).attribution.geo;
 assert.throws(() => geo({ city: 'Belo Horizonte' }), { status: 400, message: /precisão/ });
 assert.throws(() => geo({ latitude: -19.9, longitude: -43.9 }), { status: 400, message: /precisão/ });
 assert.throws(() => geo({ latitude: 91, longitude: 0, precision: 'ip' }), ERRO400);
 assert.throws(() => geo({ latitude: 0, longitude: 181, precision: 'ip' }), ERRO400);
 assert.throws(() => geo({ latitude: '1', longitude: 2, precision: 'ip' }), ERRO400);
 assert.throws(() => geo({ latitude: -19.9, precision: 'ip' }), ERRO400, 'latitude sem longitude');
 assert.throws(() => geo({ city: 'BH', precision: 'gps' }), ERRO400);
 assert.throws(() => geo({ country: 'br', precision: 'ip' }), ERRO400, 'país em duas letras maiúsculas');
 assert.equal(geo({ latitude: -19.91667, longitude: -43.93333, precision: 'ip' }).latitude, -19.92);
 assert.equal(geo({ latitude: -19.91667, longitude: -43.93333, precision: 'cnpj' }).latitude, -19.9167);
 assert.deepEqual(geo({ city: 'Belo Horizonte', precision: 'declared' }), { city: 'Belo Horizonte', precision: 'declared' });
});

test('sessão: limites de eventos, páginas e duração, e nomes de evento válidos', () => {
 const sessao = s => intake(comAtribuicao({ session: s })).attribution.session;
 assert.throws(() => sessao({ events: Array.from({ length: 21 }, () => ({ name: 'PageView' })) }), ERRO400);
 assert.equal(sessao({ events: Array.from({ length: 20 }, () => ({ name: 'PageView' })) }).events.length, 20);
 assert.throws(() => sessao({ events: [{ name: '1invalido' }] }), ERRO400);
 assert.throws(() => sessao({ events: [{ name: 'Lead', event_id: 'tem espaço' }] }), ERRO400);
 assert.throws(() => sessao({ events: 'x' }), ERRO400);
 assert.throws(() => sessao({ pageviews: -1 }), ERRO400);
 assert.throws(() => sessao({ pageviews: 10001 }), ERRO400);
 assert.throws(() => sessao({ pageviews: 1.5 }), ERRO400);
 assert.throws(() => sessao({ duration_seconds: 86401 }), ERRO400);
 assert.throws(() => sessao({ consent: 'talvez' }), ERRO400);
 assert.throws(() => intake(comAtribuicao({ session: 'texto' })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ last_touch: [] })), ERRO400);
});

test('datas no futuro são recusadas (primeiro toque, último toque, sessão, evento)', () => {
 const futuro = new Date(Date.now() + 3600_000).toISOString();
 assert.throws(() => intake(comAtribuicao({ first_touch_at: futuro })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ last_touch: { at: futuro } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ session: { last_seen_at: futuro } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ session: { events: [{ name: 'Lead', at: futuro }] } })), ERRO400);
 assert.throws(() => intake(comAtribuicao({ first_touch_at: 'ontem' })), ERRO400);
});

test('as regras de produto e de contato continuam valendo com a atribuição estendida', () => {
 assert.throws(() => validateIntake(comAtribuicao(COMPLETA), 'skiller'), { status: 403 });
 const b = comAtribuicao(COMPLETA); b.lead = { name: 'Maria Silva' };
 assert.throws(() => intake(b), ERRO400);
});

// ---- gravação ----------------------------------------------------------------------------------------------

function roteador() { const rotas = {}; return { rotas, post: (c, fn, o) => { rotas[`POST ${c}`] = { fn, o }; } }; }
function clienteFalso() {
 const consultas = [];
 return {
  consultas,
  query: async (sql, args = []) => {
   consultas.push([sql, args]);
   if (sql.includes('FROM commercial_intake_requests') || sql.includes('FROM commercial_leads')) return { rows: [] };
   if (/INSERT INTO (tenants|stakeholders|commercial_leads)/.test(sql)) return { rows: [{ id: randomUUID() }] };
   return { rows: [], rowCount: 0 };
  },
 };
}
async function grava(corpo) {
 const r = roteador(); commercialIntakeRoutes(r, { avisarLeadNovo: async () => {} });
 const cliente = clienteFalso();
 await r.rotas['POST /v1/commercial/intake'].fn({ client: cliente, pool: {}, body: corpo, productId: 'sites', req: { headers: { 'idempotency-key': randomUUID() } } });
 return cliente.consultas.find(c => c[0].includes('INSERT INTO commercial_attributions'));
}

test('o intake grava as colunas novas, com os objetos em JSON, e os 10 campos de sempre na mesma ordem', async () => {
 const [sql, args] = await grava(comAtribuicao(COMPLETA));
 assert.match(sql, /utm_term,utm_tzolkin,meta_campaign_id,meta_adset_id,meta_ad_id,fbclid,gclid,fbc,fbp,session_key,first_touch_at,last_touch,session,geo/);
 assert.equal(args.length, 24);
 assert.equal((sql.match(/\$\d+/g) || []).length, 24);
 assert.deepEqual(args.slice(3, 10), ['website', 'meta', 'cpc', 'corretor-lancamento', null, '/corretores', 'https://l.instagram.com']);
 assert.deepEqual(args.slice(10, 21), ['site para corretor', 'sites.corretor', '120210000000001', '120210000000002', '120210000000003', 'IwAR0abcdefghijklmnopq', 'Cj0KCQjw_abc123', FBC, FBP, 'a1b2c3d4-e5f6-7890', '2026-09-25T12:00:00.000Z']);
 assert.equal(JSON.parse(args[21]).utm_tzolkin, 'sites.corretor');
 assert.equal(JSON.parse(args[22]).consent, 'granted');
 assert.equal(JSON.parse(args[23]).precision, 'ip');
});

test('pedido antigo grava NULL nas colunas novas', async () => {
 const [, args] = await grava(base());
 assert.deepEqual(args.slice(10), Array(14).fill(null));
});

test('a migração 038 só acrescenta colunas e índices, sem apagar nem alterar tipo', () => {
 const sql = readFileSync(new URL('../../db/migrations/038_atribuicao_estendida.sql', import.meta.url), 'utf8');
 const comandos = sql.replace(/--.*$/gm, '');
 assert.ok(!/\b(DROP TABLE|DROP COLUMN|DELETE|TRUNCATE|ALTER COLUMN|RENAME)\b/i.test(comandos), 'expansão, não contração');
 assert.ok(!/^\s*(BEGIN|COMMIT)\b/im.test(comandos), 'o migrate.mjs é o único dono da transação (G2)');
 for (const col of ['utm_term', 'utm_tzolkin', 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'fbclid', 'gclid', 'fbc', 'fbp', 'session_key', 'first_touch_at', 'last_touch', 'session', 'geo']) {
  assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`));
 }
 assert.match(sql, /commercial_attributions_meta_campaign_idx/);
 // as colunas da migração são as mesmas que o intake escreve
 const intakeFonte = readFileSync(new URL('../../apps/api/src/modules/commercial-intake.mjs', import.meta.url), 'utf8');
 for (const col of ['utm_term', 'utm_tzolkin', 'meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'fbclid', 'gclid', 'fbc', 'fbp', 'session_key', 'first_touch_at', 'last_touch', 'session', 'geo']) {
  assert.match(intakeFonte, new RegExp(`\\b${col}\\b`), `${col} no intake`);
 }
});
