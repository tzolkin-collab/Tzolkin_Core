import test from 'node:test';
import assert from 'node:assert/strict';
import { classificarWebhook, montarInstancia, whatsappSaudeRoutes } from '../../apps/api/src/modules/whatsapp-saude.mjs';

const CORE = new URL('https://core.exemplo.com');
const webhook = (extra = {}) => ({ ok: true, webhook: { enabled: true, url: 'https://core.exemplo.com/api/webhooks/evolution', events: ['MESSAGES_UPSERT'], headerNames: ['x-webhook-secret'], ...extra } });

test('classificarWebhook: aponta para o Core, para outro sistema, desligado, sem webhook e erro', () => {
 assert.deepEqual(classificarWebhook(webhook(), CORE), { estado: 'core', host: 'core.exemplo.com', segredo: true });
 assert.equal(classificarWebhook(webhook({ headerNames: ['apikey'] }), CORE).segredo, false, 'sem x-webhook-secret o Core recusaria tudo');
 assert.equal(classificarWebhook(webhook({ events: ['CONNECTION_UPDATE'] }), CORE).estado, 'core_sem_evento', 'aponta para o Core mas não manda mensagem');
 assert.deepEqual(classificarWebhook(webhook({ url: 'https://outro.exemplo.com/api/webhook/whatsapp' }), CORE), { estado: 'outro', host: 'outro.exemplo.com' });
 assert.equal(classificarWebhook(webhook({ url: 'https://core.exemplo.com/api/webhooks/outra-coisa' }), CORE).estado, 'outro', 'mesmo host, caminho que não é o do Core');
 assert.deepEqual(classificarWebhook(webhook({ enabled: false }), CORE), { estado: 'desligado', host: 'core.exemplo.com' });
 assert.deepEqual(classificarWebhook({ ok: true, webhook: null }, CORE), { estado: 'sem' });
 assert.deepEqual(classificarWebhook({ ok: false, reason: 'unauthorized' }, CORE), { estado: 'erro', motivo: 'unauthorized' });
 assert.equal(classificarWebhook(webhook({ url: 'não é url' }), CORE).estado, 'outro', 'URL ilegível na Evolution não derruba a tela');
 assert.equal(classificarWebhook(webhook(), null).estado, 'core', 'sem a URL pública do Core (local), o caminho basta');
});

test('montarInstancia: junta Evolution, banco e fila; sem dado do banco os números vêm zerados, não inventados', () => {
 const agora = Date.parse('2026-10-26T20:00:00Z');
 const r = montarInstancia({
  instancia: { name: 'teste', state: 'open', number: '5531997599216', profile: 'Tzolkin' },
  webhook: { estado: 'core' },
  atividade: { esperas: 10, respondidas: 8, sem_resposta: 2, mediana_min: '12.5', em_1h: 6 },
  caixa: { recebidas: 40, conversas: 12, ultima: '2026-10-26T19:30:00Z' },
  fila: { na_fila: 3, falhas: 1, enviadas: 25, mais_antiga: '2026-10-26T19:40:00Z' },
  agora, dias: 7,
 });
 assert.equal(r.conectada, true);
 assert.equal(r.ultima_mensagem_recebida, '2026-10-26T19:30:00.000Z');
 assert.deepEqual(r.fila, { na_fila: 3, mais_antiga_min: 20, falhas: 1, enviadas: 25 });
 assert.deepEqual(r.resultado, { periodo_dias: 7, pessoas_que_escreveram: 12, mensagens_recebidas: 40, esperas: 10, respondidas: 8, sem_resposta: 2, mediana_min: 12.5, respondidas_em_1h: 6, taxa_resposta: 80 });
 const vazio = montarInstancia({ instancia: { name: 'nova', state: 'close' }, webhook: { estado: 'sem' }, agora, dias: 7 });
 assert.equal(vazio.conectada, false);
 assert.equal(vazio.ultima_mensagem_recebida, null);
 assert.deepEqual(vazio.fila, { na_fila: 0, mais_antiga_min: null, falhas: 0, enviadas: 0 });
 assert.equal(vazio.resultado.taxa_resposta, null, 'sem espera, não há taxa (nada de 0% nem 100% inventado)');
 assert.equal(vazio.resultado.mediana_min, null);
});

