// Projeto técnico — o cadastro de COMO uma coisa é construída e publicada.
//
// O QUE, essa coisa é, vem do Portfólio (products) ou de uma contratação
// (client_engagements). Esta fatia acaba com a terceira resposta: até aqui, criar
// um projeto técnico INVENTAVA um item do portfólio ("project-<uuid>", tipo
// 'product', sempre), e o painel passava a ter itens que ninguém cadastrou, todos
// do mesmo tipo, com nome copiado do projeto. Agora o projeto NASCE COM DONO:
//
//  · UM DONO, E SÓ UM. Item do portfólio que JÁ EXISTE, ou contratação. Nenhum
//    INSERT INTO products mora mais neste arquivo — item novo nasce pelo CRUD do
//    portfólio, onde alguém escolhe o tipo dele.
//  · O DONO NÃO TROCA POR AQUI. Trocar o dono de um projeto é mover conexões,
//    contratos e histórico junto; editar o cadastro técnico não é o lugar. A única
//    edição de dono que existe é ADOTAR um projeto que não tem nenhum.
//  · O CHECKLIST PERGUNTA SÓ O QUE O DONO PODE RESPONDER. Oferta, checkout e
//    contrato de acesso são perguntas de quem VENDE (as capacidades de
//    catalog.mjs). Perguntá-las a uma linha de serviço ou a um item interno deixava
//    o checklist impossível de completar e o botão de ativar inalcançável.
//  · EXCLUIR É ARQUIVAR, como no portfólio (ADR do módulo portfolio.mjs). Some da
//    lista de trabalho, continua existindo para a trilha e para as conexões que
//    apontam para o item. Nenhum DELETE restou neste módulo.
//
// ONDE MORA O DONO-CONTRATAÇÃO. A 034 não deixou coluna nenhuma em
// delivery_projects (conferido em produção, somente leitura: id, specification,
// revision, created_at, updated_at, product_id) e esta fatia não abre migração.
// Então o item do portfólio continua na coluna product_id — que é quem carrega a
// chave estrangeira e o índice único "um projeto por item" (015) — e a contratação
// mora na própria especificação, ao lado do resto do cadastro. O arquivamento
// segue o mesmo caminho, pelo mesmo motivo.
import { json, isUuid, isProductId, fail, input, onlyParams } from '../platform/http.mjs';
import { validateProject, projectIssues, STACKS, KINDS, ENVIRONMENTS } from '../platform/delivery-model.mjs';
import { createDeliveryOptions } from '../integrations/delivery-options.mjs';
import { createDeliverySettings } from '../integrations/delivery-settings.mjs';
import { createResourceReader } from '../integrations/resource.mjs';
import { capabilitiesOf, requireProductFor, KIND_LABELS } from './catalog.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { COLUNAS_ITEM, registrarItem } from './portfolio.mjs';

/**
 * O checklist de ativação, item a item.
 *
 * `capability` é a capacidade (catalog.mjs) que a pergunta pressupõe: quem não tem
 * a capacidade não recebe a pergunta. `capability: null` é o que TODO dono
 * responde — inclusive a contratação, que não tem tipo de portfólio e por isso não
 * tem capacidade nenhuma: uma entrega contratada tem código, serviços e deploy,
 * mas não tem oferta nem contrato de acesso próprio.
 *
 * E-MAILS FICA EM 'commercial' (produto, plataforma e linha de serviço). É a
 * leitura mais defensável de "quem fala com cliente precisa saber como fala", mas
 * é escolha, não dedução — está registrada como pergunta aberta ao dono.
 */
