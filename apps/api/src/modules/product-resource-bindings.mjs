// Conexão técnica confirmada — o REGISTRO ÚNICO de "de quem é este recurso".
//
// Desde a migração 034, product_resource_bindings é a única resposta para a
// pergunta que antes tinha três (product_deploy_bindings, service_deploy_bindings
// e esta). Este módulo é o lado do código dessa decisão:
//
//  · UM DONO, E SÓ UM. Item do portfólio (product_id) OU contratação
//    (engagement_id), nunca os dois, nunca nenhum — o CHECK um_dono da 034. Aqui
//    a regra é conferida ANTES do banco, para a recusa sair em português em vez
//    de virar 500 traduzido de uma violação de restrição.
//  · DESVINCULAR É UPDATE, NUNCA DELETE. active=false guarda o último dono, o
//    motivo e a data. Nenhuma rota deste módulo emite DELETE — religar é
//    reaproveitar a linha, e é isso que mantém a UNIQUE da 022 verdadeira.
//    (test/unit/product-resource-bindings.test.mjs faz essa guarda valer.)
//  · TROCAR DE DONO É DECISÃO, NÃO EDIÇÃO. Reatribuir exige reassign:true, a
//    revisão que o operador leu e um motivo, e é permissão de owner. Sem isso, um
//    recurso já confirmado responde 409 apontando para Reatribuir — nunca para
//    "remova ou edite o vínculo existente", que era o conselho que levava ao 500
//    (editar) ou a apagar a conexão de uma contratação (remover).
//  · O IDENTIFICADOR É O DO PROVEDOR. Casar por nome foi o que deixou um projeto
//    renomeado herdar o dono de outro; o id nominal legado continua valendo, mas
//    só declarado em external_id_kind='name'.
//
// As fachadas legadas (product-deploy-bindings.mjs e service-deploy-bindings.mjs)
// gravam por aqui, pelo mesmo núcleo: é o que impede a tela antiga de criar um
// vínculo que o registro único não enxerga.
import { fail, input, isProductId, isUuid, onlyParams, text } from '../platform/http.mjs';
import { findEditableProduct } from './catalog.mjs';
import { commercialPermission } from './commercial-keys.mjs';

const resourceTypes = ['repository','frontend','backend','domain','api','worker','database','cache','checkout','email'];
const providers = ['github','vercel','easypanel','hostinger','stripe','asaas','manual'];
const environments = ['development','staging','production','internal'];
// Checkout e e-mail são configuração de quem VENDE (billing_offers,
// checkout_templates, email_templates têm tabela própria), nunca infraestrutura
// entregue a uma organização: é o CHECK contratacao_tipo da 034.
const TIPOS_SO_DE_ITEM = ['checkout','email'];

// Colunas públicas. actor_subject e actor_email ficam de fora de propósito: a
// trilha guarda quem mexeu, a listagem não precisa devolver e-mail de operador.
// deactivated_at e unbind_reason entram porque a tela de Conexões mostra o estado
// de cada linha, e uma conexão desligada sem a data e o motivo é só uma ausência.
const COLUNAS = `id,product_id,engagement_id,resource_type,provider,external_id,external_id_kind,
 display_name,environment,url,active,deactivated_at,unbind_reason,revision,created_at,updated_at`;
const select = `SELECT ${COLUNAS}
 FROM product_resource_bindings`;
// Carregar para decidir e para a trilha: aqui a linha inteira importa, porque é
// ela que vira before_value.
const carregar = `SELECT * FROM product_resource_bindings`;

// A tela de Conexões pergunta o motivo do desligamento; a ficha do item e as
// fachadas legadas não perguntam. Quando não vem motivo, gravar a frase honesta é
// melhor do que gravar nulo: o registro diz de onde veio o desligamento e admite
// o que não sabe, em vez de fingir que ninguém quis dizer nada.
const MOTIVO_DESVINCULO = 'desvinculada pela tela, sem motivo informado';
const MOTIVO_DESATRELAR = 'desatrelada em lote pela ficha do item; a ficha não pede o motivo';

// Disciplina de identificador por provedor. O id estável é o que faz duas leituras
// falarem do mesmo recurso. Onde o provedor tem formato conhecido ele é conferido,
// e a mensagem diz qual é o formato — um 400 legível vale mais que um vínculo que
// casa por acaso. Hostinger, Stripe, Asaas e manual não têm formato a conferir: o
// identificador deles É o nome do recurso.
const FORMATOS = {
 vercel: [/^prj_[A-Za-z0-9]+$/, 'O identificador da Vercel começa com prj_. Confirme o projeto pela lista em vez de digitar o nome.'],
 easypanel: [/^[^/\s][^/]*\/[^/\s][^/]*$/, 'O identificador do EasyPanel é projeto/serviço.'],
 github: [/^[0-9]+$/, 'O identificador do GitHub é o número do repositório.'],
};

