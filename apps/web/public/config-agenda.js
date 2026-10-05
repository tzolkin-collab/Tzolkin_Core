// Configurações → Agenda. Escopo MISTO, e cada bloco diz o seu:
//   Todo o espaço   — o lembrete padrão (servidor, migração 048)
//   Neste navegador — visão em que a agenda abre e duração de uma atividade nova (agenda-prefs.js)
import { textoDosLembretes, VISOES, ROTULO_DA_VISAO } from './agenda-model.js';
import { caixaDeLembretes } from './agenda-repeticao.js';
import { DURACOES, duracaoPadraoMin, definirDuracaoPadrao, visaoInicial, definirVisaoInicial, meetAutomatico, definirMeetAutomatico, localDoMeet, definirLocalDoMeet, convidarContatoPrincipal, definirConvidarContatoPrincipal, LOCAL_MEET_PADRAO } from './agenda-prefs.js';
import { seloDeEscopo } from './config-indice.js';

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