const CHECKLIST = [
 { key: 'identity', capability: null, label: 'Identidade e responsável',
   detail: 'Nome e responsável definidos no projeto.',
   ready: (row, spec) => Boolean(spec.name && spec.owner) },
 { key: 'source', capability: null, label: 'Código-fonte',
   detail: 'Repositório selecionado ou conexão de código confirmada.',
   ready: (row, spec) => Boolean(spec.repository_id || row.has_repository_connection) },
 { key: 'services', capability: null, label: 'Componentes técnicos',
   detail: 'Ao menos um componente técnico cadastrado.',
   ready: (row, spec) => (spec.components || []).length > 0 },
 { key: 'deploy', capability: null, label: 'Deploy de produção',
   detail: 'Frontend ou backend confirmado em produção.',
   ready: row => Boolean(row.has_deploy_connection) },
 { key: 'emails', capability: 'commercial', label: 'E-mails',
   detail: 'Ao menos um template de e-mail salvo.',
   ready: row => Boolean(row.has_email_template) },
 { key: 'checkout', capability: 'checkout', label: 'Oferta e checkout',
   detail: 'Oferta e template de checkout cadastrados.',
   ready: row => Boolean(row.has_offer && row.has_checkout_template) },
 { key: 'contracts', capability: 'access', label: 'Contrato de cliente',
   detail: 'Ao menos um contrato ativo preparado para o produto.',
   ready: row => Boolean(row.has_contract) },
];

// capabilitiesOf(undefined) devolve lista vazia, e é isso que faz a contratação
// cair no checklist curto sem nenhum "if" sobre tipo de dono espalhado por aqui.
const readiness = row => {
 const spec = row.specification || {};
 const capacidades = capabilitiesOf(row.portfolio_kind);
 const items = CHECKLIST
  .filter(item => !item.capability || capacidades.includes(item.capability))
  .map(item => ({ key: item.key, label: item.label, ready: Boolean(item.ready(row, spec)), detail: item.detail }));
 return { ready: items.every(item => item.ready), completed: items.filter(item => item.ready).length, total: items.length, items };
};

// A contratação dona do projeto, lida da especificação. NULLIF antes do cast
// porque jsonb sem a chave devolve NULL, mas jsonb com string vazia devolveria ''
// — e '' não é uuid.
const CONTRATACAO = "NULLIF(d.specification->>'engagement_id','')::uuid";
// De quem é a conexão, do ponto de vista do projeto: as mesmas duas colunas de
// dono do registro único (034), cada uma comparada com o lado certo do projeto.
const MESMO_DONO = `(r.product_id=d.product_id OR r.engagement_id=${CONTRATACAO})`;

// Conexão desligada não conta para o checklist: desde a 034 desvincular é
// active=false, e uma linha desligada guarda o último dono, não uma entrega viva.
// Sem o filtro, um item voltaria a "pronto para ativar" por causa de um vínculo
// que alguém desfez.
//
// As quatro perguntas comerciais continuam presas a d.product_id: oferta, checkout,
// template de e-mail e contrato são cadastros do item que vende. Num projeto de
// contratação elas dão falso — e não aparecem no checklist, porque a contratação
// não tem a capacidade que as pede.
const readinessColumns = `
 EXISTS(SELECT 1 FROM product_resource_bindings r WHERE ${MESMO_DONO} AND r.active AND r.resource_type='repository') AS has_repository_connection,
 EXISTS(SELECT 1 FROM product_resource_bindings r WHERE ${MESMO_DONO} AND r.active AND r.resource_type IN ('frontend','backend') AND r.environment='production') AS has_deploy_connection,
 EXISTS(SELECT 1 FROM email_templates e WHERE e.product_id=d.product_id) AS has_email_template,
 EXISTS(SELECT 1 FROM billing_offers b WHERE b.product_id=d.product_id) AS has_offer,
 EXISTS(SELECT 1 FROM checkout_templates c WHERE c.product_id=d.product_id) AS has_checkout_template,
 EXISTS(SELECT 1 FROM entitlements e WHERE e.product_id=d.product_id AND e.active) AS has_contract`;

// O cadastro do projeto e o cadastro do dono na mesma leitura: a tela mostra os
// dois juntos, e buscá-los em duas rodadas é como dois nomes diferentes para o
// mesmo item apareciam em telas vizinhas.
const PROJETO_COM_DONO = `SELECT d.id,d.product_id,d.specification,d.revision,d.updated_at,
  p.lifecycle_status,p.name AS product_name,p.portfolio_kind,
  e.label AS engagement_label,e.tenant_id,e.archived_at AS engagement_archived_at,${readinessColumns}
 FROM delivery_projects d
 LEFT JOIN products p ON p.id=d.product_id
 LEFT JOIN client_engagements e ON e.id=${CONTRATACAO}`;

