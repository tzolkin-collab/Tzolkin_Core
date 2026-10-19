// Configurações → Notificações: ligar o aviso neste aparelho e escolher o lembrete padrão da agenda.
// Tudo que depende do navegador (permissão, service worker, PushManager) é perguntado na hora, e cada impedimento
// vira uma frase clara em vez de um botão que não faz nada. `api` é a mesma função do app (lança Error com a mensagem do servidor).

import {
 SONS_NOTIFICACAO,
 SOM_PADRAO,
 CHAVE_STORAGE_SOM_LEAD,
 CHAVE_STORAGE_SOM_AGENDA,
 obterSomEscolhido,
 definirSomEscolhido,
 obterSomPorTopico,
 definirSomPorTopico,
 obterSomCustomizado,
 salvarSomCustomizado,
 removerSomCustomizado,
 tocarSomNotificacao,
} from './notification-sound.js';

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

const mesmosBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

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
  frag.push(blocoDoSom());
  frag.push(await blocoDaAgenda());
  corpo.replaceChildren(...frag.filter(Boolean));
 }

 function blocoDoSom() {
  const bloco = no('div', undefined, 'config-bloco');
  bloco.append(no('h3', 'Som da notificação', 'config-sub'));
  bloco.append(no('p', 'Escolha os sons reproduzidos neste navegador ou adicione barulhos personalizados do seu computador.', 'config-ajuda'));

  const customSom = obterSomCustomizado();
  const somAtual = obterSomEscolhido();

  // 1. Som padrão
  const titPadrao = no('h4', 'Som padrão');
  titPadrao.style.cssText = 'margin-top: 8px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);';
  bloco.append(titPadrao);

  for (const [id, som] of Object.entries(SONS_NOTIFICACAO)) {
   if (id === 'custom' && !customSom) continue;
   const l = no('label', undefined, 'config-opcao');
   const r = document.createElement('input');
   r.type = 'radio';
   r.name = 'notif-som';
   r.value = id;
   r.checked = id === somAtual;
   r.onchange = () => {
    definirSomEscolhido(id);
    if (id !== 'none') tocarSomNotificacao(id);
    dizer('Som padrão salvo.');
   };

   const t = no('span', undefined, 'config-opcao-texto');
   const nomeExibido = id === 'custom' ? `Personalizado (${customSom?.nome || 'áudio'})` : som.nome;
   t.append(no('strong', nomeExibido), no('small', som.descricao));
   l.append(r, t);

   if (id !== 'none') {
    const btnOuvir = no('button', 'Ouvir', 'secondary mini');
    btnOuvir.type = 'button';
    btnOuvir.onclick = ev => {
     ev.preventDefault();
     tocarSomNotificacao(id);
    };
    l.append(btnOuvir);
   }

   bloco.append(l);
  }

  // 2. Barulho personalizado (upload)
  const areaCustom = no('div', undefined, 'config-bloco');
  areaCustom.style.cssText = 'border-top: 1px solid var(--line-soft); margin-top: 12px; padding-top: 12px;';
  const titCustom = no('h4', 'Adicionar outro barulho (personalizado)');
  titCustom.style.cssText = 'font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);';
  areaCustom.append(titCustom);
  areaCustom.append(no('p', 'Envie um arquivo de som (MP3, WAV, OGG) para tocar nas notificações deste aparelho.', 'config-ajuda'));

  const inputArquivo = document.createElement('input');
  inputArquivo.type = 'file';
  inputArquivo.accept = 'audio/*';
  inputArquivo.style.display = 'none';

  inputArquivo.onchange = () => {
   const file = inputArquivo.files?.[0];
   if (!file) return;
   if (file.size > 2 * 1024 * 1024) {
    dizer('Arquivo muito grande. Escolha um áudio de até 2 MB.', true);
    inputArquivo.value = '';
    return;
   }
   const reader = new FileReader();
   reader.onload = e => {
    const dataUrl = e.target?.result;
    if (dataUrl && typeof dataUrl === 'string') {
     salvarSomCustomizado(dataUrl, file.name);
     definirSomEscolhido('custom');
     tocarSomNotificacao('custom');
     dizer(`Som "${file.name}" salvo e definido como padrão.`);
     desenhar();
    }
   };
   reader.onerror = () => {
    dizer('Não foi possível ler o arquivo de áudio.', true);
   };
   reader.readAsDataURL(file);
  };

  const acoesCustom = no('div', undefined, 'config-acoes');
  const btnUpload = no('button', customSom ? 'Trocar arquivo de som' : 'Escolher arquivo de áudio', 'secondary');
  btnUpload.type = 'button';
  btnUpload.onclick = () => inputArquivo.click();
  acoesCustom.append(inputArquivo, btnUpload);

  if (customSom) {
   const btnOuvirCustom = no('button', 'Ouvir som personalizado', 'secondary');
   btnOuvirCustom.type = 'button';
   btnOuvirCustom.onclick = () => tocarSomNotificacao('custom');

   const btnRemoverCustom = no('button', 'Remover som personalizado', 'secondary');
   btnRemoverCustom.type = 'button';
   btnRemoverCustom.onclick = () => {
    removerSomCustomizado();
    if (obterSomEscolhido() === 'custom') definirSomEscolhido(SOM_PADRAO);
    dizer('Som personalizado removido.');
    desenhar();
   };

   acoesCustom.append(btnOuvirCustom, btnRemoverCustom);
  }

  areaCustom.append(acoesCustom);
  bloco.append(areaCustom);

  // 3. Sons específicos por assunto
  const areaTopicos = no('div', undefined, 'config-bloco');
  areaTopicos.style.cssText = 'border-top: 1px solid var(--line-soft); margin-top: 12px; padding-top: 12px;';
  const titAssunto = no('h4', 'Som específico por assunto');
  titAssunto.style.cssText = 'font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);';
  areaTopicos.append(titAssunto);
  areaTopicos.append(no('p', 'Diferencie o toque de novos contatos e de compromissos da agenda.', 'config-ajuda'));

  const criarLinhaTopico = (titulo, topico, somRecomendado) => {
   const linha = no('div', undefined, 'config-linha-seletor');
   linha.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-soft); flex-wrap: wrap;';

   const info = no('div', undefined, 'config-opcao-texto');
   info.append(no('strong', titulo));

   const controles = no('div', undefined, 'config-acoes');
   controles.style.cssText = 'margin: 0; align-items: center;';

   const select = document.createElement('select');
   select.className = 'field-input';
   select.style.cssText = 'padding: 5px 8px; font-size: 13px;';

   const opPadrao = document.createElement('option');
   opPadrao.value = 'padrao';
   opPadrao.textContent = 'Mesmo som do padrão';
   select.append(opPadrao);

   const somSalvo = localStorage.getItem(topico === 'commercial.lead' ? CHAVE_STORAGE_SOM_LEAD : CHAVE_STORAGE_SOM_AGENDA);

   for (const [id, som] of Object.entries(SONS_NOTIFICACAO)) {
    if (id === 'custom' && !customSom) continue;
    const op = document.createElement('option');
    op.value = id;
    let label = id === 'custom' ? `Personalizado (${customSom?.nome || 'áudio'})` : som.nome;
    if (id === somRecomendado) label += ' (Sugerido)';
    op.textContent = label;
    select.append(op);
   }

   select.value = somSalvo || 'padrao';

   select.onchange = () => {
    definirSomPorTopico(topico, select.value);
    const somTocar = obterSomPorTopico(topico);
    if (somTocar !== 'none') tocarSomNotificacao(somTocar);
    dizer('Som por assunto salvo.');
   };

   const btnOuvir = no('button', 'Ouvir', 'secondary mini');
   btnOuvir.type = 'button';
   btnOuvir.onclick = () => {
    const s = select.value === 'padrao' ? obterSomEscolhido() : select.value;
    tocarSomNotificacao(s);
   };

   controles.append(select, btnOuvir);
   linha.append(info, controles);
   return linha;
  };

  areaTopicos.append(criarLinhaTopico('Lead novo (Comercial)', 'commercial.lead', 'fanfare'));
  areaTopicos.append(criarLinhaTopico('Lembretes da agenda', 'agenda.lembrete', 'digital'));

  bloco.append(areaTopicos);

  return bloco;
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
     const chaveAtual = chaveParaBytes(cfg.publicKey);
     // Assinatura feita com outra chave pública (as chaves foram trocadas) não recebe nada: descarta e assina de novo.
     let existente = sub;
     const antiga = existente?.options?.applicationServerKey;
     if (existente && antiga && !mesmosBytes(new Uint8Array(antiga), chaveAtual)) { await existente.unsubscribe(); existente = null; }
     const nova = existente || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveAtual });
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
