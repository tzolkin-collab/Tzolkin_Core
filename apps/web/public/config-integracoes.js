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

const RETORNO_GOOGLE = {
 ok: ['Conta Google conectada. Agora dá para criar salas do Meet nas atividades.', false],
 denied: ['A autorização foi cancelada no Google. Nada foi gravado.', true],
 expired: ['O pedido de conexão expirou. Tente conectar de novo.', true],
 scope: ['A permissão de criar eventos na agenda não foi concedida. Conecte de novo e deixe essa opção marcada.', true],
 config: ['O servidor não está pronto para guardar a conexão (faltam variáveis). Veja abaixo o que falta.', true],
 error: ['Não foi possível concluir a conexão com o Google. Tente de novo.', true],
};

/** Google Agenda e Meet: a conta é do OPERADOR (cada um conecta a sua); o Core guarda só o token de uso contínuo, cifrado. */
function blocoDoGoogle(api, retorno) {
 const bloco = no('section', undefined, 'cfg-grupo-integracao cfg-google');
 bloco.append(no('h3', 'Google Agenda e Meet', 'config-sub'));
 const linha = no('div', undefined, 'cfg-linha');
 const t = no('div', undefined, 'cfg-linha-texto');
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 const dizer = (texto, erro = false) => { aviso.textContent = texto; aviso.classList.toggle('erro', erro); };
 if (retorno && RETORNO_GOOGLE[retorno]) dizer(...RETORNO_GOOGLE[retorno]);
 linha.append(t);
 bloco.append(linha, aviso);
 (async () => {
  let s;
  try { s = await api('/api/google/calendar/status'); } catch (e) { t.append(no('small', e.message)); return; }
  const topo = no('div', undefined, 'cfg-integracao-topo');
  topo.append(no('strong', 'Sua conta Google'));
  t.append(topo, no('small', 'Cria a sala do Meet junto com a atividade, na SUA agenda, e acompanha mudança de horário e cancelamento. Só pede permissão para eventos.'));
  if (!s.migracao) { topo.append(selo('Indisponível', 'neutral')); t.append(no('small', 'Disponível assim que a atualização do banco (migração 049) for aplicada.', 'cfg-faltando')); return; }
  if (!s.cliente || !s.chave) {
   topo.append(selo('Incompleto', 'warning'));
   const falta = [!s.cliente && 'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET', !s.chave && 'CORE_SECRETS_KEY'].filter(Boolean).join(' e ');
   t.append(no('small', `Falta definir no EasyPanel: ${falta}.`, 'cfg-faltando'));
   return;
  }
  if (s.conectado) {
   topo.append(selo('Conectada', 'success'));
   t.append(no('small', s.email ? `Conectada como ${s.email}.` : 'Conta conectada.', 'cfg-faltando'));
   const b = no('button', 'Desconectar', 'secondary'); b.type = 'button';
   b.onclick = async () => {
    b.disabled = true;
    try { await api('/api/google/calendar/disconnect', 'POST', {}); location.assign('/?secao=integracoes'); } catch (e) { dizer(e.message, true); b.disabled = false; }
   };
   linha.append(b);
   return;
  }
  topo.append(selo('Não conectada', 'neutral'));
  const b = no('button', 'Conectar conta Google', 'primary'); b.type = 'button';
  b.onclick = async () => {
   b.disabled = true;
   try { const r = await api('/api/google/calendar/authorize', 'POST', {}); location.assign(r.url); } catch (e) { dizer(e.message, true); b.disabled = false; }
  };
  linha.append(b);
 })();
 return bloco;
}

export function montar(raiz, { api, abrirTela, retorno }) {
 const corpo = no('div', undefined, 'cfg-integracoes');
 raiz.append(corpo);
 corpo.append(blocoDoGoogle(api, retorno));
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
