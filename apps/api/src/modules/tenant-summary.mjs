// Ficha da empresa — o que uma organização tem contratado, assinado, entregue e
// de onde veio, numa leitura só.
//
// EMPRESA NO CENTRO. A tela navegava por item (produto, serviço, lead, deploy) e
// responder "o que a empresa X tem" pedia sete telas. Aqui a empresa (tenants) é
// o eixo, a contratação (client_engagements) fica logo abaixo e o item do
// portfólio entra só como contexto da contratação.
//
// SOMENTE LEITURA. GET sem transação e sem auditoria: nada aqui grava.
//
// ISOLAMENTO. Toda consulta recebe o id da URL como $1 e filtra por chave
// estrangeira que já existe — tenant_id direto, ou a contratação da empresa.
// Nenhuma seção junta por nome, rótulo ou proximidade: o que não tem ligação
// real no banco não aparece.
//
// UMA SEÇÃO NÃO DERRUBA A FICHA. Sem permissão comercial, ou num banco sem a
// tabela de uma seção, ela volta { available:false, reason } e o resto segue.
// Só a própria empresa é obrigatória: sem ela é 404.
//
// NADA ALÉM DO QUE AS TELAS JÁ MOSTRAM. Pessoas saem com os mesmos campos do
// /api/overview (sem e-mail nem telefone). Leads saem sem contato, mensagem,
// preferência de privacidade nem hash. Acesso sai contado, sem identificador.
import { fail, isUuid, onlyParams } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';

const FUSO = 'America/Sao_Paulo';

// Mês corrente no fuso da operação, no formato do Acompanhamento (tracking.js).
export const mesCorrente = (clock = Date.now) =>
 new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit' }).format(new Date(clock()));

const MOTIVOS = {
 permissao: 'Sem permissão para ver dados comerciais desta empresa.',
 ausente: 'Esta parte do cadastro ainda não existe neste banco.',
 falha: 'Não foi possível consultar esta parte agora.',
};

// Erro de uma seção vira estado da seção. 42P01/42703: tabela ou coluna que a
// migração daquela seção ainda não criou neste banco.
async function secao(consulta) {
 try { return { available: true, ...(await consulta()) }; }
 catch (error) {
  if (error.status === 403) return { available: false, reason: MOTIVOS.permissao };
  if (['42P01', '42703'].includes(error.code)) return { available: false, reason: MOTIVOS.ausente };
  return { available: false, reason: MOTIVOS.falha };
 }
}

// bigint chega do pg como texto; centavos cabem com folga em Number.
const centavos = valor => (valor == null ? null : Number(valor));

// ---------------------------------------------------------------------------
// Consultas — todas com o id da empresa em $1
// ---------------------------------------------------------------------------

const SQL = {
 empresa: `SELECT id,name,slug,organization_type,relationship_kind,lifecycle_status,status,created_at
             FROM tenants WHERE id=$1`,

 pessoas: `SELECT s.id,s.name,os.role,os.title,os.is_primary,os.contact_allowed
             FROM organization_stakeholders os JOIN stakeholders s ON s.id=os.stakeholder_id
            WHERE os.tenant_id=$1 ORDER BY os.is_primary DESC,s.name`,

 // Todos os service_model, educação e produto inclusive. Arquivada saiu da
 // operação corrente e fica fora, como nas demais listas de trabalho.
 contratacoes: `SELECT e.id,e.label,e.service_model,e.status,e.revision,e.created_at,e.updated_at,
                       e.product_id,p.name AS product_name,p.portfolio_kind,p.lifecycle_status AS product_lifecycle_status
                  FROM client_engagements e LEFT JOIN products p ON p.id=e.product_id
                 WHERE e.tenant_id=$1 AND e.archived_at IS NULL
                 ORDER BY e.created_at,e.label`,

 deploys: `SELECT s.engagement_id,s.provider,s.external_project_id,s.external_project_name,s.environment,s.updated_at
             FROM service_deploy_bindings s JOIN client_engagements e ON e.id=s.engagement_id
            WHERE e.tenant_id=$1 AND e.archived_at IS NULL
            ORDER BY s.external_project_name`,

 // Só vínculo ativo e só pelo lado da contratação: campanha de produto não é
 // desta empresa, mesmo que ela contrate o produto (marketing_binding_um_lado_so).
 campanhas: `SELECT b.engagement_id,c.provider,c.external_id,c.name,c.status,c.effective_status,a.currency,
                    COALESCE(i.spend_cents,0)::bigint AS spend_cents
               FROM marketing_campaign_bindings b
               JOIN client_engagements e ON e.id=b.engagement_id
               JOIN marketing_campaigns c ON c.provider=b.provider AND c.external_id=b.external_campaign_id
               LEFT JOIN marketing_accounts a ON a.provider=c.provider AND a.external_id=c.account_external_id
               LEFT JOIN LATERAL (
                 SELECT SUM(s.spend_cents) AS spend_cents FROM marketing_campaign_insights s
                  WHERE s.provider=c.provider AND s.campaign_external_id=c.external_id
                    AND s.date_start >= $2::date AND s.date_start < $2::date + interval '1 month'
               ) i ON true
              WHERE e.tenant_id=$1 AND b.active AND e.archived_at IS NULL
              ORDER BY c.name`,

 // A atividade tem tenant_id; ligação com contratação ainda não existe. As horas
 // são da empresa, e a resposta diz isso em by_engagement.
 horas: `SELECT COALESCE(SUM(l.minutes),0)::int AS minutes,count(l.id)::int AS logs,count(DISTINCT a.id)::int AS activities
           FROM service_time_logs l JOIN service_activities a ON a.id=l.activity_id
          WHERE a.tenant_id=$1 AND l.worked_on >= $2::date AND l.worked_on < $2::date + interval '1 month'`,

 contratosDeAcesso: `SELECT e.product_id,p.name AS product_name,e.plan,e.rights,e.updated_at
                       FROM entitlements e LEFT JOIN products p ON p.id=e.product_id
                      WHERE e.tenant_id=$1 AND e.active ORDER BY p.name,e.product_id`,

 vinculosDeAcesso: `SELECT m.product_id,p.name AS product_name,count(*)::int AS active
                      FROM memberships m LEFT JOIN products p ON p.id=m.product_id
                     WHERE m.tenant_id=$1 AND m.active GROUP BY m.product_id,p.name ORDER BY p.name,m.product_id`,

 // Datas como texto: um date do pg vira Date à meia-noite local e escorrega um
 // dia quando serializado em UTC.
 contratos: `SELECT c.id,c.lead_id,c.product_id,p.name AS product_name,c.title,c.status,c.amount_minor,c.currency,
                    to_char(c.starts_on,'YYYY-MM-DD') AS starts_on,to_char(c.ends_on,'YYYY-MM-DD') AS ends_on,
                    c.accepted_at,c.created_at
               FROM commercial_contracts c LEFT JOIN products p ON p.id=c.product_id
              WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 101`,

 // Mais antigo primeiro: o primeiro lead é de onde a empresa veio.
 origem: `SELECT l.id,l.name,l.status,l.product_id,p.name AS product_name,l.service_model,l.interest,
                 l.source_system,l.source_created_at,l.created_at,
                 a.channel,a.utm_source,a.utm_medium,a.utm_campaign
            FROM commercial_leads l LEFT JOIN products p ON p.id=l.product_id
            LEFT JOIN commercial_attributions a ON a.lead_id=l.id
           WHERE l.tenant_id=$1 ORDER BY COALESCE(l.source_created_at,l.created_at),l.id LIMIT 51`,
};

