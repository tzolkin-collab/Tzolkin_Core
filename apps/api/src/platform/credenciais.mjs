// Catálogo das credenciais que a TELA pode guardar (etapa 1: Vercel, GitHub, EasyPanel e Hostinger), com a regra de cada campo e o
// "Testar" de cada provedor. O nome do campo é o MESMO da variável de ambiente que ele substitui (VERCEL_TOKEN etc.): é isso que faz
// os módulos antigos, que leem `env.VERCEL_TOKEN`, enxergarem o valor da tela sem mudar a leitura (ver env-vivo.mjs).
import { createVercelAdapter } from '../integrations/vercel.mjs';
import { createGithubAdapter } from '../integrations/github.mjs';
import { createEasypanelAdapter } from '../integrations/easypanel.mjs';
import { createHostingerDnsAdapter } from '../integrations/hostinger-dns.mjs';
import { createEvolutionAdapter, normalizarNumero } from '../integrations/evolution.mjs';
import { createAnthropicAdapter } from '../integrations/anthropic.mjs';
import { createGeminiAdapter } from '../integrations/gemini.mjs';
import { createECDH } from 'node:crypto';
import { scrub } from './secrets.mjs';
import { lerRemetente, conferirResend, PROVEDORES_DE_EMAIL } from './email.mjs';

const LIMPO = /^[\x21-\x7e]{8,500}$/;                       // segredo: ASCII visível, sem espaço nem quebra de linha
const segredo = valor => LIMPO.test(valor) ? null : 'Use de 8 a 500 caracteres, sem espaços nem quebras de linha.';
const dominio = valor => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(valor) ? null : 'Informe um domínio, como tzolkin.cloud.';
const idDoTime = valor => /^[\w-]{3,64}$/.test(valor) ? null : 'ID do time inválido (letras, números, _ e -).';
const enderecoEasypanel = valor => {
 let u; try { u = new URL(valor); } catch { return 'Informe o endereço completo, com https://.'; }
 if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !['/', '/api', '/api/'].includes(u.pathname)) return 'Use o endereço https do painel, sem usuário, parâmetros ou caminho (só / ou /api).';
 return null;
};

