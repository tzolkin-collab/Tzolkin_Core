import { fail, isUuid } from '../platform/http.mjs';
import { commercialPermission } from './commercial-keys.mjs';
import { FERRAMENTAS, CAPACIDADES, MODELOS, TIPOS_DE_MATERIAL, validarAgente, riscoDoAgente } from '../platform/agentes.mjs';

// Rotas dos agentes de IA do WhatsApp: listar (com o catálogo do que se pode liberar), criar e editar. É só a CONFIGURAÇÃO (ver
// db/migrations/065_agentes_de_ia.sql): salvar e ligar um agente não faz ele responder ninguém, porque a execução é outra etapa.
// Agente não se apaga (a role do Core não tem DELETE): desliga.

export const MENSAGEM_065 = 'Os agentes de IA ainda não estão disponíveis neste banco: falta aplicar a migração 065.';
const COLUNAS = 'id,name,description,instance,model,instructions,context,pipelines,tools,abilities,assets,is_active,version,created_by,created_at,updated_at';

export function whatsappAgentesRoutes(router) {
 const funisAtivos = async db => (await db.query('SELECT p.id,p.name,p.space_id,pr.name AS space_name FROM pipelines p JOIN products pr ON pr.id=p.space_id WHERE p.is_active ORDER BY pr.name,p.position,p.name')).rows;
 const comRisco = a => ({ ...a, risco: riscoDoAgente(a.tools) });

 router.get('/api/whatsapp/agents', async ({ pool, reply, operator }) => {
  await commercialPermission(pool, operator);
  const funis = await funisAtivos(pool);
  const catalogo = { ferramentas: FERRAMENTAS, capacidades: CAPACIDADES, modelos: MODELOS, tipos: TIPOS_DE_MATERIAL };
  try {
   const agents = (await pool.query(`SELECT ${COLUNAS} FROM ai_agents ORDER BY lower(name)`)).rows.map(comRisco);
   reply(200, { disponivel: true, agents, catalogo, funis });
  } catch (e) { if (e?.code === '42P01') return reply(200, { disponivel: false, agents: [], catalogo, funis, aviso: MENSAGEM_065 }); throw e; }
 }, { body: false });

 router.post('/api/whatsapp/agents', async ({ client, body, operator }) => {
  await commercialPermission(client, operator, true);
  const funis = new Set((await funisAtivos(client)).map(f => f.id));
  const a = validarAgente(body, funis);
  try {
   const r = await client.query(
    'INSERT INTO ai_agents(name,description,instance,model,instructions,context,pipelines,tools,abilities,assets,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [a.name, a.description, a.instance, a.model, a.instructions, a.context, a.pipelines, a.tools, JSON.stringify(a.abilities), JSON.stringify(a.assets), a.is_active, operator?.email || operator?.subject || null]);
   return { body: { id: r.rows[0].id } };
  } catch (e) {
   if (e?.code === '42P01') throw fail(409, MENSAGEM_065);
   if (e?.code === '23505') throw fail(409, 'Já existe um agente com este nome.');
   throw e;
  }
 }, { transactional: true, audit: false });

 router.put('/api/whatsapp/agents/:id', async ({ client, params, body, operator }) => {
  await commercialPermission(client, operator, true);
  if (!isUuid(params.id)) throw fail(400, 'Identificador inválido.');
  const funis = new Set((await funisAtivos(client)).map(f => f.id));
  const a = validarAgente(body, funis);
  try {
   const antigo = (await client.query('SELECT id,version FROM ai_agents WHERE id=$1 FOR UPDATE', [params.id])).rows[0];
   if (!antigo) throw fail(404, 'Agente não encontrado.');
   if (body.version !== antigo.version) throw fail(409, 'Agente alterado em outra sessão. Reabra a tela.');
   await client.query(
    'UPDATE ai_agents SET name=$2,description=$3,instance=$4,model=$5,instructions=$6,context=$7,pipelines=$8,tools=$9,abilities=$10,assets=$11,is_active=$12,version=version+1,updated_at=now() WHERE id=$1',
    [params.id, a.name, a.description, a.instance, a.model, a.instructions, a.context, a.pipelines, a.tools, JSON.stringify(a.abilities), JSON.stringify(a.assets), a.is_active]);
   return { body: { ok: true } };
  } catch (e) {
   if (e?.code === '42P01') throw fail(409, MENSAGEM_065);
   if (e?.code === '23505') throw fail(409, 'Já existe um agente com este nome.');
   throw e;
  }
 }, { transactional: true, audit: false });
}
