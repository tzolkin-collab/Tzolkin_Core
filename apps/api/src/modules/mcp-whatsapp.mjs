import { createEvolutionAdapter } from '../integrations/evolution.mjs';
import { vivo } from '../platform/env-vivo.mjs';
import { listarConexoes, salvarConexao } from './whatsapp-captura.mjs';
import { listarFluxos, salvarFluxo, iniciarTeste } from './whatsapp-fluxos.mjs';
import { listarAgentes, salvarAgente } from './whatsapp-agentes.mjs';

// Ferramentas do MCP para montar o WhatsApp do Core sem abrir a tela: conectar uma instância a um funil, montar fluxos com gatilho e criar agentes
// de IA. São as MESMAS funções que a tela usa (mesmas validações, mesmas mensagens de erro), então o que o MCP monta aparece na tela e vice-versa.
// Nada aqui envia mensagem sozinho, exceto `whatsapp_iniciar_fluxo` em fluxo ATIVO (em teste só registra o que enviaria).

const OBJ = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const PASSOS = { type: 'array', description: 'Passos na ordem. Termine sempre com uma mensagem.', items: OBJ({
 tipo: { type: 'string', enum: ['mensagem', 'espera'] },
 texto: { type: 'string', description: 'Só em "mensagem". Aceita {{first_name}}, {{name}}, {{email}}, {{whatsapp}}, {{company_name}}, {{product_name}}, {{dados.interesse}}, {{dados.mensagem_do_lead}} e {{dados.<chave>}}.' },
 minutos: { type: 'integer', description: 'Só em "espera": de 1 a 43200 (30 dias).' },
}, ['tipo']) };

export const FERRAMENTAS_WHATSAPP = [
 {
  name: 'whatsapp_instancias',
  description: 'Lista as instâncias de WhatsApp da Evolution (estado, número) e a qual funil cada uma está conectada, mais os funis disponíveis. Use antes de conectar uma instância a um funil.',
  inputSchema: OBJ({}),
 },
 {
  name: 'whatsapp_conectar_instancia_funil',
  description: 'Conecta uma instância de WhatsApp a um funil: a conversa NOVA que chegar nela vira lead na etapa de entrada desse funil (as automações do funil e os agentes de IA andam sozinhos). Só vale para conversas depois de conectar; o histórico antigo não é importado. Para desligar, criar_leads=false.',
  inputSchema: OBJ({
   instancia: { type: 'string', description: 'Nome da instância (de whatsapp_instancias)' },
   funil_id: { type: 'string', description: 'UUID do funil (de whatsapp_instancias, campo funis)' },
   criar_leads: { type: 'boolean', description: 'Padrão true. false desliga a criação de leads por esta instância.' },
  }, ['instancia', 'funil_id']),
 },
 {
  name: 'whatsapp_listar_fluxos',
  description: 'Lista os fluxos de WhatsApp (sequências de mensagens com espera) com situação, gatilho e resultado (iniciados, responderam, sem resposta), e os dados para montar um novo: espaços, funis com etapas e eventos de gatilho.',
  inputSchema: OBJ({}),
 },
 {
  name: 'whatsapp_salvar_fluxo',
  description: 'Cria (sem id) ou edita (com id e version) um fluxo de WhatsApp. O gatilho cria a automação por trás: com gatilho e situação "teste" ou "ativo", todo lead que cumprir o gatilho entra no fluxo sozinho. COMECE EM "teste": roda inteiro mas NÃO envia nada (cada espera vale 1 minuto) e mostra o que enviaria em whatsapp_listar_fluxos/execuções. "ativo" envia de verdade (só sai com o envio do WhatsApp ligado). Fluxo não se apaga: use status "arquivado".',
  inputSchema: OBJ({
   id: { type: 'string', description: 'UUID do fluxo, para editar' },
   version: { type: 'integer', description: 'Versão atual do fluxo (obrigatória ao editar)' },
   space_id: { type: 'string', description: 'Espaço (contexto) do fluxo, ex.: sites. Não muda depois.' },
   name: { type: 'string', description: 'Nome do fluxo (2 a 120 caracteres)' },
   status: { type: 'string', enum: ['rascunho', 'teste', 'ativo', 'arquivado'] },
   stop_on_reply: { type: 'boolean', description: 'Padrão true: para quando a pessoa responde e observa 24 h depois da última mensagem para dar o resultado' },
   instance: { type: 'string', description: 'Instância que envia; vazio = a padrão' },
   steps: PASSOS,
   gatilho: OBJ({
    event: { type: 'string', enum: ['lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado'] },
    pipeline_id: { type: 'string', description: 'Só neste funil (opcional)' },
    stage_id: { type: 'string', description: 'Só nesta etapa do funil (opcional; precisa de pipeline_id)' },
   }, ['event']),
  }, ['space_id', 'name', 'steps']),
 },
 {
  name: 'whatsapp_iniciar_fluxo',
  description: 'Inicia um fluxo para UM número, sem lead (para testar). Fluxo em teste só registra o que enviaria; fluxo ativo ENVIA DE VERDADE para o número informado. Confirme o número antes.',
  inputSchema: OBJ({
   flow_id: { type: 'string', description: 'UUID do fluxo' },
   numero: { type: 'string', description: 'WhatsApp com DDD, ex.: 31999990000' },
   nome: { type: 'string', description: 'Nome da pessoa, para {{name}} (opcional)' },
   dados: { type: 'object', description: 'Pares chave e valor para {{dados.chave}} (opcional, até 10)' },
  }, ['flow_id', 'numero']),
 },
 {
  name: 'whatsapp_listar_agentes',
  description: 'Lista os agentes de IA do WhatsApp e o catálogo para montar um (ferramentas, capacidades, modelos Claude e Gemini, funis). Um agente com modelo "gemini-..." usa a chave do Gemini cadastrada em Integrações.',
  inputSchema: OBJ({}),
 },
 {
  name: 'whatsapp_salvar_agente',
  description: 'Cria (sem id) ou edita (com id e version) um agente de IA do WhatsApp: instruções, contexto do negócio, funis que atende, ferramentas liberadas e modelo. O agente só responde com a execução dos agentes ligada e a chave do provedor do modelo cadastrada. Comece com poucas ferramentas (ler e anotar). Agente não se apaga: is_active=false.',
  inputSchema: OBJ({
   id: { type: 'string', description: 'UUID do agente, para editar' },
   version: { type: 'integer', description: 'Versão atual (obrigatória ao editar)' },
   name: { type: 'string' },
   description: { type: 'string' },
   instance: { type: 'string', description: 'Instância em que atende; vazio = a padrão' },
   model: { type: 'string', description: 'Um dos modelos de whatsapp_listar_agentes (catalogo.modelos)' },
   instructions: { type: 'string', description: 'Como o agente se comporta' },
   context: { type: 'string', description: 'O que ele precisa saber do negócio' },
   pipelines: { type: 'array', items: { type: 'string' }, description: 'UUIDs dos funis que atende' },
   tools: { type: 'array', items: { type: 'string' }, description: 'Ferramentas liberadas (catalogo.ferramentas)' },
   abilities: { type: 'object', description: 'Capacidades (catalogo.capacidades)' },
   assets: { type: 'array', items: { type: 'object' }, description: 'Materiais que pode citar' },
   is_active: { type: 'boolean' },
  }, ['name', 'model', 'instructions']),
 },
];

