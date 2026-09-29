// Tela de Conexões: o casamento entre o que está gravado e o que o provedor mostra.
//
// A função casaConexao é a única do painel que responde "esta conexão é deste
// projeto?". Antes havia três respostas diferentes para a mesma pergunta — uma em
// Produtos, uma em Serviços, uma em Gestão técnica —, e elas discordavam: a de
// Produtos comparava o nome do PROJETO do EasyPanel com um id no formato
// projeto/serviço, e por isso um serviço classificado aparecia como "Classificação
// pendente". Esta é a razão de os testes abaixo insistirem tanto no id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { casaConexao } from '../../apps/web/public/connections.js';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const fonte = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

const conexao = extra => ({ provider: 'vercel', external_id: 'prj_abc123', external_id_kind: 'provider_id', display_name: 'tzolkin-sites', ...extra });
const recurso = extra => ({ provider: 'vercel', id: 'prj_abc123', name: 'tzolkin-sites', ...extra });

test('o id do provedor manda, e o provedor tem de ser o mesmo', () => {
 assert.ok(casaConexao(conexao(), recurso()));
 // Projeto renomeado: o id continua o mesmo, o vínculo continua valendo. É a
 // razão de existir o id — o nome é do humano, o id é do recurso.
 assert.ok(casaConexao(conexao(), recurso({ name: 'sites-tzolkin-novo-nome' })));
 assert.ok(!casaConexao(conexao(), recurso({ id: 'prj_outro' })));
 assert.ok(!casaConexao(conexao({ provider: 'easypanel' }), recurso()));
 assert.ok(!casaConexao(conexao(), null), 'sem recurso não há casamento');
});

test('o nome só casa quando o vínculo foi gravado com id nominal', () => {
 // Projeto que herdou o nome de outro: com id de provedor, não casa. Foi esse
 // casamento por nome que deixou um projeto renomeado herdar o dono de outro.
 assert.ok(!casaConexao(conexao({ external_id: 'prj_antigo' }), recurso({ id: 'prj_novo' })));
 // Id nominal é o legado declarado (migração 020, EasyPanel antigo): aí o nome é
 // o identificador, porque o provedor não deu outro.
 const nominal = conexao({ external_id: 'designer', external_id_kind: 'name', display_name: 'designer' });
 assert.ok(casaConexao(nominal, recurso({ id: 'prj_qualquer', name: 'designer' })));
 assert.ok(!casaConexao(nominal, recurso({ id: 'prj_qualquer', name: 'outro' })));
});

test('EasyPanel casa por serviço, no formato projeto/serviço do inventário', () => {
 // O inventário (delivery-options.mjs) devolve id 'other/core' e nome 'other / core',
 // e é isso que está gravado. Comparar com o nome do projeto ('other') era o que
 // fazia a tela antiga dizer "Classificação pendente" para um serviço classificado.
 const core = { provider: 'easypanel', external_id: 'other/core', external_id_kind: 'provider_id', display_name: 'other / core' };
 assert.ok(casaConexao(core, { provider: 'easypanel', id: 'other/core', name: 'other / core' }));
 assert.ok(!casaConexao(core, { provider: 'easypanel', id: 'other', name: 'other' }));
 assert.ok(!casaConexao(core, { provider: 'easypanel', id: 'other/skiller', name: 'other / skiller' }), 'dois serviços do mesmo projeto não são o mesmo recurso');
});

test('id numérico do GitHub casa mesmo vindo como número do inventário', () => {
 const repo = { provider: 'github', external_id: '1353012326', external_id_kind: 'provider_id', display_name: 'tzolkin-collab/Tzolkin_Core' };
 assert.ok(casaConexao(repo, { provider: 'github', id: 1353012326, name: 'tzolkin-collab/Tzolkin_Core' }));
});

// ---------------------------------------------------------------------------
// Guardas de fonte
// ---------------------------------------------------------------------------

test('o painel inteiro usa um casamento só, e nenhuma tela escreve nas tabelas antigas', () => {
 const app = fonte('app.js'), tela = fonte('connections.js');
 // Casar por nome fora de casaConexao é a reincidência que este trabalho fechou.
 assert.ok(!/external_project_name\s*===\s*project/.test(app), 'voltou a casar projeto por nome em app.js');
 assert.ok(!/DEPLOY_ALIASES\s*=/.test(app), 'DEPLOY_ALIASES voltou: ele adivinhava o dono pelo nome do projeto');
 for (const rota of ['product-deploy-bindings', 'service-deploy-bindings'])
  for (const arquivo of ['app.js', 'connections.js', 'delivery.js'])
   assert.ok(!new RegExp(`api\\(\\s*['\`]/api/${rota}`).test(fonte(arquivo)),
    `${arquivo} ainda chama /api/${rota}; a tela lê e grava no registro único`);
 // A tela de Conexões é a única que precisa ver o desligado, e pede isso explícito.
 assert.ok(tela.includes('/api/product-resource-bindings?state=all'), 'a tela precisa de state=all para enxergar a conexão desligada');
 // Desvincular e reatribuir só chegam ao servidor com motivo: é o que diferencia
 // uma decisão registrada de uma linha que some sem explicação.
 assert.ok(/'DELETE', \{ reason, revision: binding\.revision \}/.test(tela), 'desvincular precisa mandar motivo e revisão');
 assert.ok(/reassign: true/.test(tela), 'reatribuir precisa declarar reassign');
});

test('a tela sabe traduzir todas as ações que a trilha pode gravar', () => {
 const tela = fonte('connections.js');
 const traduzidas = new Set([...(/const ACOES = \{([^}]*)\}/.exec(tela)?.[1] ?? '').matchAll(/(\w+):/g)].map(m => m[1]));
 // A lista do banco: CHECK product_resource_audit_action_check, migração 034. Uma
 // ação sem tradução apareceria no histórico com o nome da coluna.
 const migracao = readFileSync(new URL('../../db/migrations/034_uma_conexao_um_dono.sql', import.meta.url), 'utf8');
 const doBanco = [...(/action IN \(([^)]*)\)/.exec(migracao)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1]);
 assert.ok(doBanco.length >= 8, `poucas ações lidas da migração (${doBanco.length})`);
 for (const acao of doBanco) assert.ok(traduzidas.has(acao), `o histórico não sabe dizer "${acao}" em português`);
});
