// Tela de Conexões — o registro único de "de quem é este recurso", visto de fora.
//
// A tela que ela substitui ("Projetos detectados nos provedores") só sabia falar
// de deploy, classificava por nome e escrevia em duas tabelas que a migração 034
// aposentou. Esta parte das mesmas três perguntas, agora para todo tipo de recurso:
//
//  1. o que já tem dono — e QUEM é o dono, item do portfólio ou contratação;
//  2. o que o provedor mostra e nenhuma conexão reclama (sem classificar);
//  3. o que uma conexão reclama e o provedor não mostra mais (some sem avisar).
//
// Nada aqui decide permissão nem regra de negócio: o servidor recusa o que tem de
// recusar, e a tela mostra a recusa em vez de escondê-la. Desligar e trocar de dono
// pedem motivo porque é o motivo que, meses depois, separa uma decisão de um sumiço.
import { providerLogo, createIcon } from './icons.js';

/**
 * Casamento entre uma conexão confirmada e um item do inventário do provedor.
 * UMA função, usada pela tela de Conexões e por app.js: enquanto cada tela tinha
 * a sua, a de Produtos dizia "Classificação pendente" para um serviço do EasyPanel
 * que estava classificado — ela comparava o nome do PROJETO com um id no formato
 * projeto/serviço.
 *
 * O id do provedor manda. O nome só vale quando a conexão foi gravada com id
 * nominal (external_id_kind='name'), que é o único caso em que o provedor não deu
 * id (o legado da 020, o EasyPanel antigo). Casar por nome em qualquer outro caso
 * é o que deixava um projeto renomeado herdar o dono de outro — exatamente o que a
 * 034 existe para acabar.
 */
export const casaConexao = (binding, recurso) => Boolean(recurso) && binding.provider === recurso.provider
 && (String(binding.external_id) === String(recurso.id ?? '')
  || (binding.external_id_kind === 'name' && binding.external_id === recurso.name));

// Provedores cujo inventário esta tela consegue ler. Fora desta lista (hostinger,
// stripe, manual) não existe "não encontrado no provedor": existe "não conferido",
// e dizer a primeira coisa seria inventar uma ausência.
const INVENTARIADOS = ['github', 'vercel', 'easypanel'];

const PROVEDORES = { github: 'GitHub', vercel: 'Vercel', easypanel: 'EasyPanel', hostinger: 'Hostinger', stripe: 'Stripe', asaas: 'Asaas', manual: 'Manual' };

// Como a tela agrupa os tipos do banco. A ordem é a da pergunta que o operador faz
// ("onde está o código, onde ele roda, por onde se chega, onde estão os dados"), e
// todo tipo aceito pela API cai em algum grupo: um tipo sem grupo sumiria da tela.
const GRUPOS = [
 { chave: 'repository', titulo: 'Repositórios', icone: 'repo', tipos: ['repository'] },
 { chave: 'deploy', titulo: 'Deploys e aplicações', icone: 'cloud', tipos: ['frontend', 'backend', 'api', 'worker'] },
 { chave: 'domain', titulo: 'Domínios', icone: 'external', tipos: ['domain'] },
 { chave: 'data', titulo: 'Bancos e caches', icone: 'database', tipos: ['database', 'cache'] },
 { chave: 'sales', titulo: 'Checkout e e-mail', icone: 'wallet', tipos: ['checkout', 'email'] },
];
const TIPOS = { repository: 'Repositório', frontend: 'Frontend', backend: 'Backend', api: 'API', worker: 'Worker', database: 'Banco', cache: 'Cache', domain: 'Domínio', checkout: 'Checkout', email: 'E-mail' };
const AMBIENTES = { production: 'Produção', staging: 'Homologação', development: 'Desenvolvimento', internal: 'Interno' };

// O tipo que um projeto de provedor vira quando é confirmado. Mesma regra da API
// (vinculoDeDeploy) e das cópias da 034: o mesmo projeto tem o mesmo tipo em toda
// parte, senão a tela grava 'frontend' onde o banco já disse 'backend'.
const TIPO_PADRAO = { vercel: 'frontend', easypanel: 'backend', github: 'repository' };

const dataHora = valor => valor ? new Date(valor).toLocaleString('pt-BR') : '';

