import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
 TOPICOS, enderecoPushValido, assinaturaValida, topicosValidos, vapidConfig,
 createSender, payloadLeadNovo, payloadTeste, senderPadrao, _reiniciarSenderPadrao,
} from '../../apps/api/src/platform/webpush.mjs';
import { pushRoutes, notificarTopico, notificarLeadNovo } from '../../apps/api/src/modules/push.mjs';
import { commercialIntakeRoutes } from '../../apps/api/src/modules/commercial-intake.mjs';

const P256 = 'B' + 'A'.repeat(86);   // 87 caracteres base64url
const AUTH = 'x'.repeat(22);
const FCM = 'https://fcm.googleapis.com/fcm/send/abc';
const assinatura = (endpoint = FCM) => ({ endpoint, keys: { p256dh: P256, auth: AUTH } });
const CONFIG = { publicKey: 'pub', privateKey: 'priv', subject: 'https://core.tzolkin.cloud' };

// Roteador falso: guarda cada handler pelo método e caminho.
function roteador() {
 const rotas = {};
 const reg = metodo => (caminho, fn, opcoes = {}) => { rotas[`${metodo} ${caminho}`] = { fn, opcoes }; };
 return { rotas, get: reg('GET'), put: reg('PUT'), post: reg('POST'), delete: reg('DELETE') };
}
const resposta = () => { const r = {}; r.reply = (status, body) => { r.status = status; r.body = body; }; return r; };
const operador = { subject: 'google:123', email: 'dono@tzolkin.cloud' };