const optionalUrl = value => {
 if (value === null || value === undefined || value === '') return null;
 const candidate = text(value, 8, 1000);
 try { const parsed = new URL(candidate); if (parsed.protocol !== 'https:') throw new Error(); }
 catch { throw fail(400, 'A URL da conexão deve usar HTTPS.'); }
 return candidate;
};

const vazio = value => value === undefined || value === null || value === '';

/**
 * Origem do identificador. Quem declara, manda; quem não declara herda a mesma
 * leitura da 034: id igual ao nome significa que o provedor não deu id, e é o
 * único caso em que casar por nome é legítimo (o repositório que a Vercel sugere,
 * o vínculo legado da 020). Onde não há formato a conferir, nada disso muda a
 * resposta — e então 'provider_id' continua sendo o que está gravado hoje.
 */
const origemDoIdentificador = (provider, externalId, displayName, declarada) =>
 declarada || (FORMATOS[provider] && externalId === displayName ? 'name' : 'provider_id');

const CAMPOS = ['id','product_id','engagement_id','resource_type','provider','external_id',
 'external_id_kind','display_name','environment','url','revision','reassign','reason'];

function validate(body) {
 input(body, CAMPOS);
 if (body.id !== undefined && !isUuid(body.id)) throw fail(400, 'Conexão inválida.');

 // Dono XOR, antes do banco: com os dois ou com nenhum, o CHECK um_dono derrubaria
 // a transação e o operador leria "não foi possível concluir a operação".
 const productId = vazio(body.product_id) ? null : body.product_id;
 const engagementId = vazio(body.engagement_id) ? null : body.engagement_id;
 if ((productId === null) === (engagementId === null))
  throw fail(400, 'Uma conexão tem um dono só: informe o item do portfólio OU a contratação.');
 if (productId !== null && !isProductId(productId)) throw fail(400, 'Produto inválido.');
 if (engagementId !== null && !isUuid(engagementId)) throw fail(400, 'Contratação inválida.');

 if (!resourceTypes.includes(body.resource_type) || !providers.includes(body.provider))
  throw fail(400, 'Tipo ou provedor inválido.');
 if (engagementId !== null && TIPOS_SO_DE_ITEM.includes(body.resource_type))
  throw fail(400, 'Checkout e e-mail são configuração do item que vende, não infraestrutura de uma contratação.');
 if (!vazio(body.environment) && !environments.includes(body.environment)) throw fail(400, 'Ambiente inválido.');

 const externalId = text(body.external_id, 1, 300);
 const displayName = text(body.display_name, 1, 240);
 if (!vazio(body.external_id_kind) && !['provider_id','name'].includes(body.external_id_kind))
  throw fail(400, 'Origem do identificador inválida.');
 const kind = origemDoIdentificador(body.provider, externalId, displayName, vazio(body.external_id_kind) ? null : body.external_id_kind);
 if (kind === 'provider_id' && FORMATOS[body.provider] && !FORMATOS[body.provider][0].test(externalId))
  throw fail(400, FORMATOS[body.provider][1]);

 if (body.reassign !== undefined && typeof body.reassign !== 'boolean') throw fail(400, 'Reatribuição inválida.');
 const reassign = body.reassign === true;

 // Revisão otimista no padrão de portfolio.mjs: quem mexe numa conexão que já
 // existe diz qual versão leu. Vincular um recurso novo não tem o que comparar, e
 // mandar revisão nesse caso é sinal de que a tela está mandando a versão errada.
 const precisaRevisao = Boolean(body.id) || reassign;
 if (precisaRevisao ? !Number.isInteger(body.revision) || body.revision < 1 : body.revision !== undefined)
  throw fail(400, 'Revisão inválida.');

 // Trocar de dono sem dizer por quê não é registro, é buraco (034).
 const reason = vazio(body.reason) ? null : text(body.reason, 2, 1000);
 if (reassign && !reason) throw fail(400, 'Diga por que a conexão está mudando de dono.');

 return {
  id: body.id || null,
  product_id: productId,
  engagement_id: engagementId,
  resource_type: body.resource_type,
  provider: body.provider,
  external_id: externalId,
  external_id_kind: kind,
  display_name: displayName,
  environment: vazio(body.environment) ? null : body.environment,
  url: optionalUrl(body.url),
  revision: precisaRevisao ? body.revision : null,
  reassign,
  reason,
 };
}

