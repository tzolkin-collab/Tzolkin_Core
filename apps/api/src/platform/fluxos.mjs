import { fail, input, isUuid, text } from './http.mjs';
import { normalizarNumero } from '../integrations/evolution.mjs';
import { VARIAVEIS_DE_WHATSAPP, renderizarMensagem, carregarLead } from './whatsapp-saida.mjs';

// Fluxos de WhatsApp: sequências de mensagens com espera. Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md (seção 4.0). Um fluxo só começa por uma
// automação ("Iniciar fluxo", que leva dados do lead) ou por início manual de teste; o motor que o anda é modules/whatsapp-fluxos.mjs.

export const MENSAGEM_070 = 'Os fluxos de WhatsApp ainda não estão disponíveis neste banco: falta aplicar a migração 070.';
export const STATUS_DO_FLUXO = Object.freeze(['rascunho', 'teste', 'ativo', 'arquivado']);
/** Eventos que um fluxo aceita como gatilho: os de lead (há um lead com WhatsApp para receber a mensagem). */
export const GATILHOS_DE_FLUXO = Object.freeze(['lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado']);
export const MAX_PASSOS = 20, MAX_ESPERA_MIN = 43200, MAX_TEXTO = 1000, MAX_DADOS = 10;
/** Depois da última mensagem o fluxo espera isto por uma resposta antes de dar o resultado ("sem resposta"). */
export const JANELA_FINAL_MIN = 24 * 60;
/** Em teste as esperas valem no máximo isto: dá para ver o fluxo inteiro em minutos, não em dias. */
export const ESPERA_EM_TESTE_MIN = 1;

const CHAVE_DE_DADOS = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const VARIAVEL_DE_DADOS = /^dados\.[A-Za-z][A-Za-z0-9_]{0,39}$/;
const INSTANCIA = /^[A-Za-z0-9_.-]{1,64}$/;

