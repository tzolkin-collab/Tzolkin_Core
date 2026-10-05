// A navegação do painel, afirmada por fora.
//
// renderNav abre um cabeçalho de grupo toda vez que o grupo da tela MUDA. A
// consequência não é óbvia: a ordem das chaves em CONTEXTS é a ordem da barra, e
// uma tela fora de lugar não aparece só fora de lugar — ela parte o grupo dela em
// dois cabeçalhos iguais ("Tecnologia" duas vezes, com uma tela de outro grupo no
// meio). Isso não quebra teste nenhum, não lança erro e some no meio de um diff.
//
// O mesmo desenho está escrito em dois lugares (a ordem em CONTEXTS e o mapa
// `groups` em renderNav), e é a discordância entre eles que produz o defeito. Este
// teste lê os dois do fonte e confere o resultado contra a navegação combinada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PUBLIC = new URL('../../apps/web/public/', import.meta.url);
const fonte = nome => readFileSync(new URL(nome, PUBLIC), 'utf8');

// A navegação do contexto geral, como foi decidida: grupo e, dentro dele, ordem.
const NAVEGACAO = [
 ['Hoje', ['Visão geral', 'Financeiro']],
 ['Relacionamentos', ['Empresas', 'Pessoas', 'Clientes', 'Inbound', 'E-mails']],
 ['Portfólio', ['Portfólio']],
 ['Entrega', ['Serviços', 'Acompanhamento']],
 ['Tecnologia', ['Conexões', 'Vercel', 'GitHub', 'EasyPanel', 'DNS']],
 ['Bases de dados', ['Banco de dados']],
 ['Administração', ['Configurações']],
];

// Esvazia o conteúdo das aspas simples preservando o tamanho: os blocos lidos aqui
// não têm template literal nem aspas escapadas, e sem isso um título com chave
// dentro estragaria a contagem de chaves.
const semTexto = bloco => bloco.replace(/'[^']*'/g, aspas => `'${' '.repeat(aspas.length - 2)}'`);

/** Trecho que começa em `{` na posição `abre` e vai até a chave que o fecha. */
function bloco(texto, abre) {
 const codigo = semTexto(texto);
 let profundidade = 0;
 for (let k = abre; k < codigo.length; k++) {
  if (codigo[k] === '{') profundidade++;
  else if (codigo[k] === '}' && --profundidade === 0) return texto.slice(abre, k + 1);
 }
 throw new Error(`sem fechamento para a posição ${abre}`);
}

const depoisDe = (texto, marca) => {
 const posicao = texto.indexOf(marca);
 assert.notEqual(posicao, -1, `não encontrei "${marca}" em app.js`);
 return posicao + marca.length - 1;
};

/** As telas de um contexto, na ordem em que estão escritas. */
function telas(app, contexto) {
 const contextos = bloco(app, depoisDe(app, 'const CONTEXTS = {'));
 const inicio = contextos.indexOf(`${contexto}: {`);
 assert.notEqual(inicio, -1, `contexto ${contexto} não encontrado`);
 const views = bloco(contextos, contextos.indexOf('{', contextos.indexOf('views: {', inicio) + 7));
 // Uma tela por linha: `chave: { ... },`. O formato é do arquivo, e a guarda de
 // quantidade lá embaixo impede que uma mudança de formatação faça este teste
 // passar lendo zero telas.
 return [...views.matchAll(/^\s*'?([\w-]+)'?\s*:\s*\{([^{}]*)\}/gm)].map(([, chave, corpo]) => ({
  chave,
  titulo: /title\s*:\s*'([^']*)'/.exec(corpo)?.[1] ?? null,
  secao: /section\s*:\s*'([^']*)'/.exec(corpo)?.[1] ?? null,
  oculta: /hidden\s*:\s*true/.test(corpo),
 }));
}