const actor = operator => operator?.email || operator?.subject || 'local-operator';

// Os verbos da trilha, nomeados num lugar só. O CHECK de product_resource_audit
// (034) precisa aceitar todos: uma ação que o banco não conheça não falha sozinha,
// derruba a transação inteira — foi assim que 'detached' deixou "Desatrelar
// conexões" quebrado sem ninguém perceber. Por isso a conferência é aqui, antes
// do INSERT, e o teste compara esta lista com o CHECK do schema.
const ACOES = ['created', 'updated', 'reactivated', 'reassigned', 'deactivated', 'detached'];

// A trilha aponta para o dono de DEPOIS; os dois donos de uma reatribuição ficam
// em before_value e after_value, que é o único lugar onde o dono anterior de uma
// conexão desligada ou reatribuída continua legível.
const audit = (client, row, action, operator, antes, depois, reason = null) => ACOES.includes(action)
 ? client.query(
 `INSERT INTO product_resource_audit
   (binding_id,product_id,engagement_id,action,actor,actor_subject,actor_email,reason,before_value,after_value)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
 [row.id, row.product_id, row.engagement_id, action, actor(operator),
  operator?.subject ?? null, operator?.email ?? null, reason, antes, depois])
 : Promise.reject(new Error(`ação de trilha desconhecida: ${action}`));

// Uma linha salva tem a mesma forma de uma linha listada — a tela não precisa
// saber de onde ela veio. Só o e-mail do operador fica fora: quem mexeu é pergunta
// da trilha, e a trilha tem rota própria.
const publica = row => row && Object.fromEntries(Object.entries(row).filter(([chave]) =>
 !['actor_subject','actor_email'].includes(chave)));

// Identificar o dono na mensagem sem expor cliente: o id do item é interno e
// público na URL de checkout; nome de organização ou rótulo de contratação, não.
const donoDe = row => row.product_id ? `no item ${row.product_id}` : 'em uma contratação';

/** O dono existe e aceita vínculo? Item arquivado e contratação arquivada não aceitam. */
async function exigirDono(client, { product_id, engagement_id }) {
 if (product_id !== null) {
  if (!await findEditableProduct(client, product_id)) throw fail(400, 'Produto não encontrado ou arquivado.');
  return;
 }
 const contratacao = (await client.query('SELECT id,archived_at FROM client_engagements WHERE id=$1', [engagement_id])).rows[0];
 if (!contratacao) throw fail(404, 'Contratação não encontrada.');
 if (contratacao.archived_at) throw fail(409, 'Contratação arquivada. Restaure a contratação antes de vincular uma conexão.');
}

/**
 * Núcleo de "vincular": insere, reativa, edita ou reatribui — uma linha só por
 * recurso, sempre com trilha. É o que as fachadas legadas chamam, para a tela
 * antiga nunca gravar um vínculo fora do registro único.
 *
 * Não confere o dono nem a permissão: quem chama já decidiu essas duas coisas,
 * porque as fachadas mantêm a recusa que a tela de hoje já conhece.
 */
export async function aplicarVinculo(client, operator, v) {
 const anterior = v.id
  ? (await client.query(`${carregar} WHERE id=$1 FOR UPDATE`, [v.id])).rows[0] || null
  : (await client.query(`${carregar} WHERE resource_type=$1 AND provider=$2 AND external_id=$3 FOR UPDATE`,
     [v.resource_type, v.provider, v.external_id])).rows[0] || null;
 if (v.id && !anterior) throw fail(404, 'Conexão não encontrada.');

 const valores = [v.product_id, v.engagement_id, v.resource_type, v.provider, v.external_id,
  v.external_id_kind, v.display_name, v.environment, v.url, operator?.subject ?? null, operator?.email ?? null];

 if (!anterior) {
  // Sem ON CONFLICT: o upsert antigo trocava o dono em silêncio, que é exatamente
  // o que a 034 existe para acabar. Corrida perdida vira 23505 → 409 em describeError.
  const linha = (await client.query(
   `INSERT INTO product_resource_bindings
     (product_id,engagement_id,resource_type,provider,external_id,external_id_kind,
      display_name,environment,url,actor_subject,actor_email)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, valores)).rows[0];
  await audit(client, linha, 'created', operator, null, linha, v.reason);
  return { acao: 'created', linha };
 }

 if (v.revision !== null && anterior.revision !== v.revision)
  throw fail(409, 'Esta conexão foi alterada por outra pessoa. Recarregue antes de salvar.');

 const mesmoDono = anterior.product_id === v.product_id && anterior.engagement_id === v.engagement_id;
 // Conexão desligada não tem dono a defender: religar é vincular, e é assim que a
 // linha parqueada pela 034 ganha dono quando alguém decidir qual é.
 if (anterior.active && !mesmoDono && !v.reassign)
  throw fail(409, `Este recurso já está confirmado ${donoDe(anterior)}. Use Reatribuir para trocar o dono.`);

 const acao = !anterior.active ? 'reactivated' : mesmoDono ? 'updated' : 'reassigned';
 const linha = (await client.query(
  `UPDATE product_resource_bindings
      SET product_id=$2,engagement_id=$3,resource_type=$4,provider=$5,external_id=$6,external_id_kind=$7,
          display_name=$8,environment=$9,url=$10,actor_subject=$11,actor_email=$12,
          active=true,deactivated_at=NULL,unbind_reason=NULL,revision=revision+1,updated_at=now()
    WHERE id=$1 RETURNING *`, [anterior.id, ...valores])).rows[0];
 await audit(client, linha, acao, operator, anterior, linha, v.reason);
 return { acao, linha };
}

