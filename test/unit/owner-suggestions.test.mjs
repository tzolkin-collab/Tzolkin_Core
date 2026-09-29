// Sugestão de dono: o caso que motivou o módulo (Kalidash, um repositório com mais
// de um projeto na Vercel, cliente sob demanda) e as recusas que o protegem de virar
// a heurística por nome que a migração 034 aposentou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { achatar, termos, sugerirDono, irmaosDoRepositorio } from '../../apps/web/public/owner-suggestions.js';

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