const chavePublicaVapid = valor => /^[A-Za-z0-9_-]{87}$/.test(valor) ? null : 'Chave pública inválida (87 caracteres, letras, números, - e _).';
const chavePrivadaVapid = valor => /^[A-Za-z0-9_-]{43}$/.test(valor) ? null : 'Chave privada inválida (43 caracteres, letras, números, - e _).';
const assuntoVapid = valor => valor.length <= 200 && /^(https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/.test(valor) ? null : 'Use o endereço do site (https://…) ou um mailto:.';
/** A chave pública tem de ser a que nasce da privada: par trocado faz todo envio falhar sem explicação. */
export function parDeChavesConfere(publica, privada) {
 try { const e = createECDH('prime256v1'); e.setPrivateKey(Buffer.from(privada, 'base64url')); return e.getPublicKey().toString('base64url') === publica; }
 catch { return false; }
}

const chaveStripe = v => /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(v) ? null : 'Chave secreta inválida (começa com sk_live_, sk_test_ ou rk_).';
const chavePublicaStripe = v => /^pk_(live|test)_[A-Za-z0-9]{10,}$/.test(v) ? null : 'Chave publicável inválida (começa com pk_live_ ou pk_test_).';
const segredoWebhookStripe = v => /^whsec_[A-Za-z0-9]{16,}$/.test(v) ? null : 'Segredo de webhook inválido (começa com whsec_).';
const tokenWebhookAsaas = v => /^[\x21-\x7e]{16,255}$/.test(v) ? null : 'Use de 16 a 255 caracteres, sem espaços.';
const ambienteAsaas = v => ['production', 'sandbox'].includes(v) ? null : 'Use production ou sandbox.';
const modoStripe = v => (String(v).includes('_live_') ? 'live' : 'test');

const idPluggy = v => /^[A-Za-z0-9_-]{8,128}$/.test(v) ? null : 'ID do cliente inválido (letras, números, - e _).';
const itensPluggy = v => {
 const ids = v.split(',').map(x => x.trim()).filter(Boolean);
 if (!ids.length) return 'Informe pelo menos um item.';
 if (ids.length > 20) return 'No máximo 20 itens.';
 return ids.every(i => /^[A-Za-z0-9_-]{1,128}$/.test(i)) ? null : 'Cada item deve ter só letras, números, - e _, separados por vírgula.';
};
export const itensDePluggy = v => [...new Set(String(v || '').split(',').map(x => x.trim()).filter(Boolean))];

const idAppMeta = v => /^\d{8,20}$/.test(v) ? null : 'ID do aplicativo inválido (só números).';
const configLoginMeta = v => /^\d{5,25}$/.test(v) ? null : 'ID da configuração inválido (só números).';
const retornoMeta = v => {
 let u; try { u = new URL(v); } catch { return 'Informe o endereço completo, com https://.'; }
 return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? null : 'Use um endereço https, sem usuário, parâmetros ou âncora.';
};

const provedorEmail = v => PROVEDORES_DE_EMAIL.includes(v) ? null : `Por enquanto só ${PROVEDORES_DE_EMAIL.join(', ')}.`;
const chaveResend = v => /^re_[A-Za-z0-9_]{16,}$/.test(v) ? null : 'Chave do Resend inválida (começa com re_).';
const remetenteEmail = v => lerRemetente(v) ? null : 'Use voce@dominio.com ou Nome <voce@dominio.com>.';

const enderecoEvolution = v => {
 let u; try { u = new URL(v); } catch { return 'Informe o endereço completo, com https://.'; }
 return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? null : 'Use um endereço https, sem usuário, parâmetros ou âncora.';
};
const instanciaEvolution = v => /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? null : 'Use só letras, números, . _ e - (até 64 caracteres).';
const numerosDaEquipe = v => {
 const itens = String(v).split(',').map(x => x.trim()).filter(Boolean);
 if (!itens.length || itens.length > 10) return 'Informe de 1 a 10 números, separados por vírgula.';
 return itens.every(n => normalizarNumero(n)) ? null : 'Há um número inválido. Use DDD + número, por exemplo (31) 99999-9999.';
};
/** Números da equipe já normalizados (só dígitos, com DDI), sem repetição. */
export const numerosDaEquipeNormalizados = v => [...new Set(String(v || '').split(',').map(x => normalizarNumero(x.trim())).filter(Boolean))];

const rotuloDeErro = (e, ...segredos) => scrub(e?.message || 'sem detalhe', ...segredos).slice(0, 160);

export const PROVEDORES = Object.freeze({
 vercel: {
  nome: 'Vercel',
  campos: [
   { nome: 'VERCEL_TOKEN', rotulo: 'Token', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'Crie em vercel.com/account/tokens, com escopo só de leitura dos projetos.' },
   { nome: 'VERCEL_TEAM_ID', rotulo: 'ID do time (opcional)', secreto: false, validar: idDoTime, ajuda: 'Só para token de conta inteira; token de time dispensa.' },
  ],
  async testar(v, fetchImpl) {
   const lista = await createVercelAdapter({ token: v.VERCEL_TOKEN, teamId: v.VERCEL_TEAM_ID || null, fetchImpl }).listProjects({ limit: 1 });
   return `A Vercel respondeu (${lista.length >= 1 ? 'há projetos visíveis' : 'nenhum projeto visível'}).`;
  },
 },
 github: {
  nome: 'GitHub',
  campos: [{ nome: 'GITHUB_TOKEN', rotulo: 'Token', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'Token de leitura, só dos repositórios que o Core precisa ver.' }],
  async testar(v, fetchImpl) {
   const r = await createGithubAdapter({ token: v.GITHUB_TOKEN, fetchImpl }).listRepositories();
   return `O GitHub respondeu (${r.repositories.length}${r.truncated ? '+' : ''} repositórios visíveis).`;
  },
 },
 easypanel: {
  nome: 'EasyPanel',
  campos: [
   { nome: 'EASYPANEL_URL', rotulo: 'Endereço do painel', secreto: false, obrigatorio: true, validar: enderecoEasypanel, ajuda: 'Ex.: https://painel.seudominio.com' },
   { nome: 'EASYPANEL_TOKEN', rotulo: 'Token da API', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'Gerado no perfil do EasyPanel.' },
  ],
  async testar(v, fetchImpl) {
   await createEasypanelAdapter({ baseUrl: v.EASYPANEL_URL, token: v.EASYPANEL_TOKEN, fetchImpl }).inventory();
   return 'O EasyPanel respondeu ao inventário.';
  },
 },
 pluggy: {
  nome: 'Pluggy (bancos)',
  campos: [
   { nome: 'PLUGGY_CLIENT_ID', rotulo: 'ID do cliente', secreto: false, obrigatorio: true, validar: idPluggy, ajuda: 'Dashboard da Pluggy → Aplicação.' },
   { nome: 'PLUGGY_CLIENT_SECRET', rotulo: 'Segredo do cliente', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'Do mesmo aplicativo na Pluggy.' },
   { nome: 'PLUGGY_ITEM_IDS', rotulo: 'Conexões (itens), separadas por vírgula', secreto: false, validar: itensPluggy, ajuda: 'Cada banco conectado na Pluggy tem um item. Sem itens o Financeiro não mostra contas.' },
  ],
  async testar(v, fetchImpl) {
   const auth = await fetchImpl('https://api.pluggy.ai/auth', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: v.PLUGGY_CLIENT_ID, clientSecret: v.PLUGGY_CLIENT_SECRET }), signal: AbortSignal.timeout(10000) });
   if (auth.status === 401 || auth.status === 403) throw new Error('A Pluggy recusou o ID e o segredo do cliente.');
   if (!auth.ok) throw new Error('A Pluggy não respondeu como esperado.');
   const { apiKey } = await auth.json();
   if (!apiKey) throw new Error('A Pluggy não devolveu o token de acesso.');
   const itens = itensDePluggy(v.PLUGGY_ITEM_IDS).slice(0, 10);
   if (!itens.length) return 'A Pluggy aceitou o ID e o segredo. Nenhuma conexão (item) informada ainda.';
   const faltam = [];
   for (const id of itens) {
    const r = await fetchImpl(`https://api.pluggy.ai/items/${encodeURIComponent(id)}`, { method: 'GET', redirect: 'error', headers: { 'X-API-KEY': apiKey }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) faltam.push(id);
   }
   if (faltam.length) throw new Error(`Credenciais aceitas, mas ${faltam.length === 1 ? 'este item não foi encontrado' : 'estes itens não foram encontrados'} nesta conta: ${faltam.join(', ')}.`);
   return `A Pluggy aceitou as credenciais e ${itens.length === 1 ? 'a conexão respondeu' : `as ${itens.length} conexões responderam`}.`;
  },
 },
 push: {
  nome: 'Notificações push',
  campos: [
   { nome: 'VAPID_PUBLIC_KEY', rotulo: 'Chave pública', secreto: false, obrigatorio: true, validar: chavePublicaVapid, ajuda: 'É entregue ao navegador; não é segredo.' },
   { nome: 'VAPID_PRIVATE_KEY', rotulo: 'Chave privada', secreto: true, obrigatorio: true, validar: chavePrivadaVapid, ajuda: 'Fica só no servidor.' },
   { nome: 'VAPID_SUBJECT', rotulo: 'Assunto', secreto: false, obrigatorio: true, validar: assuntoVapid, ajuda: 'O endereço do site (https://…) ou um mailto:. Identifica o remetente para o serviço de push.' },
  ],
  async testar(v) {
   if (!parDeChavesConfere(v.VAPID_PUBLIC_KEY, v.VAPID_PRIVATE_KEY)) throw new Error('A chave pública não é a par da chave privada.');
   return 'O par de chaves confere. Nenhum aviso foi enviado.';
  },
 },
 stripe: {
  nome: 'Stripe',
  campos: [
   { nome: 'STRIPE_SECRET_KEY', rotulo: 'Chave secreta', secreto: true, obrigatorio: true, critico: true, validar: chaveStripe, ajuda: 'Dashboard do Stripe → Desenvolvedores → Chaves de API. Prefira uma chave restrita (rk_) com o mínimo necessário.', avisoTroca: 'Trocar a chave secreta muda a conta usada nas cobranças, no checkout e nas vendas importadas.' },
   { nome: 'STRIPE_PUBLISHABLE_KEY', rotulo: 'Chave publicável', secreto: false, validar: chavePublicaStripe, ajuda: 'Usada no checkout. Tem de ser do mesmo modo (live ou test) da chave secreta.' },
   { nome: 'STRIPE_WEBHOOK_SECRET', rotulo: 'Segredo do webhook', secreto: true, critico: true, validar: segredoWebhookStripe, ajuda: 'Vem do endpoint de webhook no Stripe (whsec_…). Sem ele os pagamentos não são confirmados.', avisoTroca: 'Trocar o segredo do webhook: o endpoint no Stripe precisa estar com o MESMO valor, senão os pagamentos deixam de ser confirmados.' },
  ],
  async testar(v, fetchImpl) {
   const partes = [];
   const r = await fetchImpl('https://api.stripe.com/v1/balance', { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${v.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(10000) });
   if (r.status === 401 || r.status === 403) throw new Error('O Stripe recusou a chave secreta.');
   if (!r.ok) throw new Error('O Stripe não respondeu como esperado.');
   partes.push(`O Stripe aceitou a chave secreta (modo ${modoStripe(v.STRIPE_SECRET_KEY)}).`);
   if (v.STRIPE_PUBLISHABLE_KEY) {
    if (modoStripe(v.STRIPE_PUBLISHABLE_KEY) !== modoStripe(v.STRIPE_SECRET_KEY)) throw new Error('A chave publicável e a secreta são de modos diferentes (uma live, outra test).');
    partes.push('A chave publicável é do mesmo modo.');
   }
   if (v.STRIPE_WEBHOOK_SECRET) partes.push('O segredo do webhook tem o formato certo; só um evento real confirma que bate com o do Stripe.');
   return partes.join(' ');
  },
 },
 asaas: {
  nome: 'Asaas',
  campos: [
   { nome: 'ASAAS_API_KEY', rotulo: 'Chave da API', secreto: true, obrigatorio: true, critico: true, validar: segredo, ajuda: 'Asaas → Integrações → Chave de API.', avisoTroca: 'Trocar a chave da API muda a conta usada nas cobranças e nas vendas importadas.' },
   { nome: 'ASAAS_ENVIRONMENT', rotulo: 'Ambiente (production ou sandbox)', secreto: false, critico: true, validar: ambienteAsaas, ajuda: 'Se vazio, usa sandbox. A chave de produção só funciona em production.', avisoTroca: 'Trocar o ambiente faz o Core falar com outra conta do Asaas (produção ou testes).' },
   { nome: 'ASAAS_WEBHOOK_TOKEN', rotulo: 'Token do webhook', secreto: true, critico: true, validar: tokenWebhookAsaas, ajuda: 'O mesmo token configurado no webhook do Asaas. Sem ele os pagamentos não são confirmados.', avisoTroca: 'Trocar o token do webhook: o webhook no Asaas precisa estar com o MESMO valor, senão os pagamentos deixam de ser confirmados.' },
  ],
  async testar(v, fetchImpl) {
   const producao = v.ASAAS_ENVIRONMENT === 'production';
   const base = producao ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
   const r = await fetchImpl(`${base}/finance/balance`, { method: 'GET', redirect: 'error', headers: { access_token: v.ASAAS_API_KEY, 'User-Agent': 'TZOLKIN-Core/1.0' }, signal: AbortSignal.timeout(10000) });
   if (r.status === 401 || r.status === 403) throw new Error(`O Asaas recusou a chave no ambiente ${producao ? 'production' : 'sandbox'}. Confira se a chave é do ambiente certo.`);
   if (!r.ok) throw new Error('O Asaas não respondeu como esperado.');
   return `O Asaas aceitou a chave (ambiente ${producao ? 'production' : 'sandbox'}).${v.ASAAS_WEBHOOK_TOKEN ? ' O token do webhook tem o formato certo; só um evento real confirma que bate.' : ''}`;
  },
 },
 meta: {
  nome: 'Meta (anúncios)',
  campos: [
   { nome: 'META_APP_ID', rotulo: 'ID do aplicativo', secreto: false, obrigatorio: true, critico: true, validar: idAppMeta, ajuda: 'developers.facebook.com → seu aplicativo → Configurações → Básico.', avisoTroca: 'Trocar o aplicativo da Meta invalida a conta de anúncios já conectada: será preciso conectar de novo em cada produto.' },
   { nome: 'META_APP_SECRET', rotulo: 'Chave secreta do aplicativo', secreto: true, obrigatorio: true, critico: true, validar: segredo, ajuda: 'Na mesma página (Chave secreta do aplicativo).', avisoTroca: 'Trocar a chave secreta do aplicativo pode invalidar a conta de anúncios já conectada: se a Meta recusar o token antigo, será preciso conectar de novo.' },
   { nome: 'META_LOGIN_CONFIG_ID', rotulo: 'ID da configuração do Login para Empresas (opcional)', secreto: false, validar: configLoginMeta, ajuda: 'Só para Login para Empresas. Sem ele, usa o Login do Facebook clássico.' },
   { nome: 'META_REDIRECT_URI', rotulo: 'Endereço de retorno (opcional)', secreto: false, validar: retornoMeta, ajuda: 'Só se o endereço de retorno cadastrado na Meta não for o do próprio Core (/api/marketing/meta/callback).' },
  ],
  async testar(v, fetchImpl) {
   // O app só emite token de acesso se ID e chave secreta forem do mesmo aplicativo. POST (e não GET): a chave não vai em endereço.
   const r = await fetchImpl('https://graph.facebook.com/oauth/access_token', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: v.META_APP_ID, client_secret: v.META_APP_SECRET, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(10000) });
   if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error('A Meta recusou o ID e a chave secreta: confira se são do mesmo aplicativo.');
   if (!r.ok) throw new Error('A Meta não respondeu como esperado.');
   const d = await r.json();
   if (!d.access_token) throw new Error('A Meta não confirmou o aplicativo.');
   return `A Meta aceitou o ID e a chave secreta do aplicativo.${v.META_LOGIN_CONFIG_ID ? ' O ID da configuração tem o formato certo; só uma conexão real confirma que existe.' : ''}`;
  },
 },
 email: {
  nome: 'E-mail transacional',
  campos: [
   { nome: 'EMAIL_PROVIDER', rotulo: 'Provedor', secreto: false, obrigatorio: true, validar: provedorEmail, ajuda: 'Por enquanto só resend.' },
   { nome: 'EMAIL_API_KEY', rotulo: 'Chave da API', secreto: true, obrigatorio: true, validar: chaveResend, ajuda: 'resend.com/api-keys. Prefira uma chave só de envio (permissão "Sending access").' },
   { nome: 'EMAIL_FROM', rotulo: 'Remetente', secreto: false, obrigatorio: true, validar: remetenteEmail, ajuda: 'Ex.: Tzolkin <contato@tzolkin.cloud>. O domínio precisa estar verificado no Resend.' },
  ],
  async testar(v, fetchImpl) {
   const remetente = lerRemetente(v.EMAIL_FROM);
   const r = await conferirResend({ chave: v.EMAIL_API_KEY, remetente, fetchImpl });
   if (r.restrita) return 'O Resend aceitou a chave (ela é restrita a envio, o que é o ideal). O domínio só se confere enviando o e-mail de teste.';
   return `O Resend aceitou a chave e o domínio ${remetente.dominio} está verificado.`;
  },
 },
 hostinger: {
  nome: 'Hostinger (DNS)',
  campos: [
   { nome: 'HOSTINGER_API_KEY', rotulo: 'Chave da API', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'Gerada em hPanel → API.' },
   { nome: 'HOSTINGER_DNS_ZONE', rotulo: 'Zona de DNS', secreto: false, validar: dominio, ajuda: 'Se vazio, usa tzolkin.cloud.' },
  ],
  async testar(v, fetchImpl) {
   const r = await createHostingerDnsAdapter({ env: { HOSTINGER_API_KEY: v.HOSTINGER_API_KEY, HOSTINGER_DNS_ZONE: v.HOSTINGER_DNS_ZONE || undefined }, fetchImpl }).readZone();
   if (r.status === 'ok') return `A Hostinger respondeu (${r.records.length} registros na zona ${r.zone}).`;
   const motivos = { unauthorized: 'A Hostinger recusou a chave.', not_found: `A zona ${r.zone} não foi encontrada nesta conta.`, unavailable: 'A Hostinger não respondeu.', invalid: 'A resposta da Hostinger veio em formato inesperado.' };
   throw new Error(motivos[r.status] || 'A Hostinger não confirmou.');
  },
 },
 anthropic: {
  nome: 'Claude (agentes de IA)',
  campos: [
   { nome: 'ANTHROPIC_API_KEY', rotulo: 'Chave da API da Anthropic', secreto: true, obrigatorio: true, validar: v => (/^[\x21-\x7e]{20,300}$/.test(v) ? null : 'Chave inválida (de 20 a 300 caracteres, sem espaços).'), ajuda: 'Criada em console.anthropic.com → API keys. Os agentes de IA do WhatsApp usam esta chave.' },
   { nome: 'AGENTES_EXECUCAO', rotulo: 'Execução dos agentes', secreto: false, validar: v => (['ligado', 'desligado'].includes(String(v).trim().toLowerCase()) ? null : 'Use ligado ou desligado.'), ajuda: 'Só com "ligado" os agentes respondem. Desligado, nada chama o modelo e nada é agendado.' },
  ],
  async testar(v, fetchImpl) {
   const r = await createAnthropicAdapter({ env: { ANTHROPIC_API_KEY: v.ANTHROPIC_API_KEY }, fetchImpl }).listModels();
   if (r.ok) return `A Anthropic aceitou a chave e ela enxerga ${r.models.length} ${r.models.length === 1 ? 'modelo' : 'modelos'}.`;
   const motivos = { unauthorized: 'A Anthropic recusou a chave.', rate_limited: 'A Anthropic pediu para ir mais devagar. Tente de novo.', unavailable: 'A Anthropic não respondeu.', invalid: 'A resposta da Anthropic veio em formato inesperado.', invalid_config: 'A chave tem formato inválido.' };
   throw new Error(motivos[r.reason] || 'A Anthropic não confirmou.');
  },
 },
 gemini: {
  nome: 'Gemini (agentes de IA, ótimo para testar)',
  campos: [
   { nome: 'GEMINI_API_KEY', rotulo: 'Chave da API do Gemini', secreto: true, obrigatorio: true, validar: v => (/^[\x21-\x7e]{20,300}$/.test(v) ? null : 'Chave inválida (de 20 a 300 caracteres, sem espaços).'), ajuda: 'Criada de graça em aistudio.google.com/apikey. A camada gratuita tem limite por minuto e por dia: serve para testar. Um agente usa o Gemini quando o modelo dele começa com "gemini-". Para os agentes responderem, defina também "Execução dos agentes" como ligado no cartão do Claude.' },
  ],
  async testar(v, fetchImpl) {
   const r = await createGeminiAdapter({ env: { GEMINI_API_KEY: v.GEMINI_API_KEY }, fetchImpl }).listModels();
   if (r.ok) return `O Google aceitou a chave e ela enxerga ${r.models.length} ${r.models.length === 1 ? 'modelo' : 'modelos'} (por exemplo: ${r.models.filter(m => /flash/.test(m)).slice(0, 4).join(', ') || r.models.slice(0, 4).join(', ')}).`;
   const motivos = { unauthorized: 'O Google recusou a chave.', rate_limited: 'O Google pediu para ir mais devagar. Tente de novo.', unavailable: 'O Google não respondeu.', invalid: 'A resposta do Google veio em formato inesperado.', invalid_config: 'A chave está em formato inválido.' };
   throw new Error(motivos[r.reason] || 'O Google não confirmou.');
  },
 },
 evolution: {
  nome: 'WhatsApp (Evolution API)',
  campos: [
   { nome: 'EVOLUTION_URL', rotulo: 'Endereço da Evolution', secreto: false, obrigatorio: true, validar: enderecoEvolution, ajuda: 'Ex.: https://evolution.seudominio.com' },
   { nome: 'EVOLUTION_INSTANCE', rotulo: 'Nome da instância', secreto: false, obrigatorio: true, validar: instanciaEvolution, ajuda: 'A instância conectada ao número da TZOLKIN, no manager da Evolution.' },
   { nome: 'EVOLUTION_API_KEY', rotulo: 'Chave da API', secreto: true, obrigatorio: true, validar: segredo, ajuda: 'A chave da instância (ou a global) da Evolution.' },
   { nome: 'EVOLUTION_WEBHOOK_SECRET', rotulo: 'Segredo do webhook', secreto: true, validar: segredo, ajuda: 'Segredo que a Evolution manda ao Core ao avisar mensagem recebida. Sem ele, o Core só envia.' },
   { nome: 'WHATSAPP_ENVIO', rotulo: 'Envio automático', secreto: false, validar: v => (['ligado', 'desligado'].includes(String(v).trim().toLowerCase()) ? null : 'Use ligado ou desligado.'), ajuda: 'Só com "ligado" a fila envia mensagens. Desligado, elas ficam esperando.' },
   { nome: 'WHATSAPP_TEAM_NUMBERS', rotulo: 'Números da equipe', secreto: false, validar: numerosDaEquipe, ajuda: 'Quem recebe o aviso de lead novo, com DDD, separados por vírgula.' },
  ],
  async testar(v, fetchImpl) {
   const r = await createEvolutionAdapter({ env: { EVOLUTION_URL: v.EVOLUTION_URL, EVOLUTION_INSTANCE: v.EVOLUTION_INSTANCE, EVOLUTION_API_KEY: v.EVOLUTION_API_KEY }, fetchImpl }).connectionState();
   if (r.ok && r.connected) return `A Evolution respondeu e a instância ${v.EVOLUTION_INSTANCE} está conectada ao WhatsApp.`;
   if (r.ok) throw new Error(`A instância existe, mas o WhatsApp não está conectado (estado: ${r.state}). Leia o QR code no manager da Evolution.`);
   const motivos = { unauthorized: 'A Evolution recusou a chave.', not_found: `A instância ${v.EVOLUTION_INSTANCE} não existe nesta Evolution.`, unavailable: 'A Evolution não respondeu.', invalid: 'A resposta da Evolution veio em formato inesperado.', invalid_config: 'Endereço, instância ou chave inválidos.' };
   throw new Error(motivos[r.reason] || 'A Evolution não confirmou.');
  },
 },
});