/**
 * Vínculo de deploy pelas fachadas legadas. O tipo vem do provedor, como nas
 * cópias da 034 e da 035, para o mesmo projeto ter o mesmo tipo em toda parte.
 */
export function vinculoDeDeploy({ provider, external_project_id, external_project_name, environment, product_id = null, engagement_id = null }) {
 return {
  id: null,
  product_id, engagement_id,
  resource_type: provider === 'vercel' ? 'frontend' : 'backend',
  provider,
  external_id: external_project_id,
  external_id_kind: origemDoIdentificador(provider, external_project_id, external_project_name, null),
  display_name: external_project_name,
  environment,
  url: null,
  // A tela antiga não tem revisão para mandar nem botão de reatribuir: ela só
  // vincula projeto que ainda não tem dono, e é isso que ela continua fazendo.
  revision: null,
  reassign: false,
  // A trilha diz de onde o vínculo veio: a fachada é a única escrita que não passa
  // pela tela de conexões, e sem isso ela seria indistinguível da rota nova.
  reason: 'gravado pela tela de Deploys (fachada legada)',
 };
}

export function productResourceBindingRoutes(router) {
 // --- desatrelar todas as conexões de um item ------------------------------
 // Em lote, e não uma a uma: quem clica quer o item limpo. Cada linha deixa
 // trilha 'detached' com o antes e o depois — a ação que a 022 não aceitava e
 // por isso derrubava a transação inteira (era gravada como 'deleted' até a 034).
 router.delete('/api/products/:id/attachments', async ({ client, params, operator }) => {
  await commercialPermission(client, operator, true, true);
  if (!isProductId(params.id)) throw fail(400, 'Produto inválido.');
  if (!await findEditableProduct(client, params.id)) throw fail(404, 'Produto não encontrado ou arquivado.');
  const antes = (await client.query(`${carregar} WHERE product_id=$1 AND active FOR UPDATE`, [params.id])).rows;
  const depois = antes.length ? (await client.query(
   `UPDATE product_resource_bindings
       SET active=false,deactivated_at=now(),unbind_reason=$2,revision=revision+1,updated_at=now()
     WHERE product_id=$1 AND active RETURNING *`, [params.id, MOTIVO_DESATRELAR])).rows : [];
  const porId = new Map(antes.map(linha => [linha.id, linha]));
  for (const linha of depois) await audit(client, linha, 'detached', operator, porId.get(linha.id), linha, MOTIVO_DESATRELAR);
  return { tenant: null, type: 'product.attachments.detached', detached_resources: depois.length };
 }, { transactional: true, audit: false, body: false });

 // --- listar ---------------------------------------------------------------
 // Ativo por padrão: uma conexão desligada guarda o último dono para a trilha, e
 // sem esse filtro a linha parqueada pela 034 apareceria como vínculo vivo de um
 // item que ninguém escolheu. state=all existe para a tela de Conexões, que é a
 // única que PRECISA ver o desligado — enquanto ela não existia, a única forma de
 // enxergar a linha parqueada era consultar o banco.
 router.get('/api/product-resource-bindings', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['product_id', 'state']);
  const productId = url.searchParams.get('product_id');
  const estado = url.searchParams.get('state') || 'active';
  if (productId && !isProductId(productId)) throw fail(400, 'Produto inválido.');
  if (!['active', 'all'].includes(estado)) throw fail(400, 'Estado inválido.');
  const filtros = [...(estado === 'active' ? ['active'] : []), ...(productId ? ['product_id=$1'] : [])];
  const where = filtros.length ? ` WHERE ${filtros.join(' AND ')}` : '';
  // Desligada por último: a tela lê de cima para baixo e o que vive vem primeiro.
  const result = await pool.query(
   `${select}${where} ORDER BY active DESC,${productId ? '' : 'product_id,'}resource_type,display_name`,
   productId ? [productId] : []);
  return reply(200, { bindings: result.rows });
 }, { body: false });

 // --- histórico de uma conexão --------------------------------------------
 // A trilha é a razão de ser da 034: sem ela, "desvincular" e "trocar de dono"
 // seriam indistinguíveis de "nunca existiu". Devolve o ator porque a pergunta que
 // a tela responde é "quem mexeu, quando e por quê" — as três juntas ou nenhuma.
 // Leitura de operador autenticado, não de dono: quem enxerga a conexão precisa
 // enxergar a história dela, senão o botão existe para mostrar um 403.
 router.get('/api/product-resource-bindings/:id/history', async ({ pool, params, reply, operator }) => {
  await commercialPermission(pool, operator, false);
  if (!isUuid(params.id)) throw fail(400, 'Conexão inválida.');
  // O dono de ANTES só sobrevive em before_value: a linha em si já foi atualizada.
  // É o que torna uma reatribuição legível meses depois ("saiu de X, entrou em Y").
  const result = await pool.query(
   `SELECT id,action,actor,reason,created_at,
           product_id AS depois_product_id, engagement_id AS depois_engagement_id,
           before_value->>'product_id' AS antes_product_id,
           (before_value->'engagement_id' IS NOT NULL AND before_value->>'engagement_id' IS NOT NULL) AS antes_de_contratacao,
           (before_value->>'active')::boolean AS antes_ativa
      FROM product_resource_audit WHERE binding_id=$1
     ORDER BY created_at DESC, id DESC LIMIT 100`, [params.id]);
  return reply(200, { history: result.rows });
 }, { body: false });

 // --- vincular, editar, religar e reatribuir -------------------------------
 router.put('/api/product-resource-bindings', async ({ client, body, operator }) => {
  const v = validate(body);
  // Reatribuir tira um recurso de quem o tinha: é decisão de dono, não edição.
  await commercialPermission(client, operator, true, v.reassign);
  await exigirDono(client, v);
  const { acao, linha } = await aplicarVinculo(client, operator, v);
  return { tenant: null, type: `product.resource.${acao}`, body: publica(linha) };
 }, { transactional: true, audit: false });

 // --- desvincular ----------------------------------------------------------
 // UPDATE, nunca DELETE: a linha desligada guarda o último dono, a data e o motivo,
 // e é ela que religar reaproveita.
 //
 // O motivo é opcional no protocolo e obrigatório na tela de Conexões. A diferença
 // é deliberada: a ficha do item e as fachadas legadas mandam DELETE sem corpo — é
 // assim que o navegador exclui por id —, e exigir corpo aqui quebraria as duas
 // por 415. Quem não manda motivo fica com a frase honesta gravada, não com nulo.
 router.delete('/api/product-resource-bindings/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  if (!isUuid(params.id)) throw fail(400, 'Conexão inválida.');
  input(body, ['reason', 'revision']);
  const motivo = vazio(body.reason) ? MOTIVO_DESVINCULO : text(body.reason, 2, 1000);
  if (body.revision !== undefined && (!Number.isInteger(body.revision) || body.revision < 1))
   throw fail(400, 'Revisão inválida.');
  const antes = (await client.query(`${carregar} WHERE id=$1 FOR UPDATE`, [params.id])).rows[0];
  if (!antes) throw fail(404, 'Conexão não encontrada.');
  // Mesma revisão otimista de salvar: desligar a conexão que outra pessoa acabou de
  // reatribuir tiraria o recurso de um dono que esta tela nunca chegou a mostrar.
  if (body.revision !== undefined && antes.revision !== body.revision)
   throw fail(409, 'Esta conexão foi alterada por outra pessoa. Recarregue antes de salvar.');
  if (!antes.active) throw fail(409, 'Esta conexão já está desligada.');
  const linha = (await client.query(
   `UPDATE product_resource_bindings
       SET active=false,deactivated_at=now(),unbind_reason=$2,revision=revision+1,updated_at=now()
     WHERE id=$1 RETURNING *`, [params.id, motivo])).rows[0];
  await audit(client, linha, 'deactivated', operator, antes, linha, motivo);
  return { tenant: null, type: 'product.resource.deactivated' };
 }, { transactional: true, audit: false, body: 'optional' });
}

export const _internals = { validate, ACOES, FORMATOS, MOTIVO_DESVINCULO, MOTIVO_DESATRELAR };
