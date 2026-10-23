// Claude (API de mensagens da Anthropic): uma chamada de conversa, com ferramentas. Só servidor; a chave nunca sai daqui nem entra em log.
//
// Mesmo desenho dos outros adaptadores: cada método devolve `{ ok, ... }` e, se falhou, `reason` (um motivo estável que a fila de turnos usa
// para decidir entre tentar de novo e desistir), sem nunca lançar por falha de rede.
//
//   unauthorized  chave recusada (401/403)         rejected      a Anthropic recusou ESTE pedido (400/413/422): não repete
//   rate_limited  429: repete mais tarde           unavailable   rede, timeout, 5xx ou 529 (sobrecarga): repete
//   invalid       resposta fora do formato         not_configured / invalid_config  falta ou está ruim a chave

const URL_BASE = 'https://api.anthropic.com';
const VERSAO = '2023-06-01';
const TIMEOUT_MS = 60_000;
const CHAVE = /^[\x21-\x7e]{20,300}$/;

export function createAnthropicAdapter({ env = process.env, fetchImpl = fetch } = {}) {
 const chave = String(env.ANTHROPIC_API_KEY || '').trim();
 if (!chave) { const nao = async () => ({ ok: false, reason: 'not_configured' }); return { configured: false, messages: nao, listModels: nao }; }
 if (!CHAVE.test(chave)) { const ruim = async () => ({ ok: false, reason: 'invalid_config' }); return { configured: false, messages: ruim, listModels: ruim }; }

 const chamar = async (metodo, caminho, corpo) => {
  let r;
  try {
   r = await fetchImpl(`${URL_BASE}${caminho}`, {
    method: metodo, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'x-api-key': chave, 'anthropic-version': VERSAO, accept: 'application/json', ...(corpo ? { 'content-type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
   });
  } catch { return { ok: false, reason: 'unavailable' }; }
  if (r.ok) { const json = await r.json().catch(() => null); return json && typeof json === 'object' ? { ok: true, body: json } : { ok: false, reason: 'invalid' }; }
  const s = r.status;
  const reason = s === 401 || s === 403 ? 'unauthorized' : s === 429 ? 'rate_limited' : s === 400 || s === 413 || s === 422 ? 'rejected' : s === 408 || s === 529 || s >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, reason, status: s };
 };

 return {
  configured: true,

  /** Uma volta da conversa. `tools` no formato da Anthropic. Devolve { ok, content, stopReason, usage } com `content` já validado. */
  async messages({ model, system, messages, tools, maxTokens = 1024 }) {
   if (typeof model !== 'string' || !Array.isArray(messages) || !messages.length) return { ok: false, reason: 'rejected' };
   const r = await chamar('POST', '/v1/messages', { model, max_tokens: maxTokens, ...(system ? { system } : {}), messages, ...(tools?.length ? { tools } : {}) });
   if (!r.ok) return r;
   const content = r.body.content;
   if (!Array.isArray(content)) return { ok: false, reason: 'invalid' };
   return { ok: true, content, stopReason: r.body.stop_reason ?? null, usage: { input: Number(r.body.usage?.input_tokens) || 0, output: Number(r.body.usage?.output_tokens) || 0 } };
  },

  /** Confere a chave sem gastar nada: lista os modelos que ela enxerga. */
  async listModels() {
   const r = await chamar('GET', '/v1/models?limit=100');
   if (!r.ok) return r;
   const dados = Array.isArray(r.body.data) ? r.body.data : null;
   return dados ? { ok: true, models: dados.map(m => String(m?.id ?? '')).filter(Boolean) } : { ok: false, reason: 'invalid' };
  },
 };
}
