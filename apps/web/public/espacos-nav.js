// Endereço e memória da navegação por espaço.
//
// O painel é uma página só: sem isto, recarregar, voltar ou mandar o link para outra pessoa sempre cai na Visão geral do
// espaço geral, e trocar de espaço sempre cai na primeira tela do outro. Aqui ficam as duas coisas que corrigem isso:
//   - o endereço (`#/geral/leads`, `#/espaco/sites/product-clients`), que o botão Voltar do navegador entende;
//   - a última tela vista em cada espaço, para voltar a ele onde se estava.
// Nada aqui toca o servidor nem decide o que o usuário pode ver: o endereço só PEDE uma tela, e quem valida é o router
// (tela que não existe ou que o tipo do espaço não tem volta para a primeira).

const ESPACO = /^[A-Za-z0-9_.-]{1,64}$/;
const TELA = /^[A-Za-z][A-Za-z0-9-]{0,40}$/;
const SUB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;   // id de um item da tela (ex.: o funil aberto em Fluxo)
const CHAVE = 'core.espacos.ultima-tela';

/** `#/geral/leads` → { espaco: '', tela: 'leads' }; `#/geral/fluxo/<uuid>` → { espaco: '', tela: 'fluxo', sub: '<uuid>' }; `#/espaco/sites` → { espaco: 'sites', tela: null }; outra coisa → null. */
export function lerEndereco(hash) {
 const partes = String(hash || '').replace(/^#\/?/, '').split('/');
 if (partes[0] === 'geral' && partes.length <= 3) {
  const tela = partes[1] ?? null, sub = partes[2] ?? null;
  if (sub !== null && !SUB.test(sub)) return null;
  return tela === null || TELA.test(tela) ? { espaco: '', tela, ...(sub ? { sub } : {}) } : null;
 }
 if (partes[0] === 'espaco' && partes.length >= 2 && partes.length <= 3 && ESPACO.test(partes[1])) {
  const tela = partes[2] ?? null;
  return tela === null || TELA.test(tela) ? { espaco: partes[1], tela } : null;
 }
 return null;
}

export const montarEndereco = (espaco, tela, sub) => `#/${espaco ? `espaco/${espaco}` : 'geral'}${tela ? `/${tela}` : ''}${sub && !espaco ? `/${sub}` : ''}`;

const guardado = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { return {}; } };

/** Última tela vista no espaço (`''` = geral), ou null. */
export const telaLembrada = espaco => { const v = guardado()[espaco || '_geral']; return typeof v === 'string' && TELA.test(v) ? v : null; };

export function lembrarTela(espaco, tela) {
 if (!TELA.test(tela)) return;
 try { localStorage.setItem(CHAVE, JSON.stringify({ ...guardado(), [espaco || '_geral']: tela })); } catch { /* sem armazenamento: só não lembra */ }
}

let suspenso = false;

/** Roda `fn` sem escrever no histórico (quem aplica um endereço não deve criar outro). */
export async function semHistorico(fn) {
 const antes = suspenso;
 suspenso = true;
 try { return await fn(); } finally { suspenso = antes; }
}

/** Registra a tela atual: lembra por espaço e põe no endereço. Mudar de tela cria um passo no histórico; repetir o mesmo, não. */
export function registrarTela(espaco, tela) {
 if (suspenso) return;
 lembrarTela(espaco, tela);
 const alvo = montarEndereco(espaco, tela);
 if (location.hash === alvo) return;
 try { history.pushState(null, '', location.pathname + location.search + alvo); } catch { /* ambiente sem histórico */ }
}

/**
 * Filtro da lista de espaços: sem acento, sem caixa, por nome ou tipo. Texto vazio mostra tudo.
 * `itens` = [{ texto }]; devolve os índices que ficam.
 */
export function filtrarEspacos(itens, consulta) {
 const limpo = s => String(s).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '').trim();
 const q = limpo(consulta);
 return itens.map((item, i) => (q && !limpo(item.texto).includes(q) ? -1 : i)).filter(i => i >= 0);
}
