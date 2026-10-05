// Modelo de e-mail: troca {{variáveis}} por valores e gera texto e HTML. Sem rede e sem banco.
//
// REGRAS
//  - Só variáveis conhecidas do tipo de e-mail. {{plan}} num e-mail de lead não é "vazio": é erro, dito antes de enviar.
//  - O valor de uma variável é DADO, nunca marcação: no HTML ele é escapado; no assunto, quebra de linha vira espaço (nada de
//    cabeçalho injetado por um nome de lead com \r\n).
//  - O que foi enviado fica gravado já renderizado (email_outbox), então mudar o modelo depois não reescreve o passado.

export const VARIAVEIS_DO_LEAD = Object.freeze(['name', 'email', 'product_name', 'company_name']);
/** Todas as variáveis que o editor conhece (as de cobrança entram quando houver e-mail de pagamento). */
export const VARIAVEIS_CONHECIDAS = Object.freeze([...VARIAVEIS_DO_LEAD, 'plan', 'due_date']);

export class ErroDeModelo extends Error {
 constructor(mensagem) { super(mensagem); this.status = 400; }
}

const LIMPAR = valor => String(valor ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 200);
export const escaparHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function trocar(texto, valores, permitidas, escapar) {
 return String(texto ?? '').replace(TOKEN, (_t, nome) => {
  if (!permitidas.includes(nome)) {
   const caso = VARIAVEIS_CONHECIDAS.includes(nome) ? 'não existe neste tipo de e-mail' : 'é desconhecida';
   throw new ErroDeModelo(`A variável {{${nome}}} ${caso}. Disponíveis aqui: ${permitidas.map(p => `{{${p}}}`).join(', ')}.`);
  }
  const v = LIMPAR(valores[nome]);
  return escapar ? escaparHtml(v) : v;
 });
}

/** Parágrafos em branco viram <p>; quebra simples vira <br>. */
const paraHtml = textoJaEscapado => textoJaEscapado.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');

/**
 * @param {{subject:string, body:string, preheader?:string}} modelo
 * @param {Record<string,string>} valores
 * @param {{permitidas?:string[], rodape?:string|null}} [opcoes]
 * @returns {{assunto:string, texto:string, html:string}}
 */
export function renderizar(modelo, valores, { permitidas = VARIAVEIS_DO_LEAD, rodape = null } = {}) {
 const assunto = trocar(modelo.subject, valores, permitidas, false).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
 if (!assunto) throw new ErroDeModelo('O assunto ficou vazio.');
 const corpo = trocar(modelo.body, valores, permitidas, false).replace(/\r\n/g, '\n').trim();
 if (!corpo) throw new ErroDeModelo('O corpo ficou vazio.');
 const corpoHtml = trocar(modelo.body, valores, permitidas, true).replace(/\r\n/g, '\n').trim();
 const previa = modelo.preheader ? trocar(modelo.preheader, valores, permitidas, true).replace(/[\r\n]+/g, ' ').trim().slice(0, 180) : '';
 const rodapeTexto = rodape ? String(rodape) : null;
 const texto = rodapeTexto ? `${corpo}\n\n--\n${rodapeTexto}` : corpo;
 const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222">${previa ? `<span style="display:none;max-height:0;overflow:hidden;opacity:0">${previa}</span>` : ''}${paraHtml(corpoHtml)}${rodapeTexto ? `<hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="margin:0;font-size:12px;color:#666">${escaparHtml(rodapeTexto)}</p>` : ''}</div>`;
 return { assunto, texto, html };
}

/** Texto de rodapé dos e-mails automáticos: diz por que a pessoa recebeu e como parar. */
export const rodapeDoLead = produto => `Você recebeu este e-mail porque entrou em contato com ${LIMPAR(produto) || 'a TZOLKIN'}. Para não receber mais mensagens, responda este e-mail pedindo para sair.`;
