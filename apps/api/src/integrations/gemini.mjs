import { randomUUID } from 'node:crypto';

// Gemini (API generateContent do Google AI Studio): a mesma interface do adaptador da Anthropic (integrations/anthropic.mjs), para o motor dos
// agentes (platform/agentes-motor.mjs) conversar com qualquer um dos dois sem mudar. Serve para testar com a chave gratuita do AI Studio.
// Só servidor; a chave vai no cabeçalho `x-goog-api-key` (nunca na URL, que cai em log) e nunca entra em resultado.
//
// O motor fala no formato da Anthropic (mensagens com blocos text, tool_use e tool_result); aqui isso vira o formato do Gemini (contents com
// parts text, functionCall e functionResponse) e a resposta volta ao formato do motor. Motivos de falha, como nos outros adaptadores:
//   unauthorized  chave recusada (401/403, ou 400 "API key not valid")   rejected   o Gemini recusou ESTE pedido (400/404/413/422): não repete
//   rate_limited  429 (a camada gratuita estoura fácil): repete depois    unavailable  rede, timeout ou 5xx: repete
//   invalid       resposta fora do formato                                 not_configured / invalid_config  falta ou está ruim a chave

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const TIMEOUT_MS = 60_000;
const CHAVE = /^[\x21-\x7e]{20,300}$/;
const MODELO = /^gemini-[a-z0-9][a-z0-9.-]{1,60}$/;
// O modelo pode gastar parte do limite pensando; com 1024 a resposta saía cortada.
const PISO_DE_SAIDA = 2048;
// O Gemini aceita só um subconjunto do esquema JSON: as demais palavras fazem ele recusar o pedido inteiro.
const ESQUEMA_ACEITO = new Set(['type', 'properties', 'required', 'description', 'enum', 'items', 'minimum', 'maximum', 'format', 'nullable']);

/** Esquema de ferramenta (formato Anthropic/JSON Schema) sem o que o Gemini recusa (additionalProperties, maxLength...). */
export function limparEsquema(e) {
 if (Array.isArray(e)) return e.map(limparEsquema);
 if (!e || typeof e !== 'object') return e;
 const saida = {};
 for (const [k, v] of Object.entries(e)) {
  if (k === 'properties' && v && typeof v === 'object') saida.properties = Object.fromEntries(Object.entries(v).map(([nome, sub]) => [nome, limparEsquema(sub)]));
  else if (ESQUEMA_ACEITO.has(k)) saida[k] = k === 'items' ? limparEsquema(v) : v;
 }
 return saida;
}

/** `tools` do motor (name, description, input_schema) para `functionDeclarations`. Ferramenta sem campos fica sem `parameters` (o Gemini recusa objeto vazio). */
export function declaracoes(tools) {
 return (tools ?? []).map(t => {
  const parametros = limparEsquema(t.input_schema);
  const temCampos = parametros?.properties && Object.keys(parametros.properties).length > 0;
  return { name: t.name, description: String(t.description ?? '').slice(0, 1000), ...(temCampos ? { parameters: parametros } : {}) };
 });
}

/** Resultado de ferramenta (texto JSON do motor) como objeto, que é o que o Gemini exige em `functionResponse.response`. */
const comoObjeto = (conteudo, erro) => {
 if (erro) return { error: String(conteudo ?? '') };
 try { const v = JSON.parse(String(conteudo)); return v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v }; } catch { return { result: String(conteudo ?? '') }; }
};

/** Conversa do motor (formato Anthropic) para `contents` do Gemini. Mensagens seguidas do mesmo papel viram uma só. */
export function paraContents(messages) {
 const nomes = new Map();   // tool_use_id -> nome da ferramenta (o Gemini responde pelo NOME, não pelo id)
 const contents = [];
 const juntar = (role, parts) => { if (!parts.length) return; const ultimo = contents.at(-1); if (ultimo?.role === role) ultimo.parts.push(...parts); else contents.push({ role, parts }); };
 for (const m of messages) {
  const papel = m.role === 'assistant' ? 'model' : 'user';
  if (typeof m.content === 'string') { if (m.content.trim()) juntar(papel, [{ text: m.content }]); continue; }
  const parts = [];
  for (const b of Array.isArray(m.content) ? m.content : []) {
   if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push({ text: b.text });
   else if (b?.type === 'tool_use') { nomes.set(b.id, b.name); parts.push({ functionCall: { name: b.name, args: b.input && typeof b.input === 'object' ? b.input : {} }, ...(b.thoughtSignature ? { thoughtSignature: b.thoughtSignature } : {}) }); }
   else if (b?.type === 'tool_result') parts.push({ functionResponse: { name: nomes.get(b.tool_use_id) ?? 'ferramenta', response: comoObjeto(b.content, b.is_error) } });
  }
  juntar(papel, parts);
 }
 return contents;
}

