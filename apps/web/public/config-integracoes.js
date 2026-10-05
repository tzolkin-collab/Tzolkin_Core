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

function cartao(i, abrirTela, cred, aoMudar) {
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
 if (cred) {
  const b = no('button', 'Configurar', 'secondary'); b.type = 'button'; b.dataset.acao = 'configurar';
  b.setAttribute('aria-label', `Configurar ${i.nome}`); b.setAttribute('aria-expanded', 'false');
  let aberto = null;
  b.onclick = () => {
   if (aberto) { aberto.remove(); aberto = null; b.setAttribute('aria-expanded', 'false'); return; }
   aberto = formularioDeCredenciais(cred, aoMudar);
   c.append(aberto); b.setAttribute('aria-expanded', 'true');
   aberto.querySelector('input')?.focus();
  };
  c.append(b);
 }
 return c;
}

const DATA = iso => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };

/**
 * Formulário de credenciais de um provedor. O valor de segredo NUNCA é preenchido de volta (o servidor nem o envia): campo vazio = não mudar.
 * Salvar testa no provedor antes de gravar; se o provedor recusar, nada muda. Campo definido pela tela pode ser removido (volta a valer o .env).
 */
function formularioDeCredenciais(cred, aoMudar) {
 const f = no('form', undefined, 'cfg-cred-form'); f.noValidate = true;
 const entradas = new Map();
 for (const c of cred.provedor.campos) {
  const l = no('label', undefined, 'cfg-cred-campo');
  l.append(no('span', c.rotulo + (c.obrigatorio ? '' : '')));
  const inp = document.createElement('input');
  inp.name = c.nome; inp.autocomplete = 'off'; inp.spellcheck = false;
  inp.type = c.secreto ? 'password' : 'text';
  if (!c.secreto) inp.value = c.valor || '';
  else inp.placeholder = c.origem === 'tela' ? 'Definido pela tela — digite para trocar' : c.origem === 'servidor' ? 'Vem do servidor — digite para sobrepor' : 'Cole aqui';
  inp.dataset.original = c.secreto ? '' : (c.valor || '');
  entradas.set(c.nome, inp);
  l.append(inp);
  const origem = c.origem === 'tela' ? `Definido pela tela${c.atualizado_por ? ` por ${c.atualizado_por}` : ''}${c.atualizado_em ? ` em ${DATA(c.atualizado_em)}` : ''}${c.impressao ? ` · impressão ${c.impressao.slice(0, 8)}` : ''}.`
   : c.origem === 'servidor' ? 'Vem do servidor (variável de ambiente).' : 'Ainda não definido.';
  l.append(no('small', [c.ajuda, origem].filter(Boolean).join(' ')));
  if (c.origem === 'tela') {
   const r = no('button', 'Remover da tela', 'quiet cfg-cred-remover'); r.type = 'button';
   r.onclick = async () => {
    r.disabled = true;
    try { await cred.api(`/api/integrations/credentials/${cred.provedor.id}/${c.nome}`, 'DELETE'); await aoMudar('Removido da tela. Passa a valer o que o servidor tiver.'); }
    catch (e) { dizer(e.message, true); r.disabled = false; }
   };
   l.append(r);
  }
  f.append(l);
 }
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 const dizer = (t, erro = false) => { aviso.textContent = t; aviso.classList.toggle('erro', erro); };
 const mudados = () => { const v = {}; for (const [nome, inp] of entradas) { const x = inp.value.trim(); if (x && x !== inp.dataset.original) v[nome] = x; } return v; };
 const acoes = no('div', undefined, 'config-acoes');
 const testar = no('button', 'Testar', 'secondary'); testar.type = 'button';
 const salvar = no('button', 'Salvar', 'primary'); salvar.type = 'submit';
 const bloqueado = !cred.pronto;
 testar.disabled = salvar.disabled = bloqueado;
 testar.onclick = async () => {
  testar.disabled = true; dizer('Testando…');
  try { const r = await cred.api('/api/integrations/credentials/test', 'POST', { provider: cred.provedor.id, valores: mudados() }); dizer(r.mensagem, !r.ok); }
  catch (e) { dizer(e.message, true); }
  testar.disabled = bloqueado;
 };
 f.onsubmit = async ev => {
  ev.preventDefault();
  const valores = mudados();
  if (!Object.keys(valores).length) { dizer('Preencha o que quer trocar.', true); return; }
  salvar.disabled = testar.disabled = true; dizer('Testando e salvando…');
  try {
   const r = await cred.api('/api/integrations/credentials', 'PUT', { provider: cred.provedor.id, valores });
   await aoMudar(`Salvo. ${r.mensagem} As telas podem levar até 30 segundos para refletir.`);
  } catch (e) { dizer(e.message, true); salvar.disabled = testar.disabled = bloqueado; }
 };
 acoes.append(testar, salvar);
 // Push: as chaves VAPID se GERAM aqui (o par nasce no servidor; a privada nunca vem para a tela).
 if (cred.provedor.id === 'push') {
  const jaTem = cred.provedor.campos.some(c => c.nome === 'VAPID_PUBLIC_KEY' && c.definido);
  const gerar = no('button', jaTem ? 'Gerar chaves novas…' : 'Gerar chaves', 'secondary'); gerar.type = 'button'; gerar.dataset.acao = 'gerar';
  gerar.disabled = bloqueado;
  let confirmando = false;
  gerar.onclick = async () => {
   if (jaTem && !confirmando) {
    confirmando = true; gerar.textContent = 'Confirmar: gerar e desativar os aparelhos atuais';
    dizer('Trocar as chaves desativa os aparelhos que já ativaram as notificações: cada pessoa precisa ativar de novo em Configurações → Notificações. Clique de novo para confirmar.', true);
    return;
   }
   gerar.disabled = true; dizer('Gerando…');
   try {
    const assunto = entradas.get('VAPID_SUBJECT')?.value.trim();
    const r = await cred.api('/api/integrations/credentials/push/gerar', 'POST', { confirmar: jaTem, ...(assunto ? { subject: assunto } : {}) });
    await aoMudar(`Chaves geradas e guardadas. ${r.aparelhos_desativados ? `${r.aparelhos_desativados} aparelho(s) foram desativados: cada pessoa ativa de novo em Notificações. ` : ''}A chave privada ficou só no servidor.`);
   } catch (e) { dizer(e.message, true); gerar.disabled = bloqueado; confirmando = false; gerar.textContent = jaTem ? 'Gerar chaves novas…' : 'Gerar chaves'; }
  };
  acoes.append(gerar);
 }
 f.append(acoes, aviso);
 if (!cred.migracao) dizer('Disponível assim que a atualização do banco (migração 050) for aplicada.', true);
 else if (!cred.chave) dizer('Falta definir CORE_SECRETS_KEY no servidor para guardar credenciais pela tela.', true);
 const hist = cred.provedor.historico || [];
 if (hist.length) {
  const d = no('details', undefined, 'cfg-cred-hist'); d.append(no('summary', 'Histórico'));
  for (const h of hist) d.append(no('p', `${DATA(h.em)} · ${h.nome} ${h.acao === 'set' ? 'definido' : 'removido'} por ${h.por}`, 'config-ajuda'));
  f.append(d);
 }
 return f;
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
  // Endereço que o Google exige cadastrado, para copiar sem errar (erro redirect_uri_mismatch).
  if (s.retorno) { const r = no('small', 'Endereço de retorno a cadastrar no Google Cloud (URIs de redirecionamento autorizados): ', 'cfg-faltando'); const code = no('code', s.retorno, 'cfg-codigo'); r.append(code); t.append(r); }
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
 const google = blocoDoGoogle(api, retorno);
 corpo.append(google);
 const lista = no('div', undefined, 'cfg-integracoes-lista');
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 corpo.append(aviso, lista);

 async function desenhar(mensagem) {
  let dados, credenciais = null;
  try { dados = await api('/api/integrations/status'); } catch (e) { lista.replaceChildren(no('p', e.message, 'config-ajuda')); return; }
  try { credenciais = await api('/api/integrations/credentials'); } catch { /* sem a tela de credenciais: os cartões ficam só de leitura */ }
  const itens = dados.integracoes || [];
  const resumo = itens.filter(i => i.estado === 'configurado').length;
  const nos = [no('p', `${resumo} de ${itens.length} integrações ligadas.`, 'config-ajuda cfg-resumo')];
  for (const grupo of GRUPOS_DE_INTEGRACAO) {
   const doGrupo = itens.filter(i => i.grupo === grupo);
   if (!doGrupo.length) continue;
   const bloco = no('section', undefined, 'cfg-grupo-integracao');
   bloco.append(no('h3', grupo, 'config-sub'));
   for (const i of doGrupo) {
    const provedor = credenciais?.provedores.find(p => p.id === i.id);
    const cred = provedor ? { provedor, api, migracao: credenciais.migracao, chave: credenciais.chave, pronto: credenciais.migracao && credenciais.chave } : null;
    bloco.append(cartao(i, abrirTela, cred, desenhar));
   }
   nos.push(bloco);
  }
  nos.push(no('p', 'Segredos nunca aparecem aqui, nem depois de salvos. Quem ainda não foi movido para a tela continua vindo das variáveis do servidor (EasyPanel).', 'cfg-nota'));
  lista.replaceChildren(...nos);
  aviso.textContent = mensagem || ''; aviso.classList.remove('erro');
 }
 desenhar();
}