const COLUNAS_PROJETO = 'id,product_id,specification,revision,updated_at';

/** Quem é o dono, do jeito que a tela precisa perguntar: tipo, nome e para onde o clique leva. */
const donoDe = row => {
 if (row.product_id) return {
  kind: 'item', id: row.product_id, name: row.product_name || row.product_id,
  item_kind: row.portfolio_kind || null, item_kind_label: KIND_LABELS[row.portfolio_kind] || 'item',
  lifecycle_status: row.lifecycle_status || null,
 };
 const engagementId = row.specification?.engagement_id || null;
 if (engagementId) return {
  kind: 'engagement', id: engagementId, name: row.engagement_label || 'Contratação',
  tenant_id: row.tenant_id || null, archived: Boolean(row.engagement_archived_at),
 };
 // Sem dono é estado possível só para cadastro anterior a esta regra. Dizer "sem
 // dono" é melhor do que escolher um: a tela oferece adotar.
 return { kind: 'none', id: null, name: null };
};

const present = row => {
 const spec = row.specification || {};
 const belongsTo = donoDe(row);
 const issues = projectIssues(spec);
 if (belongsTo.kind === 'none') issues.unshift('Projeto sem dono: escolha o item do portfólio ou a contratação.');
 if (belongsTo.kind === 'engagement' && belongsTo.archived) issues.push('A contratação dona deste projeto está arquivada.');
 return {
  ...spec,
  id: row.id,
  product_id: row.product_id || null,
  product_lifecycle_status: row.lifecycle_status || null,
  belongs_to: belongsTo,
  archived_at: spec.archived_at || null,
  revision: row.revision,
  updated_at: row.updated_at,
  issues,
  readiness: readiness(row),
  deployment_status: 'not_observed',
 };
};

const vazio = valor => valor === undefined || valor === null || valor === '';

/**
 * O dono pedido no corpo, se veio algum. Mesma forma do registro único de conexão
 * (um dono, e só um), conferida antes do banco para a recusa sair em português em
 * vez de virar violação de restrição.
 */
function donoPedido(body) {
 const productId = vazio(body.product_id) ? null : body.product_id;
 const engagementId = vazio(body.engagement_id) ? null : body.engagement_id;
 if (productId === null && engagementId === null) return null;
 if (productId !== null && engagementId !== null)
  throw fail(400, 'Um projeto técnico pertence a um dono só: informe o item do portfólio OU a contratação.');
 if (productId !== null && !isProductId(productId)) throw fail(400, 'Item do portfólio inválido.');
 if (engagementId !== null && !isUuid(engagementId)) throw fail(400, 'Contratação inválida.');
 return { product_id: productId, engagement_id: engagementId };
}

