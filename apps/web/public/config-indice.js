// Configurações: o registro das seções. Cada uma diz de quem é (escopo), em que grupo aparece e como carregar.
// Uma seção nova entra aqui e em assets.mjs; a casca (settings.js) não muda. Plano completo: docs/CONFIGURACOES.md.
//
// Escopos: o que a pessoa precisa saber ANTES de mexer — vale só neste navegador, na conta dela, ou para todo mundo.
export const ESCOPOS = Object.freeze({
 navegador: 'Só neste navegador',
 conta: 'Sua conta',
 espaco: 'Todo o espaço',
});

export const GRUPOS = Object.freeze(['Pessoal', 'Espaço de trabalho', 'Administração']);

export const SECOES = Object.freeze([
 { id: 'perfil', titulo: 'Perfil e sessão', grupo: 'Pessoal', escopo: 'conta', descricao: 'Quem você é no Core, o que pode fazer e até quando vale o seu acesso.', carregar: () => import('./config-perfil.js') },
 { id: 'aparencia', titulo: 'Aparência', grupo: 'Pessoal', escopo: 'navegador', descricao: 'Tema claro ou escuro.', carregar: () => import('./config-aparencia.js') },
 { id: 'notificacoes', titulo: 'Notificações', grupo: 'Pessoal', escopo: 'conta', descricao: 'Avisos neste aparelho e lembretes da agenda.', carregar: () => import('./notificacoes.js') },
 { id: 'integracoes', titulo: 'Integrações', grupo: 'Espaço de trabalho', escopo: 'espaco', descricao: 'Quais serviços externos o Core usa e se estão ligados. As chaves ficam no servidor: aqui só aparece se existem e o que falta.', carregar: () => import('./config-integracoes.js') },
 { id: 'agenda', titulo: 'Agenda', grupo: 'Espaço de trabalho', escopo: null, descricao: 'Lembretes e como a agenda abre. Cada bloco diz de quem é.', carregar: () => import('./config-agenda.js') },
 { id: 'aplicativo', titulo: 'Aplicativo', grupo: 'Pessoal', escopo: 'navegador', descricao: 'Instalar o Core como aplicativo e ver o que o navegador permite.', carregar: () => import('./config-aplicativo.js') },
 { id: 'teclado', titulo: 'Teclado', grupo: 'Pessoal', escopo: 'navegador', descricao: 'Atalhos da agenda. Valem com o foco fora de campos de texto.', carregar: () => import('./config-teclado.js') },
 { id: 'acessos', titulo: 'Acessos', grupo: 'Administração', escopo: 'espaco', descricao: 'Quem pode entrar no Core e com que papel. Só administradores alteram.', carregar: () => import('./config-acessos.js') },
 { id: 'auditoria', titulo: 'Auditoria', grupo: 'Administração', escopo: 'espaco', descricao: 'O que mudou, por quem e quando.', carregar: () => import('./config-auditoria.js') },
]);

/** Selo de escopo como elemento: a casca o põe no título da seção; seções de escopo misto o põem em cada bloco. */
export function seloDeEscopo(escopo) {
 const e = document.createElement('span');
 e.className = 'cfg-escopo'; e.dataset.escopo = escopo; e.textContent = ESCOPOS[escopo];
 return e;
}

// A seção que abre primeiro. Fixa (e não "a primeira da lista"): Perfil fica no topo do menu, mas Aparência é o ponto de partida.
export const SECAO_PADRAO = 'aparencia';
export const secaoPorId = id => SECOES.find(s => s.id === id) || null;