// Rotas, com a Evolution e o banco de mentira.
const adaptadorDe = ({ configurada = true, instancias = [{ name: 'teste', state: 'open', number: '5531997599216', profile: null }], lista = true, webhooks = {} } = {}) => ({ instance, env } = {}) => ({
 configured: configurada,
 async listInstances() { return lista ? { ok: true, instances: instancias } : { ok: false, reason: 'unauthorized' }; },
 async connectionState() { return { ok: true, state: 'open', connected: true }; },
 async getWebhook() { return webhooks[instance] ?? { ok: true, webhook: null }; },
});
function montar({ env = { EVOLUTION_INSTANCE: 'teste', PUBLIC_ORIGIN: 'https://core.exemplo.com' }, pool, adaptador = adaptadorDe() } = {}) {
 const rotas = new Map();
 whatsappSaudeRoutes({ get: (r, f) => rotas.set('GET ' + r, f) }, { env, clock: () => Date.parse('2026-10-26T20:00:00Z'), criarAdaptador: adaptador });
 return async (consulta = '') => {
  let resposta = null;
  await rotas.get('GET /api/whatsapp/saude')({ pool, url: new URL('https://x.test/api/whatsapp/saude' + consulta), reply: (status, dados) => { resposta = { status, dados }; } });
  return resposta;
 };
}
const banco = ({ erro = null } = {}) => { const sql = []; return { sql, async query(texto, p) { sql.push({ texto, p }); if (erro) throw Object.assign(new Error('x'), { code: erro });
 if (/FROM resp GROUP BY/.test(texto)) return { rows: [{ inst: 'teste', esperas: 4, respondidas: 3, sem_resposta: 1, mediana_min: '9.0', em_1h: 3 }] };
 if (/FROM whatsapp_inbox GROUP BY/.test(texto)) return { rows: [{ inst: 'teste', recebidas: 9, conversas: 4, ultima: '2026-10-26T18:00:00Z' }] };
 return { rows: [{ inst: 'teste', na_fila: 0, falhas: 0, enviadas: 5, mais_antiga: null }] }; } }; };

test('rota: lista todas as instâncias com saúde e resultado; só lê (nenhum comando de escrita)', async () => {
 const pool = banco();
 const adaptador = adaptadorDe({ instancias: [{ name: 'teste', state: 'open', number: null, profile: null }, { name: 'gabi_prod', state: 'close', number: null, profile: null }],
  webhooks: { teste: webhook(), gabi_prod: { ok: true, webhook: { enabled: true, url: 'https://bot.exemplo.com/webhook', events: ['MESSAGES_UPSERT'], headerNames: [] } } } });
 const { status, dados } = await montar({ pool, adaptador })();
 assert.equal(status, 200);
 assert.equal(dados.todas, true);
 assert.equal(dados.webhook_esperado, 'core.exemplo.com/api/webhooks/evolution');
 assert.deepEqual(dados.instancias.map(i => [i.nome, i.webhook.estado]), [['teste', 'core'], ['gabi_prod', 'outro']]);
 const teste = dados.instancias[0];
 assert.equal(teste.resultado.taxa_resposta, 75);
 assert.equal(teste.resultado.mediana_min, 9);
 assert.equal(dados.instancias[1].resultado.esperas, 0, 'instância sem conversa registrada vem zerada');
 assert.equal(pool.sql.length, 3);
 for (const q of pool.sql) assert.equal(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i.test(q.texto), false, 'a saúde só lê');
 assert.equal(pool.sql[0].p[0], 'teste', 'mensagem antiga, gravada sem instância, é da padrão');
});

test('rota: o período vem de ?dias, de 1 a 90, e vai ao banco como data', async () => {
 const pool = banco();
 const { dados } = await montar({ pool })('?dias=30');
 assert.equal(dados.periodo_dias, 30);
 assert.equal(pool.sql[0].p[1], '2026-09-26T20:00:00.000Z');
 for (const ruim of ['?dias=0', '?dias=91', '?dias=abc', '?dias=1.5']) await assert.rejects(montar({ pool })(ruim), e => e.status === 400, ruim);
 await assert.rejects(montar({ pool })('?outra=1'), e => e.status === 400, 'parâmetro desconhecido');
});

test('rota: chave de uma instância só cai para a padrão; sem Evolution configurada responde configurada:false sem tocar no banco', async () => {
 const sozinha = await montar({ pool: banco(), adaptador: adaptadorDe({ lista: false }) })();
 assert.equal(sozinha.dados.todas, false);
 assert.deepEqual(sozinha.dados.instancias.map(i => i.nome), ['teste']);
 const pool = banco();
 const nada = await montar({ pool, adaptador: adaptadorDe({ configurada: false }) })();
 assert.deepEqual(nada.dados, { configurada: false, envio_ligado: false, periodo_dias: 7, instancias: [] });
 assert.equal(pool.sql.length, 0);
});

test('rota: sem as migrações a saúde ainda responde (Evolution e webhook), com aviso e números zerados', async () => {
 for (const codigo of ['42P01', '42703']) {
  const { dados } = await montar({ pool: banco({ erro: codigo }) })();
  assert.equal(dados.banco_disponivel, false);
  assert.match(dados.aviso, /migrações 062, 063 e 064/);
  assert.equal(dados.instancias[0].conectada, true);
  assert.equal(dados.instancias[0].resultado.esperas, 0);
 }
 await assert.rejects(montar({ pool: banco({ erro: '57014' }) })(), e => e.code === '57014', 'erro de verdade do banco não é engolido');
});

test('rota: o envio ligado vem de WHATSAPP_ENVIO', async () => {
 assert.equal((await montar({ pool: banco(), env: { EVOLUTION_INSTANCE: 'teste', WHATSAPP_ENVIO: 'ligado' } })()).dados.envio_ligado, true);
 assert.equal((await montar({ pool: banco() })()).dados.envio_ligado, false);
});