/** O dono existe, aceita projeto e ainda não tem um? */
async function exigirDono(client, dono) {
 if (dono.product_id) {
  // requireProductFor confere o TIPO. Todo tipo opera (catalog.mjs), então o que
  // ela recusa aqui é item inexistente ou arquivado — e recusa dizendo qual dos
  // dois. draft:true porque item novo nasce rascunho, e é justamente o rascunho
  // que o checklist existe para ativar.
  await requireProductFor(client, dono.product_id, 'operate',
   { draft: true, missing: fail(404, 'Item do portfólio não encontrado ou arquivado.') });
  // Um projeto por item é regra do banco desde a 015 (índice único parcial). A
  // pergunta aqui existe para a recusa dizer o que fazer, em vez de sair como
  // 23505 traduzido.
  if ((await client.query('SELECT 1 FROM delivery_projects WHERE product_id=$1 LIMIT 1', [dono.product_id])).rowCount)
   throw fail(409, 'Este item do portfólio já tem projeto técnico. Abra o projeto existente em vez de criar outro.');
  return;
 }
 const contratacao = (await client.query('SELECT id,archived_at FROM client_engagements WHERE id=$1', [dono.engagement_id])).rows[0];
 if (!contratacao) throw fail(404, 'Contratação não encontrada.');
 if (contratacao.archived_at) throw fail(409, 'Contratação arquivada. Restaure a contratação antes de criar o projeto.');
 // Um projeto por contratação, pelo mesmo motivo que o banco garante um por item
 // desde a 015: dois projetos no mesmo dono leem as MESMAS conexões (MESMO_DONO) e
 // mostram dois checklists idênticos, sem ninguém poder dizer qual vale.
 // A diferença é onde mora a garantia. Para o item ela é do banco; aqui é só do
 // código, porque a 034 não deixou coluna de contratação em delivery_projects
 // (conferido em produção, somente leitura) e índice parcial sobre a especificação
 // seria migração — que esta fatia não abre. Fica registrado como o que é.
 if ((await client.query(`SELECT 1 FROM delivery_projects d WHERE ${CONTRATACAO}=$1 LIMIT 1`, [dono.engagement_id])).rowCount)
  throw fail(409, 'Esta contratação já tem projeto técnico. Abra o projeto existente em vez de criar outro.');
}

/** O dono que o projeto já tem, na mesma forma do pedido. */
const donoAtual = row => row.product_id ? { product_id: row.product_id, engagement_id: null }
 : row.specification?.engagement_id ? { product_id: null, engagement_id: row.specification.engagement_id }
 : null;