const LIMITE_CONTRATOS = 100, LIMITE_LEADS = 50;

export function tenantSummaryRoutes(router, { clock = Date.now } = {}) {
 router.get('/api/tenants/:id/summary', async ({ pool, params, url, reply, operator }) => {
  // Formato primeiro: id inválido não custa consulta.
  if (!isUuid(params.id)) throw fail(400, 'Empresa inválida.');
  onlyParams(url.searchParams, []);
  const id = params.id, mes = mesCorrente(clock), inicioDoMes = `${mes}-01`;

  const empresa = (await pool.query(SQL.empresa, [id])).rows[0];
  if (!empresa) throw fail(404, 'Empresa não encontrada.');

  // Sequencial de propósito, como o /api/overview: reaproveita uma conexão
  // ociosa em vez de abrir várias conexões TLS ao banco remoto de uma vez.
  const people = await secao(async () => ({ items: (await pool.query(SQL.pessoas, [id])).rows }));

  const engagements = await secao(async () => ({
   items: (await pool.query(SQL.contratacoes, [id])).rows.map(({ product_id, product_name, portfolio_kind, product_lifecycle_status, ...e }) => ({
    ...e,
    product: product_id ? { id: product_id, name: product_name, portfolio_kind, lifecycle_status: product_lifecycle_status } : null,
   })),
  }));

  const deploys = await secao(async () => ({ items: (await pool.query(SQL.deploys, [id])).rows }));

  const campaigns = await secao(async () => ({
   month: mes,
   items: (await pool.query(SQL.campanhas, [id, inicioDoMes])).rows.map(c => ({ ...c, spend_cents: centavos(c.spend_cents) })),
  }));

  const hours = await secao(async () => ({
   month: mes, by_engagement: false, ...(await pool.query(SQL.horas, [id, inicioDoMes])).rows[0],
  }));

  const access = await secao(async () => ({
   entitlements: (await pool.query(SQL.contratosDeAcesso, [id])).rows,
   memberships: (await pool.query(SQL.vinculosDeAcesso, [id])).rows,
  }));

  // Comercial: uma checagem de leitura para as duas seções. Recusa não derruba
  // a ficha — vira indisponível nas duas.
  const permitido = await secao(() => commercialPermission(pool, operator));
  const comercial = async consulta => (permitido.available ? secao(consulta) : { available: false, reason: permitido.reason });

  const contracts = await comercial(async () => {
   const linhas = (await pool.query(SQL.contratos, [id])).rows;
   return {
    truncated: linhas.length > LIMITE_CONTRATOS,
    items: linhas.slice(0, LIMITE_CONTRATOS).map(c => ({ ...c, amount_minor: centavos(c.amount_minor) })),
   };
  });

  const origin = await comercial(async () => {
   const linhas = (await pool.query(SQL.origem, [id])).rows;
   return { truncated: linhas.length > LIMITE_LEADS, items: linhas.slice(0, LIMITE_LEADS) };
  });

  return reply(200, {
   tenant: empresa,
   people, engagements, deploys, campaigns, hours, access, contracts, origin,
   generated_at: new Date(clock()).toISOString(),
  });
 }, { body: false });
}

export const _internals = { SQL, secao, MOTIVOS };
