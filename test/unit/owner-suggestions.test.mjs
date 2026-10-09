// Sugestão de dono: o caso que motivou o módulo (Kalidash, um repositório com mais
// de um projeto na Vercel, cliente sob demanda) e as recusas que o protegem de virar
// a heurística por nome que a migração 034 aposentou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { achatar, termos, sugerirDono, irmaosDoRepositorio, agruparSugestoes, nomeDoDono } from '../../apps/web/public/owner-suggestions.js';

// O mesmo casamento do painel (connections.js), reproduzido só para o teste.
const casa = (binding, recurso) => binding.provider === recurso.provider && String(binding.external_id) === String(recurso.id);

const donos = {
 tenants: [{ id: 't-kali', name: 'Kalidash' }, { id: 't-outra', name: 'Outra Empresa' }],
 engagements: [
  { id: 'e-kali', tenant_id: 't-kali', label: 'Kalidash — site e landing', service_model: 'on_demand', archived_at: null },
  { id: 'e-outra', tenant_id: 't-outra', label: 'Outra Empresa — consultoria', service_model: 'consulting', archived_at: null },
 ],
 products: [{ id: 'skiller', name: 'Skiller' }],
};

const inventario = {
 github: { status: 'ok', items: [
  { id: '1', name: 'tzolkin-collab/Kalidash_Site' },
  { id: '2', name: 'tzolkin-collab/Kalidash_LandingPage_01_-evento-' },
  { id: '3', name: 'tzolkin-collab/skiller-app' },
  { id: '4', name: 'tzolkin-collab/site-tzolkin' },
 ] },
 vercel: { status: 'ok', items: [
  { id: 'v1', name: 'kalidash-lp', repository: 'tzolkin-collab/Kalidash_Site' },
  { id: 'v2', name: 'kalidash-admin', repository: 'tzolkin-collab/Kalidash_Site' },
 ] },
 easypanel: { status: 'ok', items: [{ id: 'other/kalidash-api', name: 'other / kalidash-api' }] },
};
const itens = achatar(inventario);
const repo = id => itens.find(item => item.provider === 'github' && item.id === id);
const vercel = id => itens.find(item => item.provider === 'vercel' && item.id === id);
const contexto = (conexoes = []) => ({ itens, conexoes, donos, casa });

test('termos: tira organização genérica, número e palavra curta, e ignora acento', () => {
 assert.deepEqual(termos('Kalidash_LandingPage_01_-evento-'), ['kalidash']);
 assert.deepEqual(termos('site-tzolkin'), []);
 assert.deepEqual(termos('Ação Médica — API'), ['acao', 'medica']);
});

test('achatar só traz provedor que respondeu, e guarda de qual repositório sai o projeto da Vercel', () => {
 assert.equal(itens.length, 7);
 assert.equal(vercel('v1').repository, 'tzolkin-collab/Kalidash_Site');
 assert.deepEqual(achatar({ github: { status: 'error', items: [] }, vercel: { status: 'ok', items: [{ id: 'x', name: 'x' }] } }).map(item => item.provider), ['vercel']);
});

