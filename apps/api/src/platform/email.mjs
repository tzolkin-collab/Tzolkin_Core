// Envio de e-mail do Core. Por enquanto um provedor, o Resend (REST, sem biblioteca). As credenciais vêm do ambiente vivo
// (EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM: definidas pela tela ou pelo servidor), lidas NO MOMENTO do envio.
//
// Hoje o único uso é o e-mail de teste de Configurações → Integrações. As automações e modelos de e-mail continuam rascunho
// (nada aqui os liga): este módulo é a base para quando elas passarem a enviar.
import { scrub } from './secrets.mjs';

export const PROVEDORES_DE_EMAIL = Object.freeze(['resend']);
const RESEND = 'https://api.resend.com';
const ENDERECO = /^[^\s<>@,;"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export class ErroDeEmail extends Error {
 constructor(mensagem, status = 502) { super(mensagem); this.status = status; }
}

/** "Nome <voce@dominio.com>" ou "voce@dominio.com". Devolve { nome, email, dominio } ou null. */
export function lerRemetente(valor) {
 const v = String(valor ?? '').trim();
 if (!v || v.length > 200 || /[\r\n]/.test(v)) return null;
 const m = v.match(/^(?:"?([^"<>\r\n]{1,80}?)"?\s*)?<([^<>\s]+)>$/);
 const email = (m ? m[2] : v).toLowerCase();
 if (!ENDERECO.test(email)) return null;
 return { nome: m?.[1]?.trim() || null, email, dominio: email.split('@')[1] };
}
export const enderecoValido = valor => ENDERECO.test(String(valor ?? '').trim());

const cabecalho = chave => ({ Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', 'User-Agent': 'TZOLKIN-Core/1.0' });

/**
 * Confere a chave e o domínio do remetente no Resend. Chave restrita a ENVIO não consegue listar domínios (e é a melhor prática):
 * nesse caso diz que a conferência do domínio só sai enviando o e-mail de teste.
 * Devolve { restrita:boolean, verificado:boolean|null }. Lança ErroDeEmail com mensagem clara.
 */
export async function conferirResend({ chave, remetente, fetchImpl = fetch }) {
 const r = await fetchImpl(`${RESEND}/domains`, { method: 'GET', redirect: 'error', headers: cabecalho(chave), signal: AbortSignal.timeout(10000) });
 let corpo = {}; try { corpo = await r.json(); } catch { /* sem corpo */ }
 if (r.status === 401 && corpo?.name === 'restricted_api_key') return { restrita: true, verificado: null };
 if (r.status === 401 || r.status === 403) throw new ErroDeEmail('O Resend recusou a chave.', 422);
 if (!r.ok) throw new ErroDeEmail('O Resend não respondeu como esperado.');
 const dominio = (corpo.data || []).find(d => String(d.name).toLowerCase() === remetente.dominio);
 if (!dominio) throw new ErroDeEmail(`O domínio ${remetente.dominio} não está cadastrado neste Resend. Cadastre e verifique em resend.com/domains.`, 422);
 if (dominio.status !== 'verified') throw new ErroDeEmail(`O domínio ${remetente.dominio} ainda não foi verificado no Resend (situação: ${String(dominio.status).slice(0, 30)}).`, 422);
 return { restrita: false, verificado: true };
}

/** Envia UM e-mail de texto. A resposta do Resend nunca ecoa a chave (mascarada); a mensagem dele ("domínio não verificado", etc.) é repassada. */
export async function enviarEmail({ env, para, assunto, texto, html = null, fetchImpl = fetch }) {
 const provedor = String(env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
 const chave = String(env.EMAIL_API_KEY ?? '').trim();
 const de = String(env.EMAIL_FROM ?? '').trim();
 if (provedor !== 'resend' || !chave || !lerRemetente(de)) throw new ErroDeEmail('O e-mail ainda não está configurado: faltam provedor, chave e remetente em Configurações → Integrações.', 503);
 if (!enderecoValido(para)) throw new ErroDeEmail('Destinatário inválido.', 400);
 const r = await fetchImpl(`${RESEND}/emails`, { method: 'POST', redirect: 'error', headers: cabecalho(chave), body: JSON.stringify({ from: de, to: [para], subject: assunto, text: texto, ...(html ? { html } : {}) }), signal: AbortSignal.timeout(15000) });
 let corpo = {}; try { corpo = await r.json(); } catch { /* sem corpo */ }
 if (!r.ok) {
  const motivo = scrub(String(corpo?.message || '').slice(0, 200), chave);
  throw new ErroDeEmail(r.status === 401 || r.status === 403 ? 'O Resend recusou a chave.' : `O Resend não enviou${motivo ? `: ${motivo}` : '.'}`, r.status >= 500 ? 502 : 422);
 }
 return { id: corpo.id ?? null };
}
