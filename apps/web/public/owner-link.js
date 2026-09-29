// Vincular um recurso de provedor ao seu dono, do mesmo jeito em toda tela.
//
// Conexões mostra o que já está ligado a um cliente, contratação ou item do
// portfólio, e as sugestões. O inventário completo de cada provedor mora na aba
// dele (Vercel, GitHub, EasyPanel), e é lá que um recurso sem dono precisa poder
// ganhar um. Este módulo é o controle único: a mesma sugestão, o mesmo seletor e a
// mesma gravação, para as quatro telas não terem quatro jeitos de vincular.
import { sugerirDono, irmaosDoRepositorio, chaveDono, nomeDoDono, MODELOS } from './owner-suggestions.js';
export { MODELOS };

export const PROVEDORES = { github: 'GitHub', vercel: 'Vercel', easypanel: 'EasyPanel', hostinger: 'Hostinger', stripe: 'Stripe', asaas: 'Asaas', manual: 'Manual' };

// O tipo que um recurso de provedor vira quando é confirmado. Mesma regra da API
// (vinculoDeDeploy): o mesmo projeto tem o mesmo tipo em toda parte.
export const TIPO_PADRAO = { vercel: 'frontend', easypanel: 'backend', github: 'repository' };

const node = (tag, texto, classe) => { const el = document.createElement(tag); if (texto !== undefined) el.textContent = texto; if (classe) el.className = classe; return el; };

/** 'product:skiller' → { product_id:'skiller', engagement_id:null }. O XOR de dono é do servidor. */
export const donoEscolhido = valor => {
 const [tipo, id] = String(valor || '').split(/:(.+)/);
 if (tipo === 'product' && id) return { product_id: id, engagement_id: null };
 if (tipo === 'engagement' && id) return { product_id: null, engagement_id: id };
 return null;
};

export const valorDoDono = dono => chaveDono(dono);

/** O corpo do PUT que confirma um recurso do inventário como conexão. */
export const corpoDeVinculo = (recurso, dono) => ({
 ...dono, resource_type: TIPO_PADRAO[recurso.provider], provider: recurso.provider,
 external_id: recurso.id, display_name: recurso.name,
 // Repositório não tem ambiente; projeto de deploy que aparece aqui é o que está no
 // ar. Se for outro, a ficha do item edita — sem adivinhar em silêncio.
 environment: recurso.provider === 'github' ? null : 'production',
});

/**
 * Um a um, e parando no primeiro erro: cada vínculo é uma trilha própria, e um lote
 * que "mais ou menos" gravou é pior do que um que parou dizendo onde.
 */
export async function vincularRecursos(api, recursos, dono) {
 for (const recurso of recursos) await api('/api/product-resource-bindings', 'PUT', corpoDeVinculo(recurso, dono));
}

/** Itens do portfólio e contratações no mesmo <select>, separados por grupo. */
export function seletorDeDono(donos, selecionado = '') {
 const empresa = id => donos.tenants?.find(item => item.id === id) || null;
 const opcao = (valor, rotulo) => { const el = node('option', rotulo); el.value = valor; return el; };
 const select = document.createElement('select');
 select.append(opcao('', 'Escolher dono…'));
 const grupo = (rotulo, opcoes) => { if (!opcoes.length) return; const g = document.createElement('optgroup'); g.label = rotulo; g.append(...opcoes); select.append(g); };
 grupo('Contratações', (donos.engagements || []).filter(item => !item.archived_at).map(item => {
  return opcao(`engagement:${item.id}`, nomeDoDono({ label: item.label, cliente: empresa(item.tenant_id)?.name, modelo: item.service_model }));
 }));
 grupo('Itens do portfólio', (donos.products || []).map(item => opcao(`product:${item.id}`, item.name)));
 select.value = selecionado;
 return select;
}

/**
 * O controle de um recurso sem dono: a sugestão (ou a ausência dela, dita), o
 * seletor de dono e o botão que vincula. `contexto` é { itens, conexoes, donos, casa }.
 * `aoVincular` roda depois de gravar, para a tela se redesenhar com a verdade nova.
 */
export function controleDeVinculo({ recurso, contexto, api, aoVincular }) {
 const raiz = node('div', undefined, 'link-control');
 const sugestao = sugerirDono(recurso, contexto), select = seletorDeDono(contexto.donos);
 select.className = 'connection-owner-select';
 const erro = node('p', undefined, 'notice-inline link-error');
 if (sugestao?.dono) {
  select.value = valorDoDono(sugestao.dono);
  raiz.append(node('span', `Sugestão: ${sugestao.rotulo} — ${sugestao.motivo}.`, 'connection-suggestion'));
 } else if (sugestao?.ambiguo) {
  raiz.append(node('span', `O nome combina com mais de um dono (${sugestao.ambiguo.join('; ')}). Escolha um.`, 'connection-suggestion ambiguous'));
 } else raiz.append(node('span', 'Sem dono e sem sugestão. Escolha um.', 'detail'));

 const irmaos = irmaosDoRepositorio(recurso, contexto);
 const botoes = [];
 const acionar = lote => async () => {
  const dono = donoEscolhido(select.value);
  if (!dono) { erro.textContent = 'Escolha o dono antes de vincular.'; return; }
  erro.textContent = '';
  botoes.forEach(b => { b.disabled = true; }); select.disabled = true;
  try { await vincularRecursos(api, lote, dono); await aoVincular?.(); }
  catch (falha) { erro.textContent = falha.message; botoes.forEach(b => { b.disabled = false; }); select.disabled = false; }
 };
 const acoes = node('div', undefined, 'connection-actions');
 const vincular = node('button', 'Vincular', 'table-action'); vincular.type = 'button'; vincular.onclick = acionar([recurso]);
 botoes.push(vincular); acoes.append(select, vincular);
 if (irmaos.length) {
  const todos = node('button', `Vincular com o repositório (${irmaos.length + 1})`, 'table-action'); todos.type = 'button';
  todos.title = irmaos.map(item => `${PROVEDORES[item.provider]}: ${item.name}`).join('\n');
  todos.onclick = acionar([recurso, ...irmaos]);
  botoes.push(todos); acoes.append(todos);
 }
 raiz.append(acoes, erro);
 return raiz;
}

/**
 * O controle de vínculo para uma linha de lista (repositório, projeto da Vercel,
 * serviço do EasyPanel): quem já é o dono, ou uma linha recolhida "Sem dono" /
 * "Sugestão: X" que abre o controle. Recolhido, porque uma aba com trinta recursos
 * não pode mostrar trinta seletores.
 * `rotuloDoDono(conexao)` devolve o nome do dono de uma conexão, ou nada.
 */
export function vinculoNaLista({ recurso, contexto, api, aoVincular, rotuloDoDono }) {
 const conexao = contexto.conexoes.find(item => contexto.casa(item, recurso));
 if (conexao) return node('span', `Dono: ${rotuloDoDono(conexao) || 'registrado'}`, 'detail link-owner');
 const sugestao = sugerirDono(recurso, contexto);
 const resumo = sugestao?.dono ? `Sugestão: ${sugestao.rotulo}`
  : sugestao?.ambiguo ? 'Sem dono · o nome combina com mais de um' : 'Sem dono · vincular';
 const caixa = node('details', undefined, 'link-details' + (sugestao?.dono ? ' suggested' : ''));
 caixa.append(node('summary', resumo), controleDeVinculo({ recurso, contexto, api, aoVincular }));
 return caixa;
}
