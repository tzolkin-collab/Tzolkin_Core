// A tela de Projetos técnicos, depois de o projeto passar a ter dono.
//
// Dois tipos de teste convivem aqui, e é de propósito. As funções puras
// (rotuloDoDono, donoEscolhido) são chamadas de verdade, porque dá. O resto do
// assistente só existe dentro de um DOM, e o que se pode afirmar sem navegador é
// sobre o FONTE: que o passo novo existe na ordem certa, que o ícone pedido existe
// mesmo em icons.js, que a frase "Ativar produto" — que chamava de produto uma
// linha de serviço — não voltou, e que a tela manda o dono no corpo. São as
// mesmas guardas de fonte que connections.test.mjs e web-nav.test.mjs usam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rotuloDoDono, donoEscolhido } from '../../apps/web/public/delivery.js';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const fonte = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');
const delivery = fonte('delivery.js'), html = fonte('index.html'), icons = fonte('icons.js');

test('o dono aparece com o tipo que ele tem, e não como "produto"', () => {
 assert.equal(rotuloDoDono({ kind: 'item', name: 'Skiller', item_kind_label: 'linha de serviço' }), 'Skiller · linha de serviço');
 assert.equal(rotuloDoDono({ kind: 'item', name: 'Educare', item_kind_label: 'produto' }), 'Educare · produto');
 assert.equal(rotuloDoDono({ kind: 'item', name: 'Core' }), 'Core · item', 'sem o tipo, "item" é honesto; "produto" seria chute');
 assert.equal(rotuloDoDono({ kind: 'engagement', name: 'Consultoria' }), 'Consultoria · contratação');
 assert.equal(rotuloDoDono({ kind: 'none' }), 'Sem dono');
 assert.equal(rotuloDoDono(null), 'Sem dono');
});

test('o seletor de dono vira um dono só, na mesma forma que o servidor exige', () => {
 assert.deepEqual(donoEscolhido('product:skiller'), { product_id: 'skiller', engagement_id: null });
 assert.deepEqual(donoEscolhido('engagement:22222222-2222-4222-8222-222222222222'),
  { product_id: null, engagement_id: '22222222-2222-4222-8222-222222222222' });
 // Item com hífen no id não perde metade do nome: o corte é no PRIMEIRO dois-pontos.
 assert.deepEqual(donoEscolhido('product:tzolkin-sites'), { product_id: 'tzolkin-sites', engagement_id: null });
 assert.equal(donoEscolhido(''), null, 'nada escolhido não vira dono nenhum');
 assert.equal(donoEscolhido(null), null);
 assert.equal(donoEscolhido('product:'), null);
 assert.equal(donoEscolhido('outro:coisa'), null);
});

