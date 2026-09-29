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
 * A linha de dono de um recurso, nas listas dos provedores (repositório, projeto da
 * Vercel, serviço do EasyPanel). Uma linha só, sempre no mesmo formato:
 *   [Dono] Kalidash sob demanda
 *   [Sugestão] Kalidash sob demanda   [Vincular] [Com o repositório (2)]  Outro dono…
 *   [Ambíguo] o nome combina com mais de um   Escolher…
 *   [Sem dono]   Vincular…
 * A sugestão se aceita com um clique, sem abrir nada; o motivo por extenso é o
 * tooltip. O seletor só aparece quando o operador quer outro dono.
 * `contexto` é { itens, conexoes, donos, casa }; `rotuloDoDono(conexao)` devolve o
 * nome do dono de uma conexão; `aoVincular` roda depois de gravar.
 */
export function vinculoNaLista({ recurso, contexto, api, aoVincular, rotuloDoDono }) {
 const linha = node('div', undefined, 'own-line');
 const etiqueta = (texto, tom) => node('span', texto, `own-tag ${tom}`);
 const conexao = contexto.conexoes.find(item => contexto.casa(item, recurso));
 if (conexao) {
  linha.append(etiqueta('Dono', 'linked'), node('span', rotuloDoDono(conexao) || 'registrado', 'own-name'));
  return linha;
 }
 const sugestao = sugerirDono(recurso, contexto);
 const erro = node('span', undefined, 'notice-inline link-error');
 const botoes = [];
 const gravar = async (lote, dono) => {
  if (!dono) { erro.textContent = 'Escolha o dono antes de vincular.'; return; }
  erro.textContent = ''; botoes.forEach(b => { b.disabled = true; });
  try { await vincularRecursos(api, lote, dono); await aoVincular?.(); }
  catch (falha) { erro.textContent = falha.message; botoes.forEach(b => { b.disabled = false; }); }
 };
 const botao = (rotulo, classe, acao) => { const b = node('button', rotulo, classe); b.type = 'button'; b.onclick = acao; botoes.push(b); return b; };

 // Outro dono: recolhido, com o seletor e o botão dentro.
 const outroDono = rotulo => {
  const caixa = node('details', undefined, 'other-owner'), select = seletorDeDono(contexto.donos);
  select.className = 'connection-owner-select';
  caixa.append(node('summary', rotulo), select, botao('Vincular ao escolhido', 'mini', () => gravar([recurso], donoEscolhido(select.value))));
  return caixa;
 };

 if (sugestao?.dono) {
  linha.title = sugestao.motivo;
  linha.append(etiqueta('Sugestão', 'suggested'), node('span', sugestao.rotulo, 'own-name'), botao('Vincular', 'mini primary', () => gravar([recurso], sugestao.dono)));
  const irmaos = irmaosDoRepositorio(recurso, contexto);
  if (irmaos.length) {
   const todos = botao(`Com o repositório (${irmaos.length + 1})`, 'mini', () => gravar([recurso, ...irmaos], sugestao.dono));
   todos.title = irmaos.map(item => `${PROVEDORES[item.provider]}: ${item.name}`).join('\n');
   linha.append(todos);
  }
  linha.append(outroDono('Outro dono…'));
 } else if (sugestao?.ambiguo) {
  linha.title = `O nome combina com: ${sugestao.ambiguo.join('; ')}`;
  linha.append(etiqueta('Ambíguo', 'warn'), node('span', 'o nome combina com mais de um dono', 'own-name muted'), outroDono('Escolher…'));
 } else linha.append(etiqueta('Sem dono', 'none'), outroDono('Vincular…'));
 linha.append(erro);
 return linha;
}
