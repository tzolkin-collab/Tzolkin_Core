// Configurações → Integrações. SOMENTE LEITURA: o servidor diz quais serviços externos estão ligados e quais variáveis faltam.
// Nunca aparece chave, token ou segredo (nem o servidor os envia). Para ligar um serviço, a variável vai nos segredos do EasyPanel.
import { selo } from './data-table.js';

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

const ESTADO = {
 configurado: ['Ligado', 'success'],
 parcial: ['Incompleto', 'warning'],
 nao_configurado: ['Não configurado', 'neutral'],
};

export const GRUPOS_DE_INTEGRACAO = Object.freeze(['Acesso', 'Cobrança', 'Marketing', 'Tecnologia', 'Avisos']);

/** Uma linha de frase sobre o que falta, ou nada se está tudo certo. */
export function textoDoQueFalta(i) {
 if (i.estado === 'configurado') return i.opcionais_ausentes?.length ? `Opcional, ainda não definido: ${i.opcionais_ausentes.join(', ')}.` : '';
 return `Falta definir no EasyPanel: ${i.faltando.join(', ')}.`;
}

function contaMeta(i) {
 if (!i.conta) return '';
 if (!i.conta.conectada) return 'Nenhuma conta conectada ainda: conecte dentro do produto, em Inbound → Campanhas.';
 if (i.conta.expirada) return 'A conta conectada expirou: conecte de novo.';
 if (i.conta.com_erro) return 'A última verificação da conta conectada deu erro.';
 return 'Conta conectada.';
}

function cartao(i, abrirTela) {
 const c = no('div', undefined, 'cfg-linha cfg-integracao');
 c.dataset.integracao = i.id; c.dataset.estado = i.estado;
 const t = no('div', undefined, 'cfg-linha-texto');
 const topo = no('div', undefined, 'cfg-integracao-topo');
 topo.append(no('strong', i.nome), selo(...ESTADO[i.estado]));
 t.append(topo, no('small', i.para));
 for (const texto of [textoDoQueFalta(i), i.id === 'meta' && i.estado === 'configurado' ? contaMeta(i) : '']) if (texto) t.append(no('small', texto, 'cfg-faltando'));
 c.append(t);
 if (i.tela && abrirTela) {
  const b = no('button', 'Abrir', 'secondary'); b.type = 'button';
  b.setAttribute('aria-label', `Abrir ${i.nome}`);
  b.onclick = () => abrirTela(i.tela);
  c.append(b);
 }
 return c;
}

export function montar(raiz, { api, abrirTela }) {
 const corpo = no('div', undefined, 'cfg-integracoes');
 raiz.append(corpo);
 (async () => {
  let dados;
  try { dados = await api('/api/integrations/status'); } catch (e) { corpo.append(no('p', e.message, 'config-ajuda')); return; }
  const itens = dados.integracoes || [];
  const resumo = itens.filter(i => i.estado === 'configurado').length;
  corpo.append(no('p', `${resumo} de ${itens.length} integrações ligadas.`, 'config-ajuda cfg-resumo'));
  for (const grupo of GRUPOS_DE_INTEGRACAO) {
   const doGrupo = itens.filter(i => i.grupo === grupo);
   if (!doGrupo.length) continue;
   const bloco = no('section', undefined, 'cfg-grupo-integracao');
   bloco.append(no('h3', grupo, 'config-sub'));
   for (const i of doGrupo) bloco.append(cartao(i, abrirTela));
   corpo.append(bloco);
  }
  corpo.append(no('p', 'Chaves e segredos nunca aparecem aqui. Para ligar um serviço, defina a variável indicada nos segredos do serviço no EasyPanel e reinicie.', 'cfg-nota'));
 })();
}
