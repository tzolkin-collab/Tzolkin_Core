import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fonte = nome => readFileSync(new URL(`../../apps/web/public/${nome}`, import.meta.url), 'utf8');

test('tela de Serviços: elementos de filtro existem no HTML e na barra de ferramentas', () => {
  const html = fonte('index.html');
  assert.match(html, /<section\s+id="view-services"[^>]*>/, 'seção view-services deve existir');
  assert.match(html, /<select\s+id="services-filter"><\/select>/, 'select #services-filter deve existir dentro de view-services');
  assert.match(html, /<div\s+id="services-summary"[^>]*>/, 'resumo dos serviços deve existir');
  assert.match(html, /<div\s+id="services-list"><\/div>/, 'container #services-list deve existir');
});

test('filtro de Serviços em app.js: modelos válidos, filtragem e reatividade', () => {
  const app = fonte('app.js');

  // Define os modelos de serviço excluindo produto simples
  assert.match(app, /const\s+MODELOS_DE_SERVICO\s*=\s*SERVICE_MODELS\.filter\(model\s*=>\s*model\s*!==\s*'product'\)/, 'MODELOS_DE_SERVICO filtra apenas serviços reais');
  assert.match(app, /const\s+serviceEngagements\s*=\s*\(\)\s*=>\s*state\.overview\?\.engagements\?\.filter/, 'serviceEngagements filtra contratações ativas');

  // Filtragem efetiva por service_model
  assert.match(app, /const\s+engagements\s*=\s*serviceFilter\s*\?\s*todos\.filter\(e\s*=>\s*e\.service_model\s*===\s*serviceFilter\)\s*:\s*todos/, 'engagements aplica o serviceFilter sobre todos');

  // Montagem dinâmica das opções presentes nos dados reais
  assert.match(app, /const\s+tipos\s*=\s*MODELOS_DE_SERVICO\.filter\(model\s*=>\s*todos\.some\(e\s*=>\s*e\.service_model\s*===\s*model\)\)/, 'filtro só exibe opções que possuem dados reais cadastrados');

  // Opção padrão "Todos os tipos"
  assert.match(app, /filtro\.replaceChildren\(option\('','Todos os tipos'\)/, 'primeira opção do filtro deve ser Todos os tipos');

  // Disparo ao trocar de opção re-renderiza a lista
  assert.match(app, /filtro\.onchange\s*=\s*\(\)\s*=>\s*\{\s*serviceFilter\s*=\s*filtro\.value;\s*renderServices\(\);\s*\}/, 'ao alterar filtro atualiza serviceFilter e chama renderServices');
});

test('lógica de filtragem pura: isola e conta contratações por modelo', () => {
  const mockEngagements = [
    { id: '1', service_model: 'retainer', label: 'Assessoria Mensal' },
    { id: '2', service_model: 'education', label: 'Mentoria Técnica' },
    { id: '3', service_model: 'on_demand', label: 'Consultoria Pontual' },
    { id: '4', service_model: 'education', label: 'Mentoria Executiva' },
    { id: '5', service_model: 'product', label: 'Ignorado' },
  ];

  const MODELOS_DE_SERVICO = ['retainer', 'on_demand', 'education'];
  const todos = mockEngagements.filter(e => MODELOS_DE_SERVICO.includes(e.service_model));
  assert.equal(todos.length, 4, 'exclui modelos que não são de serviço');

  const tipos = MODELOS_DE_SERVICO.filter(m => todos.some(e => e.service_model === m));
  assert.deepEqual(tipos, ['retainer', 'on_demand', 'education']);

  let serviceFilter = 'education';
  let filtrados = serviceFilter ? todos.filter(e => e.service_model === serviceFilter) : todos;
  assert.equal(filtrados.length, 2);
  assert.ok(filtrados.every(e => e.service_model === 'education'));

  serviceFilter = '';
  filtrados = serviceFilter ? todos.filter(e => e.service_model === serviceFilter) : todos;
  assert.equal(filtrados.length, 4);
});
