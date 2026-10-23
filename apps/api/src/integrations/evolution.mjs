// Evolution API (WhatsApp) v2: envio de texto e estado da conexão. Só servidor; a chave nunca sai daqui nem entra em log.
//
// O Core fala com UMA Evolution (EVOLUTION_URL), por padrão pela instância EVOLUTION_INSTANCE; `instance` escolhe outra do mesmo servidor. Cada método devolve um objeto com `ok` e, se
// falhou, `reason` (um motivo estável, que a fila usa para decidir entre tentar de novo e desistir), sem nunca lançar por falha de rede.
//
//   unauthorized  chave recusada (401/403): não adianta tentar de novo
//   not_found     instância inexistente (404)
//   rejected      a Evolution recusou ESTA mensagem (400/422), por exemplo número que não tem WhatsApp: não repete
//   rate_limited  429: repete mais tarde
//   unavailable   rede, timeout ou 5xx: repete
//   invalid       resposta fora do formato esperado
//   not_configured / invalid_config  faltam ou estão ruins as variáveis

const TIMEOUT_MS = 10_000;
const MAX_TEXT = 4096;

/**
 * Número como a Evolution espera: só dígitos, com DDI. Sem DDI, assume Brasil (55). Devolve null se não parece um telefone.
 * Aceita "(31) 99759-9216", "31997599216", "+55 31 99759-9216" e "5531997599216".
 */
export function normalizarNumero(valor) {
 if (typeof valor !== 'string') return null;
 let digitos = valor.replace(/[\s()+.\-]/g, '');
 if (!/^\d+$/.test(digitos)) return null;
 digitos = digitos.replace(/^0+/, '');
 // 10 ou 11 dígitos = DDD + número do Brasil, sem DDI.
 if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
 if (digitos.length < 10 || digitos.length > 15) return null;
 // Brasil com DDI: 55 + DDD (2) + número. Celular tem 9 dígitos e começa em 9; fixo tem 8 e começa em 2 a 5. Um celular com
 // um dígito a menos (8 dígitos começando em 9) não existe mais e a Evolution só responderia que o número não tem WhatsApp.
 if (digitos.startsWith('55')) {
  const numero = digitos.slice(4);
  const ok = (numero.length === 9 && numero[0] === '9') || (numero.length === 8 && /^[2-5]/.test(numero));
  if (!ok) return null;
 }
 return digitos;
}

const instancia = valor => typeof valor === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(valor);
const enderecoSeguro = valor => {
 let u;
 try { u = new URL(valor); } catch { return null; }
 const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
 if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.search || u.hash) return null;
 return u;
};

export function createEvolutionAdapter({ env = process.env, fetchImpl = fetch, instance: escolhida } = {}) {
 const base = String(env.EVOLUTION_URL || '').trim();
 const name = String(escolhida || env.EVOLUTION_INSTANCE || '').trim();
 const key = String(env.EVOLUTION_API_KEY || '').trim();
 if (!base && !name && !key) return { configured: false, async connectionState() { return { ok: false, reason: 'not_configured' }; }, async sendText() { return { ok: false, reason: 'not_configured' }; }, async listInstances() { return { ok: false, reason: 'not_configured' }; } };
 const origem = enderecoSeguro(base);
 if (!origem || !instancia(name) || !key || /[\r\n]/.test(key)) {
  const invalido = async () => ({ ok: false, reason: 'invalid_config' });
  return { configured: false, connectionState: invalido, sendText: invalido, listInstances: invalido };
 }

 const chamar = async (metodo, caminho, corpo) => {
  let resposta;
  try {
   resposta = await fetchImpl(new URL(caminho, origem), {
    method: metodo, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { apikey: key, accept: 'application/json', ...(corpo ? { 'content-type': 'application/json' } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
   });
  } catch { return { ok: false, reason: 'unavailable' }; }
  if (resposta.ok) {
   const json = await resposta.json().catch(() => null);
   return json && typeof json === 'object' ? { ok: true, body: json } : { ok: false, reason: 'invalid' };
  }
  const status = resposta.status;
  const reason = status === 401 || status === 403 ? 'unauthorized' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited'
   : status === 400 || status === 422 ? 'rejected' : status === 408 || status >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, reason, status };
 };

 return {
  configured: true,
  instance: name,

  /**
   * Instâncias do servidor (precisa da chave global da Evolution; com a chave de uma instância só, a Evolution recusa e o Core usa só a padrão).
   * Aceita os dois formatos que a Evolution devolve: o v2 (um objeto por instância) e o antigo (`{ instance: { instanceName, status } }`).
   */
  async listInstances() {
   const r = await chamar('GET', '/instance/fetchInstances');
   if (!r.ok) return r;
   const lista = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.instances) ? r.body.instances : null;
   if (!lista) return { ok: false, reason: 'invalid' };
   const instancias = lista.map(i => {
    const d = i?.instance && typeof i.instance === 'object' ? i.instance : i, nome = String(d?.name ?? d?.instanceName ?? '');
    const numero = String(d?.ownerJid ?? d?.owner ?? d?.number ?? '').replace(/@.*$/, '').replace(/\D/g, '');
    return { name: nome, state: String(d?.connectionStatus ?? d?.status ?? 'close'), number: numero || null, profile: typeof d?.profileName === 'string' ? d.profileName : null };
   }).filter(i => instancia(i.name));
   return { ok: true, instances: instancias };
  },

  /** `open` = WhatsApp conectado e pronto para enviar. */
  async connectionState() {
   const r = await chamar('GET', `/instance/connectionState/${encodeURIComponent(name)}`);
   if (!r.ok) return r;
   const state = r.body?.instance?.state ?? r.body?.state;
   return typeof state === 'string' ? { ok: true, state, connected: state === 'open' } : { ok: false, reason: 'invalid' };
  },

  /** Envia um texto. `number` pode vir em qualquer formato comum; é normalizado aqui. */
  async sendText({ number, text }) {
   const destino = normalizarNumero(number);
   if (!destino) return { ok: false, reason: 'rejected', detail: 'invalid_number' };
   if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { ok: false, reason: 'rejected', detail: 'invalid_text' };
   const r = await chamar('POST', `/message/sendText/${encodeURIComponent(name)}`, { number: destino, text });
   if (!r.ok) return r;
   const id = r.body?.key?.id;
   return typeof id === 'string' && id ? { ok: true, messageId: id, status: r.body?.status ?? null } : { ok: false, reason: 'invalid' };
  },
 };
}
