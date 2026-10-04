// Configurações → Teclado. Só a lista (leitura): os atalhos são fixos e valem na agenda.
import { listaDeAtalhos } from './agenda-atalhos.js';

export function montar(raiz) {
 const caixa = document.createElement('div');
 caixa.className = 'cfg-atalhos';
 caixa.append(...listaDeAtalhos());
 raiz.append(caixa);
}
