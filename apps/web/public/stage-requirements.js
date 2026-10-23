// Requisitos de etapa (fase 6 do funil): o aviso do que falta quando um movimento é bloqueado e o gerenciador dos requisitos
// de cada funil. As regras moram na API (modules/commercial-gates.mjs); aqui só se monta a tela. Sem estilo inline (a CSP não deixa).
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const GATES = { ENTER: 'Para entrar na etapa', EXIT: 'Para sair da etapa' };
const TIPOS = { ACTION: 'Tarefa a concluir', FIELD: 'Campo a preencher' };

/** O que falta para o movimento acontecer. Tarefa já foi criada para o registro; campo se preenche em "Dados do espaço". */
export function blockersNotice(blockers) {
 const box = el('div', null, 'notice-inline blockers'); box.setAttribute('role', 'alert');
 box.append(el('p', blockers.length > 1 ? 'Ainda não dá para mover. Faltam estes requisitos da etapa:' : 'Ainda não dá para mover. Falta este requisito da etapa:'));
 const lista = el('ul');
 for (const b of blockers) lista.append(el('li', b.kind === 'FIELD'
  ? `${b.title} — preencha o campo "${b.field_key}" em Dados do espaço.`
  : `${b.title} — a tarefa foi criada; conclua em Tarefas.`));
 box.append(lista);
 return box;
}