async function emTransacao(pool, fn) {
 const client = await pool.connect();
 try { await client.query('BEGIN'); const r = await fn(client); await client.query('COMMIT'); return r; }
 catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
 finally { client.release(); }
}
const por = auth => auth?.ator || 'mcp';
const semId = ({ id, ...resto }) => resto;

/** Executa uma ferramenta de WhatsApp. Devolve `undefined` se o nome não é daqui (o despachante geral segue procurando). */
export async function executarFerramentaWhatsapp(nome, args, { pool, auth, env = vivo.env, criarAdaptador = createEvolutionAdapter } = {}) {
 switch (nome) {
  case 'whatsapp_instancias': {
   const ad = criarAdaptador({ env });
   let instancias = [], aviso = null;
   if (!ad.configured) aviso = 'A Evolution não está configurada (Integrações → WhatsApp).';
   else {
    const r = await ad.listInstances();
    if (r.ok) instancias = r.instances;
    else {
     const e = await ad.connectionState();
     instancias = [{ name: ad.instance, state: e.ok ? e.state : 'close', number: null, profile: null }];
     aviso = 'A chave da Evolution é de uma instância só: só a instância padrão aparece. Para listar todas, use a chave global.';
    }
   }
   const c = await listarConexoes(pool);
   return { instancias: instancias.map(i => ({ nome: i.name, estado: i.state, conectada: i.state === 'open', numero: i.number, funil: c.conexoes.find(x => x.instance === i.name) ?? null })), funis: c.funis.map(f => ({ id: f.id, nome: f.name, espaco: f.space_id, espaco_nome: f.space_name })), ...(aviso ? { aviso } : {}), ...(c.aviso ? { aviso_conexoes: c.aviso } : {}) };
  }
  case 'whatsapp_conectar_instancia_funil':
   return emTransacao(pool, client => salvarConexao(client, { instance: args.instancia, pipeline_id: args.funil_id, create_leads: args.criar_leads ?? true, por: por(auth) }));
  case 'whatsapp_listar_fluxos':
   return listarFluxos(pool);
  case 'whatsapp_salvar_fluxo':
   return emTransacao(pool, client => salvarFluxo(client, { id: args.id ?? null, body: semId(args), por: por(auth) }));
  case 'whatsapp_iniciar_fluxo':
   return emTransacao(pool, client => iniciarTeste(client, { id: args.flow_id, numero: args.numero, nome: args.nome, dados: args.dados }));
  case 'whatsapp_listar_agentes':
   return listarAgentes(pool);
  case 'whatsapp_salvar_agente':
   return emTransacao(pool, client => salvarAgente(client, { id: args.id ?? null, body: { pipelines: [], tools: [], abilities: {}, assets: [], ...semId(args) }, por: por(auth) }));
  default: return undefined;
 }
}
