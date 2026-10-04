// Google Agenda e Meet: a parte que fala com o Google. Sem banco, sem rota; `fetcher` entra por parâmetro para os testes não saírem da máquina.
//
// O que o Core guarda: SÓ o refresh token, cifrado (platform/secrets.mjs). O token de acesso dura ~1 h e é pedido na hora de usar.
// Escopo mínimo: eventos do calendário (criar/alterar/apagar). Não lê a agenda da pessoa.
// O mesmo cliente OAuth do login (GOOGLE_CLIENT_ID/SECRET), com outro endereço de retorno.

export const ESCOPOS = Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/calendar.events']);
export const ENDERECO_DE_RETORNO = '/api/google/calendar/callback';
const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOGAR = 'https://oauth2.googleapis.com/revoke';
const CALENDARIO = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const FUSO = 'America/Sao_Paulo';

export const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/;

/** Erro do Google já em português e com `status` para a rota. `reconectar` = o token não vale mais (revogado ou vencido). */
export class ErroGoogle extends Error {
 constructor(mensagem, { status = 502, reconectar = false } = {}) { super(mensagem); this.status = status; this.reconectar = reconectar; }
}

export function urlDeAutorizacao({ clientId, redirectUri, state, challenge, email = null }) {
 const u = new URL(AUTORIZAR);
 for (const [k, v] of Object.entries({
  client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: ESCOPOS.join(' '), state,
  code_challenge: challenge, code_challenge_method: 'S256',
  // offline + consent: sem isso o Google só devolve refresh token na PRIMEIRA autorização da conta.
  access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  ...(email ? { login_hint: email } : {}),
 })) u.searchParams.set(k, v);
 return u.href;
}

const json = async r => { try { return await r.json(); } catch { return {}; } };

async function pedirToken(corpo, fetcher) {
 const r = await fetcher(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(corpo), redirect: 'error', signal: AbortSignal.timeout(10000) });
 const d = await json(r);
 if (!r.ok) {
  const revogado = d.error === 'invalid_grant';
  throw new ErroGoogle(revogado ? 'A conexão com o Google expirou ou foi revogada. Conecte de novo em Configurações → Integrações.' : 'O Google recusou o pedido de autorização.', { status: revogado ? 409 : 502, reconectar: revogado });
 }
 return d;
}

/** Troca o código do retorno por tokens. Devolve o e-mail da conta (lido do id_token, que veio direto do Google por TLS). */
export async function trocarCodigo({ clientId, clientSecret, code, verifier, redirectUri, fetcher = fetch }) {
 const d = await pedirToken({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }, fetcher);
 if (!d.refresh_token) throw new ErroGoogle('O Google não devolveu a permissão de uso contínuo. Tente conectar de novo.');
 const escopos = String(d.scope || '').split(' ').filter(Boolean);
 if (!escopos.includes(ESCOPOS[2])) throw new ErroGoogle('A permissão de criar eventos na agenda não foi concedida.', { status: 409 });
 let email = null;
 try { email = JSON.parse(Buffer.from(String(d.id_token).split('.')[1], 'base64url').toString('utf8')).email ?? null; } catch { /* sem e-mail: a tela só não o mostra */ }
 return { refreshToken: d.refresh_token, escopos, email };
}

export async function tokenDeAcesso({ clientId, clientSecret, refreshToken, fetcher = fetch }) {
 const d = await pedirToken({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetcher);
 return d.access_token;
}

export async function revogar({ token, fetcher = fetch }) {
 try { await fetcher(REVOGAR, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(8000) }); } catch { /* o Core esquece o token de qualquer forma */ }
}

const cabecalho = acesso => ({ authorization: `Bearer ${acesso}`, 'content-type': 'application/json' });

async function chamar(url, opcoes, fetcher) {
 const r = await fetcher(url, { ...opcoes, redirect: 'error', signal: AbortSignal.timeout(15000) });
 if (r.status === 204) return {};
 const d = await json(r);
 if (!r.ok) {
  if (r.status === 401) throw new ErroGoogle('A conexão com o Google expirou. Conecte de novo em Configurações → Integrações.', { status: 409, reconectar: true });
  if (r.status === 403) throw new ErroGoogle('O Google não permitiu criar o evento nesta conta (permissão ou limite).', { status: 502 });
  if (r.status === 404 || r.status === 410) throw new ErroGoogle('O evento não existe mais no Google Agenda.', { status: 404 });
  throw new ErroGoogle('O Google Agenda não respondeu como esperado. Tente de novo.');
 }
 return d;
}

const corpoDoEvento = ({ titulo, descricao, local, inicio, fim, convidados }) => ({
 summary: titulo,
 ...(descricao ? { description: descricao } : {}),
 ...(local ? { location: local } : {}),
 start: { dateTime: new Date(inicio).toISOString(), timeZone: FUSO },
 end: { dateTime: new Date(fim).toISOString(), timeZone: FUSO },
 ...(convidados?.length ? { attendees: convidados.map(email => ({ email })) } : {}),
});

/** O link do Meet: normalmente já vem na criação; se a sala ainda está sendo preparada, pergunta mais algumas vezes. */
const linkDoMeet = e => e.hangoutLink || e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri || null;

export async function criarEventoComMeet({ acesso, evento, requestId, fetcher = fetch, esperar = ms => new Promise(r => setTimeout(r, ms)) }) {
 const corpo = { ...corpoDoEvento(evento), conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } };
 let e = await chamar(`${CALENDARIO}?conferenceDataVersion=1&sendUpdates=${evento.convidados?.length ? 'all' : 'none'}`, { method: 'POST', headers: cabecalho(acesso), body: JSON.stringify(corpo) }, fetcher);
 for (let i = 0; i < 3 && !linkDoMeet(e); i++) {
  await esperar(700);
  e = await chamar(`${CALENDARIO}/${encodeURIComponent(e.id)}?conferenceDataVersion=1`, { headers: cabecalho(acesso) }, fetcher);
 }
 const link = linkDoMeet(e);
 if (!link) throw new ErroGoogle('O evento foi criado no Google Agenda, mas o Google ainda não devolveu o link do Meet. Abra o evento no Google Agenda.');
 return { id: e.id, link };
}

export async function atualizarEvento({ acesso, id, evento, fetcher = fetch }) {
 return chamar(`${CALENDARIO}/${encodeURIComponent(id)}?sendUpdates=${evento.convidados?.length ? 'all' : 'none'}`, { method: 'PATCH', headers: cabecalho(acesso), body: JSON.stringify(corpoDoEvento(evento)) }, fetcher);
}

export async function removerEvento({ acesso, id, fetcher = fetch }) {
 try { await chamar(`${CALENDARIO}/${encodeURIComponent(id)}?sendUpdates=all`, { method: 'DELETE', headers: cabecalho(acesso) }, fetcher); }
 catch (e) { if (e.status !== 404) throw e; }   // já não existe: o resultado que se queria
}
