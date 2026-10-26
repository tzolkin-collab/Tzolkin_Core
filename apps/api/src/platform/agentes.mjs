// Agentes de IA do WhatsApp: o catálogo do que se pode liberar a um agente e a validação do que a tela manda salvar.
// Só regras puras; as rotas ficam em modules/whatsapp-agentes.mjs e o texto das telas em apps/web/public/whatsapp-agentes.js.
import { fail, input, isUuid, text } from './http.mjs';

/** Ferramentas do Core que um agente pode receber. `execucao`: se o motor já sabe executar (as outras ficam configuráveis, mas o modelo não as recebe). `risco`: o que acontece se o agente errar (baixo = só lê ou anota; medio = muda dado; alto = mexe com dinheiro ou fala por fora). */
export const FERRAMENTAS = Object.freeze({
 'lead.buscar': { nome: 'Buscar lead e histórico', descricao: 'Lê o cadastro do lead, as conversas e o que já foi feito com ele.', execucao: true, risco: 'baixo' },
 'base.consultar': { nome: 'Consultar a base de conhecimento', descricao: 'Procura nos materiais e no contexto do agente antes de responder.', execucao: true, risco: 'baixo' },
 'nota.registrar': { nome: 'Registrar anotação', descricao: 'Grava no histórico do lead um resumo do que foi combinado.', execucao: true, risco: 'baixo' },
 'agenda.consultar': { nome: 'Consultar horários livres', descricao: 'Vê os horários disponíveis na Agenda do Core.', execucao: false, risco: 'baixo' },
 'contrato.consultar': { nome: 'Consultar contratos e pagamentos', descricao: 'Lê as contratações e o estado dos pagamentos do cliente.', execucao: true, risco: 'baixo' },
 'lead.atualizar': { nome: 'Atualizar dados do lead', descricao: 'Corrige nome, e-mail, WhatsApp e os campos do espaço.', execucao: true, risco: 'medio' },
 'lead.mover_etapa': { nome: 'Mover de etapa', descricao: 'Move o lead ou a oportunidade no funil, respeitando as tarefas de etapa.', execucao: false, risco: 'medio' },
 'tarefa.criar': { nome: 'Criar tarefa para a equipe', descricao: 'Abre uma tarefa com prazo e responsável.', execucao: true, risco: 'medio' },
 'tarefa.concluir': { nome: 'Concluir tarefa', descricao: 'Marca como cumprida uma tarefa do lead.', execucao: true, risco: 'medio' },
 'agenda.marcar': { nome: 'Marcar reunião', descricao: 'Cria o compromisso na Agenda do Core e avisa o lead.', execucao: false, risco: 'medio' },
 'equipe.transferir': { nome: 'Transferir para uma pessoa', descricao: 'Para de responder e avisa a equipe no WhatsApp para assumir a conversa.', execucao: true, risco: 'baixo' },
 'email.enviar': { nome: 'Enviar e-mail ao lead', descricao: 'Manda um dos templates de e-mail do espaço.', execucao: true, risco: 'alto' },
 'cobranca.gerar_link': { nome: 'Gerar link de pagamento', descricao: 'Cria um link de cobrança (Stripe) para o lead. Mexe com dinheiro.', execucao: false, risco: 'alto' },
});

/** O que o agente pode fazer na conversa. `execucao`: se o motor já executa (hoje só o texto; o resto é configuração pronta para quando houver voz, mídia e agendamento). */
export const CAPACIDADES = Object.freeze({
 texto: { nome: 'Responder por texto', descricao: 'Escreve as respostas na conversa.', execucao: true },
 audio_enviar: { nome: 'Enviar áudios de voz', descricao: 'Responde em áudio, com voz sintetizada, quando fizer sentido.', execucao: false },
 audio_entender: { nome: 'Entender áudios', descricao: 'Transcreve os áudios que o lead manda antes de responder.', execucao: false },
 imagem_entender: { nome: 'Entender imagens', descricao: 'Lê fotos e prints que o lead manda (comprovantes, documentos).', execucao: false },
 documento_enviar: { nome: 'Enviar documentos e imagens', descricao: 'Manda os materiais cadastrados no agente quando o lead pedir.', execucao: false },
 ligacao: { nome: 'Fazer ligações', descricao: 'Liga para o lead quando a conversa pedir (precisa de uma linha de voz conectada).', execucao: false },
 retomar: { nome: 'Retomar conversa parada', descricao: 'Volta a falar com o lead que sumiu, no ritmo e nos horários permitidos.', execucao: false },
});

