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
import { achatar, agruparSugestoes, nomeDoDono } from './owner-suggestions.js';
import { PROVEDORES, donoEscolhido, seletorDeDono as seletorBase, vincularRecursos, valorDoDono } from './owner-link.js';

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

const dataHora = valor => valor ? new Date(valor).toLocaleString('pt-BR') : '';

export function setupConnections({ api, openTenant, openProduct, onChanged = () => {}, projectFor = () => null, openProject = () => {}, activateProject = async () => {}, goTo = () => {} }) {
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
 const itensDoInventario = () => achatar(inventario);


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

 /** Seletor de dono, com os donos que a tela conhece agora (a implementação é de owner-link.js). */
 const seletorDeDono = (selecionado = '') => seletorBase(donos, selecionado);

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

 function linhaDeConexao(binding, { mostrarDono = true } = {}) {
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

  if (mostrarDono) {
   const dono = donoDe(binding), donoBloco = node('div', undefined, 'connection-owner');
   if (dono.abrir) { const link = node('button', dono.rotulo, 'table-action'); link.type = 'button'; link.onclick = dono.abrir; donoBloco.append(link); }
   else donoBloco.append(node('strong', dono.rotulo));
   donoBloco.append(node('span', dono.detalhe, 'detail'));
   copy.append(donoBloco);
  }

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

 const semAcento = texto => String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
 const contextoDeSugestao = () => ({ itens: itensDoInventario(), conexoes: conexoes.filter(b => b.active), donos, casa: casaConexao });

 // Quem é o dono de uma conexão, como objeto para o cadastro técnico e como chave.
 const donoObjeto = binding => ({ product_id: binding.product_id || null, engagement_id: binding.engagement_id || null });
 const chaveDaConexao = binding => binding.product_id ? `product:${binding.product_id}` : binding.engagement_id ? `engagement:${binding.engagement_id}` : 'sem';

 /** O que o dono é, sem repetir o que o nome dele já diz ("Kalidash sob demanda" não vira "… · sob demanda"). */
 const naturezaDoDono = binding => {
  if (binding.product_id) {
   const tipo = produto(binding.product_id)?.kind_label;
   return tipo ? `Item do portfólio · ${tipo}` : 'Item do portfólio';
  }
  const acordo = contratacao(binding.engagement_id), rotulo = acordo?.label || '';
  const extras = nomeDoDono({ label: rotulo, cliente: empresa(acordo?.tenant_id)?.name, modelo: acordo?.service_model }).slice(rotulo.length).replace(/^ · /, '');
  return extras ? `Contratação · ${extras}` : 'Contratação';
 };

 const logosDe = bindings => {
  const grupo = node('span', undefined, 'owner-logos');
  for (const provider of [...new Set(bindings.map(b => b.provider))].slice(0, 4)) grupo.append(providerLogo(provider));
  return grupo;
 };

  // O cadastro técnico do dono, compacto: quanto do checklist está pronto, o que
 // falta e os dois botões que existiam na tela de Projetos técnicos.
 function rodapeDoCadastro(dono) {
  const rodape = node('div', undefined, 'owner-project');
  const projeto = projectFor(dono);
  if (!projeto) {
   rodape.append(node('span', 'Sem cadastro técnico.', 'detail'));
   const novo = node('button', 'Cadastrar projeto', 'table-action'); novo.type = 'button'; novo.onclick = () => openProject(null);
   rodape.append(novo);
   return rodape;
  }
  const checklist = projeto.readiness;
  rodape.append(chip(checklist ? (checklist.ready ? 'Checklist completo' : `Checklist ${checklist.completed}/${checklist.total}`) : 'Cadastro técnico', checklist?.ready ? 'active' : 'building'));
  const faltando = (checklist?.items || []).filter(item => !item.ready).map(item => item.label);
  if (faltando.length) rodape.append(node('span', `Falta: ${faltando.join('; ')}.`, 'detail'));
  const acoes = node('div', undefined, 'connection-actions');
  const configurar = node('button', 'Configurações', 'table-action'); configurar.type = 'button'; configurar.onclick = () => openProject(projeto);
  acoes.append(configurar);
  if (projeto.belongs_to?.kind === 'item' && projeto.product_lifecycle_status === 'draft' && checklist?.ready) {
   const ativar = node('button', `Ativar ${projeto.belongs_to.item_kind_label || 'item'}`, 'table-action');
   ativar.type = 'button';
   ativar.onclick = async () => {
    ativar.disabled = true;
    try { await activateProject(projeto); await recarregar(); }
    catch (error) { ativar.disabled = false; $('connections-message').textContent = error.message; }
   };
   acoes.append(ativar);
  }
  rodape.append(acoes);
  return rodape;
 }

 /** Um cartão por dono: o que está ligado a ele, e o cadastro técnico logo abaixo. */
 function cartaoDoDono({ bindings }, aberto) {
  const primeira = bindings[0], info = donoDe(primeira), dono = donoObjeto(primeira);
  const cartao = node('details', undefined, 'owner-card');
  cartao.open = aberto;
  const resumo = node('summary', undefined, 'owner-summary'), nome = node('span', undefined, 'owner-name');
  nome.append(node('strong', info.rotulo), node('small', naturezaDoDono(primeira)));
  const projeto = projectFor(dono), checklist = projeto?.readiness;
  resumo.append(logosDe(bindings), nome, node('span', `${bindings.length} ${bindings.length === 1 ? 'recurso' : 'recursos'}`, 'owner-count'),
   checklist ? chip(checklist.ready ? 'Checklist completo' : `Checklist ${checklist.completed}/${checklist.total}`, checklist.ready ? 'active' : 'building') : node('span'));
  const corpo = node('div', undefined, 'owner-body'), lista = node('div', undefined, 'list-panel');
  lista.append(...bindings.map(b => linhaDeConexao(b, { mostrarDono: false })));
  corpo.append(lista, rodapeDoCadastro(dono));
  if (info.abrir) { const ficha = node('button', info.tipo === 'item' ? 'Abrir o item' : 'Abrir a ficha da empresa', 'table-action'); ficha.type = 'button'; ficha.onclick = info.abrir; corpo.append(ficha); }
  cartao.append(resumo, corpo);
  return cartao;
 }

 /**
  * O grupo de sugestão: um dono provável e os recursos que iriam com ele. A ação
  * principal é aceitar; escolher outro dono fica recolhido, porque repetir o dono
  * sugerido num seletor logo abaixo do título só confundia. O motivo por extenso é o
  * tooltip de cada linha; à vista fica uma etiqueta curta.
  */
 function cartaoDeSugestao(grupo) {
  const cartao = node('article', undefined, 'suggestion-card');
  const cabeca = node('div', undefined, 'suggestion-head');
  cabeca.append(node('strong', grupo.rotulo), node('span', `${grupo.recursos.length} ${grupo.recursos.length === 1 ? 'recurso' : 'recursos'}`, 'owner-count'));
  const lista = node('ul', undefined, 'suggestion-list');
  for (const { recurso, motivo, etiqueta } of grupo.recursos) {
   const item = node('li'); item.title = motivo;
   item.append(providerLogo(recurso.provider), node('strong', recurso.name), node('span', etiqueta, 'suggestion-tag'));
   lista.append(item);
  }
  const erro = node('p', undefined, 'notice-inline link-error');
  const lote = grupo.recursos.map(item => item.recurso);
  const gravar = async (dono, botoes) => {
   if (!dono) { erro.textContent = 'Escolha o dono antes de vincular.'; return; }
   botoes.forEach(b => { b.disabled = true; }); erro.textContent = '';
   try { await vincularRecursos(api, lote, dono); await recarregar(); }
   catch (falha) { botoes.forEach(b => { b.disabled = false; }); erro.textContent = falha.message; }
  };
  const aceitar = node('button', grupo.recursos.length === 1 ? 'Vincular' : `Vincular os ${grupo.recursos.length}`, 'primary'); aceitar.type = 'button';
  const outro = node('details', undefined, 'other-owner');
  const select = seletorDeDono(''); select.className = 'connection-owner-select';
  const escolher = node('button', 'Vincular ao escolhido', 'secondary'); escolher.type = 'button';
  outro.append(node('summary', 'Outro dono…'), select, escolher);
  const botoes = [aceitar, escolher];
  aceitar.onclick = () => gravar(grupo.dono, botoes);
  escolher.onclick = () => gravar(donoEscolhido(select.value), botoes);
  const acoes = node('div', undefined, 'suggestion-actions'); acoes.append(aceitar, outro);
  cartao.append(cabeca, lista, acoes, erro);
  return cartao;
 }

 function cartaoAmbiguo({ recurso, candidatos }) {
  const cartao = node('article', undefined, 'suggestion-card ambiguous');
  const cabeca = node('div', undefined, 'suggestion-head');
  cabeca.append(providerLogo(recurso.provider), node('strong', recurso.name));
  cartao.append(cabeca, node('span', `O nome combina com mais de um dono: ${candidatos.join('; ')}. Escolha um.`, 'detail'));
  const select = seletorDeDono(''); select.className = 'connection-owner-select';
  const erro = node('p', undefined, 'notice-inline link-error');
  const vincular = node('button', 'Vincular', 'primary'); vincular.type = 'button';
  vincular.onclick = async () => {
   const dono = donoEscolhido(select.value);
   if (!dono) { erro.textContent = 'Escolha o dono antes de vincular.'; return; }
   vincular.disabled = select.disabled = true; erro.textContent = '';
   try { await vincularRecursos(api, [recurso], dono); await recarregar(); }
   catch (falha) { vincular.disabled = select.disabled = false; erro.textContent = falha.message; }
  };
  const acoes = node('div', undefined, 'connection-actions'); acoes.append(select, vincular);
  cartao.append(acoes, erro);
  return cartao;
 }

 function desenhar() {
  const termo = semAcento($('connections-search').value).trim();
  const ativas = conexoes.filter(b => b.active), desligadas = conexoes.filter(b => !b.active);
  const semDono = itensDoInventario().filter(recurso => !ativas.some(b => casaConexao(b, recurso)));
  const sumidas = ativas.filter(sumiuDoProvedor);

  // O estado de cada provedor sai explícito: "sem dono: 0" com o GitHub fora do ar
  // não é a mesma frase que "sem dono: 0" com ele respondendo.
  $('connections-providers').replaceChildren(...INVENTARIADOS.map(provider => {
   const bloco = inventario?.[provider], estado = bloco?.status;
   const texto = estado === 'ok' ? `${bloco.items.length} no inventário${bloco.truncated ? ' · lista parcial' : ''}`
    : estado === 'not_configured' ? 'não conectado no servidor' : estado === 'error' ? 'não respondeu agora' : 'consultando';
   const item = node('span', undefined, 'delivery-provider' + (estado === 'ok' ? ' connected' : ''));
   item.append(providerLogo(provider), node('span', `${PROVEDORES[provider]}: ${texto}`));
   return item;
  }));

  // 1. Sugestões — só o que tem uma pista, agrupado por dono provável.
  const { grupos, ambiguos, restantes } = agruparSugestoes(semDono, contextoDeSugestao());
  const casaComBusca = (...textos) => !termo || textos.some(texto => semAcento(texto).includes(termo));
  const gruposVisiveis = grupos.filter(g => casaComBusca(g.rotulo, ...g.recursos.map(r => r.recurso.name)));
  const ambiguosVisiveis = ambiguos.filter(a => casaComBusca(a.recurso.name, ...a.candidatos));
  const blocoSugestoes = $('connections-suggestions');
  if (!gruposVisiveis.length && !ambiguosVisiveis.length) blocoSugestoes.replaceChildren();
  else {
   const titulo = node('h2', `Sugestões (${gruposVisiveis.length + ambiguosVisiveis.length})`, 'section-title');
   blocoSugestoes.replaceChildren(titulo,
    node('p', 'Recursos sem dono que provavelmente pertencem a alguém. Nada é vinculado sem o seu clique.', 'catalog-caption'),
    ...gruposVisiveis.map(cartaoDeSugestao), ...ambiguosVisiveis.map(cartaoAmbiguo));
  }

  // 2. Conectado — um cartão por dono, só donos que têm alguma conexão.
  const porDono = new Map();
  for (const b of ativas) { const k = chaveDaConexao(b); if (!porDono.has(k)) porDono.set(k, []); porDono.get(k).push(b); }
  const donosComConexao = [...porDono.entries()].map(([chave, bindings]) => ({ chave, bindings, rotulo: donoDe(bindings[0]).rotulo }))
   .filter(item => casaComBusca(item.rotulo, ...item.bindings.map(b => b.display_name)))
   .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  const raiz = $('connections-owned');
  if (!ativas.length) raiz.replaceChildren(node('p', 'Nenhum recurso está ligado a um cliente, contratação ou item do portfólio ainda.', 'empty-list'));
  else if (!donosComConexao.length) raiz.replaceChildren(node('p', 'Nada encontrado para essa busca.', 'empty-list'));
  else raiz.replaceChildren(...donosComConexao.map(item => cartaoDoDono(item, Boolean(termo))));
  if (sumidas.length) raiz.prepend(node('p', `${sumidas.length} ${sumidas.length === 1 ? 'conexão não aparece' : 'conexões não aparecem'} mais no provedor: ${sumidas.map(b => b.display_name).join(', ')}.`, 'notice-inline'));

  // 3. Sem dono e sem pista — só a contagem e o caminho até a aba do provedor.
  const porProvedor = INVENTARIADOS.map(provider => [provider, restantes.filter(r => r.provider === provider).length]).filter(([, n]) => n);
  const orfaos = $('connections-orphans');
  if (!porProvedor.length) orfaos.replaceChildren(node('p', INVENTARIADOS.some(lido) ? 'Nenhum recurso ficou sem dono e sem pista.' : 'Nenhum provedor respondeu: não dá para dizer o que falta ligar.', 'empty-list'));
  else {
   const linha = node('div', undefined, 'orphan-line');
   linha.append(node('span', `${restantes.length} ${restantes.length === 1 ? 'recurso sem dono e sem pista' : 'recursos sem dono e sem pista'}. Ligue-os na aba do provedor:`));
   for (const [provider, n] of porProvedor) {
    const ir = node('button', `${PROVEDORES[provider]} (${n})`, 'table-action'); ir.type = 'button'; ir.onclick = () => goTo(provider); linha.append(ir);
   }
   orfaos.replaceChildren(linha);
  }

  // 4. Desligadas — recolhidas: são histórico, não trabalho.
  const visiveisDesligadas = desligadas.filter(b => casaComBusca(b.display_name));
  $('connections-inactive-count').textContent = String(visiveisDesligadas.length);
  $('connections-inactive').replaceChildren(...(visiveisDesligadas.length
   ? visiveisDesligadas.map(b => linhaDeConexao(b))
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

 $('connections-search').oninput = desenhar;
 $('connections-refresh').onclick = () => { $('connections-message').textContent = ''; recarregar().catch(error => { $('connections-message').textContent = error.message; }); };

 // redraw: o cadastro técnico mudou (delivery.load terminou) e a tela se redesenha com ele.
 return {
  async load(owners) {
   donos = { products: owners?.products || [], engagements: owners?.engagements || [], tenants: owners?.tenants || [] };
   $('connections-message').textContent = '';
   try { await recarregar(); }
   catch (error) { $('connections-message').textContent = error.message; }
  },
  redraw() { if (inventario || conexoes.length) desenhar(); },
  clear() {
   geracao++; conexoes = []; inventario = null; donos = { products: [], engagements: [], tenants: [] };
   for (const id of ['connections-providers', 'connections-suggestions', 'connections-owned', 'connections-orphans', 'connections-inactive', 'connection-history-list']) $(id).replaceChildren();
   $('connections-message').textContent = ''; $('connections-search').value = '';
   reasonDialog.close(); $('connection-history-dialog').close();
  },
 };
}
