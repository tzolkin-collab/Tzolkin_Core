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
 // Brasil com DDI: 55 + DDD (2) + número. Celular tem 9 dígitos e começa em 9; fixo tem 8 e começa em 2 a 5. Celular de 8 dígitos (6 a 9)
 // é o formato ANTIGO, e o WhatsApp ainda guarda muitas contas assim (o endereço da conversa vem com 12 dígitos). A Evolution resolve as duas
 // formas; recusar aqui travava a resposta a quem já conversava (o envio falhava sem nem chegar na Evolution).
 if (digitos.startsWith('55')) {
  const numero = digitos.slice(4);
  const ok = (numero.length === 9 && numero[0] === '9') || (numero.length === 8 && /^[2-9]/.test(numero));
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

const MIDIAS = Object.freeze(['image', 'video', 'audio', 'document']);
const PRESENCAS = Object.freeze(['available', 'unavailable', 'composing', 'recording']);
const MAX_MIDIA_BASE64 = 28_000_000;   // ~20 MB em base64
const texto = v => (typeof v === 'string' && v ? v : null);
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** URL https (sem usuário nem espaços) ou base64 (puro ou data URI) dentro do limite. */
const midiaValida = m => {
 if (typeof m !== 'string' || !m || m.length > MAX_MIDIA_BASE64) return false;
 if (/^https?:\/\//i.test(m)) { try { const u = new URL(m); return u.protocol === 'https:' && !u.username && !u.password && m.length <= 2000; } catch { return false; } }
 return /^(data:[a-z0-9.+\/-]+;base64,)?[A-Za-z0-9+/=\r\n]+$/i.test(m);
};

/** Webhook que o Core aceita configurar: https público, eventos em MAIÚSCULAS e cabeçalhos simples (o segredo vai num deles). */
const webhookValido = ({ url, events, headers } = {}) => {
 let u; try { u = new URL(String(url)); } catch { return null; }
 if (u.protocol !== 'https:' || u.username || u.password || u.hash || String(url).length > 500) return null;
 const lista = events == null ? ['MESSAGES_UPSERT'] : events;
 if (!Array.isArray(lista) || !lista.length || lista.length > 40 || lista.some(e => typeof e !== 'string' || !/^[A-Z][A-Z_]{2,59}$/.test(e))) return null;
 let cab;
 if (headers != null) {
  if (typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 10) return null;
  for (const [k, v] of Object.entries(headers)) if (!/^[A-Za-z0-9-]{1,60}$/.test(k) || typeof v !== 'string' || !v || v.length > 500 || /[\r\n]/.test(v)) return null;
  cab = { ...headers };
 }
 return { url: u.href, events: [...new Set(lista)], headers: cab };
};

/** Consulta de listagem (where/orderBy/take/skip) com limites: o servidor é de terceiros e a consulta vem de quem usa a tela. */
const consultaValida = ({ where, orderBy, take = 50, skip = 0 } = {}) => {
 if (!inteiro(take, 1, 200) || !inteiro(skip, 0, 100_000)) return null;
 for (const o of [where, orderBy]) if (o != null && (typeof o !== 'object' || Array.isArray(o) || JSON.stringify(o).length > 2000)) return null;
 return { ...(where ? { where } : {}), ...(orderBy ? { orderBy } : {}), take, skip };
};

/** Quem enviou: na 2.3.7 a mensagem NOSSA vem marcada em `key.fromMe` e o registro não tem `fromMe` (ler o campo de cima dava tudo como "dela"). */

/** Situação de entrega de uma mensagem nossa: a Evolution não manda `status` no registro, manda a lista `MessageUpdate`; vale a mais avançada. */
const ORDEM_DO_STATUS = ['PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED'];
const statusDe = x => {
 const lista = Array.isArray(x.MessageUpdate) ? x.MessageUpdate.map(u => u?.status) : [];
 const todos = [x.status, ...lista].filter(s => typeof s === 'string' && s);
 return todos.sort((a, b) => ORDEM_DO_STATUS.indexOf(b) - ORDEM_DO_STATUS.indexOf(a))[0] ?? null;
};

/** Consulta de histórico: `where`/`orderBy` com limite de tamanho, `page` de 1 a 10000 e `offset` (tamanho da página) de 1 a 100. */
const consultaDeMensagens = ({ where, orderBy, page = 1, offset = 50 } = {}) => {
 if (!inteiro(page, 1, 10_000) || !inteiro(offset, 1, 100)) return null;
 for (const o of [where, orderBy]) if (o != null && (typeof o !== 'object' || Array.isArray(o) || JSON.stringify(o).length > 2000)) return null;
 return { ...(where ? { where } : {}), ...(orderBy ? { orderBy } : {}), page, offset };
};

/** QR e código de pareamento: null quando a instância já está conectada (a Evolution devolve só `count`). */
const qrDe = q => {
 if (!q || typeof q !== 'object') return null;
 const base64 = texto(q.base64), code = texto(q.code), pairingCode = texto(q.pairingCode);
 return base64 || code || pairingCode ? { base64, code, pairingCode, count: Number.isInteger(q.count) ? q.count : null } : null;
};

/** Resposta de envio: o id da mensagem é o que a fila grava. */
const enviada = corpo => {
 const id = corpo?.key?.id;
 return typeof id === 'string' && id ? { ok: true, messageId: id, status: corpo?.status ?? null } : { ok: false, reason: 'invalid' };
};

// Todo método do adaptador, para o adaptador parado (sem configuração) responder igual em qualquer um.
const METODOS = Object.freeze(['listInstances', 'connectionState', 'sendText', 'createInstance', 'connect', 'restart', 'logout', 'deleteInstance', 'setPresence',
 'setWebhook', 'getWebhook', 'sendMedia', 'sendLocation', 'sendPoll', 'checkNumbers', 'findChats', 'findContacts', 'findMessages', 'archiveChat']);
const parado = reason => ({ configured: false, ...Object.fromEntries(METODOS.map(m => [m, async () => ({ ok: false, reason })])) });

export function createEvolutionAdapter({ env = process.env, fetchImpl = fetch, instance: escolhida } = {}) {
 const base = String(env.EVOLUTION_URL || '').trim();
 const name = String(escolhida || env.EVOLUTION_INSTANCE || '').trim();
 const key = String(env.EVOLUTION_API_KEY || '').trim();
 if (!base && !name && !key) return parado('not_configured');
 const origem = enderecoSeguro(base);
 if (!origem || !instancia(name) || !key || /[\r\n]/.test(key)) {
  return parado('invalid_config');
 }

 const chamar = async (metodo, caminho, corpo, { nulo = false } = {}) => {
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
   if (nulo && json === null) return { ok: true, body: null };
   return json && typeof json === 'object' ? { ok: true, body: json } : { ok: false, reason: 'invalid' };
  }
  const status = resposta.status;
  const erro = await resposta.json().catch(() => null);
  const bruta = erro?.error?.message ?? erro?.message ?? erro?.response?.message;
  const mensagem = (Array.isArray(bruta) ? bruta.join(' ') : typeof bruta === 'string' ? bruta : '').split(key).join('***').slice(0, 200);
  const reason = status === 401 || status === 403 ? 'unauthorized' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited'
   : status === 400 || status === 422 ? 'rejected' : status === 408 || status >= 500 ? 'unavailable' : 'rejected';
  return { ok: false, reason, status, ...(mensagem ? { message: mensagem } : {}) };
 };

 // Caminho de uma rota por instância: a escolhida na chamada ou a do adaptador; nome inválido não vai à rede.
 const rota = (prefixo, escolhida) => { const alvo = escolhida ?? name; return instancia(alvo) ? `${prefixo}/${encodeURIComponent(alvo)}` : null; };

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

  // ---------------------------------------------------------------------------------------------------------------------------
  // Gestão (F1). Corpos conforme a referência oficial da 2.3.7 (docs.evolutionfoundation.com.br); o que ela deixa em aberto fica de
  // fora (item de `markMessageAsRead`, `sendReaction`, `sendContact`) até conferir no servidor com scripts/evolution-smoke.mjs.
  // Os métodos de instância aceitam `instance` para escolher outra instância do mesmo servidor; sem ele, vale a do adaptador.
  // ---------------------------------------------------------------------------------------------------------------------------

  /** Cria uma instância (precisa da chave global). Devolve o QR/código de pareamento e o token da instância (SEGREDO: guardar cifrado). */
  async createInstance({ name: nova, number, webhook, qrcode = true } = {}) {
   if (!instancia(nova)) return { ok: false, reason: 'rejected', detail: 'invalid_name' };
   let numero;
   if (number != null && number !== '') { numero = normalizarNumero(String(number)); if (!numero) return { ok: false, reason: 'rejected', detail: 'invalid_number' }; }
   const corpo = { instanceName: nova, qrcode: qrcode !== false, integration: 'WHATSAPP-BAILEYS', ...(numero ? { number: numero } : {}) };
   if (webhook) {
    const w = webhookValido(webhook);
    if (!w) return { ok: false, reason: 'rejected', detail: 'invalid_webhook' };
    corpo.webhook = { enabled: true, url: w.url, events: w.events };
   }
   const r = await chamar('POST', '/instance/create', corpo);
   if (!r.ok) return r.reason === 'unauthorized' && r.status === 403 && /already|em uso|exist/i.test(r.message ?? '') ? { ...r, reason: 'conflict' } : r;
   const i = r.body.instance ?? {}, hash = r.body.hash;
   return { ok: true, instance: { name: String(i.instanceName ?? nova), id: texto(i.instanceId), status: texto(i.status) }, token: texto(typeof hash === 'string' ? hash : hash?.apikey), qr: qrDe(r.body.qrcode) };
  },

  /** QR e código de pareamento de uma instância desconectada. `qr` é null quando ela já está conectada. */
  async connect({ instance: escolhida } = {}) {
   const c = rota('/instance/connect', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('GET', c);
   return r.ok ? { ok: true, qr: qrDe(r.body) } : r;
  },

  async restart({ instance: escolhida } = {}) {
   const c = rota('/instance/restart', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c);
   return r.ok ? (r.body.error === true ? { ok: false, reason: 'rejected' } : { ok: true }) : r;
  },

  async logout({ instance: escolhida } = {}) {
   const c = rota('/instance/logout', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('DELETE', c);
   return r.ok ? { ok: r.body.success !== false } : r;
  },

  /** Apaga a instância no servidor da Evolution. Irreversível: quem chama pede confirmação. */
  async deleteInstance({ instance: escolhida } = {}) {
   const c = rota('/instance/delete', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('DELETE', c);
   return r.ok ? (r.body.success === false ? { ok: false, reason: 'rejected' } : { ok: true }) : r;
  },

  async setPresence({ presence, instance: escolhida } = {}) {
   if (!PRESENCAS.includes(presence)) return { ok: false, reason: 'rejected', detail: 'invalid_presence' };
   const c = rota('/instance/setPresence', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, { presence });
   return r.ok ? { ok: r.body.success !== false } : r;
  },

  /** Aponta o webhook da instância para o Core. `headers` leva o segredo (ex.: x-webhook-secret); nada daqui vai para log. */
  async setWebhook({ url, events, headers, enabled = true, instance: escolhida } = {}) {
   const w = webhookValido({ url, events, headers });
   if (!w) return { ok: false, reason: 'rejected', detail: 'invalid_webhook' };
   const c = rota('/webhook/set', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   // O servidor 2.3.7 EXIGE o objeto `webhook` (400 "instance requires property webhook" com o corpo plano que a doc mostra).
   const r = await chamar('POST', c, { webhook: { enabled: enabled !== false, url: w.url, events: w.events, byEvents: false, base64: false, ...(w.headers ? { headers: w.headers } : {}) } });
   return r.ok ? { ok: r.body.success !== false } : r;
  },

  /** Webhook atual. `webhook` é null se não houver. Só os NOMES dos cabeçalhos saem (nunca o valor do segredo). */
  async getWebhook({ instance: escolhida } = {}) {
   const c = rota('/webhook/find', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('GET', c, undefined, { nulo: true });
   if (!r.ok) return r;
   const w = r.body;
   if (!w || typeof w !== 'object') return { ok: true, webhook: null };
   return { ok: true, webhook: { enabled: w.enabled !== false, url: texto(w.url), events: Array.isArray(w.events) ? w.events.map(String) : [], headerNames: w.headers && typeof w.headers === 'object' ? Object.keys(w.headers) : [] } };
  },

  /** Mídia por URL https ou base64. `mediatype`: image, video, audio ou document. */
  async sendMedia({ number, mediatype, media, caption, fileName, mimetype, instance: escolhida } = {}) {
   const destino = normalizarNumero(number);
   if (!destino) return { ok: false, reason: 'rejected', detail: 'invalid_number' };
   if (!MIDIAS.includes(mediatype)) return { ok: false, reason: 'rejected', detail: 'invalid_media_type' };
   if (!midiaValida(media)) return { ok: false, reason: 'rejected', detail: 'invalid_media' };
   if (caption != null && (typeof caption !== 'string' || caption.length > 1024)) return { ok: false, reason: 'rejected', detail: 'invalid_text' };
   if (fileName != null && (typeof fileName !== 'string' || !/^[^\\/\r\n]{1,200}$/.test(fileName))) return { ok: false, reason: 'rejected', detail: 'invalid_file_name' };
   if (mimetype != null && (typeof mimetype !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimetype))) return { ok: false, reason: 'rejected', detail: 'invalid_mimetype' };
   const c = rota('/message/sendMedia', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, { number: destino, mediatype, media, ...(mimetype ? { mimetype } : {}), ...(caption ? { caption } : {}), ...(fileName ? { fileName } : {}) });
   return r.ok ? enviada(r.body) : r;
  },

  async sendLocation({ number, latitude, longitude, name: nomeLocal, address, instance: escolhida } = {}) {
   const destino = normalizarNumero(number);
   if (!destino) return { ok: false, reason: 'rejected', detail: 'invalid_number' };
   if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { ok: false, reason: 'rejected', detail: 'invalid_location' };
   for (const t of [nomeLocal, address]) if (t != null && (typeof t !== 'string' || t.length > 300)) return { ok: false, reason: 'rejected', detail: 'invalid_text' };
   const c = rota('/message/sendLocation', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, { number: destino, latitude, longitude, ...(nomeLocal ? { name: nomeLocal } : {}), ...(address ? { address } : {}) });
   return r.ok ? enviada(r.body) : r;
  },

  async sendPoll({ number, name: pergunta, values, selectableCount = 1, instance: escolhida } = {}) {
   const destino = normalizarNumero(number);
   if (!destino) return { ok: false, reason: 'rejected', detail: 'invalid_number' };
   if (typeof pergunta !== 'string' || !pergunta.trim() || pergunta.length > 255) return { ok: false, reason: 'rejected', detail: 'invalid_text' };
   if (!Array.isArray(values) || values.length < 2 || values.length > 12 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 100)) return { ok: false, reason: 'rejected', detail: 'invalid_options' };
   if (!Number.isInteger(selectableCount) || selectableCount < 1 || selectableCount > values.length) return { ok: false, reason: 'rejected', detail: 'invalid_options' };
   const c = rota('/message/sendPoll', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, { number: destino, name: pergunta, selectableCount, values });
   return r.ok ? enviada(r.body) : r;
  },

  /** Quais números têm WhatsApp (até 50 por chamada). Número fora do formato volta como `exists: false`, sem ir ao servidor. */
  async checkNumbers({ numbers, instance: escolhida } = {}) {
   if (!Array.isArray(numbers) || !numbers.length || numbers.length > 50) return { ok: false, reason: 'rejected', detail: 'invalid_numbers' };
   const normalizados = numbers.map(n => normalizarNumero(typeof n === 'string' ? n : ''));
   const validos = [...new Set(normalizados.filter(Boolean))];
   const c = rota('/chat/whatsappNumbers', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   let achados = new Map();
   if (validos.length) {
    const r = await chamar('POST', c, { numbers: validos });
    if (!r.ok) return r;
    if (!Array.isArray(r.body.numbers)) return { ok: false, reason: 'invalid' };
    achados = new Map(r.body.numbers.map(x => [String(x?.number ?? ''), x?.exists === true]));
   }
   return { ok: true, numbers: numbers.map((original, i) => ({ number: normalizados[i] ?? null, exists: normalizados[i] ? achados.get(normalizados[i]) ?? false : false, input: typeof original === 'string' ? original.slice(0, 40) : null })) };
  },

  async findChats({ instance: escolhida, ...consulta } = {}) {
   const q = consultaValida(consulta); if (!q) return { ok: false, reason: 'rejected', detail: 'invalid_query' };
   const c = rota('/chat/findChats', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, q);
   if (!r.ok) return r;
   return Array.isArray(r.body) ? { ok: true, chats: r.body.filter(x => x && typeof x === 'object') } : { ok: false, reason: 'invalid' };
  },

  async findContacts({ instance: escolhida, ...consulta } = {}) {
   const q = consultaValida(consulta); if (!q) return { ok: false, reason: 'rejected', detail: 'invalid_query' };
   const c = rota('/chat/findContacts', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, q);
   if (!r.ok) return r;
   return !Array.isArray(r.body) ? { ok: false, reason: 'invalid' } : { ok: true, contacts: r.body.filter(x => x && typeof x === 'object').map(x => ({ id: texto(x.id), pushName: texto(x.pushName), number: texto(x.number), profilePictureUrl: texto(x.profilePictureUrl) })) };
  },

  /** Histórico. O filtro vai em `where` (ex.: `{ key: { remoteJid: '5531...@s.whatsapp.net' } }`); a sintaxe exata é do servidor. */
  async findMessages({ instance: escolhida, where, orderBy, page = 1, offset = 50 } = {}) {
   // Na 2.3.7 `offset` é o TAMANHO da página e `page` o número dela (a partir de 1); `take` e `skip` do corpo são ignorados. Vem da mais nova para a mais antiga.
   const q = consultaDeMensagens({ where, orderBy, page, offset }); if (!q) return { ok: false, reason: 'rejected', detail: 'invalid_query' };
   const c = rota('/chat/findMessages', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, q);
   if (!r.ok) return r;
   const m = r.body.messages;
   if (!m || typeof m !== 'object' || !Array.isArray(m.records)) return { ok: false, reason: 'invalid' };
   return { ok: true, total: Number(m.total) || 0, pages: Number(m.pages) || 0, page: Number(m.currentPage) || 1,
    messages: m.records.filter(x => x && typeof x === 'object').map(x => ({ id: texto(x.id), key: x.key && typeof x.key === 'object' ? x.key : null, fromMe: (x.key?.fromMe ?? x.fromMe) === true, messageType: texto(x.messageType), status: statusDe(x), timestamp: Number.isFinite(Number(x.messageTimestamp ?? x.timestamp)) && (x.messageTimestamp ?? x.timestamp) != null ? Number(x.messageTimestamp ?? x.timestamp) : null, message: x.message && typeof x.message === 'object' ? x.message : null })) };
  },

  /** Arquiva ou desarquiva a conversa com um número. */
  async archiveChat({ number, archive, instance: escolhida } = {}) {
   const destino = normalizarNumero(number);
   if (!destino) return { ok: false, reason: 'rejected', detail: 'invalid_number' };
   if (typeof archive !== 'boolean') return { ok: false, reason: 'rejected', detail: 'invalid_archive' };
   const c = rota('/chat/archiveChat', escolhida); if (!c) return { ok: false, reason: 'invalid_config' };
   const r = await chamar('POST', c, { number: destino, archive });
   return r.ok ? { ok: r.body.success !== false } : r;
  },
 };
}

/**
 * As mensagens de UMA PESSOA. O WhatsApp pode guardar a mesma pessoa em dois endereços: o que enviamos fica em `<telefone>@s.whatsapp.net` e o que
 * ela responde em `<id>@lid`, ligado ao telefone por `key.remoteJidAlt`. Ler só o telefone mostra a conversa de um lado só (e um fluxo nunca
 * perceberia a resposta). Com o telefone, busca pelos dois endereços e junta, da mais nova para a mais antiga. Sem telefone, só pelo `jid`.
 * A busca principal decide o erro; a pelo `remoteJidAlt` que falha é ignorada.
 */
export async function mensagensDaPessoa(adaptador, { telefone = null, jid = null, page = 1, offset = 40 }) {
 const chaves = telefone ? [{ remoteJid: `${telefone}@s.whatsapp.net` }, { remoteJidAlt: `${telefone}@s.whatsapp.net` }] : [{ remoteJid: jid }];
 const rs = await Promise.all(chaves.map(key => adaptador.findMessages({ where: { key }, page, offset })));
 if (!rs[0].ok) return rs[0];
 const vistas = new Set(), messages = [];
 for (const r of rs.filter(x => x.ok)) for (const m of r.messages) { const k = m.id ?? m.key?.id; if (k && vistas.has(k)) continue; if (k) vistas.add(k); messages.push(m); }
 messages.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
 const oks = rs.filter(x => x.ok);
 return { ok: true, total: oks.reduce((n, r) => n + r.total, 0), pages: Math.max(...oks.map(r => r.pages)), page, messages };
}