export function setupConnections({ api, openTenant, openProduct, onChanged = () => {} }) {
 const $ = id => document.getElementById(id);
 const node = (tag, texto, classe) => { const el = document.createElement(tag); if (texto !== undefined) el.textContent = texto; if (classe) el.className = classe; return el; };
 const option = (valor, rotulo) => { const el = node('option', rotulo); el.value = valor; return el; };

 // Tudo o que a tela leu do servidor. `donos` vem de app.js (já está na memória do
 // painel): repetir /api/overview aqui só produziria duas verdades.
 let conexoes = [], inventario = null, donos = { products: [], engagements: [], tenants: [] }, geracao = 0;

 const produto = id => donos.products.find(item => item.id === id) || null;
 const contratacao = id => donos.engagements.find(item => item.id === id) || null;
 const empresa = id => donos.tenants.find(item => item.id === id) || null;

 // Itens do inventário, achatados numa forma só. O EasyPanel entra POR SERVIÇO,
 // com id projeto/serviço — é o formato que delivery-options.mjs já devolve e o
 // que está gravado no banco. Listar por projeto era o motivo de um serviço
 // classificado aparecer como "Classificação pendente".
 const itensDoInventario = () => INVENTARIADOS.flatMap(provider => {
  const bloco = inventario?.[provider];
  return bloco?.status === 'ok' ? bloco.items.map(item => ({ provider, id: item.id, name: item.name })) : [];
 });

 const lido = provider => inventario?.[provider]?.status === 'ok';

 /** Uma conexão ativa cujo provedor foi lido e não mostra mais o recurso. */
 const sumiuDoProvedor = binding => binding.active && lido(binding.provider)
  && !inventario[binding.provider].items.some(item => casaConexao(binding, { provider: binding.provider, id: item.id, name: item.name }));

 // ---------------------------------------------------------------------------
 // Dono: rótulo, situação e o caminho até a ficha
 // ---------------------------------------------------------------------------
 // Quem é o dono é a pergunta inteira desta tela, então ela é respondida por uma
 // função só, e ela admite quando não sabe responder em vez de dizer "—".
 const donoDe = binding => {
  if (binding.product_id) {
   const item = produto(binding.product_id);
   return { tipo: 'item', rotulo: item?.name || binding.product_id, detalhe: 'Item do portfólio', abrir: () => openProduct(binding.product_id) };
  }
  if (binding.engagement_id) {
   const acordo = contratacao(binding.engagement_id);
   const cliente = acordo ? empresa(acordo.tenant_id) : null;
   return {
    tipo: 'contratacao',
    rotulo: acordo?.label || 'Contratação',
    detalhe: cliente ? `Contratação · ${cliente.name}` : 'Contratação',
    // A ficha da empresa é onde a contratação vive: sem este clique, saber de quem
    // é o recurso não leva a lugar nenhum.
    abrir: acordo?.tenant_id ? () => openTenant(acordo.tenant_id) : null,
   };
  }
  return { tipo: 'sem', rotulo: 'Sem dono', detalhe: 'Desligada sem dono definido', abrir: null };
 };

 /** Seletor de dono: itens e contratações no mesmo <select>, separados por grupo. */
 const seletorDeDono = (selecionado = '') => {
  const select = document.createElement('select');
  select.append(option('', 'Escolher dono…'));
  const grupo = (rotulo, opcoes) => { if (!opcoes.length) return; const g = document.createElement('optgroup'); g.label = rotulo; g.append(...opcoes); select.append(g); };
  grupo('Itens do portfólio', donos.products.map(item => option(`product:${item.id}`, item.name)));
  grupo('Contratações', donos.engagements.map(item => {
   const cliente = empresa(item.tenant_id);
   return option(`engagement:${item.id}`, cliente ? `${item.label} · ${cliente.name}` : item.label);
  }));
  select.value = selecionado;
  return select;
 };

 // 'product:skiller' → { product_id:'skiller', engagement_id:null }. O XOR de dono
 // é conferido pelo servidor (CHECK um_dono da 034); aqui ele é só a forma.
 const donoEscolhido = valor => {
  const [tipo, id] = String(valor || '').split(/:(.+)/);
  if (tipo === 'product' && id) return { product_id: id, engagement_id: null };
  if (tipo === 'engagement' && id) return { product_id: null, engagement_id: id };
  return null;
 };

 // ---------------------------------------------------------------------------
 // Diálogos
 // ---------------------------------------------------------------------------
 const reasonDialog = $('connection-reason-dialog'), reasonForm = $('connection-reason-form');
 let aoConfirmarMotivo = null;

 /** Pede motivo (e dono, quando é reatribuição) e devolve o controle a quem chamou. */
 function pedirMotivo({ titulo, assunto, pedeDono = false, confirmar }) {
  $('connection-reason-title').textContent = titulo;
  $('connection-reason-subject').textContent = assunto;
  $('connection-reason-owner-field').hidden = !pedeDono;
  // O seletor é refeito a cada abertura, mesmo escondido: guardado de uma vez para
  // a outra, ele traria a lista de donos de antes e a escolha de antes junto.
  const novo = seletorDeDono();
  novo.id = 'connection-reason-owner'; novo.name = 'owner'; novo.required = pedeDono;
  $('connection-reason-owner').replaceWith(novo);
  reasonForm.reset();
  reasonForm.querySelector('.dialog-error').textContent = '';
  reasonForm.querySelector('button.primary').disabled = false;
  aoConfirmarMotivo = confirmar;
  reasonDialog.showModal();
 }

 reasonForm.onsubmit = async event => {
  event.preventDefault();
  const erro = reasonForm.querySelector('.dialog-error'), salvar = reasonForm.querySelector('button.primary');
  const dados = Object.fromEntries(new FormData(reasonForm));
  erro.textContent = ''; salvar.disabled = true;
  try {
   await aoConfirmarMotivo(dados);
   reasonDialog.close();
   await recarregar();
  } catch (reason) { erro.textContent = reason.message; salvar.disabled = false; }
 };

 // Os verbos da trilha em português. Vêm do CHECK de product_resource_audit (034):
 // uma ação sem tradução aqui apareceria como o nome da coluna, então a lista
 // cobre todas as oito, inclusive as duas que só a migração grava.
 const ACOES = { created: 'Vinculada', updated: 'Editada', reactivated: 'Religada', reassigned: 'Reatribuída', deactivated: 'Desvinculada', detached: 'Desatrelada em lote', deleted: 'Excluída', migrated: 'Copiada pela migração' };
 const nomeDeDono = (productId, deContratacao) => productId ? (produto(productId)?.name || productId) : deContratacao ? 'uma contratação' : 'sem dono';

 async function abrirHistorico(binding) {
  const lista = $('connection-history-list');
  $('connection-history-subject').textContent = `${binding.display_name} · ${PROVEDORES[binding.provider] || binding.provider}`;
  lista.replaceChildren(node('p', 'Consultando a trilha…', 'empty-list'));
  $('connection-history-dialog').showModal();
  try {
   const { history } = await api(`/api/product-resource-bindings/${encodeURIComponent(binding.id)}/history`);
   if (!history.length) return lista.replaceChildren(node('p', 'Nenhum registro na trilha desta conexão.', 'empty-list'));
   lista.replaceChildren(...history.map(linha => {
    const item = node('article', undefined, 'record connection-history-row');
    const copy = node('div');
    copy.append(node('strong', ACOES[linha.action] || linha.action), node('span', `${dataHora(linha.created_at)} · ${linha.actor}`, 'detail'));
    // Reatribuição é a única ação em que o dono de antes importa, e ele só existe
    // em before_value: a linha em si já foi atualizada quando isto é lido.
    if (linha.action === 'reassigned') copy.append(node('span', `${nomeDeDono(linha.antes_product_id, linha.antes_de_contratacao)} → ${nomeDeDono(linha.depois_product_id, Boolean(linha.depois_engagement_id))}`, 'detail'));
    if (linha.reason) copy.append(node('span', linha.reason, 'detail'));
    item.append(copy);
    return item;
   }));
  } catch (error) { lista.replaceChildren(node('p', error.message, 'notice-inline')); }
 }

 // ---------------------------------------------------------------------------
 // Ações
 // ---------------------------------------------------------------------------
 const vincular = (corpo) => api('/api/product-resource-bindings', 'PUT', corpo);

 const desvincular = binding => pedirMotivo({
  titulo: 'Desvincular conexão',
  assunto: `${binding.display_name} · ${PROVEDORES[binding.provider] || binding.provider} · hoje de ${donoDe(binding).rotulo}`,
  confirmar: ({ reason }) => api(`/api/product-resource-bindings/${encodeURIComponent(binding.id)}`, 'DELETE', { reason, revision: binding.revision }),
 });

 const reatribuir = binding => pedirMotivo({
  titulo: binding.active ? 'Reatribuir conexão' : 'Religar conexão',
  assunto: binding.active
   ? `${binding.display_name} sai de ${donoDe(binding).rotulo} e passa para quem você escolher.`
   : `${binding.display_name} está desligada. Escolher um dono religa a mesma linha, com o histórico inteiro.`,
  pedeDono: true,
  confirmar: ({ owner, reason }) => {
   const dono = donoEscolhido(owner);
   if (!dono) throw new Error('Escolha o item ou a contratação que passa a ser dono desta conexão.');
   return vincular({
    id: binding.id, revision: binding.revision, ...dono,
    resource_type: binding.resource_type, provider: binding.provider,
    external_id: binding.external_id, external_id_kind: binding.external_id_kind,
    display_name: binding.display_name, environment: binding.environment, url: binding.url,
    // Uma conexão desligada não tem dono a defender: religar é vincular, e pedir
    // reassign nela seria exigir permissão de dono para uma decisão que não tira
    // recurso de ninguém.
    ...(binding.active ? { reassign: true } : {}), reason,
   });
  },
 });

 // ---------------------------------------------------------------------------
 // Desenho
 // ---------------------------------------------------------------------------
 const chip = (texto, tom) => node('span', texto, `status ${tom}`);

 function linhaDeConexao(binding) {
  const row = node('article', undefined, 'record connection-row'), copy = node('div', undefined, 'connection-row-copy');
  const cabeca = node('div', undefined, 'connection-row-head');
  cabeca.append(providerLogo(binding.provider), node('strong', binding.display_name));
  copy.append(cabeca);
  const fatos = [TIPOS[binding.resource_type] || binding.resource_type, PROVEDORES[binding.provider] || binding.provider,
   AMBIENTES[binding.environment] || (binding.environment ? binding.environment : 'Sem ambiente')];
  copy.append(node('span', fatos.join(' · '), 'detail'));
  // O identificador do provedor é o que faz duas leituras falarem do mesmo recurso.
  const id = node('code', binding.external_id, 'connection-external-id');
  if (binding.external_id_kind === 'name') id.title = 'Vínculo por nome: o provedor não deu identificador próprio.';
  copy.append(id);

  const dono = donoDe(binding), donoBloco = node('div', undefined, 'connection-owner');
  if (dono.abrir) { const link = node('button', dono.rotulo, 'table-action'); link.type = 'button'; link.onclick = dono.abrir; donoBloco.append(link); }
  else donoBloco.append(node('strong', dono.rotulo));
  donoBloco.append(node('span', dono.detalhe, 'detail'));
  copy.append(donoBloco);

  const marcas = node('div', undefined, 'connection-flags');
  if (!binding.active) marcas.append(chip('Desligada', 'building'));
  else if (sumiuDoProvedor(binding)) marcas.append(chip('Não encontrada no provedor', 'danger'));
  else if (lido(binding.provider)) marcas.append(chip('Confirmada no provedor', 'active'));
  else marcas.append(chip('Confirmada', 'active'));
  if (!binding.active && binding.unbind_reason) marcas.append(node('span', `${dataHora(binding.deactivated_at)} · ${binding.unbind_reason}`, 'detail'));
  copy.append(marcas);

  const acoes = node('div', undefined, 'connection-actions');
  const botao = (rotulo, acao, classe = 'table-action') => { const b = node('button', rotulo, classe); b.type = 'button'; b.onclick = acao; return b; };
  if (binding.active) acoes.append(botao('Reatribuir', () => reatribuir(binding)), botao('Desvincular', () => desvincular(binding), 'table-action danger-link'));
  else acoes.append(botao('Religar com um dono', () => reatribuir(binding)));
  acoes.append(botao('Histórico', () => abrirHistorico(binding)));
  row.append(copy, acoes);
  return row;
 }

 function linhaSemDono(recurso) {
  const row = node('article', undefined, 'record connection-row'), copy = node('div', undefined, 'connection-row-copy');
  const cabeca = node('div', undefined, 'connection-row-head');
  cabeca.append(providerLogo(recurso.provider), node('strong', recurso.name));
  copy.append(cabeca, node('span', `${PROVEDORES[recurso.provider]} · ${TIPOS[TIPO_PADRAO[recurso.provider]]} quando confirmado`, 'detail'), node('code', recurso.id, 'connection-external-id'));
  const acoes = node('div', undefined, 'connection-actions'), select = seletorDeDono();
  select.className = 'connection-owner-select';
  const confirmar = node('button', 'Vincular', 'table-action'); confirmar.type = 'button';
  confirmar.onclick = async () => {
   const dono = donoEscolhido(select.value);
   if (!dono) return;
   confirmar.disabled = select.disabled = true;
   try {
    await vincular({
     ...dono, resource_type: TIPO_PADRAO[recurso.provider], provider: recurso.provider,
     external_id: recurso.id, display_name: recurso.name,
     // Repositório não tem ambiente; projeto de deploy que aparece aqui é o que
     // está no ar. Se for outro, a ficha do item edita — sem adivinhar em silêncio.
     environment: recurso.provider === 'github' ? null : 'production',
    });
    await recarregar();
   } catch (error) { confirmar.disabled = select.disabled = false; $('connections-message').textContent = error.message; }
  };
  acoes.append(select, confirmar);
  row.append(copy, acoes);
  return row;
 }

 function desenhar() {
  const ativas = conexoes.filter(b => b.active), desligadas = conexoes.filter(b => !b.active);
  const semDono = itensDoInventario().filter(recurso => !conexoes.some(b => b.active && casaConexao(b, recurso)));
  const sumidas = ativas.filter(sumiuDoProvedor);

  $('connections-summary').replaceChildren(...[
   ['Conexões ativas', ativas.length],
   ['De item do portfólio', ativas.filter(b => b.product_id).length],
   ['De contratação', ativas.filter(b => b.engagement_id).length],
   ['Sem classificar', semDono.length],
   ['Não encontradas no provedor', sumidas.length],
   ['Desligadas', desligadas.length],
  ].map(([rotulo, valor]) => { const card = node('article'); card.append(node('span', rotulo), node('strong', String(valor))); return card; }));

  // O estado de cada provedor sai explícito: "sem classificar: 0" com o GitHub
  // fora do ar não é a mesma frase que "sem classificar: 0" com ele respondendo.
  $('connections-providers').replaceChildren(...INVENTARIADOS.map(provider => {
   const bloco = inventario?.[provider], estado = bloco?.status;
   const texto = estado === 'ok' ? `${bloco.items.length} no inventário${bloco.truncated ? ' · lista parcial' : ''}`
    : estado === 'not_configured' ? 'não conectado no servidor' : estado === 'error' ? 'não respondeu agora' : 'consultando';
   const item = node('span', undefined, 'delivery-provider' + (estado === 'ok' ? ' connected' : ''));
   item.append(providerLogo(provider), node('span', `${PROVEDORES[provider]}: ${texto}`));
   return item;
  }));

  const raiz = $('connections-owned');
  if (!ativas.length) raiz.replaceChildren(node('p', 'Nenhuma conexão confirmada ainda.', 'empty-list'));
  else raiz.replaceChildren(...GRUPOS.map(grupo => {
   const linhas = ativas.filter(b => grupo.tipos.includes(b.resource_type));
   if (!linhas.length) return null;
   const secao = node('section', undefined, 'connection-group');
   const cabeca = node('div', undefined, 'section-toolbar'), titulo = node('h2', undefined, 'section-title');
   titulo.append(createIcon(grupo.icone), document.createTextNode(` ${grupo.titulo}`));
   cabeca.append(titulo, chip(`${linhas.length} ${linhas.length === 1 ? 'conexão' : 'conexões'}`, 'active'));
   const lista = node('div', undefined, 'list-panel');
   lista.append(...linhas.map(linhaDeConexao));
   secao.append(cabeca, lista);
   return secao;
  }).filter(Boolean));

  $('connections-unclassified').replaceChildren(...(semDono.length
   ? semDono.map(linhaSemDono)
   : [node('p', INVENTARIADOS.some(lido) ? 'Tudo o que os provedores mostram já tem dono.' : 'Nenhum provedor respondeu: não dá para dizer o que falta classificar.', 'empty-list')]));

  $('connections-inactive').replaceChildren(...(desligadas.length
   ? desligadas.map(linhaDeConexao)
   : [node('p', 'Nenhuma conexão desligada.', 'empty-list')]));
 }

 async function recarregar() {
  const meu = ++geracao;
  const [lista, opcoes] = await Promise.all([
   api('/api/product-resource-bindings?state=all'),
   // O inventário é de provedor externo: se ele cair, a tela continua mostrando o
   // que está gravado, e diz que não conferiu — em vez de sumir com as conexões.
   api('/api/delivery/options').catch(() => null),
  ]);
  if (meu !== geracao) return;
  conexoes = lista.bindings || [];
  inventario = opcoes;
  desenhar();
  onChanged(conexoes.filter(b => b.active));
 }

 $('connections-refresh').onclick = () => { $('connections-message').textContent = ''; recarregar().catch(error => { $('connections-message').textContent = error.message; }); };

 return {
  async load(owners) {
   donos = { products: owners?.products || [], engagements: owners?.engagements || [], tenants: owners?.tenants || [] };
   $('connections-message').textContent = '';
   try { await recarregar(); }
   catch (error) { $('connections-message').textContent = error.message; }
  },
  clear() {
   geracao++; conexoes = []; inventario = null; donos = { products: [], engagements: [], tenants: [] };
   for (const id of ['connections-summary', 'connections-providers', 'connections-owned', 'connections-unclassified', 'connections-inactive', 'connection-history-list']) $(id).replaceChildren();
   $('connections-message').textContent = '';
   reasonDialog.close(); $('connection-history-dialog').close();
  },
 };
}