/** `{{x}}` que não existe: as variáveis do lead e as `{{dados.chave}}` que a automação leva. Vazio = texto válido. */
export const variaveisDoFluxoInvalidas = texto =>
 [...String(texto).matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(m => m[1]).filter(v => !VARIAVEIS_DE_WHATSAPP.includes(v) && !VARIAVEL_DE_DADOS.test(v));

/** O gatilho escolhido no fluxo: { event, pipeline_id, stage_id } ou nada. A automação por trás é do módulo whatsapp-fluxos. */
export function validarGatilho(g) {
 if (g == null || g === '') return null;
 if (typeof g !== 'object' || Array.isArray(g)) throw fail(400, 'Gatilho inválido.');
 input(g, ['event', 'pipeline_id', 'stage_id']);
 if (!GATILHOS_DE_FLUXO.includes(g.event)) throw fail(400, 'Escolha quando o fluxo começa.');
 const funil = g.pipeline_id || null, etapa = g.stage_id || null;
 if ((funil && !isUuid(funil)) || (etapa && !isUuid(etapa))) throw fail(400, 'Funil ou etapa do gatilho inválidos.');
 if (etapa && !funil) throw fail(400, 'Escolha o funil para filtrar por etapa.');
 return { event: g.event, pipeline_id: funil, stage_id: etapa };
}

/** Valida o corpo de criar/editar fluxo e devolve a forma normalizada. Lança 400 com a mensagem para a tela. */
export function validarFluxo(body) {
 input(body, ['space_id', 'name', 'status', 'stop_on_reply', 'instance', 'steps', 'version', 'gatilho']);
 const name = text(body.name, 2, 120);
 const status = body.status ?? 'rascunho';
 if (!STATUS_DO_FLUXO.includes(status)) throw fail(400, 'Situação do fluxo inválida.');
 if (body.stop_on_reply != null && typeof body.stop_on_reply !== 'boolean') throw fail(400, 'Valor inválido em "parar quando a pessoa responder".');
 const instance = body.instance == null || body.instance === '' ? null : String(body.instance);
 if (instance && !INSTANCIA.test(instance)) throw fail(400, 'Instância inválida.');
 const bruto = body.steps;
 if (!Array.isArray(bruto) || bruto.length < 1 || bruto.length > MAX_PASSOS) throw fail(400, `O fluxo precisa de 1 a ${MAX_PASSOS} passos.`);
 const steps = bruto.map((p, i) => {
  const n = i + 1;
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw fail(400, `Passo ${n} inválido.`);
  if (p.tipo === 'mensagem') {
   input(p, ['tipo', 'texto']);
   const texto = text(p.texto, 2, MAX_TEXTO);
   const ruins = variaveisDoFluxoInvalidas(texto);
   if (ruins.length) throw fail(400, `Variável desconhecida no passo ${n}: ${ruins.map(v => `{{${v}}}`).join(', ')}.`);
   return { tipo: 'mensagem', texto };
  }
  if (p.tipo === 'espera') {
   input(p, ['tipo', 'minutos']);
   if (!Number.isInteger(p.minutos) || p.minutos < 1 || p.minutos > MAX_ESPERA_MIN) throw fail(400, `A espera do passo ${n} vai de 1 minuto a 30 dias.`);
   return { tipo: 'espera', minutos: p.minutos };
  }
  throw fail(400, `Passo ${n}: tipo desconhecido.`);
 });
 if (!steps.some(p => p.tipo === 'mensagem')) throw fail(400, 'O fluxo precisa de pelo menos uma mensagem.');
 if (steps.at(-1).tipo === 'espera') throw fail(400, 'O fluxo não pode terminar numa espera: acabe com uma mensagem.');
 return { name, status, stop_on_reply: body.stop_on_reply ?? true, instance, steps, gatilho: validarGatilho(body.gatilho) };
}

/** Os dados que a ação "Iniciar fluxo" leva: chaves simples e valores curtos. Lança 400. Devolve {} se não houver. */
export function validarDados(dados) {
 if (dados == null) return {};
 if (typeof dados !== 'object' || Array.isArray(dados)) throw fail(400, 'Os dados do fluxo precisam ser pares chave e valor.');
 const chaves = Object.keys(dados);
 if (chaves.length > MAX_DADOS) throw fail(400, `No máximo ${MAX_DADOS} dados por fluxo.`);
 const saida = {};
 for (const k of chaves) {
  if (!CHAVE_DE_DADOS.test(k)) throw fail(400, `Nome de dado inválido: "${k}" (use letras, números e _, começando por letra).`);
  const v = dados[k];
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw fail(400, `O dado "${k}" precisa ser texto, número ou sim/não.`);
  const s = String(v).trim();
  if (s.length > 200) throw fail(400, `O dado "${k}" passa de 200 caracteres.`);
  saida[k] = s;
 }
 return saida;
}

/** Valores para preencher `{{...}}` num passo: os do lead mais os `{{dados.x}}` do payload. */
export function valoresDoPasso(valoresDoLead, dados) {
 return { ...valoresDoLead, ...Object.fromEntries(Object.entries(dados ?? {}).map(([k, v]) => [`dados.${k}`, v])) };
}
export const textoDoPasso = (passo, valoresDoLead, dados) => renderizarMensagem(passo.texto, valoresDoPasso(valoresDoLead, dados));

const previa = t => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

/** Dados que o lead já traz e que todo fluxo pode usar em `{{dados.interesse}}` e `{{dados.mensagem_do_lead}}`. */
export async function dadosDoLead(client, leadId) {
 const l = (await client.query('SELECT interest, message FROM commercial_leads WHERE id=$1', [leadId])).rows[0];
 return { ...(l?.interest ? { interesse: String(l.interest).slice(0, 200) } : {}), ...(l?.message ? { mensagem_do_lead: String(l.message).replace(/\s+/g, ' ').slice(0, 200) } : {}) };
}

/**
 * Coloca uma pessoa num fluxo. Roda DENTRO da transação de quem chama (a automação do lead, ou a rota de início manual de teste).
 * Não envia nada: grava a execução, e o consumidor (modules/whatsapp-fluxos.mjs) anda os passos. Idempotente pela chave.
 * Lança com mensagem clara; a automação registra FAILED e o resto do funil segue.
 * `lead` pode ser nulo no início manual: aí vale `numero`/`nome`.
 */
export async function iniciarFluxo(client, { flowId, spaceId, leadId = null, automationId = null, evento, dados = {}, numero = null, nome = '', chave = null }) {
 if (!isUuid(flowId)) throw new Error('Fluxo inválido.');
 let flow;
 try { flow = (await client.query('SELECT id, space_id, name, status, stop_on_reply, instance, steps FROM whatsapp_flows WHERE id=$1', [flowId])).rows[0]; }
 catch (e) { if (e?.code === '42P01') throw new Error(MENSAGEM_070); throw e; }
 if (!flow || flow.space_id !== spaceId) throw new Error('O fluxo não existe neste espaço.');
 if (flow.status === 'rascunho') throw new Error(`O fluxo "${flow.name}" está em rascunho: coloque em teste ou ativo para ele começar.`);
 if (flow.status === 'arquivado') throw new Error(`O fluxo "${flow.name}" está arquivado.`);

 let destino = numero ? normalizarNumero(String(numero)) : null;
 if (leadId) {
  const lead = await carregarLead(client, spaceId, leadId);
  destino = lead.numero;
  if (!destino) throw new Error('O lead não tem um WhatsApp válido: o fluxo não começou.');
 }
 if (!destino) throw new Error('Informe um número de WhatsApp válido.');
 const chaveFinal = chave ?? `fluxo:${flow.id}:${leadId ?? destino}:${automationId ?? 'manual'}:${evento ?? 'manual'}`;
 const r = await client.query(
  `INSERT INTO whatsapp_flow_runs(flow_id, space_id, lead_id, automation_id, idempotency_key, number, instance, steps, stop_on_reply, dry_run, input)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  [flow.id, spaceId, leadId, automationId, chaveFinal, destino, flow.instance, JSON.stringify(flow.steps), flow.stop_on_reply, flow.status === 'teste', JSON.stringify({ ...dados, ...(nome ? { nome_informado: String(nome).slice(0, 120) } : {}) })]);
 const modo = flow.status === 'teste' ? ' (modo de teste: nada será enviado)' : '';
 return r.rows.length ? `Fluxo "${previa(flow.name)}" iniciado para ${destino}${modo}` : `O fluxo "${previa(flow.name)}" já estava rodando para ${destino}`;
}