export const MODELOS = Object.freeze(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
/** O provedor de um modelo: os que começam com "gemini-" vão ao Google, o resto à Anthropic. */
export const provedorDoModelo = modelo => (String(modelo ?? '').startsWith('gemini-') ? 'gemini' : 'anthropic');
export const TIPOS_DE_MATERIAL = Object.freeze({ documento: 'Documento', imagem: 'Imagem', audio: 'Áudio', video: 'Vídeo', link: 'Link', texto: 'Texto' });
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_MATERIAIS = 20;

const link = valor => {
 let u;
 try { u = new URL(String(valor)); } catch { return null; }
 return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
};
const opcional = (valor, min, max) => (valor == null || String(valor).trim() === '' ? null : text(valor, min, max));

/** Valida o corpo de criação/edição e devolve a forma que vai para o banco. `funisValidos`: ids de funis que existem e estão ativos. */
export function validarAgente(corpo, funisValidos) {
 input(corpo, ['name', 'description', 'instance', 'model', 'instructions', 'context', 'pipelines', 'tools', 'abilities', 'assets', 'is_active', 'version']);
 const name = text(corpo.name, 2, 80);
 const description = opcional(corpo.description, 1, 300);
 const instance = corpo.instance == null || corpo.instance === '' ? null : String(corpo.instance);
 if (instance && !INSTANCIA.test(instance)) throw fail(400, 'Instância inválida.');
 if (!MODELOS.includes(corpo.model)) throw fail(400, 'Escolha um dos modelos da lista.');
 const instructions = text(corpo.instructions, 10, 8000);
 const context = opcional(corpo.context, 1, 8000);
 for (const [campo, rotulo] of [['pipelines', 'funis'], ['tools', 'ferramentas']]) if (!Array.isArray(corpo[campo]) || corpo[campo].length > 50) throw fail(400, `Lista de ${rotulo} inválida.`);
 const pipelines = [...new Set(corpo.pipelines)];
 for (const id of pipelines) if (!isUuid(id) || !funisValidos.has(id)) throw fail(400, 'Um dos funis escolhidos não existe ou está arquivado.');
 const tools = [...new Set(corpo.tools)];
 for (const t of tools) if (!Object.hasOwn(FERRAMENTAS, t)) throw fail(400, `Ferramenta desconhecida: ${String(t).slice(0, 40)}.`);
 if (!corpo.abilities || typeof corpo.abilities !== 'object' || Array.isArray(corpo.abilities)) throw fail(400, 'Capacidades inválidas.');
 const abilities = {};
 for (const [k, v] of Object.entries(corpo.abilities)) {
  if (!Object.hasOwn(CAPACIDADES, k) || typeof v !== 'boolean') throw fail(400, `Capacidade inválida: ${String(k).slice(0, 40)}.`);
  abilities[k] = v;
 }
 if (!Array.isArray(corpo.assets) || corpo.assets.length > MAX_MATERIAIS) throw fail(400, `Até ${MAX_MATERIAIS} materiais por agente.`);
 const assets = corpo.assets.map(m => {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw fail(400, 'Material inválido.');
  input(m, ['name', 'kind', 'url', 'when']);
  if (!Object.hasOwn(TIPOS_DE_MATERIAL, m.kind)) throw fail(400, 'Tipo de material inválido.');
  const url = m.kind === 'texto' && (m.url == null || m.url === '') ? null : link(m.url);
  if (m.kind !== 'texto' && !url) throw fail(400, `O material "${String(m.name).slice(0, 40)}" precisa de um link https.`);
  return { name: text(m.name, 2, 80), kind: m.kind, url, when: opcional(m.when, 1, 300) };
 });
 if (corpo.is_active != null && typeof corpo.is_active !== 'boolean') throw fail(400, 'Valor inválido.');
 return { name, description, instance, model: corpo.model, instructions, context, pipelines, tools, abilities, assets, is_active: corpo.is_active === true };
}

/** O resumo de risco do que foi liberado: a tela avisa quando há ferramenta de risco alto. */
export const riscoDoAgente = tools => (tools.some(t => FERRAMENTAS[t]?.risco === 'alto') ? 'alto' : tools.some(t => FERRAMENTAS[t]?.risco === 'medio') ? 'medio' : 'baixo');

/** Ferramentas que o motor executa de verdade: só estas são oferecidas ao modelo, mesmo que o agente tenha outras marcadas. */
export const FERRAMENTAS_EXECUTAVEIS = Object.freeze(Object.entries(FERRAMENTAS).filter(([, f]) => f.execucao).map(([id]) => id));
