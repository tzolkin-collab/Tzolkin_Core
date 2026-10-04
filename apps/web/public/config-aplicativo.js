// Configurações → Aplicativo. SOMENTE LEITURA, de propósito: "iniciar ao fazer login", "abrir como janela" e as permissões
// (Local, Câmera, Microfone) são controles do Chrome. O Core mostra o que o navegador deixa ler e diz onde mudar o resto.
// O evento de instalação é guardado por app.js assim que a página carrega (window.TzolkinInstalar): este módulo abre depois dele.

const no = (tag, texto, classe) => {
 const e = document.createElement(tag);
 if (texto !== undefined) e.textContent = texto;
 if (classe) e.className = classe;
 return e;
};

const TEXTO_DA_PERMISSAO = { granted: 'Permitida', denied: 'Bloqueada', default: 'Ainda não decidida', prompt: 'Pergunta ao usar' };

function linha(rotulo, valor, ajuda) {
 const l = no('div', undefined, 'cfg-linha');
 const t = no('div', undefined, 'cfg-linha-texto');
 t.append(no('strong', rotulo));
 if (ajuda) t.append(no('small', ajuda));
 l.append(t, typeof valor === 'string' ? no('span', valor, 'cfg-valor') : valor);
 return l;
}

export function instaladoComoApp(env = window) {
 return env.matchMedia('(display-mode: standalone)').matches || env.matchMedia('(display-mode: window-controls-overlay)').matches || env.navigator.standalone === true;
}

export function montar(raiz) {
 const lista = no('div', undefined, 'cfg-lista');
 raiz.append(lista);
 const desenhar = async () => {
  const linhas = [];
  const instalado = instaladoComoApp();
  const instalar = window.TzolkinInstalar;
  let valor = instalado ? 'Instalado e aberto como aplicativo' : 'Aberto no navegador';
  if (!instalado && instalar?.pronto()) {
   const b = no('button', 'Instalar o Core', 'primary'); b.type = 'button';
   b.onclick = async () => { b.disabled = true; await instalar.pedir(); desenhar(); };
   valor = b;
  }
  linhas.push(linha('Aplicativo', valor, instalado ? undefined : (instalar?.pronto() ? 'Abre em janela própria, sem a barra do navegador.' : 'No Chrome: menu ⋮ → Salvar e compartilhar → Instalar página como app. No iPhone: Compartilhar → Adicionar à Tela de Início.')));

  let sw = 'Indisponível neste navegador';
  if ('serviceWorker' in navigator) { try { sw = (await navigator.serviceWorker.getRegistration()) ? 'Ativo' : 'Não registrado'; } catch { sw = 'Não foi possível ler'; } }
  linhas.push(linha('Serviço de notificações', sw, 'É ele que mostra o aviso mesmo com o Core fechado. Não guarda páginas em cache.'));
  linhas.push(linha('Permissão de notificação', 'Notification' in window ? TEXTO_DA_PERMISSAO[Notification.permission] || Notification.permission : 'Indisponível', 'Se estiver bloqueada, libere nas configurações do site no navegador.'));

  const fora = no('div', undefined, 'cfg-nota');
  fora.append(
   no('strong', 'O que se muda no próprio navegador'),
   no('p', 'Iniciar o aplicativo ao fazer login, abrir como janela, abrir links no app e as permissões de Local, Câmera e Microfone são controles do Chrome: abra chrome://apps, clique com o botão direito em TZOLKIN Core e escolha Detalhes do app.'),
   no('p', 'O Core não usa Local, Câmera nem Microfone e não pede essas permissões.'));
  lista.replaceChildren(...linhas, fora);
 };
 desenhar();
}