export function deliveryRoutes(router, { options = createDeliveryOptions(), settings = createDeliverySettings(), resource = createResourceReader() } = {}) {
 router.get('/api/platforms/resource', async ({url,reply}) => {
  onlyParams(url.searchParams,['provider','target_id','environment']);
  if (['provider','target_id','environment'].some(key => url.searchParams.getAll(key).length !== 1)) throw fail(400,'Informe um único destino e ambiente.');
  const provider=url.searchParams.get('provider'), id=url.searchParams.get('target_id'), environment=url.searchParams.get('environment');
  if (!['vercel','easypanel'].includes(provider) || !id || id.length > 240 || !ENVIRONMENTS.includes(environment)) throw fail(400,'Destino ou ambiente inválido.');
  const inventory=(await options())[provider];
  if (inventory?.status !== 'ok') throw fail(503,'Inventário indisponível. Tente novamente.');
  const target=inventory.items.find(t => t.id === id);
  if (!target) throw fail(404,'Destino não encontrado no inventário acessível.');
  reply(200,await resource({provider,target,environment}));
 });
 router.get('/api/delivery/settings', async ({ url, reply }) => {
  onlyParams(url.searchParams, ['provider','target_id','environment']);
  if (['provider','target_id','environment'].some(key => url.searchParams.getAll(key).length !== 1)) throw fail(400,'Informe um único destino e ambiente.');
  const provider = url.searchParams.get('provider'), id = url.searchParams.get('target_id'), environment = url.searchParams.get('environment');
  if (!['vercel','easypanel'].includes(provider) || !ENVIRONMENTS.includes(environment) || !id || id.length > 240) throw fail(400,'Destino ou ambiente inválido.');
  const inventory = (await options())[provider];
  if (inventory.status !== 'ok') throw fail(503,'Inventário indisponível. Tente novamente mais tarde.');
  const target = inventory.items.find(t => t.id === id);
  if (!target) throw fail(404,'Destino não encontrado no inventário acessível.');
  reply(200, await settings({provider,target,environment}));
 });
 router.get('/api/delivery/options', async ({ url, reply }) => {
  onlyParams(url.searchParams, []);
  reply(200, { ...await options(), stacks: STACKS, kinds: KINDS, environments: ENVIRONMENTS });
 });
 // Arquivado fica fora por padrão, como em /api/portfolio: a tela de trabalho
 // mostra o que está em uso, e quem precisa restaurar pede include_archived=1.
 router.get('/api/delivery/projects', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['include_archived']);
  const incluirArquivados = url.searchParams.get('include_archived') === '1';
  const rows = (await pool.query(
   `${PROJETO_COM_DONO} WHERE $1 OR d.specification->>'archived_at' IS NULL
    ORDER BY d.updated_at DESC LIMIT 201`, [incluirArquivados])).rows;
  reply(200, { projects: rows.slice(0, 200).map(present), truncated: rows.length > 200 });
 });
 const save = async ({ req, params, pool, url, reply, operator }) => {
  onlyParams(url.searchParams, []);
  if (params.id && !isUuid(params.id)) throw fail(400, 'Projeto inválido.');
  // Cadastro técnico é escrita de operação, não leitura: um visitante não cria
  // projeto nem muda o de ninguém. Fora da transação porque uma recusa de
  // permissão não precisa abrir uma.
  await commercialPermission(pool, operator, true);
  const body = await json(req);
  const spec = validateProject(body);
  const pedido = donoPedido(body);
  if (params.id ? !Number.isInteger(body.revision) || body.revision < 1 : body.revision !== undefined)
   throw fail(400, 'Revisão inválida.');
  const available = await options();
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   const before = params.id ? (await client.query(`SELECT ${COLUNAS_PROJETO} FROM delivery_projects WHERE id=$1 FOR UPDATE`, [params.id])).rows[0] : null;
   if (params.id && !before) throw fail(404, 'Projeto não encontrado.');
   if (before && before.revision !== body.revision) throw fail(409, 'Este projeto mudou. Reabra o cadastro antes de editar.');
   if (before?.specification?.archived_at) throw fail(409, 'Projeto arquivado. Restaure antes de editar.');

   // QUEM TEM DONO, MANTÉM. Adotar é a única mudança de dono possível aqui, e só
   // vale para projeto que não tem nenhum — cadastro anterior a esta regra.
   // Trocar o dono de um projeto que já tem é mover conexões e histórico junto:
   // decisão, não edição de cadastro.
   const atual = before ? donoAtual(before) : null;
   let dono = atual;
   if (!atual) {
    if (!pedido) throw fail(400, before
     ? 'Este projeto está sem dono: escolha o item do portfólio ou a contratação antes de salvar.'
     : 'Um projeto técnico precisa de dono: escolha um item do portfólio já cadastrado ou uma contratação. Item novo nasce pelo Portfólio, onde o tipo é escolhido.');
    dono = pedido;
    await exigirDono(client, dono);
   } else if (pedido && (pedido.product_id !== atual.product_id || pedido.engagement_id !== atual.engagement_id)) {
    // A frase cita o botão pelo nome que ele tem na tela de Conexões. Mandar
    // "reatribuir" em minúscula faria o operador procurar uma ação que, escrita
    // assim, não existe em lugar nenhum — foi exatamente o que a mensagem antiga
    // de "remova ou edite o vínculo" fazia.
    throw fail(409, 'O dono de um projeto técnico não muda por aqui. Crie o projeto no dono certo e use Reatribuir, na tela de Conexões, para mover as conexões.');
   }

   // Durante uma indisponibilidade, preservar vínculos existentes é permitido;
   // acrescentar ou trocar um vínculo exige inventário acessível ao servidor.
   if (spec.repository_id) {
    const repo = available.github.items.find(r => r.id === spec.repository_id && !r.archived);
    if (!repo && before?.specification.repository_id !== spec.repository_id) throw fail(400, 'Escolha um repositório acessível e não arquivado na lista do GitHub.');
    spec.repository_name = repo?.name || before.specification.repository_name;
   } else spec.repository_name = null;
   for (const c of spec.components) for (const b of c.bindings) {
    const target = available[b.provider].items.find(t => t.id === b.target_id);
    const previous = before?.specification.components.find(p => p.id === c.id)?.bindings.find(p => p.provider === b.provider && p.target_id === b.target_id && p.environment === b.environment);
    if (!target && !previous) throw fail(400, 'Destino não encontrado. Atualize a lista da plataforma.');
    if (target && ((b.provider === 'vercel' && ['worker','database','cache'].includes(c.kind)) ||
     (b.provider === 'easypanel' && (c.kind === 'database' ? !['postgres','mysql','mariadb','mongo','mongodb'].includes(target.type) : c.kind === 'cache' ? target.type !== 'redis' : !['app','compose','box','wordpress'].includes(target.type)))))
     throw fail(400, 'O tipo do destino não corresponde à função do componente.');
    b.target_name = target?.name || previous.target_name;
   }
   // validateProject devolve só o que validou, então o que mora na especificação e
   // não é cadastro técnico precisa ser recolocado: sem esta linha o dono-contratação
   // se perderia em silêncio no primeiro salvar, e o projeto viraria órfão.
   if (dono.engagement_id) spec.engagement_id = dono.engagement_id;

   const row = before
    ? (await client.query(`UPDATE delivery_projects SET specification=$1,product_id=$3,revision=revision+1,updated_at=now()
        WHERE id=$2 RETURNING ${COLUNAS_PROJETO}`, [spec, params.id, dono.product_id])).rows[0]
    : (await client.query(`INSERT INTO delivery_projects(product_id,specification) VALUES($1,$2)
        RETURNING ${COLUNAS_PROJETO}`, [dono.product_id, spec])).rows[0];
   // O nome do item é do Portfólio. A rotina antiga renomeava o produto rascunho a
   // cada salvar, porque o produto era invenção deste módulo; agora ele tem dono
   // humano e sobrescrever o nome dele daqui seria apagar uma escolha.
   Object.assign(row, dono.product_id
    ? (await client.query('SELECT lifecycle_status,name AS product_name,portfolio_kind FROM products WHERE id=$1', [dono.product_id])).rows[0] || {}
    : (await client.query('SELECT label AS engagement_label,tenant_id,archived_at AS engagement_archived_at FROM client_engagements WHERE id=$1', [dono.engagement_id])).rows[0] || {});
   await client.query('INSERT INTO delivery_audit(project_id,revision,before_specification,after_specification) VALUES($1,$2,$3,$4)', [row.id,row.revision,before?.specification || null,spec]);
   await client.query('COMMIT');
   reply(before ? 200 : 201, { project: present(row) });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
 };
 router.post('/api/delivery/projects', save);
 router.put('/api/delivery/projects/:id', save);

 // EXCLUIR É ARQUIVAR, e por isso não existe mais DELETE aqui.
 //
 // Apagar o projeto apagava junto o produto rascunho — e o produto é citado por
 // conexão e por trilha, que desde a 034 ninguém apaga. A chave estrangeira
 // recusava, o 23503 saía como "Empresa ou produto não encontrado." e a rota
 // passou a responder 409 explicando que não dava. Arquivar tira da lista de
 // trabalho sem nada disso: o registro continua lá, a trilha continua legível, e o
 // item do portfólio segue sendo arquivado pelo Portfólio, que é onde ele nasce.
 for (const [acao, arquivar] of [['archive', true], ['restore', false]]) {
  router.post(`/api/delivery/projects/:id/${acao}`, async ({ client, params, body, operator }) => {
   await commercialPermission(client, operator, true);
   if (!isUuid(params.id)) throw fail(400, 'Projeto inválido.');
   input(body, ['revision']);
   if (!Number.isInteger(body.revision) || body.revision < 1) throw fail(400, 'Revisão inválida.');
   const antes = (await client.query(`SELECT ${COLUNAS_PROJETO} FROM delivery_projects WHERE id=$1 FOR UPDATE`, [params.id])).rows[0];
   if (!antes) throw fail(404, 'Projeto não encontrado.');
   if (antes.revision !== body.revision)
    throw fail(409, `Este projeto mudou. Reabra o cadastro antes de ${arquivar ? 'arquivar' : 'restaurar'}.`);
   if (arquivar === Boolean(antes.specification.archived_at))
    throw fail(409, arquivar ? 'Este projeto já está arquivado.' : 'Este projeto não está arquivado.');
   const spec = { ...antes.specification };
   if (arquivar) spec.archived_at = new Date().toISOString(); else delete spec.archived_at;
   const row = (await client.query(`UPDATE delivery_projects SET specification=$1,revision=revision+1,updated_at=now()
     WHERE id=$2 RETURNING ${COLUNAS_PROJETO}`, [spec, params.id])).rows[0];
   // Arquivar é mudança de cadastro e entra na mesma trilha das outras: quem
   // olhar delivery_audit vê a revisão em que o projeto saiu de circulação.
   await client.query('INSERT INTO delivery_audit(project_id,revision,before_specification,after_specification) VALUES($1,$2,$3,$4)',
    [row.id, row.revision, antes.specification, spec]);
   return { tenant: null, type: arquivar ? 'delivery.project_archived' : 'delivery.project_restored', body: { id: row.id, revision: row.revision, archived_at: spec.archived_at || null } };
  }, { transactional: true, audit: false });
 }

 // ATIVAR O ITEM DO PORTFÓLIO pelo checklist do projeto.
 //
 // É o mesmo ato de /api/portfolio/:id/lifecycle e por isso pede a mesma coisa:
 // permissão de dono. Sem isso, o checklist seria a porta barata para ativar o que
 // a outra tela protege. A trilha também é a mesma (portfolio_audit 'activated'),
 // senão "ativado" teria dois significados conforme a tela por onde passou.
 router.post('/api/delivery/projects/:id/activate', async ({ params, body, client, operator }) => {
  await commercialPermission(client, operator, true, true);
  if (!isUuid(params.id)) throw fail(400, 'Projeto inválido.');
  input(body, ['revision']);
  if (!Number.isInteger(body.revision) || body.revision < 1) throw fail(400, 'Revisão inválida.');
  // FOR UPDATE OF d: a trava é do projeto. Pedi-la para o LEFT JOIN inteiro seria
  // erro do Postgres (não se trava o lado que pode vir nulo), e o item do
  // portfólio é travado logo abaixo, na leitura que vira before_value.
  const current = (await client.query(`${PROJETO_COM_DONO} WHERE d.id=$1 FOR UPDATE OF d`, [params.id])).rows[0];
  if (!current) throw fail(404, 'Projeto não encontrado.');
  if (current.revision !== body.revision) throw fail(409, 'Este projeto mudou. Reabra o cadastro antes de ativar.');
  if (current.specification.archived_at) throw fail(409, 'Projeto arquivado. Restaure antes de ativar.');
  if (!current.product_id) throw fail(409, current.specification.engagement_id
   ? 'Este projeto pertence a uma contratação, e contratação não é item do portfólio: não há o que ativar aqui.'
   : 'Este projeto está sem dono: escolha o item do portfólio antes de ativar.');
  const antes = (await client.query(`SELECT ${COLUNAS_ITEM} FROM products WHERE id=$1 FOR UPDATE`, [current.product_id])).rows[0];
  if (!antes) throw fail(404, 'Item do portfólio não encontrado.');
  if (antes.lifecycle_status === 'archived') throw fail(409, 'Item arquivado. Restaure pelo Portfólio antes de ativar.');
  if (antes.lifecycle_status !== 'draft') throw fail(409, `${antes.name} já está ativo.`);
  // O tipo lido AGORA, com trava: reclassificar o item muda o checklist, e ativar
  // por um checklist que o tipo atual não pede é ativar sem conferir.
  const state = readiness({ ...current, portfolio_kind: antes.portfolio_kind });
  if (!state.ready) throw fail(409, `Resolva o checklist antes de ativar: ${state.items.filter(item => !item.ready).map(item => item.label).join(', ')}.`);
  const depois = (await client.query(
   `UPDATE products SET lifecycle_status='active',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING ${COLUNAS_ITEM}`,
   [current.product_id])).rows[0];
  await registrarItem(client, 'product', current.product_id, 'activated', antes, depois, operator);
  return { tenant: null, type: 'delivery.product_activated', body: depois };
 }, { transactional: true, audit: false });
}

export const _internals = { CHECKLIST, readiness, present, donoPedido, donoDe };