test('só passa endpoint HTTPS de serviço de push conhecido: SSRF, esquema, usuário, porta e sufixo falso são recusados', () => {
 for (const bom of [FCM, 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
  assert.equal(enderecoPushValido(bom), true, bom);
 }
 for (const ruim of [
  'http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://169.254.169.254/latest', 'https://localhost/x',
  'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com@evil.com/x', 'https://fcm.googleapis.com:8443/x',
  'https://user:pass@fcm.googleapis.com/x', 'ftp://fcm.googleapis.com/x', '', 'não é url', 123, null, undefined,
  'https://fcm.googleapis.com/' + 'a'.repeat(700),
 ]) assert.equal(enderecoPushValido(ruim), false, String(ruim));
});

test('a assinatura exige endpoint válido e chaves base64url do tamanho certo', () => {
 assert.equal(assinaturaValida(assinatura()), true);
 assert.equal(assinaturaValida({ endpoint: FCM }), false);
 assert.equal(assinaturaValida({ endpoint: FCM, keys: { p256dh: 'curta', auth: AUTH } }), false);
 assert.equal(assinaturaValida({ endpoint: FCM, keys: { p256dh: P256, auth: 'curta' } }), false);
 assert.equal(assinaturaValida({ endpoint: FCM, keys: { p256dh: P256 + '!', auth: AUTH } }), false);
 assert.equal(assinaturaValida({ endpoint: 'https://evil.example.com/x', keys: { p256dh: P256, auth: AUTH } }), false);
 for (const lixo of [null, undefined, 'x', 5, [], {}]) assert.equal(assinaturaValida(lixo), false);
});

test('tópicos: só os da lista fechada, sem repetição, e vazio é erro', () => {
 assert.deepEqual(TOPICOS, ['commercial.lead']);
 assert.deepEqual(topicosValidos(['commercial.lead', 'commercial.lead']), ['commercial.lead']);
 for (const ruim of [[], ['outro'], ['commercial.lead', 'outro'], 'commercial.lead', null, undefined]) assert.equal(topicosValidos(ruim), null);
});

test('VAPID: sem as três variáveis o push fica desligado, e o assunto precisa ser URL https ou mailto', () => {
 assert.equal(vapidConfig({}), null);
 assert.equal(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' }), null);
 assert.equal(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'ftp://x' }), null);
 assert.deepEqual(vapidConfig({ VAPID_PUBLIC_KEY: ' a ', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'https://core.tzolkin.cloud\r\n' }),
  { publicKey: 'a', privateKey: 'b', subject: 'https://core.tzolkin.cloud' });
 assert.ok(vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:ops@tzolkin.cloud' }));
});

test('o envio padrão é criado uma vez e fica nulo sem VAPID no ambiente', () => {
 const antes = { ...process.env };
 try {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  _reiniciarSenderPadrao();
  assert.equal(senderPadrao(), null);
 } finally { Object.assign(process.env, antes); _reiniciarSenderPadrao(); }
});

test('o envio passa o VAPID em cada chamada, com TTL curto e o payload em JSON', async () => {
 let chamada;
 const enviar = createSender(CONFIG, { sendNotification: async (...args) => { chamada = args; return { statusCode: 201 }; } });
 await enviar(assinatura(), { title: 'x' });
 assert.deepEqual(chamada[0], assinatura());
 assert.equal(chamada[1], JSON.stringify({ title: 'x' }));
 assert.deepEqual(chamada[2].vapidDetails, { subject: CONFIG.subject, publicKey: 'pub', privateKey: 'priv' });
 assert.equal(chamada[2].TTL, 3600);
 assert.equal(chamada[2].urgency, 'high');
 assert.ok(chamada[2].timeout > 0);
});

test('a notificação de lead novo usa os campos do sw.js e leva só nome, nunca e-mail, telefone ou mensagem', () => {
 const p = payloadLeadNovo({ produto: 'TZOLKIN Sites', organizacao: 'Clínica Sorriso', nome: 'Maria Silva', leadId: 'abc-123' });
 assert.deepEqual(Object.keys(p).sort(), ['body', 'tag', 'title', 'view']);
 assert.equal(p.title, 'Lead novo — TZOLKIN Sites');
 assert.equal(p.body, 'Clínica Sorriso · Maria Silva');
 assert.equal(p.tag, 'lead:abc-123');
 assert.equal(p.view, 'leads');
 // limites do sw.js: título 120, corpo 300, tag 80
 const longo = payloadLeadNovo({ produto: 'P'.repeat(500), organizacao: 'O'.repeat(500), nome: 'N'.repeat(500), leadId: 'L'.repeat(500) });
 assert.ok(longo.title.length <= 120 && longo.body.length <= 300 && longo.tag.length <= 80);
 assert.equal(payloadLeadNovo({ leadId: 'x' }).body, 'Um contato novo chegou.');
 assert.equal(payloadTeste().view, 'leads');
});

test('a tela que a notificação abre existe no painel', () => {
 const app = readFileSync(new URL('../../apps/web/public/app.js', import.meta.url), 'utf8');
 assert.match(app, /\bleads: \{ title: 'Inbound'/);
 assert.equal(payloadLeadNovo({ leadId: 'x' }).view, 'leads');
});

test('avisar um tópico: envia aos ativos, revoga o que morreu (404/410) e só conta falha no resto', async () => {
 const consultas = [];
 const linhas = [1, 2, 3, 4].map(n => ({ id: `s${n}`, endpoint: `${FCM}${n}`, p256dh: P256, auth: AUTH }));
 const pool = { query: async (sql, args) => { consultas.push([sql, args]); return { rows: sql.startsWith('SELECT') ? linhas : [] }; } };
 const destino = { s1: null, s2: { statusCode: 410 }, s3: { statusCode: 404 }, s4: { statusCode: 500 } };
 const enviar = async sub => { const erro = destino[linhas.find(l => l.endpoint === sub.endpoint).id]; if (erro) throw Object.assign(new Error('x'), erro); };
 const r = await notificarTopico(pool, 'commercial.lead', { title: 't' }, enviar);
 assert.deepEqual(r, { enviados: 1, revogados: 2, falhas: 1 });
 assert.match(consultas[0][0], /revoked_at IS NULL AND \$1 = ANY\(topics\)/);
 assert.deepEqual(consultas[0][1], ['commercial.lead']);
 const sql = consultas.slice(1).map(c => c[0]).join('\n');
 assert.equal((sql.match(/revoked_at=now\(\)/g) || []).length, 2);
 assert.equal((sql.match(/failure_count=failure_count\+1/g) || []).length, 1);
 assert.ok(!/DELETE/i.test(sql), 'a role do Core não apaga linha: revogar é revoked_at');
 await assert.rejects(() => notificarTopico(pool, 'inexistente', {}, enviar), /Tópico desconhecido/);
});

test('uma falha ao registrar o resultado não derruba o envio nem quem chamou', async () => {
 const pool = { query: async sql => { if (sql.startsWith('SELECT')) return { rows: [{ id: 's', endpoint: FCM, p256dh: P256, auth: AUTH }] }; throw new Error('banco fora'); } };
 const r = await notificarTopico(pool, 'commercial.lead', {}, async () => { throw Object.assign(new Error('x'), { statusCode: 410 }); });
 assert.equal(r.falhas, 1);
});

test('lead novo: push desligado não faz nada; ligado manda com o nome do produto; sem o nome usa o id', async () => {
 assert.deepEqual(await notificarLeadNovo({ query: async () => assert.fail('não deve consultar') }, { productId: 'sites' }, null), { desligado: true });
 const enviados = [];
 const pool = { query: async sql => ({ rows: sql.includes('FROM products') ? [{ name: 'TZOLKIN Sites' }] : sql.startsWith('SELECT') ? [{ id: 's', endpoint: FCM, p256dh: P256, auth: AUTH }] : [] }) };
 const r = await notificarLeadNovo(pool, { productId: 'sites', leadId: 'l1', nome: 'Maria', organizacao: 'Clínica' }, async (_s, payload) => { enviados.push(payload); });
 assert.equal(r.enviados, 1);
 assert.equal(enviados[0].title, 'Lead novo — TZOLKIN Sites');
 const semProduto = { query: async sql => { if (sql.includes('FROM products')) throw new Error('x'); return { rows: sql.startsWith('SELECT') ? [{ id: 's', endpoint: FCM, p256dh: P256, auth: AUTH }] : [] }; } };
 await notificarLeadNovo(semProduto, { productId: 'sites', leadId: 'l2' }, async (_s, payload) => { enviados.push(payload); });
 assert.equal(enviados[1].title, 'Lead novo — sites');
});

test('config do push: informa se está ligado e devolve só a chave pública', async () => {
 const ligado = roteador(); pushRoutes(ligado, { config: CONFIG });
 let r = resposta(); await ligado.rotas['GET /api/push/config'].fn({ reply: r.reply });
 assert.deepEqual(r.body, { enabled: true, publicKey: 'pub', topics: ['commercial.lead'] });
 assert.ok(!JSON.stringify(r.body).includes('priv'));
 const desligado = roteador(); pushRoutes(desligado, { config: null });
 r = resposta(); await desligado.rotas['GET /api/push/config'].fn({ reply: r.reply });
 assert.deepEqual(r.body, { enabled: false, publicKey: null, topics: ['commercial.lead'] });
});

test('assinar: exige push ligado, assinatura válida e tópico válido; grava por endpoint e nunca devolve chaves', async () => {
 const desligado = roteador(); pushRoutes(desligado, { config: null });
 await assert.rejects(() => desligado.rotas['PUT /api/push/subscriptions'].fn({ client: {}, body: { subscription: assinatura() }, operator: operador }), { status: 503 });

 const ligado = roteador(); pushRoutes(ligado, { config: CONFIG });
 const rota = ligado.rotas['PUT /api/push/subscriptions'];
 assert.equal(rota.opcoes.transactional, true);
 assert.equal(rota.opcoes.audit, false, 'audit_events exige tenant_id e uma assinatura de push não tem organização');
 const cliente = () => ({ query: async () => assert.fail('não deve gravar') });
 await assert.rejects(() => rota.fn({ client: cliente(), body: { subscription: { endpoint: 'https://evil.example.com/x', keys: { p256dh: P256, auth: AUTH } } }, operator: operador }), { status: 400, message: /Assinatura/ });
 await assert.rejects(() => rota.fn({ client: cliente(), body: { subscription: assinatura(), topics: ['outro'] }, operator: operador }), { status: 400, message: /Tópico/ });
 await assert.rejects(() => rota.fn({ client: cliente(), body: { subscription: assinatura(), campo_extra: 1 }, operator: operador }), { status: 400 });

 let chamada;
 const client = { query: async (sql, args) => { chamada = [sql, args]; return { rows: [{ id: 'uuid-1' }] }; } };
 const r = await rota.fn({ client, body: { subscription: assinatura() }, operator: operador, req: { headers: { 'user-agent': 'Chrome/120' } } });
 assert.match(chamada[0], /ON CONFLICT \(endpoint\) DO UPDATE/);
 assert.match(chamada[0], /revoked_at=NULL/);
 assert.deepEqual(chamada[1], ['google:123', 'dono@tzolkin.cloud', FCM, P256, AUTH, ['commercial.lead'], 'Chrome/120']);
 assert.deepEqual(r.response, { ok: true, id: 'uuid-1', topics: ['commercial.lead'] });
 assert.ok(!JSON.stringify(r).includes(P256) && !JSON.stringify(r).includes(AUTH) && !JSON.stringify(r).includes(FCM));
});

test('meus aparelhos: filtra pelo operador logado e nunca seleciona endpoint nem chaves', async () => {
 const r = roteador(); pushRoutes(r, { config: CONFIG });
 let chamada; const res = resposta();
 await r.rotas['GET /api/push/subscriptions'].fn({ pool: { query: async (sql, args) => { chamada = [sql, args]; return { rows: [{ id: 'a' }] }; } }, operator: operador, reply: res.reply });
 assert.deepEqual(chamada[1], ['google:123']);
 assert.match(chamada[0], /operator_subject=\$1 AND revoked_at IS NULL/);
 assert.ok(!/endpoint|p256dh|\bauth\b/.test(chamada[0].split('FROM')[0]), 'a lista não pode selecionar endpoint nem chaves');
 assert.deepEqual(res.body, { subscriptions: [{ id: 'a' }] });
});

test('desligar aparelho: só o dono, id válido, e revoga em vez de apagar', async () => {
 const r = roteador(); pushRoutes(r, { config: CONFIG });
 const rota = r.rotas['DELETE /api/push/subscriptions/:id'];
 assert.equal(rota.opcoes.body, false);
 await assert.rejects(() => rota.fn({ client: {}, params: { id: 'nao-uuid' }, operator: operador }), { status: 400 });
 const id = randomUUID(); let chamada;
 await assert.rejects(() => rota.fn({ client: { query: async () => ({ rowCount: 0 }) }, params: { id }, operator: operador }), { status: 404 });
 const ok = await rota.fn({ client: { query: async (sql, args) => { chamada = [sql, args]; return { rowCount: 1 }; } }, params: { id }, operator: operador });
 assert.deepEqual(ok.response, { ok: true });
 assert.deepEqual(chamada[1], [id, 'google:123']);
 assert.match(chamada[0], /SET revoked_at=now\(\)/);
 assert.ok(!/DELETE/i.test(chamada[0]));
});

test('teste de notificação: só para os aparelhos de quem pediu', async () => {
 const sem = roteador(); pushRoutes(sem, { config: null });
 await assert.rejects(() => sem.rotas['POST /api/push/test'].fn({ pool: {}, operator: operador, reply: () => {} }), { status: 503 });

 const enviados = []; const r = roteador();
 pushRoutes(r, { config: CONFIG, enviar: async (_s, payload) => { enviados.push(payload); } });
 const vazio = { query: async () => ({ rows: [] }) };
 await assert.rejects(() => r.rotas['POST /api/push/test'].fn({ pool: vazio, operator: operador, reply: () => {} }), { status: 409 });

 let chamada; const res = resposta();
 const pool = { query: async (sql, args) => { chamada ??= [sql, args]; return { rows: sql.startsWith('SELECT') ? [{ id: 's', endpoint: FCM, p256dh: P256, auth: AUTH }] : [] }; } };
 await r.rotas['POST /api/push/test'].fn({ pool, operator: operador, reply: res.reply });
 assert.deepEqual(chamada[1], ['google:123']);
 assert.equal(res.body.enviados, 1);
 assert.equal(enviados[0].title, 'Notificações ativas');
});

// ---- intake: o aviso só sai para lead CRIADO, e depois do commit -----------------------------------------------

const CORPO = {
 lead: { name: 'Maria Silva', email: 'maria@clinica.com.br', whatsapp: '31999990000' },
 organization: { name: 'Clínica Sorriso', slug: 'clinica-sorriso', organization_type: 'company' },
 stakeholder: { role: 'owner' },
 commercial: { product_id: 'sites', service_model: 'consulting', label: 'Site' },
 attribution: { source_system: 'tzolkin-sites', source_ref: 'lead-1', channel: 'website' },
 privacy: {},
};

function clienteFalso({ anterior = null, existente = null } = {}) {
 const consultas = [];
 return {
  consultas,
  query: async (sql, args = []) => {
   consultas.push([sql, args]);
   if (sql.includes('FROM commercial_intake_requests')) return { rows: anterior ? [anterior] : [] };
   if (sql.includes('count(*) FROM commercial_leads')) return { rows: [{ count: '0' }] };
   if (sql.includes('FROM commercial_leads')) return { rows: existente ? [existente] : [] };
   if (/INSERT INTO (tenants|stakeholders|commercial_leads)/.test(sql)) return { rows: [{ id: randomUUID() }] };
   return { rows: [], rowCount: 0 };
  },
 };
}
const intake = opcoes => { const r = roteador(); commercialIntakeRoutes(r, opcoes); return r.rotas['POST /v1/commercial/intake']; };
const requisicao = () => ({ headers: { 'idempotency-key': randomUUID() } });

test('lead criado devolve um afterCommit que avisa a equipe com o nome da organização e da pessoa, só quando chamado', async () => {
 const avisos = [];
 const pool = { marca: 'pool-do-core' };
 const rota = intake({ avisarLeadNovo: async (p, dados) => { avisos.push([p, dados]); } });
 const r = await rota.fn({ client: clienteFalso(), pool, body: structuredClone(CORPO), productId: 'sites', req: requisicao() });
 assert.equal(r.body.created, true);
 assert.equal(typeof r.afterCommit, 'function', 'lead novo deve avisar');
 // O handler roda DENTRO da transação: nada pode sair antes de o COMMIT. Quem chama o
 // afterCommit é o app.mjs, depois do COMMIT (guarda de fonte no último teste).
 assert.equal(avisos.length, 0, 'o aviso não pode sair durante a transação');
 await r.afterCommit();
 assert.equal(avisos.length, 1);
 assert.equal(avisos[0][0], pool);
 assert.deepEqual(avisos[0][1], { productId: 'sites', leadId: r.body.lead_id, nome: 'Maria Silva', organizacao: 'Clínica Sorriso' });
});

test('um aviso que falha não altera a resposta do intake', async () => {
 const rota = intake({ avisarLeadNovo: async () => { throw new Error('push fora do ar'); } });
 const r = await rota.fn({ client: clienteFalso(), pool: {}, body: structuredClone(CORPO), productId: 'sites', req: requisicao() });
 assert.equal(r.body.created, true);
 assert.equal(r.body.tenant_id !== undefined, true);
 await assert.rejects(r.afterCommit(), /push fora do ar/); // quem protege é o app.mjs: captura e só registra no log
});

test('reenvio da mesma chave e lead que já existia NÃO avisam de novo', async () => {
 const primeiro = clienteFalso();
 const r1 = await intake().fn({ client: primeiro, pool: {}, body: structuredClone(CORPO), productId: 'sites', req: { headers: { 'idempotency-key': '11111111-1111-4111-8111-111111111111' } } });
 assert.equal(r1.body.created, true);
 const hash = primeiro.consultas.flatMap(c => c[1]).find(a => typeof a === 'string' && /^[0-9a-f]{64}$/.test(a));
 assert.ok(hash, 'o hash do pedido é gravado junto do lead');

 // 1) mesma Idempotency-Key: devolve a resposta guardada, sem afterCommit
 const replay = clienteFalso({ anterior: { response: { lead_id: 'l', created: true }, request_hash: hash } });
 const r2 = await intake().fn({ client: replay, pool: {}, body: structuredClone(CORPO), productId: 'sites', req: { headers: { 'idempotency-key': '11111111-1111-4111-8111-111111111111' } } });
 assert.equal(r2.afterCommit, undefined);

 // 2) chave nova, mas a origem (source_ref) já foi importada com o mesmo conteúdo: created:false
 const existente = clienteFalso({ existente: { id: 'l', tenant_id: 't', stakeholder_id: 'p', request_hash: hash } });
 const r3 = await intake().fn({ client: existente, pool: {}, body: structuredClone(CORPO), productId: 'sites', req: requisicao() });
 assert.equal(r3.body.created, false);
 assert.equal(r3.afterCommit, undefined);
});

test('app.mjs roda o afterCommit DEPOIS do COMMIT e fora da resposta', () => {
 const fonte = readFileSync(new URL('../../apps/api/src/app.mjs', import.meta.url), 'utf8');
 const commit = fonte.indexOf("await client.query('COMMIT')");
 const hook = fonte.indexOf('result.afterCommit');
 assert.ok(commit > 0 && hook > commit, 'o aviso não pode sair antes do COMMIT');
 assert.match(fonte, /setImmediate\(\(\) => Promise\.resolve\(\)\.then\(result\.afterCommit\)/);
 assert.match(fonte, /\.catch\(erro => console\.error\('\[afterCommit\] falhou:'/, 'falha do aviso nunca vira erro da rota');
 assert.match(fonte, /pushRoutes\(router,pushOptions\)/);
});