/** Resposta do Gemini para o formato do motor: { content: [text | tool_use], stopReason, usage }. Pensamento (`thought`) não vira texto. */
export function deResposta(corpo) {
 const candidato = corpo?.candidates?.[0];
 const partes = Array.isArray(candidato?.content?.parts) ? candidato.content.parts : [];
 const content = [];
 for (const p of partes) {
  if (p?.functionCall?.name) content.push({ type: 'tool_use', id: `gem_${randomUUID().slice(0, 12)}`, name: String(p.functionCall.name), input: p.functionCall.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {}, ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) });
  else if (typeof p?.text === 'string' && p.thought !== true && p.text) content.push({ type: 'text', text: p.text });
 }
 const u = corpo?.usageMetadata ?? {};
 return {
  content,
  stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : candidato?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
  usage: { input: Number(u.promptTokenCount) || 0, output: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0) },
 };
}

export function createGeminiAdapter({ env = process.env, fetchImpl = fetch } = {}) {
 const chave = String(env.GEMINI_API_KEY || '').trim();
 if (!chave) { const nao = async () => ({ ok: false, reason: 'not_configured' }); return { configured: false, messages: nao, listModels: nao }; }
 if (!CHAVE.test(chave)) { const ruim = async () => ({ ok: false, reason: 'invalid_config' }); return { configured: false, messages: ruim, listModels: ruim }; }

 const chamar = async (metodo, caminho, corpo) => {
  let r;
  try {
   r = await fetchImpl(`${URL_BASE}${caminho}`, {
    method: metodo, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'x-goog-api-key': chave, accept: 'application/json', ...(corpo ? { 'content-type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
   });
  } catch { return { ok: false, reason: 'unavailable' }; }
  if (r.ok) { const json = await r.json().catch(() => null); return json && typeof json === 'object' ? { ok: true, body: json } : { ok: false, reason: 'invalid' }; }
  const s = r.status;
  const erro = await r.json().catch(() => null);
  const texto = String(erro?.error?.message ?? '');
  // O Gemini responde 400 (e não 401) para chave errada.
  const reason = s === 401 || s === 403 || (s === 400 && /api key/i.test(texto)) ? 'unauthorized' : s === 429 ? 'rate_limited' : s === 400 || s === 404 || s === 413 || s === 422 ? 'rejected' : s === 408 || s >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, reason, status: s, ...(texto ? { message: texto.split(chave).join('***').slice(0, 200) } : {}) };
 };

 return {
  configured: true,

  /** Uma volta da conversa. `tools` no formato do motor (Anthropic). Devolve { ok, content, stopReason, usage }, como o adaptador da Anthropic. */
  async messages({ model, system, messages, tools, maxTokens = 1024 }) {
   if (typeof model !== 'string' || !MODELO.test(model) || !Array.isArray(messages) || !messages.length) return { ok: false, reason: 'rejected' };
   const contents = paraContents(messages);
   if (!contents.length) return { ok: false, reason: 'rejected' };
   const funcoes = declaracoes(tools);
   const r = await chamar('POST', `/models/${model}:generateContent`, {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(funcoes.length ? { tools: [{ functionDeclarations: funcoes }] } : {}),
    generationConfig: { maxOutputTokens: Math.max(maxTokens, PISO_DE_SAIDA) },
   });
   if (!r.ok) return r;
   if (r.body.promptFeedback?.blockReason) return { ok: false, reason: 'rejected', message: `bloqueado: ${String(r.body.promptFeedback.blockReason).slice(0, 40)}` };
   if (!Array.isArray(r.body.candidates)) return { ok: false, reason: 'invalid' };
   return { ok: true, ...deResposta(r.body) };
  },

  /** Confere a chave sem gastar nada: lista os modelos que ela enxerga e aceitam gerar conteúdo. */
  async listModels() {
   const r = await chamar('GET', '/models?pageSize=100');
   if (!r.ok) return r;
   const lista = Array.isArray(r.body.models) ? r.body.models : null;
   return lista ? { ok: true, models: lista.filter(m => (m?.supportedGenerationMethods ?? []).includes('generateContent')).map(m => String(m?.name ?? '').replace(/^models\//, '')).filter(Boolean) } : { ok: false, reason: 'invalid' };
  },
 };
}