export const campoDe = (provedor, nome) => PROVEDORES[provedor]?.campos.find(c => c.nome === nome) ?? null;

/** Valida os valores recebidos (só campos conhecidos do provedor, não vazios, no formato certo). Devolve { limpos } ou lança com a mensagem. */
export function validarValores(provedor, valores, falhar) {
 const def = PROVEDORES[provedor];
 if (!def) throw falhar(400, 'Provedor desconhecido.');
 if (!valores || typeof valores !== 'object' || Array.isArray(valores)) throw falhar(400, 'Envie os valores como um objeto.');
 const limpos = {};
 for (const [nome, bruto] of Object.entries(valores)) {
  const campo = campoDe(provedor, nome);
  if (!campo) throw falhar(400, `Campo desconhecido: ${String(nome).slice(0, 40)}.`);
  if (typeof bruto !== 'string') throw falhar(400, `${campo.rotulo}: envie texto.`);
  const valor = bruto.trim();
  if (!valor) throw falhar(400, `${campo.rotulo}: valor vazio. Para tirar o valor da tela, use Remover.`);
  const erro = campo.validar(valor);
  if (erro) throw falhar(400, `${campo.rotulo}: ${erro}`);
  limpos[nome] = valor;
 }
 if (!Object.keys(limpos).length) throw falhar(400, 'Nada para salvar.');
 return limpos;
}

/** Testa com os valores efetivos (os enviados por cima dos que já valem). Devolve { ok, mensagem }; nunca lança, nunca ecoa segredo. */
export async function testarProvedor(provedor, enviados, atuais, fetchImpl = fetch) {
 const def = PROVEDORES[provedor];
 const v = {};
 for (const c of def.campos) v[c.nome] = enviados[c.nome] ?? atuais(c.nome) ?? '';
 const faltando = def.campos.filter(c => c.obrigatorio && !String(v[c.nome]).trim()).map(c => c.rotulo);
 if (faltando.length) return { ok: false, mensagem: `Falta informar: ${faltando.join(', ')}.` };
 try { return { ok: true, mensagem: await def.testar(v, fetchImpl) }; }
 catch (e) { return { ok: false, mensagem: `Não foi possível validar: ${rotuloDeErro(e, ...def.campos.filter(c => c.secreto).map(c => v[c.nome]))}` }; }
}
