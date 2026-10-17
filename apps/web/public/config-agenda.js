// Configurações → Agenda. Escopo MISTO, e cada bloco diz o seu:
//   Todo o espaço   — o lembrete padrão (servidor, migração 048)
//   Neste navegador — visão em que a agenda abre e duração de uma atividade nova (agenda-prefs.js)
import { textoDosLembretes, VISOES, ROTULO_DA_VISAO } from './agenda-model.js';
import { caixaDeLembretes } from './agenda-repeticao.js';
import { DURACOES, duracaoPadraoMin, definirDuracaoPadrao, visaoInicial, definirVisaoInicial, meetAutomatico, definirMeetAutomatico, localDoMeet, definirLocalDoMeet, convidarContatoPrincipal, definirConvidarContatoPrincipal, LOCAL_MEET_PADRAO } from './agenda-prefs.js';
import { seloDeEscopo } from './config-indice.js';
import { selo } from './data-table.js';

const TONS_TAG = [
 ['neutral', 'Neutra'],
 ['accent', 'Destaque'],
 ['info', 'Informação'],
 ['success', 'Sucesso'],
 ['warning', 'Atenção'],
 ['danger', 'Urgente'],
];

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

function bloco(titulo, escopo, ajuda) {
 const b = no('div', undefined, 'config-bloco');
 const cab = no('div', undefined, 'cfg-cab-bloco');
 cab.append(no('h3', titulo, 'config-sub'), seloDeEscopo(escopo));
 b.append(cab);
 if (ajuda) b.append(no('p', ajuda, 'config-ajuda'));
 return b;
}

function seletor(rotulo, opcoes, atual, aoMudar) {
 const l = no('label', undefined, 'cfg-seletor');
 l.append(no('span', rotulo));
 const s = document.createElement('select');
 for (const [valor, nome] of opcoes) { const o = no('option', nome); o.value = String(valor); s.append(o); }
 s.value = String(atual);
 s.onchange = () => aoMudar(s.value);
 l.append(s);
 return l;
}

