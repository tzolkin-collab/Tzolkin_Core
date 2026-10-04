// Configurações → Notificações: ligar o aviso neste aparelho e escolher o lembrete padrão da agenda.
// Tudo que depende do navegador (permissão, service worker, PushManager) é perguntado na hora, e cada impedimento
// vira uma frase clara em vez de um botão que não faz nada. `api` é a mesma função do app (lança Error com a mensagem do servidor).

export const ASSUNTOS = Object.freeze([
 ['commercial.lead', 'Lead novo', 'Quando alguém preenche um formulário de contato.'],
 ['agenda.lembrete', 'Lembretes da agenda', 'Antes de cada atividade, no tempo escolhido abaixo ou na própria atividade.'],
]);

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

/** Chave pública VAPID (base64url) -> bytes, como o PushManager exige. */
export function chaveParaBytes(texto) {
 const base64 = (texto + '='.repeat((4 - (texto.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
 const bruto = atob(base64);
 return Uint8Array.from(bruto, c => c.charCodeAt(0));
}

/** O que impede (ou não) de ligar neste aparelho. Devolve { ok:true } ou { ok:false, motivo }. */
export function podeNotificar(env = window) {
 if (!('serviceWorker' in env.navigator) || !('PushManager' in env) || !('Notification' in env)) {
  const ios = /iPhone|iPad|iPod/.test(env.navigator.userAgent || '');
  return { ok: false, motivo: ios ? 'No iPhone e no iPad, abra o Core pelo ícone da tela de início (Compartilhar → Adicionar à Tela de Início) para ativar as notificações.' : 'Este navegador não oferece notificações push.' };
 }
 if (env.Notification.permission === 'denied') return { ok: false, motivo: 'As notificações estão bloqueadas neste navegador. Libere nas configurações do site e volte aqui.' };
 return { ok: true };
}

async function assinaturaAtual() {
 const reg = await navigator.serviceWorker.ready;
 return { reg, sub: await reg.pushManager.getSubscription() };
}

export function montarNotificacoes(raiz, { api, irPara }) {
 const grupo = no('fieldset', undefined, 'config-grupo');
 grupo.append(no('legend', 'Notificações', 'sr-only'));
 const corpo = no('div', undefined, 'config-notif');
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 grupo.append(corpo, aviso);
 raiz.append(grupo);
 const dizer = (texto, erro = false) => { aviso.textContent = texto; aviso.classList.toggle('erro', erro); };

 async function desenhar() {
  let cfg;
  try { cfg = await api('/api/push/config'); } catch (e) { corpo.replaceChildren(no('p', e.message, 'config-ajuda')); return; }
  const frag = [];
  if (!cfg.enabled) {
   frag.push(no('p', 'As notificações ainda não foram ligadas neste servidor (faltam as chaves VAPID). Quando forem, o botão aparece aqui.', 'config-ajuda'));
  } else {
   const pode = podeNotificar();
   if (!pode.ok) frag.push(no('p', pode.motivo, 'config-ajuda'));
   else frag.push(await blocoDoAparelho(cfg));
  }
  frag.push(await blocoDaAgenda());
  corpo.replaceChildren(...frag.filter(Boolean));
 }

 async function blocoDoAparelho(cfg) {
  const bloco = no('div', undefined, 'config-bloco');
  const { reg, sub } = await assinaturaAtual();
  let estado = { subscribed: false };
  if (sub) { try { estado = await api('/api/push/status', 'POST', { endpoint: sub.endpoint }); } catch { /* sem estado: trata como desligado */ } }
  bloco.append(no('h3', 'Neste aparelho', 'config-sub'));
  if (!estado.subscribed) {
   bloco.append(no('p', 'Receba avisos mesmo com o Core fechado.', 'config-ajuda'));
   const botao = no('button', 'Ativar neste aparelho', 'primary'); botao.type = 'button';
   botao.onclick = async () => {
    botao.disabled = true;
    try {
     const permissao = await Notification.requestPermission();
     if (permissao !== 'granted') { dizer('Permissão não concedida. Sem ela o navegador não mostra avisos.', true); botao.disabled = false; return; }
     const nova = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(cfg.publicKey) });
     await api('/api/push/subscriptions', 'PUT', { subscription: nova.toJSON(), topics: ASSUNTOS.map(a => a[0]) });
     dizer('Notificações ativadas neste aparelho.');
     await desenhar();
    } catch (e) { dizer(e.message || 'Não foi possível ativar.', true); botao.disabled = false; }
   };
   bloco.append(botao);
   return bloco;
  }
  const ativos = new Set(estado.topics);
  for (const [chave, titulo, ajuda] of ASSUNTOS) {
   const l = no('label', undefined, 'config-opcao');
   const c = document.createElement('input'); c.type = 'checkbox'; c.checked = ativos.has(chave);
   c.onchange = async () => {
    c.checked ? ativos.add(chave) : ativos.delete(chave);
    if (!ativos.size) { c.checked = true; ativos.add(chave); dizer('Deixe pelo menos um assunto ligado, ou use "Desativar neste aparelho".', true); return; }
    try { await api('/api/push/subscriptions', 'PUT', { subscription: sub.toJSON(), topics: ASSUNTOS.map(a => a[0]).filter(k => ativos.has(k)) }); dizer('Salvo.'); }
    catch (e) { dizer(e.message, true); }
   };
   const t = no('span', undefined, 'config-opcao-texto'); t.append(no('strong', titulo), no('small', ajuda));
   l.append(c, t); bloco.append(l);
  }
  const acoes = no('div', undefined, 'config-acoes');
  const teste = no('button', 'Enviar teste', 'secondary'); teste.type = 'button';
  teste.onclick = async () => { teste.disabled = true; try { const r = await api('/api/push/test', 'POST', {}); dizer(r.enviados ? 'Teste enviado. Deve chegar em instantes.' : 'O envio falhou. Tente desativar e ativar de novo.', !r.enviados); } catch (e) { dizer(e.message, true); } teste.disabled = false; };
  const desligar = no('button', 'Desativar neste aparelho', 'secondary'); desligar.type = 'button';
  desligar.onclick = async () => {
   desligar.disabled = true;
   try { await api('/api/push/subscriptions/' + estado.id, 'DELETE'); await sub.unsubscribe(); dizer('Notificações desativadas neste aparelho.'); await desenhar(); }
   catch (e) { dizer(e.message, true); desligar.disabled = false; }
  };
  acoes.append(teste, desligar);
  bloco.append(acoes);
  return bloco;
 }

 // O tempo de aviso padrão da agenda é da agenda: mora em Configurações → Agenda. Aqui só o atalho.
 async function blocoDaAgenda() {
  if (!irPara) return null;
  const bloco = no('div', undefined, 'config-bloco');
  bloco.append(no('h3', 'Quando avisar', 'config-sub'));
  bloco.append(no('p', 'Cada atividade pode ter o seu lembrete; as que não têm usam o padrão da agenda.', 'config-ajuda'));
  const ir = no('button', 'Escolher o lembrete padrão', 'secondary'); ir.type = 'button';
  ir.onclick = () => irPara('agenda');
  const acoes = no('div', undefined, 'config-acoes'); acoes.append(ir);
  bloco.append(acoes);
  return bloco;
 }

 desenhar();
}

export const montar = montarNotificacoes;
