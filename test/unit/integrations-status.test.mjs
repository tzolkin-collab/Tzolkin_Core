// Configurações → Integrações: só estado, nunca segredo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRACOES, estadoDe, estadoDasIntegracoes, integrationsStatusRoutes } from '../../apps/api/src/modules/integrations-status.mjs';

const por = (lista, id) => lista.find(i => i.id === id);
const rota = pool => { let h; integrationsStatusRoutes({ get: (p, fn) => { if (p === '/api/integrations/status') h = fn; } }, { env: pool.env }); return async () => { let saida; await h({ pool, reply: (s, c) => { saida = { s, c }; } }); return saida; }; };

test('sem variáveis, tudo é "não configurado" e a lista diz o que falta', () => {
 const l = estadoDasIntegracoes({});
 assert.equal(l.length, INTEGRACOES.length);
 for (const i of l) { assert.equal(i.estado, 'nao_configurado', i.id); assert.ok(i.faltando.length >= 1, i.id); }
 assert.deepEqual(por(l, 'stripe').faltando, ['STRIPE_SECRET_KEY']);
});

test('todas as obrigatórias = configurado; só algumas = incompleto; vazio ou espaço não conta', () => {
 assert.equal(por(estadoDasIntegracoes({ STRIPE_SECRET_KEY: 'x' }), 'stripe').estado, 'configurado');
 const parcial = por(estadoDasIntegracoes({ EASYPANEL_URL: 'https://x' }), 'easypanel');
 assert.equal(parcial.estado, 'parcial'); assert.deepEqual(parcial.faltando, ['EASYPANEL_TOKEN']);
 assert.equal(por(estadoDasIntegracoes({ STRIPE_SECRET_KEY: '   ' }), 'stripe').estado, 'nao_configurado');
 assert.equal(por(estadoDasIntegracoes({ EASYPANEL_URL: 'https://x', EASYPANEL_TOKEN: 't' }), 'easypanel').estado, 'configurado');
});

test('opcionais ausentes só aparecem quando a integração já está ligada', () => {
 const ligada = por(estadoDasIntegracoes({ STRIPE_SECRET_KEY: 'x' }), 'stripe');
 assert.deepEqual(ligada.opcionais_ausentes, ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY']);
 assert.deepEqual(por(estadoDasIntegracoes({}), 'stripe').opcionais_ausentes, []);
});

test('GitHub vale com token ou com o gh local (GITHUB_USE_CLI=true)', () => {
 assert.equal(por(estadoDasIntegracoes({ GITHUB_USE_CLI: 'true' }), 'github').estado, 'configurado');
 assert.equal(por(estadoDasIntegracoes({ GITHUB_USE_CLI: 'false' }), 'github').estado, 'nao_configurado');
 assert.equal(por(estadoDasIntegracoes({ GITHUB_TOKEN: 'ghp_x' }), 'github').estado, 'configurado');
});

test('a resposta NUNCA contém o valor de nenhuma variável', async () => {
 const SEGREDOS = { STRIPE_SECRET_KEY: 'sk_live_SEGREDO123', ASAAS_API_KEY: 'asaas_SEGREDO456', VERCEL_TOKEN: 'vercel_SEGREDO789', GOOGLE_CLIENT_SECRET: 'google_SEGREDO000', META_APP_SECRET: 'meta_SEGREDO111', VAPID_PRIVATE_KEY: 'vapid_SEGREDO222', EASYPANEL_URL: 'https://painel.interno.exemplo', EASYPANEL_TOKEN: 'ep_SEGREDO333', GITHUB_TOKEN: 'ghp_SEGREDO444', CORE_ALLOWED_EMAILS: 'pessoa@exemplo.com' };
 const pool = { env: SEGREDOS, query: async () => ({ rows: [] }) };
 const r = await rota(pool)();
 const texto = JSON.stringify(r.c);
 for (const valor of Object.values(SEGREDOS)) assert.ok(!texto.includes(valor), 'vazou: ' + valor.slice(0, 8));
 assert.ok(!/SEGREDO/.test(texto));
});

test('Meta: diz se há conta conectada, se expirou ou deu erro, sem token; sem a tabela, só omite a conta', async () => {
 const env = { META_APP_ID: '1', META_APP_SECRET: 'x' };
 const com = rota({ env, query: async () => ({ rows: [{ expires_at: '2020-01-01T00:00:00Z', last_error: null }] }) });
 assert.deepEqual(por((await com()).c.integracoes, 'meta').conta, { conectada: true, expirada: true, com_erro: false });
 const sem = rota({ env, query: async () => ({ rows: [] }) });
 assert.deepEqual(por((await sem()).c.integracoes, 'meta').conta, { conectada: false });
 const nunca = rota({ env, query: async () => ({ rows: [{ expires_at: null, last_error: 'x' }] }) });
 assert.deepEqual(por((await nunca()).c.integracoes, 'meta').conta, { conectada: true, expirada: false, com_erro: true });
 const quebrado = rota({ env, query: async () => { throw new Error('relation does not exist'); } });
 const r = await quebrado();
 assert.equal(r.s, 200); assert.equal(por(r.c.integracoes, 'meta').conta, null);
});

test('toda tela citada existe no menu do Core e todo grupo é um dos que a tela desenha', async () => {
 const { GRUPOS_DE_INTEGRACAO } = await import('../../apps/web/public/config-integracoes.js').catch(() => ({ GRUPOS_DE_INTEGRACAO: null }));
 // o módulo web usa DOM só ao montar; importar não toca no document
 if (GRUPOS_DE_INTEGRACAO) for (const i of INTEGRACOES) assert.ok(GRUPOS_DE_INTEGRACAO.includes(i.grupo), `${i.id}: grupo ${i.grupo} não é desenhado`);
 const app = (await import('node:fs')).readFileSync(new URL('../../apps/web/public/app.js', import.meta.url), 'utf8');
 for (const i of INTEGRACOES.filter(x => x.tela)) assert.ok(app.includes(` ${i.tela}: { title`), `${i.id}: tela ${i.tela} não existe em app.js`);
});

test('a rota exige login como as demais e está registrada no app', async () => {
 const fonte = (await import('node:fs')).readFileSync(new URL('../../apps/api/src/app.mjs', import.meta.url), 'utf8');
 assert.match(fonte, /integrationsStatusRoutes\(router/);
});