/** O mapa chave → grupo que renderNav usa no contexto geral. */
function grupos(app) {
 const literal = bloco(app, depoisDe(app, "const groups=contextKind()==='general'?{"));
 return Object.fromEntries([...literal.matchAll(/([\w-]+)\s*:\s*'([^']+)'/g)].map(([, chave, grupo]) => [chave, grupo]));
}

test('a barra do contexto geral tem os grupos e as telas combinados, nesta ordem', () => {
 const app = fonte('app.js');
 const views = telas(app, 'general'), mapa = grupos(app);
 // Guardas do próprio teste: sem elas, um regex que parasse de casar deixaria o
 // teste verde afirmando coisa nenhuma.
 assert.ok(views.length >= 18, `poucas telas lidas de CONTEXTS (${views.length})`);
 for (const chave of ['overview', 'connections', 'vercel', 'github', 'easypanel', 'dns', 'access'])
  assert.ok(views.some(v => v.chave === chave), `tela ${chave} não foi lida de CONTEXTS`);

 const visiveis = views.filter(v => !v.oculta);
 for (const { chave } of views) assert.ok(mapa[chave], `a tela ${chave} não tem grupo em renderNav e cairia no grupo da tela anterior`);
 for (const chave of Object.keys(mapa)) assert.ok(views.some(v => v.chave === chave), `renderNav agrupa ${chave}, que não existe mais em CONTEXTS`);

 // Exatamente o que renderNav faz: cabeçalho novo quando o grupo muda.
 const barra = [];
 for (const view of visiveis) {
  if (barra.at(-1)?.[0] !== mapa[view.chave]) barra.push([mapa[view.chave], []]);
  barra.at(-1)[1].push(view.titulo);
 }
 assert.deepEqual(barra, NAVEGACAO);

 // A afirmação que o resto do teste torna possível: nenhum grupo aparece duas
 // vezes. Um grupo repetido é exatamente o sintoma de uma tela fora de ordem.
 const cabecalhos = barra.map(([grupo]) => grupo);
 assert.equal(new Set(cabecalhos).size, cabecalhos.length, `grupo repetido na barra: ${cabecalhos.join(' · ')}`);
});

test('as telas ocultas ficam no grupo delas, para não partirem a barra quando forem reveladas', () => {
 const app = fonte('app.js');
 const views = telas(app, 'general'), mapa = grupos(app);
 const sequencia = views.map(v => mapa[v.chave]);
 // Mesma conferência, agora com as ocultas no meio: se uma delas estiver alojada
 // no grupo errado, revelá-la parte o grupo em dois — e quem revelar não vai
 // desconfiar da posição da chave, porque hoje nada aponta para ela.
 const mudancas = sequencia.filter((grupo, i) => grupo !== sequencia[i - 1]);
 assert.equal(new Set(mudancas).size, mudancas.length, `grupo repetido com as ocultas: ${mudancas.join(' · ')}`);
});

test('toda tela aponta para uma seção que existe no index.html e é apagada ao trocar de contexto', () => {
 const app = fonte('app.js'), html = fonte('index.html');
 const lista = /const SECTIONS = \[([^\]]*)\]/.exec(app);
 assert.ok(lista, 'SECTIONS não encontrado em app.js');
 // A lista é montada em dois passos no fonte (o literal e um SECTIONS.push logo
 // abaixo). Ler só o literal deixaria duas telas de fora e o teste passaria por
 // ignorá-las, que é o contrário do que ele serve para fazer.
 const empurradas = [...app.matchAll(/SECTIONS\.push\(([^)]*)\)/g)].map(m => m[1]).join(',');
 const secoes = new Set([...`${lista[1]},${empurradas}`.matchAll(/'([^']+)'/g)].map(m => m[1]));
 assert.ok(secoes.size >= 25, `poucas seções em SECTIONS (${secoes.size})`);
 for (const contexto of ['general', 'product'])
  for (const view of telas(app, contexto)) {
   assert.ok(view.secao, `${contexto}.${view.chave} não declara seção`);
   // Sem isto, a tela abre em branco: switchView esconde tudo o que está em
   // SECTIONS e mostra a seção da tela ativa — que precisa existir nas duas listas.
   assert.ok(secoes.has(view.secao), `${view.chave} usa a seção ${view.secao}, que não está em SECTIONS e ficaria visível por baixo da tela seguinte`);
   assert.ok(new RegExp(`id="${view.secao}"`).test(html), `${view.chave} aponta para #${view.secao}, que não existe no index.html`);
  }
});

test('no contexto do produto, "Clientes" chama-se Acessos', () => {
 const app = fonte('app.js');
 const produto = telas(app, 'product');
 const orgs = produto.find(v => v.chave === 'product-orgs');
 assert.ok(orgs, 'a tela product-orgs sumiu do contexto do produto');
 // Duas telas com o mesmo nome e conteúdos diferentes — a carteira no geral, quem
 // tem acesso ao item no produto — ensinam errado sobre o que o Core registra.
 assert.equal(orgs.titulo, 'Acessos');
 assert.equal(telas(app, 'general').find(v => v.chave === 'clients').titulo, 'Clientes');
});
