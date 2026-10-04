// Configurações: o registro das seções. Cada uma diz de quem é (escopo), em que grupo aparece e como carregar.
// Uma seção nova entra aqui e em assets.mjs; a casca (settings.js) não muda. Plano completo: docs/CONFIGURACOES.md.
//
// Escopos: o que a pessoa precisa saber ANTES de mexer — vale só neste navegador, na conta dela, ou para todo mundo.
export const ESCOPOS = Object.freeze({
 navegador: 'Só neste navegador',
 conta: 'Sua conta',
 espaco: 'Todo o espaço',
});

export const GRUPOS = Object.freeze(['Pessoal']);

export const SECOES = Object.freeze([
 { id: 'aparencia', titulo: 'Aparência', grupo: 'Pessoal', escopo: 'navegador', descricao: 'Tema claro ou escuro.', carregar: () => import('./config-aparencia.js') },
 { id: 'notificacoes', titulo: 'Notificações', grupo: 'Pessoal', escopo: 'conta', descricao: 'Avisos neste aparelho e lembretes da agenda.', carregar: () => import('./notificacoes.js') },
 { id: 'aplicativo', titulo: 'Aplicativo', grupo: 'Pessoal', escopo: 'navegador', descricao: 'Instalar o Core como aplicativo e ver o que o navegador permite.', carregar: () => import('./config-aplicativo.js') },
]);

export const SECAO_PADRAO = SECOES[0].id;
export const secaoPorId = id => SECOES.find(s => s.id === id) || null;