export function montar(raiz, { api }) {
 const aviso = no('p', '', 'config-aviso'); aviso.setAttribute('role', 'status');
 const dizer = (texto, erro = false) => { aviso.textContent = texto; aviso.classList.toggle('erro', erro); };
 const corpo = no('div', undefined, 'config-notif');
 raiz.append(corpo, aviso);

 const reminder = bloco('Lembrete padrão', 'espaco');
 corpo.append(reminder);
 (async () => {
  let prefs;
  try { prefs = await api('/api/agenda/preferencias'); } catch (e) { reminder.append(no('p', e.message, 'config-ajuda')); return; }
  if (!prefs.disponivel) { reminder.append(no('p', 'Disponível assim que a atualização do banco (migração 048) for aplicada.', 'config-ajuda')); return; }
  const resumo = no('p', '', 'config-ajuda');
  const mostrar = m => { resumo.textContent = `Vale para toda atividade que não tem lembrete próprio: ${textoDosLembretes(m).toLowerCase()}. O aviso chega por notificação, nos aparelhos que ligaram "Lembretes da agenda".`; };
  mostrar(prefs.default_reminders);
  let revisao = prefs.revision;
  reminder.append(resumo, caixaDeLembretes(prefs.default_reminders, async minutos => {
   try { const r = await api('/api/agenda/preferencias', 'PUT', { revision: revisao, default_reminders: minutos }); revisao = r.revision; mostrar(r.default_reminders); dizer('Salvo.'); }
   catch (e) { dizer(e.message, true); }
  }));
 })();

 const catalogoBloco = bloco('Catálogo de tags', 'espaco', 'Classificação livre das atividades. Tags sugeridas pela IA já valem, mas ficam sinalizadas até alguém aprovar.');
 corpo.append(catalogoBloco);
 (async () => {
  const conteudo = no('div', undefined, 'cfg-tags-catalogo');
  catalogoBloco.append(conteudo);
  let mostrarArquivadas = false;

  async function carregarTags() {
   let dados;
   try { dados = await api('/api/tags?arquivadas=1'); } catch (e) { conteudo.replaceChildren(no('p', e.message, 'config-ajuda')); return; }
   if (!dados.available) {
    conteudo.replaceChildren(no('p', 'Disponível assim que a atualização do banco (migração 061) for aplicada.', 'config-ajuda'));
    return;
   }
   const todas = dados.tags || [];
   const ativas = todas.filter(t => !t.archived);
   const pendentesIa = ativas.filter(t => t.origin === 'ai' && !t.reviewed);
   const arquivadas = todas.filter(t => t.archived);

   const nos = [];
   const resumoTxt = `${ativas.length} ${ativas.length === 1 ? 'tag ativa' : 'tags ativas'}${pendentesIa.length ? ` · ${pendentesIa.length} sugerida${pendentesIa.length === 1 ? '' : 's'} pela IA aguardando revisão` : ''}${arquivadas.length ? ` · ${arquivadas.length} arquivada${arquivadas.length === 1 ? '' : 's'}` : ''}.`;
   nos.push(no('p', resumoTxt, 'config-ajuda cfg-resumo'));

   if (arquivadas.length) {
    const filtroArq = no('label', undefined, 'config-opcao');
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = mostrarArquivadas;
    chk.onchange = () => { mostrarArquivadas = chk.checked; carregarTags(); };
    const txt = no('span', undefined, 'config-opcao-texto'); txt.append(no('strong', 'Mostrar tags arquivadas'));
    filtroArq.append(chk, txt);
    nos.push(filtroArq);
   }

   const visiveis = mostrarArquivadas ? todas : ativas;
   const lista = no('div', undefined, 'cfg-lista');
   if (!visiveis.length) {
    lista.append(no('p', 'Nenhuma tag cadastrada ainda.', 'config-ajuda'));
   }
   for (const t of visiveis) {
    const linha = no('div', undefined, 'cfg-linha cfg-conta'); linha.dataset.tagId = t.id;
    const info = no('div', undefined, 'cfg-linha-texto');
    const topo = no('div', undefined, 'cfg-integracao-topo');
    const chip = no('span', undefined, 'ag-tag'); chip.dataset.tom = t.tone || 'neutral';
    chip.append(no('span', t.label, 'ag-tag-nome'));
    if (t.origin === 'ai' && !t.reviewed) {
     const ia = no('span', 'IA', 'ag-tag-ia'); ia.title = 'Sugerida pela IA — aguardando revisão';
     chip.append(ia);
    }
    topo.append(chip, selo(`${t.uses ?? 0} ${(t.uses ?? 0) === 1 ? 'uso' : 'usos'}`, 'neutral'));
    if (t.archived) topo.append(selo('Arquivada', 'warning'));
    info.append(topo);
    linha.append(info);

    const acoes = no('div', undefined, 'cfg-conta-acoes');
    const inpNome = document.createElement('input');
    inpNome.type = 'text'; inpNome.value = t.label; inpNome.maxLength = 40;
    inpNome.setAttribute('aria-label', `Nome da tag ${t.label}`);

    const selTom = document.createElement('select');
    for (const [val, rot] of TONS_TAG) { const o = no('option', rot); o.value = val; selTom.append(o); }
    selTom.value = t.tone || 'neutral';
    selTom.setAttribute('aria-label', `Cor da tag ${t.label}`);

    const btnSalvar = no('button', 'Salvar', 'secondary'); btnSalvar.type = 'button';
    btnSalvar.onclick = async () => {
     btnSalvar.disabled = true;
     try {
      await api(`/api/tags/${t.id}`, 'PUT', { revision: t.revision, label: inpNome.value.trim(), tone: selTom.value });
      dizer(`Tag "${inpNome.value.trim()}" salva.`);
      await carregarTags();
     } catch (e) { dizer(e.message, true); btnSalvar.disabled = false; }
    };
    acoes.append(inpNome, selTom, btnSalvar);

    if (t.origin === 'ai' && !t.reviewed) {
     const btnAprovar = no('button', 'Aprovar', 'secondary'); btnAprovar.type = 'button';
     btnAprovar.onclick = async () => {
      btnAprovar.disabled = true;
      try {
       await api(`/api/tags/${t.id}`, 'PUT', { revision: t.revision, reviewed: true });
       dizer(`Tag "${t.label}" aprovada.`);
       await carregarTags();
      } catch (e) { dizer(e.message, true); btnAprovar.disabled = false; }
     };
     acoes.append(btnAprovar);
    }

    const btnArq = no('button', t.archived ? 'Reativar' : 'Arquivar', 'quiet'); btnArq.type = 'button';
    btnArq.onclick = async () => {
     btnArq.disabled = true;
     try {
      await api(`/api/tags/${t.id}`, 'PUT', { revision: t.revision, archived: !t.archived });
      dizer(t.archived ? `Tag "${t.label}" reativada.` : `Tag "${t.label}" arquivada.`);
      await carregarTags();
     } catch (e) { dizer(e.message, true); btnArq.disabled = false; }
    };
    acoes.append(btnArq);

    linha.append(acoes);
    lista.append(linha);
   }
   nos.push(lista);

   const formNova = no('form', undefined, 'cfg-cred-form'); formNova.noValidate = true;
   const lNome = no('label', undefined, 'cfg-seletor'); lNome.append(no('span', 'Nova tag'));
   const iNome = document.createElement('input'); iNome.type = 'text'; iNome.name = 'tag-label'; iNome.maxLength = 40; iNome.placeholder = 'Ex.: Revisão técnica';
   lNome.append(iNome);
   const lTom = no('label', undefined, 'cfg-seletor'); lTom.append(no('span', 'Cor'));
   const sTom = document.createElement('select'); sTom.name = 'tag-tone';
   for (const [val, rot] of TONS_TAG) { const o = no('option', rot); o.value = val; sTom.append(o); }
   lTom.append(sTom);
   const acoesNova = no('div', undefined, 'config-acoes');
   const btnCriar = no('button', 'Criar tag', 'secondary'); btnCriar.type = 'submit';
   acoesNova.append(btnCriar);
   formNova.append(lNome, lTom, acoesNova);
   formNova.onsubmit = async ev => {
    ev.preventDefault();
    const label = iNome.value.trim();
    if (label.length < 2) { dizer('Informe ao menos 2 caracteres para a tag.', true); return; }
    btnCriar.disabled = true;
    try {
     const r = await api('/api/tags', 'POST', { label, tone: sTom.value });
     dizer(r.created ? `Tag "${r.tag.label}" criada.` : `A tag "${r.tag.label}" já existia.`);
     await carregarTags();
    } catch (e) { dizer(e.message, true); btnCriar.disabled = false; }
   };
   nos.push(formNova);

   conteudo.replaceChildren(...nos);
  }

  await carregarTags();
 })();

 const abre = bloco('Ao abrir a agenda', 'navegador', 'Em qual visão a agenda começa neste navegador.');
 abre.append(seletor('Visão inicial', [['', 'A última que usei'], ...VISOES.map(v => [v, ROTULO_DA_VISAO[v]])], visaoInicial(), v => { definirVisaoInicial(v); dizer('Salvo neste navegador.'); }));
 corpo.append(abre);

 const nova = bloco('Atividade nova', 'navegador', 'Duração quando você clica num horário vazio ou usa "Nova atividade".');
 nova.append(seletor('Duração padrão', DURACOES, duracaoPadraoMin(), v => { definirDuracaoPadrao(Number(v)); dizer('Salvo neste navegador.'); }));
 corpo.append(nova);

 const video = bloco('Videoconferência', 'navegador', 'Só tem efeito para quem conectou a conta Google em Integrações.');
 const caixa = no('label', undefined, 'config-opcao');
 const marcar = document.createElement('input'); marcar.type = 'checkbox'; marcar.checked = meetAutomatico(); marcar.name = 'meet-auto';
 marcar.onchange = () => { definirMeetAutomatico(marcar.checked); dizer('Salvo neste navegador.'); };
 const texto = no('span', undefined, 'config-opcao-texto'); texto.append(no('strong', 'Adicionar o Google Meet em toda atividade nova'), no('small', 'A atividade abre com a sala marcada; dá para desmarcar antes de salvar.'));
 caixa.append(marcar, texto); video.append(caixa);
 const localCampo = no('label', undefined, 'cfg-seletor');
 localCampo.append(no('span', 'Local quando a sala é escolhida'));
 const entrada = document.createElement('input'); entrada.type = 'text'; entrada.name = 'meet-local'; entrada.maxLength = 200; entrada.value = localDoMeet(); entrada.placeholder = LOCAL_MEET_PADRAO;
 entrada.onchange = () => { definirLocalDoMeet(entrada.value); dizer('Salvo neste navegador.'); };
 localCampo.append(entrada); video.append(localCampo, no('p', 'Preenche o Local só se ele estiver vazio. Deixe em branco para não preencher.', 'config-ajuda'));
 const caixa2 = no('label', undefined, 'config-opcao');
 const marcar2 = document.createElement('input'); marcar2.type = 'checkbox'; marcar2.checked = convidarContatoPrincipal(); marcar2.name = 'meet-convidar';
 marcar2.onchange = () => { definirConvidarContatoPrincipal(marcar2.checked); dizer('Salvo neste navegador.'); };
 const texto2 = no('span', undefined, 'config-opcao-texto'); texto2.append(no('strong', 'Convidar o contato principal da empresa'), no('small', 'Ao escolher a sala, o e-mail do contato principal já entra nos convidados; dá para remover ou somar outros contatos.'));
 caixa2.append(marcar2, texto2); video.append(caixa2);
 corpo.append(video);
}