test('repositório herda o dono do projeto da Vercel que sai dele (evidência)', () => {
 const conexoes = [{ active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-kali', product_id: null }];
 const sugestao = sugerirDono(repo('1'), contexto(conexoes));
 assert.equal(sugestao.evidencia, 'repositorio');
 assert.deepEqual(sugestao.dono, { product_id: null, engagement_id: 'e-kali' });
 assert.equal(sugestao.modelo, 'on_demand');
 assert.match(sugestao.motivo, /kalidash-lp/);
});

test('o projeto da Vercel herda o dono do repositório e dos projetos irmãos', () => {
 const conexoes = [{ active: true, provider: 'github', external_id: '1', engagement_id: 'e-kali', product_id: null }];
 assert.equal(sugerirDono(vercel('v2'), contexto(conexoes)).dono.engagement_id, 'e-kali');
 const irmaos = [{ active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-kali', product_id: null }];
 assert.equal(sugerirDono(vercel('v2'), contexto(irmaos)).evidencia, 'repositorio');
});

test('sem conexão nenhuma, o nome distintivo sugere a contratação do Kalidash', () => {
 const sugestao = sugerirDono(repo('1'), contexto());
 assert.equal(sugestao.evidencia, 'nome');
 assert.equal(sugestao.dono.engagement_id, 'e-kali');
 assert.match(sugestao.motivo, /kalidash/);
});

test('nome que combina com dois donos vira ambiguidade, não sugestão', () => {
 const doisKalidash = { ...donos, engagements: [...donos.engagements, { id: 'e-kali2', tenant_id: 't-kali', label: 'Kalidash — mentoria', service_model: 'education', archived_at: null }] };
 const resposta = sugerirDono(repo('1'), { ...contexto(), donos: doisKalidash });
 assert.equal(resposta.dono, undefined);
 assert.equal(resposta.ambiguo.length, 2);
});

test('nome genérico ou sem dono parecido não sugere nada', () => {
 assert.equal(sugerirDono(repo('4'), contexto()), null);
 assert.equal(sugerirDono({ provider: 'easypanel', id: 'x/y', name: 'x / worker' }, contexto()), null);
});

test('contratação arquivada não é candidata', () => {
 const arquivado = { ...donos, engagements: donos.engagements.map(e => e.id === 'e-kali' ? { ...e, archived_at: '2026-01-01' } : e) };
 // Sobra a empresa Kalidash, que não é dono possível: só contratação e item do portfólio são.
 assert.equal(sugerirDono(repo('1'), { ...contexto(), donos: arquivado }), null);
});

test('serviço do EasyPanel só tem o nome como pista', () => {
 const sugestao = sugerirDono(itens.find(item => item.provider === 'easypanel'), contexto());
 assert.equal(sugestao.evidencia, 'nome');
 assert.equal(sugestao.dono.engagement_id, 'e-kali');
});

test('monorepo: o repositório sem dono traz os projetos irmãos da Vercel que também estão sem dono', () => {
 assert.deepEqual(irmaosDoRepositorio(repo('1'), contexto()).map(item => item.id).sort(), ['v1', 'v2']);
 // Quem já tem dono não é arrastado para outro.
 const conexoes = [{ active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-outra', product_id: null }];
 assert.deepEqual(irmaosDoRepositorio(repo('1'), contexto(conexoes)).map(item => item.id), ['v2']);
 // Repositório sem nenhum projeto ligado não tem irmãos.
 assert.deepEqual(irmaosDoRepositorio(repo('3'), contexto()), []);
});

test('dois donos diferentes nos irmãos: ambiguidade, e nenhuma sugestão automática', () => {
 const conexoes = [
  { active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-kali', product_id: null },
  { active: true, provider: 'vercel', external_id: 'v2', engagement_id: 'e-outra', product_id: null },
 ];
 assert.equal(sugerirDono(repo('1'), contexto(conexoes)).ambiguo.length, 2);
});

test('agruparSugestoes junta o repositório, os projetos irmãos e o que só tem o nome, sob o mesmo dono', () => {
 const conexoes = [{ active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-kali', product_id: null }];
 const semDono = itens.filter(item => !conexoes.some(b => casa(b, item)));
 const { grupos, ambiguos, restantes } = agruparSugestoes(semDono, contexto(conexoes));
 const kali = grupos.find(g => g.dono.engagement_id === 'e-kali');
 // O repositório, o projeto irmão (mesma origem) e os dois que só têm o nome.
 assert.deepEqual(kali.recursos.map(r => r.recurso.name).sort(),
  ['kalidash-admin', 'other / kalidash-api', 'tzolkin-collab/Kalidash_LandingPage_01_-evento-', 'tzolkin-collab/Kalidash_Site']);
 assert.equal(ambiguos.length, 0);
 // O que não tem pista nenhuma fica de fora dos grupos, para a tela só contá-lo.
 assert.ok(restantes.every(r => !kali.recursos.some(x => x.recurso.id === r.id && x.recurso.provider === r.provider)));
});

test('agruparSugestoes não repete um recurso em dois grupos e não arrasta quem já tem dono', () => {
 const conexoes = [
  { active: true, provider: 'vercel', external_id: 'v1', engagement_id: 'e-kali', product_id: null },
  { active: true, provider: 'vercel', external_id: 'v2', engagement_id: 'e-outra', product_id: null },
 ];
 const semDono = itens.filter(item => !conexoes.some(b => casa(b, item)));
 const { grupos, ambiguos } = agruparSugestoes(semDono, contexto(conexoes));
 const todos = [...grupos.flatMap(g => g.recursos.map(r => `${r.recurso.provider}:${r.recurso.id}`)), ...ambiguos.map(a => `${a.recurso.provider}:${a.recurso.id}`)];
 assert.equal(new Set(todos).size, todos.length, 'nenhum recurso em dois lugares');
 assert.ok(!todos.includes('vercel:v1') && !todos.includes('vercel:v2'), 'quem já tem dono não é sugerido de novo');
});

test('nomeDoDono não repete a categoria nem a empresa que o rótulo já diz', () => {
 // O rótulo já traz a categoria: nada de "· sob demanda" duas vezes.
 assert.equal(nomeDoDono({ label: 'Kalidash sob demanda', cliente: 'Kalidash', modelo: 'on_demand' }), 'Kalidash sob demanda');
 assert.equal(nomeDoDono({ label: 'Clínica Exemplo — assessoria', cliente: 'Clínica Exemplo', modelo: 'advisory' }), 'Clínica Exemplo — assessoria');
 // O rótulo não traz nem a empresa nem a categoria: entram as duas, uma vez cada.
 assert.equal(nomeDoDono({ label: 'Site e landing', cliente: 'Kalidash', modelo: 'on_demand' }), 'Site e landing · Kalidash · sob demanda');
 // Só a categoria falta.
 assert.equal(nomeDoDono({ label: 'Kalidash — site', cliente: 'Kalidash', modelo: 'on_demand' }), 'Kalidash — site · sob demanda');
 // Sem empresa e sem modelo, o rótulo fica como está.
 assert.equal(nomeDoDono({ label: 'Contratação avulsa' }), 'Contratação avulsa');
});

test('o item chamado "core" é encontrado pelo nome, embora "core" seja palavra comum', () => {
 // Educare tem 'TZOLKIN' no nome: a palavra da casa não pode fazê-lo concorrer com o Core.
 const comCore = { ...donos, products: [...donos.products, { id: 'core', name: 'Core' }, { id: 'educare', name: 'Educare by TZOLKIN' }] };
 const recursos = [
  { provider: 'github', id: '9', name: 'tzolkin-collab/Tzolkin_Core', repository: null },
  { provider: 'easypanel', id: 'other/core', name: 'other / core' },
  { provider: 'vercel', id: 'v9', name: 'tzolkin-core', repository: null },
 ];
 for (const recurso of recursos) {
  const sugestao = sugerirDono(recurso, { itens: [...itens, ...recursos], conexoes: [], donos: comCore, casa });
  assert.equal(sugestao?.dono?.product_id, 'core', `${recurso.name} deveria sugerir o Core`);
 }
 // Um nome comum sem o nome do item continua sem sugestão, e o Core não vira coringa.
 assert.equal(sugerirDono({ provider: 'github', id: '8', name: 'tzolkin-collab/site-tzolkin' }, { itens, conexoes: [], donos: comCore, casa }), null);
});

test('desempate por especificidade: candidato com mais termos em comum vence sem ambiguidade', () => {
 const doisKalidash = {
  ...donos,
  engagements: [
   { id: 'e-lp', tenant_id: 't-kali', label: 'Landing Page: Projeto Claude para Empresas.', service_model: 'on_demand', status: 'active', archived_at: null },
   { id: 'e-pwa', tenant_id: 't-kali', label: 'PWA Institucional + CRM Admin', service_model: 'on_demand', status: 'active', archived_at: null },
  ],
 };
 const recursoAdmin = { provider: 'vercel', id: 'v-adm', name: 'kalidash-site-admin', repository: null };
 const sugestao = sugerirDono(recursoAdmin, { itens: [...itens, recursoAdmin], conexoes: [], donos: doisKalidash, casa });
 assert.equal(sugestao.dono.engagement_id, 'e-pwa');
 assert.match(sugestao.motivo, /admin/);
});

test('desempate por situação: contratação ativa vence contratação concluída do mesmo cliente', () => {
 const doisKalidash = {
  ...donos,
  engagements: [
   { id: 'e-lp', tenant_id: 't-kali', label: 'Landing Page: Projeto Claude para Empresas.', service_model: 'on_demand', status: 'completed', archived_at: null },
   { id: 'e-pwa', tenant_id: 't-kali', label: 'PWA Institucional + CRM Admin', service_model: 'on_demand', status: 'active', archived_at: null },
  ],
 };
 const recursoSite = { provider: 'vercel', id: 'v-site', name: 'kalidash-site', repository: null };
 const sugestao = sugerirDono(recursoSite, { itens: [...itens, recursoSite], conexoes: [], donos: doisKalidash, casa });
 assert.equal(sugestao.dono.engagement_id, 'e-pwa');
 assert.equal(sugestao.evidencia, 'nome');
});

test('irmão do repositório resolve ambiguidade em agruparSugestoes', () => {
 const doisKalidash = {
  ...donos,
  engagements: [
   { id: 'e-lp', tenant_id: 't-kali', label: 'Landing Page: Projeto Claude para Empresas.', service_model: 'on_demand', status: 'active', archived_at: null },
   { id: 'e-pwa', tenant_id: 't-kali', label: 'PWA Institucional + CRM Admin', service_model: 'on_demand', status: 'active', archived_at: null },
  ],
 };
 const repoItem = { provider: 'github', id: 'r-kali', name: 'tzolkin-collab/Kalidash_Repo', repository: null };
 const adminItem = { provider: 'vercel', id: 'v-adm', name: 'kalidash-admin', repository: 'tzolkin-collab/Kalidash_Repo' };
 const { grupos, ambiguos } = agruparSugestoes([repoItem, adminItem], { itens: [repoItem, adminItem], conexoes: [], donos: doisKalidash, casa });
 const grupoPwa = grupos.find(g => g.dono.engagement_id === 'e-pwa');
 assert.ok(grupoPwa, 'deve ter grupo PWA');
 assert.equal(grupoPwa.recursos.length, 2, 'deve conter o admin e o repositório irmão');
 assert.equal(ambiguos.length, 0, 'não deve sobrar ambiguidade');
});

