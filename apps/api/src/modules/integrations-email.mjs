import { fail } from '../platform/http.mjs';
import { enviarEmail, ErroDeEmail, enderecoValido } from '../platform/email.mjs';
import { vivo as vivoPadrao } from '../platform/env-vivo.mjs';

// E-mail de teste: manda UM e-mail, só para o endereço de quem está logado, com as credenciais que valem hoje (tela por cima do .env).
// Serve para provar que chave, domínio e remetente funcionam de verdade. Não aceita destinatário digitado: ninguém usa o Core
// para escrever a terceiros por aqui. Admin interno, como o resto.

const INTERVALO_MS = 30000;

export function integrationsEmailRoutes(router, { vivo = vivoPadrao, fetchImpl = fetch, clock = Date.now } = {}) {
 const ultimo = new Map();   // operador -> instante do último teste: evita rajada de e-mails
 router.post('/api/integrations/email/teste', async ({ operator, reply }) => {
  const para = String(operator?.email ?? '').trim().toLowerCase();
  if (!enderecoValido(para)) throw fail(409, 'Sua sessão não tem um e-mail para receber o teste.');
  const chave = operator.subject || para;
  const agora = clock();
  if (agora - (ultimo.get(chave) ?? -Infinity) < INTERVALO_MS) throw fail(429, 'Aguarde alguns segundos antes de pedir outro teste.');
  ultimo.set(chave, agora);
  try {
   await enviarEmail({ env: vivo.env, para, assunto: 'Teste do TZOLKIN Core', texto: 'Se você leu isto, o envio de e-mail do Core está funcionando.\n\nEste é um teste pedido por você em Configurações → Integrações.', fetchImpl });
  } catch (e) {
   ultimo.delete(chave);   // falhou: deixa tentar de novo logo depois de corrigir
   if (e instanceof ErroDeEmail) throw fail(e.status, e.message);
   throw e;
  }
  reply(200, { ok: true, para, mensagem: `E-mail de teste enviado para ${para}. Confira a caixa de entrada (e o spam).` });
 }, { body: false });
}
