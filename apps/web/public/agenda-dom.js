// Peças pequenas de DOM da agenda (sem regra de negócio): elemento, botão e campo de formulário.
import { createIcon } from './icons.js';

export const el = (tag, texto, classe) => {
 const n = document.createElement(tag);
 if (texto !== undefined && texto !== null) n.textContent = texto;
 if (classe) n.className = classe;
 return n;
};

export function botao(rotulo, icone, aoClicar, classe = 'secondary') {
 const b = el('button', null, classe);
 b.type = 'button';
 if (icone) b.append(createIcon(icone));
 b.append(document.createTextNode(rotulo));
 if (aoClicar) b.onclick = aoClicar;
 return b;
}

/**
 * <label>Texto<controle></label>: o texto é o PRIMEIRO nó do label (leitor de tela e os testes de tela leem assim).
 * `opcoes` = [[valor, rótulo]] vira <select>; `tipo` 'area' vira <textarea>; qualquer outro vira <input type=tipo>.
 */
export function campo(pai, rotulo, tipo = 'text', opcoes) {
 const wrap = el('label', rotulo);
 const controle = opcoes ? el('select') : el(tipo === 'area' ? 'textarea' : 'input');
 if (opcoes) for (const [valor, nome] of opcoes) { const o = el('option', nome); o.value = valor; controle.append(o); }
 else if (tipo !== 'area') controle.type = tipo;
 wrap.append(controle);
 pai.append(wrap);
 return controle;
}

export const preencher = (select, opcoes, manter) => {
 select.replaceChildren();
 for (const [valor, nome] of opcoes) { const o = el('option', nome); o.value = valor; select.append(o); }
 select.value = opcoes.some(([v]) => v === manter) ? manter : '';
};

/** Aplica estilo pelo CSSOM (a CSP do Core bloqueia o atributo style; propriedades pelo CSSOM passam). */
export const estilo = (no, props) => { for (const [k, v] of Object.entries(props)) no.style.setProperty(k, v); return no; };
