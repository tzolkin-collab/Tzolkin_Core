// Catálogo das credenciais que a TELA pode guardar (etapa 1: Vercel, GitHub, EasyPanel e Hostinger), com a regra de cada campo e o
// "Testar" de cada provedor. O nome do campo é o MESMO da variável de ambiente que ele substitui (VERCEL_TOKEN etc.): é isso que faz
// os módulos antigos, que leem `env.VERCEL_TOKEN`, enxergarem o valor da tela sem mudar a leitura (ver env-vivo.mjs).
import { createVercelAdapter } from '../integrations/vercel.mjs';
import { createGithubAdapter } from '../integrations/github.mjs';
import { createEasypanelAdapter } from '../integrations/easypanel.mjs';
import { createHostingerDnsAdapter } from '../integrations/hostinger-dns.mjs';
import { scrub } from './secrets.mjs';

const LIMPO = /^[\x21-\x7e]{8,500}$/;                       // segredo: ASCII visível, sem espaço nem quebra de linha
const segredo = valor => LIMPO.test(valor) ? null : 'Use de 8 a 500 caracteres, sem espaços nem quebras de linha.';
const dominio = valor => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(valor) ? null : 'Informe um domínio, como tzolkin.cloud.';
const idDoTime = valor => /^[\w-]{3,64}$/.test(valor) ? null : 'ID do time inválido (letras, números, _ e -).';
const enderecoEasypanel = valor => {
 let u; try { u = new URL(valor); } catch { return 'Informe o endereço completo, com https://.'; }
 if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !['/', '/api', '/api/'].includes(u.pathname)) return 'Use o endereço https do painel, sem usuário, parâmetros ou caminho (só / ou /api).';
 return null;
};

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
