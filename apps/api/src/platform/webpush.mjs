import webpush from 'web-push';

// Web Push do Core: validação da assinatura, configuração VAPID e envio.
//
// Sem rede e sem banco aqui, de propósito: o envio de verdade é injetável
// (`createSender` devolve uma função) e os testes passam um falso.

/** Lista fechada de tópicos. Espelha o CHECK de push_subscriptions (037; 'agenda.lembrete' entra na 048). */
export const TOPICOS = Object.freeze(['commercial.lead', 'agenda.lembrete']);

// A assinatura vem do navegador de quem a cria, e o servidor faz um POST para o
// `endpoint` dela. Sem filtro, qualquer operador (ou uma sessão sequestrada)
// mandaria o servidor chamar uma URL qualquer: SSRF, e o servidor tem acesso à
// rede interna do EasyPanel e ao banco. Por isso só passa HTTPS dos serviços de
// push que os navegadores usam: Chrome/Edge/Opera (FCM), Firefox (Mozilla),
// Safari (Apple) e o Windows (WNS).
const SUFIXOS = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function enderecoPushValido(endpoint) {
 if (typeof endpoint !== 'string' || endpoint.length > 600) return false;
 let url;
 try { url = new URL(endpoint); } catch { return false; }
 if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
 const host = url.hostname.toLowerCase();
 return host === 'fcm.googleapis.com' || SUFIXOS.some(s => host.endsWith(s));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** { endpoint, keys: { p256dh, auth } } no formato de PushSubscription.toJSON(). */
export function assinaturaValida(valor) {
 if (!valor || typeof valor !== 'object') return false;
 const { endpoint, keys } = valor;
 if (!enderecoPushValido(endpoint) || !keys || typeof keys !== 'object') return false;
 const { p256dh, auth } = keys;
 return typeof p256dh === 'string' && typeof auth === 'string'
  && p256dh.length >= 80 && p256dh.length <= 120 && BASE64URL.test(p256dh)
  && auth.length >= 16 && auth.length <= 40 && BASE64URL.test(auth);
}

/** Tópicos pedidos → lista válida, sem repetição. Vazio ou desconhecido é erro. */
export function topicosValidos(topicos) {
 if (!Array.isArray(topicos) || !topicos.length) return null;
 const unicos = [...new Set(topicos)];
 return unicos.every(t => TOPICOS.includes(t)) ? unicos : null;
}

/**
 * Chaves VAPID do ambiente. Sem as três o push fica DESLIGADO (null), e o painel
 * funciona igual: nenhuma rota de push falha o resto, só responde "não configurado".
 */
export function vapidConfig(env = process.env) {
 const publicKey = String(env.VAPID_PUBLIC_KEY ?? '').trim();
 const privateKey = String(env.VAPID_PRIVATE_KEY ?? '').trim();
 const subject = String(env.VAPID_SUBJECT ?? '').trim();
 if (!publicKey || !privateKey || !subject) return null;
 // O assunto identifica o remetente para o serviço de push: URL do site ou mailto.
 if (!/^(https:\/\/|mailto:)/.test(subject)) return null;
 return { publicKey, privateKey, subject };
}

/**
 * Função que envia UM push: `enviar(assinatura, payload)`. Passa o VAPID em cada
 * chamada (e não em `setVapidDetails`) para não depender de estado global do módulo.
 * TTL curto: aviso de lead que chega horas depois já perdeu o motivo.
 */
export function createSender(config, lib = webpush) {
 const vapidDetails = { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey };
 return (assinatura, payload) => lib.sendNotification(assinatura, JSON.stringify(payload), {
  vapidDetails, TTL: 3600, urgency: 'high', timeout: 8000,
 });
}

let padrao;
/** Envio configurado pelo ambiente, criado uma vez. null = push desligado. */
export function senderPadrao() {
 if (padrao === undefined) {
  const config = vapidConfig();
  padrao = config ? createSender(config) : null;
 }
 return padrao;
}
/** Só para teste: descarta o envio guardado. */
export function _reiniciarSenderPadrao() { padrao = undefined; }

const corta = (valor, max) => String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * O que a notificação mostra. Os campos são os que o `sw.js` lê: title, body, tag, view.
 *
 * Só nome da organização e da pessoa: nada de e-mail, telefone, mensagem ou
 * origem. A notificação passa pelo serviço de push (criptografada de ponta a ponta
 * até o aparelho) e aparece na tela bloqueada, então leva o mínimo.
 */
export function payloadLeadNovo({ produto, organizacao, nome, leadId }) {
 const quem = [corta(organizacao, 80), corta(nome, 80)].filter(Boolean);
 return {
  title: corta(`Lead novo${produto ? ' — ' + produto : ''}`, 120),
  body: quem.join(' · ') || 'Um contato novo chegou.',
  // Uma tag por lead: dois leads seguidos viram duas notificações, não uma só.
  tag: `lead:${corta(leadId, 40)}`,
  // `leads` é a tela Inbound do painel (CONTEXTS.general.views.leads).
  view: 'leads',
 };
}

export const payloadTeste = () => ({
 title: 'Notificações ativas',
 body: 'Este aparelho vai receber o aviso de lead novo.',
 tag: 'teste',
 view: 'leads',
});

const FUSO = 'America/Sao_Paulo';
const hora = ms => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** "Agora", "Daqui a 15 min", "Daqui a 1 h", "Amanhã", "Em 2 dias", "Em 1 semana": quanto falta, no tom de um aviso. */
export function textoDaAntecedencia(minutos) {
 if (minutos === 0) return 'Agora';
 if (minutos < 60) return `Daqui a ${minutos} min`;
 if (minutos < 1440) return `Daqui a ${minutos / 60} h`;
 if (minutos === 1440) return 'Amanhã';
 if (minutos < 10080) return `Em ${minutos / 1440} dias`;
 return 'Em 1 semana';
}

/**
 * Lembrete de atividade da agenda. Só título, empresa e horário: o aviso passa pelo serviço de push e aparece na tela bloqueada,
 * então não leva descrição, local nem link da reunião. Uma tag por atividade e antecedência: dois lembretes da mesma atividade
 * (1 dia antes e 15 min antes) são duas notificações, não uma só.
 */
export function payloadLembrete({ titulo, empresa, inicio, minutos, atividadeId }) {
 return {
  title: corta(`${textoDaAntecedencia(minutos)} — ${corta(titulo, 80)}`, 120),
  body: [corta(empresa, 80), hora(inicio)].filter(Boolean).join(' · '),
  tag: `agenda:${corta(atividadeId, 40)}:${minutos}`,
  // `tracking` é a tela Acompanhamento (a agenda).
  view: 'tracking',
 };
}
