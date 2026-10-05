import { vivo } from '../platform/env-vivo.mjs';
// Configurações → Integrações: quais serviços externos o Core usa e se estão ligados.
//
// SÓ ESTADO. Devolve o NOME das variáveis de ambiente que existem e que faltam, nunca o valor, e nunca chave, token ou segredo
// (nem parte deles). As chaves continuam no servidor (EasyPanel); esta rota só responde "está ligado?" e "o que falta?".
// Admin interno, como o resto do Core.

const tem = (env, nome) => String(env[nome] ?? '').trim() !== '';

// Cada integração: todas as `obrigatorias` precisam existir para valer; `opcionais` só melhoram.
// `tela`: onde se opera (chave de view do Core); `grupo`: como a tela agrupa.
export const INTEGRACOES = Object.freeze([
 { id: 'google-login', nome: 'Login com Google', grupo: 'Acesso', obrigatorias: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_ORIGIN', 'CORE_ALLOWED_EMAILS'], para: 'Quem entra no Core, com a conta Google de cada pessoa.' },
 { id: 'stripe', nome: 'Stripe', grupo: 'Cobrança', obrigatorias: ['STRIPE_SECRET_KEY'], opcionais: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'], para: 'Cobranças, links de pagamento e vendas. O segredo do webhook confirma os pagamentos.', tela: 'finance' },
 { id: 'asaas', nome: 'Asaas', grupo: 'Cobrança', obrigatorias: ['ASAAS_API_KEY'], opcionais: ['ASAAS_WEBHOOK_TOKEN', 'ASAAS_ENVIRONMENT'], para: 'Cobranças e vendas pelo Asaas.', tela: 'finance' },
 { id: 'pluggy', nome: 'Pluggy (bancos)', grupo: 'Cobrança', obrigatorias: ['PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_SECRET'], opcionais: ['PLUGGY_ITEM_IDS'], para: 'Contas bancárias e extratos no Financeiro.', tela: 'finance' },
 { id: 'meta', nome: 'Meta (anúncios)', grupo: 'Marketing', obrigatorias: ['META_APP_ID', 'META_APP_SECRET'], opcionais: ['META_LOGIN_CONFIG_ID', 'META_REDIRECT_URI'], para: 'Campanhas e gasto de anúncios. A conta é conectada dentro de cada produto.' },
 { id: 'email', nome: 'E-mail transacional', grupo: 'Marketing', obrigatorias: ['EMAIL_PROVIDER', 'EMAIL_API_KEY', 'EMAIL_FROM'], para: 'Envio de e-mail do Core (hoje, o e-mail de teste; as automações seguem em rascunho).' },
 { id: 'vercel', nome: 'Vercel', grupo: 'Tecnologia', obrigatorias: ['VERCEL_TOKEN'], opcionais: ['VERCEL_TEAM_ID'], para: 'Leitura de projetos e deploys.', tela: 'vercel' },
 { id: 'github', nome: 'GitHub', grupo: 'Tecnologia', obrigatorias: ['GITHUB_TOKEN'], alternativa: { GITHUB_USE_CLI: 'true' }, para: 'Leitura de repositórios.', tela: 'github' },
 { id: 'easypanel', nome: 'EasyPanel', grupo: 'Tecnologia', obrigatorias: ['EASYPANEL_URL', 'EASYPANEL_TOKEN'], para: 'Inventário de serviços e operações.', tela: 'easypanel' },
 { id: 'hostinger', nome: 'Hostinger (DNS)', grupo: 'Tecnologia', obrigatorias: ['HOSTINGER_API_KEY', 'HOSTINGER_DNS_ZONE'], para: 'Leitura da zona de DNS.', tela: 'dns' },
 { id: 'push', nome: 'Notificações push', grupo: 'Avisos', obrigatorias: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'], para: 'Avisos de lead novo e lembretes da agenda no aparelho.' },
]);

/** Estado de uma integração pelas variáveis do ambiente. Nunca lê valor além de "existe e não está vazio". */
export function estadoDe(def, env) {
 const faltando = def.obrigatorias.filter(n => !tem(env, n));
 const alternativaAtiva = def.alternativa && Object.entries(def.alternativa).every(([k, v]) => String(env[k] ?? '').trim().toLowerCase() === v);
 let estado = 'nao_configurado';
 if (!faltando.length || alternativaAtiva) estado = 'configurado';
 else if (faltando.length < def.obrigatorias.length) estado = 'parcial';
 const semOpcionais = estado === 'configurado' ? (def.opcionais || []).filter(n => !tem(env, n)) : [];
 return {
  id: def.id, nome: def.nome, grupo: def.grupo, para: def.para, estado,
  faltando: estado === 'configurado' ? [] : faltando,
  opcionais_ausentes: semOpcionais,
  tela: def.tela ?? null,
 };
}

export function estadoDasIntegracoes(env = process.env) {
 return INTEGRACOES.map(def => estadoDe(def, env));
}

export function integrationsStatusRoutes(router, { env = vivo.env } = {}) {
 router.get('/api/integrations/status', async ({ pool, reply }) => {
  const itens = estadoDasIntegracoes(env);
  // Meta: além do aplicativo (variáveis), há a CONTA conectada (credencial no banco, cifrada). Só se diz se existe e se venceu.
  const meta = itens.find(i => i.id === 'meta');
  try {
   const r = await pool.query("SELECT expires_at,last_error FROM marketing_credentials WHERE provider='meta' AND active LIMIT 1");
   const c = r.rows[0];
   meta.conta = c
    ? { conectada: true, expirada: c.expires_at ? Date.parse(c.expires_at) < Date.now() : false, com_erro: Boolean(c.last_error) }
    : { conectada: false };
  } catch { meta.conta = null; }   // tabela ausente ou banco indisponível: a tela só não mostra a conta
  return reply(200, { integracoes: itens });
 });
}