test('"Pertence a" é o primeiro passo do assistente, e o passo existe no index.html', () => {
 const ids = delivery.match(/const stepIds = \[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
 const labels = delivery.match(/const stepLabels = \[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
 const icones = delivery.match(/const stepIcons = \[([^\]]+)\]/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
 assert.deepEqual(ids, ['owner', 'project', 'components', 'review']);
 assert.deepEqual(labels, ['Pertence a', 'Projeto', 'Serviços', 'Revisão']);
 assert.equal(icones.length, ids.length, 'passo sem ícone cairia no pictograma genérico');
 // O ícone pedido tem de existir de verdade: createIcon cai em 'layers' quando o
 // nome é desconhecido, então um erro de digitação some sem avisar dentro da tela.
 const nomesDeIcone = new Set([...icons.matchAll(/(?:^|[,{\s])"?([a-z][a-z0-9-]*)"?\s*:\s*\[\[/gm)].map(m => m[1]));
 for (const [, chave, valor] of icons.matchAll(/([a-z][a-z0-9-]*):'([a-z][a-z0-9-]*)'/g)) { nomesDeIcone.add(chave); nomesDeIcone.add(valor); }
 assert.ok(nomesDeIcone.size > 20, 'a leitura de icons.js falhou, e o teste estaria conferindo nada');
 for (const nome of [...icones, 'package', 'briefcase']) assert.ok(nomesDeIcone.has(nome), `ícone ${nome} não existe em icons.js`);
 for (const id of ids) assert.ok(html.includes(`id="delivery-step-${id}"`), `falta a seção delivery-step-${id}`);
 assert.ok(html.includes('id="delivery-owner-picker"'));
 // Índices fixos (o antigo `step === 2`) quebrariam ao ganhar um passo.
 assert.ok(!/step === 2|showStep\(Math\.min\(2/.test(delivery), 'a tela não pode voltar a decidir o último passo por número fixo');
});

test('a tela manda o dono no corpo, e só quando há o que decidir', () => {
 // O corpo do POST/PUT espalha o que donoEscolhido devolveu: é o único caminho
 // pelo qual product_id e engagement_id saem da tela.
 assert.match(delivery, /const dono = ownerSelect \? donoEscolhido\(ownerSelect\.value\) : null;/);
 assert.match(delivery, /\.\.\.\(dono \|\| \{\}\)/);
 // Projeto que já tem dono não ganha seletor, então não manda dono — é assim que a
 // tela deixa de pedir uma troca que o servidor recusa com 409.
 assert.match(delivery, /if \(dono && dono\.kind !== 'none'\)/);
});

test('o botão de ativar (agora no cartão do dono) diz o tipo do item, e some onde não há o que ativar', () => {
 const conexoes = fonte('connections.js');
 assert.ok(!delivery.includes("'Ativar produto'") && !conexoes.includes("'Ativar produto'"), 'a tela chamava de produto toda linha de serviço');
 assert.match(conexoes, /`Ativar \$\{projeto\.belongs_to\.item_kind_label \|\| 'item'\}`/);
 // Três condições, todas no fonte: é item do portfólio, está em rascunho e o
 // checklist persistido está completo. O servidor recusa as três de novo.
 assert.match(conexoes, /projeto\.belongs_to\?\.kind === 'item' && projeto\.product_lifecycle_status === 'draft' && checklist\?\.ready/);
 // A ativação em si continua sendo uma função do cadastro técnico.
 assert.match(delivery, /async function activate\(project\)/);
});

test('Conexões e as abas dos provedores leem o mesmo cadastro, e recarregam depois de salvar', () => {
 const app = fonte('app.js');
 // Duas telas, um cadastro só: os projetos técnicos moram em Conexões e os
 // repositórios em GitHub. Quem salva estando em qualquer uma delas precisa ver o
 // projeto aparecer, e as telas antigas (Deploys, Projetos técnicos) não existem mais.
 assert.match(app, /\['connections','github','vercel','easypanel'\]\.includes\(view\)/);
 assert.match(app, /\['connections','github','vercel','easypanel'\]\.includes\(state\.view\)/);
 assert.ok(!/view-delivery|view-deploys|view-management/.test(app), 'as seções antigas de Tecnologia saíram');
// O dono oferecido é o mesmo cadastro da tela de Conexões, com o tipo já traduzido
 // pelo dicionário que vive no app.js — delivery.js não tem uma cópia dele.
 assert.match(app, /owners:\(\)=>\(\{/);
 assert.match(app, /kind_label:kindInfo\(item\.portfolio_kind\)\?\.label/);
 // Os tipos vêm da API (registro em catalog.mjs); nem o painel nem esta tela guardam
 // um dicionário próprio.
 assert.ok(!/PORTFOLIO_KIND_LABELS|KIND_INFO|KIND_ORDER/.test(app + delivery), 'o dicionário de tipos não pode existir no painel');
});

test('a tela de projetos técnicos não pede mais exclusão a ninguém', () => {
 // Excluir virou arquivar no servidor; o painel não pode continuar chamando DELETE
 // numa rota que deixou de existir.
 assert.ok(!/api\([^)]*delivery\/projects[^)]*'DELETE'/.test(delivery));
 assert.ok(!/'DELETE'/.test(delivery), 'delivery.js não emite DELETE nenhum');
});
