// Sons para notificações do Core via Web Audio API e áudio personalizado.
// Oferece sons sintetizados leves, sem dependência externa, e suporte a som enviado pelo operador.
// Compatível com navegadores desktop e móveis (incluindo destrave de áudio do iOS/Safari).

export const SOM_PADRAO = 'chime';
export const CHAVE_STORAGE_SOM = 'tzolkin-notificacao-som';
export const CHAVE_STORAGE_SOM_LEAD = 'tzolkin-notificacao-som-lead';
export const CHAVE_STORAGE_SOM_AGENDA = 'tzolkin-notificacao-som-agenda';
export const CHAVE_STORAGE_CUSTOM_AUDIO = 'tzolkin-notificacao-som-custom-audio';
export const CHAVE_STORAGE_CUSTOM_NOME = 'tzolkin-notificacao-som-custom-nome';

export const SONS_NOTIFICACAO = Object.freeze({
 chime: {
  id: 'chime',
  nome: 'Chime (Padrão)',
  descricao: 'Dois tons suaves e harmônicos (E5 → A5)',
  tocar(ctx) {
   tocarTom(ctx, 659.25, 0.00, 0.18, 0.15); // E5
   tocarTom(ctx, 880.00, 0.12, 0.35, 0.18); // A5
  },
 },
 bell: {
  id: 'bell',
  nome: 'Sino metálico',
  descricao: 'Toque cristalino e límpido',
  tocar(ctx) {
   tocarTom(ctx, 987.77, 0.00, 0.45, 0.20, 'triangle'); // B5
   tocarTom(ctx, 1975.53, 0.00, 0.25, 0.06, 'sine');
  },
 },
 pop: {
  id: 'pop',
  nome: 'Pop sutil',
  descricao: 'Clique arredondado e rápido',
  tocar(ctx) {
   tocarPitchSweep(ctx, 400, 850, 0.00, 0.10, 0.22);
  },
 },
 ping: {
  id: 'ping',
  nome: 'Ping agudo',
  descricao: 'Sinal discreto de alta frequência',
  tocar(ctx) {
   tocarTom(ctx, 1174.66, 0.00, 0.22, 0.15, 'sine'); // D6
  },
 },
 fanfare: {
  id: 'fanfare',
  nome: 'Fanfarra triunfante',
  descricao: 'Arpejo ascendente e festivo (ideal para novos leads)',
  tocar(ctx) {
   tocarTom(ctx, 523.25, 0.00, 0.10, 0.18, 'triangle'); // C5
   tocarTom(ctx, 659.25, 0.08, 0.10, 0.18, 'triangle'); // E5
   tocarTom(ctx, 783.99, 0.16, 0.14, 0.20, 'triangle'); // G5
   tocarTom(ctx, 1046.50, 0.26, 0.36, 0.24, 'triangle'); // C6
   tocarTom(ctx, 1046.50, 0.26, 0.30, 0.10, 'sine');
  },
 },
 digital: {
  id: 'digital',
  nome: 'Bip digital duplo',
  descricao: 'Dois pulsos rápidos (ideal para lembretes da agenda)',
  tocar(ctx) {
   tocarTom(ctx, 1046.50, 0.00, 0.08, 0.18, 'square');
   tocarTom(ctx, 1318.51, 0.11, 0.10, 0.20, 'square');
  },
 },
 marimba: {
  id: 'marimba',
  nome: 'Marimba suave',
  descricao: 'Dois toques quentes e amadeirados',
  tocar(ctx) {
   tocarTom(ctx, 392.00, 0.00, 0.18, 0.22, 'triangle'); // G4
   tocarTom(ctx, 784.00, 0.00, 0.08, 0.08, 'sine');
   tocarTom(ctx, 523.25, 0.10, 0.25, 0.25, 'triangle'); // C5
   tocarTom(ctx, 1046.50, 0.10, 0.10, 0.10, 'sine');
  },
 },
 radar: {
  id: 'radar',
  nome: 'Pulso de radar',
  descricao: 'Sinal moderno com modulação e eco',
  tocar(ctx) {
   tocarPitchSweep(ctx, 1200, 450, 0.00, 0.14, 0.22);
   tocarPitchSweep(ctx, 1000, 450, 0.18, 0.12, 0.10);
  },
 },
 harp: {
  id: 'harp',
  nome: 'Harpa suave',
  descricao: 'Dedilhado harmônico e etéreo',
  tocar(ctx) {
   tocarTom(ctx, 440.00, 0.00, 0.30, 0.12, 'sine'); // A4
   tocarTom(ctx, 554.37, 0.06, 0.32, 0.14, 'sine'); // C#5
   tocarTom(ctx, 659.25, 0.12, 0.35, 0.16, 'sine'); // E5
   tocarTom(ctx, 880.00, 0.18, 0.45, 0.18, 'sine'); // A5
  },
 },
 arcade: {
  id: 'arcade',
  nome: 'Arcade 8-bits',
  descricao: 'Salto sonoro retrô estilo videogame',
  tocar(ctx) {
   tocarTom(ctx, 330.00, 0.00, 0.06, 0.18, 'square');
   tocarTom(ctx, 440.00, 0.06, 0.06, 0.18, 'square');
   tocarTom(ctx, 660.00, 0.12, 0.08, 0.20, 'square');
   tocarTom(ctx, 880.00, 0.18, 0.18, 0.22, 'square');
  },
 },
 urgent: {
  id: 'urgent',
  nome: 'Alerta urgente',
  descricao: 'Três toques rápidos e chamativos',
  tocar(ctx) {
   tocarTom(ctx, 880.00, 0.00, 0.08, 0.20, 'sawtooth');
   tocarTom(ctx, 1174.66, 0.10, 0.08, 0.22, 'sawtooth');
   tocarTom(ctx, 880.00, 0.20, 0.10, 0.20, 'sawtooth');
  },
 },
 custom: {
  id: 'custom',
  nome: 'Som personalizado',
  descricao: 'Arquivo de áudio enviado pelo operador',
  tocar() {
   const custom = obterSomCustomizado();
   if (custom?.audio) {
    tocarAudioDataUrl(custom.audio);
   }
  },
 },
 none: {
  id: 'none',
  nome: 'Silencioso',
  descricao: 'Nenhum som ao receber notificação',
  tocar() {},
 },
});

let audioCtx = null;

function obterAudioContext() {
 if (typeof window === 'undefined') return null;
 const AudioClass = window.AudioContext || window.webkitAudioContext;
 if (!AudioClass) return null;
 if (!audioCtx || audioCtx.state === 'closed') {
  audioCtx = new AudioClass();
 }
 return audioCtx;
}

// No iOS e Android, o AudioContext precisa de toques para sair de "suspended" e pode suspender ao alternar abas.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
 const acordarAudio = () => {
  const ctx = obterAudioContext();
  if (ctx && ctx.state === 'suspended') {
   ctx.resume().catch(() => {});
  }
 };
 window.addEventListener('click', acordarAudio, { passive: true });
 window.addEventListener('touchstart', acordarAudio, { passive: true });
 window.addEventListener('touchend', acordarAudio, { passive: true });
 if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
   if (document.visibilityState === 'visible') acordarAudio();
  });
 }
}

function tocarTom(ctx, freq, inicio, duracao, ganhoMax = 0.2, tipo = 'sine') {
 try {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + inicio;

  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(ganhoMax, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t0);
  osc.stop(t0 + duracao + 0.05);
 } catch (_) {}
}

function tocarPitchSweep(ctx, freqInicio, freqFim, inicio, duracao, ganhoMax = 0.2) {
 try {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t0 = ctx.currentTime + inicio;

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freqInicio, t0);
  osc.frequency.exponentialRampToValueAtTime(freqFim, t0 + duracao);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(ganhoMax, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t0);
  osc.stop(t0 + duracao + 0.05);
 } catch (_) {}
}

export function tocarAudioDataUrl(dataUrl) {
 if (!dataUrl || typeof Audio === 'undefined') return;
 try {
  const audio = new Audio();
  audio.src = dataUrl;
  audio.preload = 'auto';
  audio.playsInline = true;
  const promessa = audio.play();
  if (promessa && typeof promessa.catch === 'function') {
   promessa.catch(() => {});
  }
 } catch (_) {}
}

export function obterSomCustomizado() {
 try {
  const audio = localStorage.getItem(CHAVE_STORAGE_CUSTOM_AUDIO);
  const nome = localStorage.getItem(CHAVE_STORAGE_CUSTOM_NOME) || 'Personalizado';
  if (audio) return { audio, nome };
 } catch (_) {}
 return null;
}

export function salvarSomCustomizado(audioDataUrl, nome) {
 try {
  if (!audioDataUrl) return;
  localStorage.setItem(CHAVE_STORAGE_CUSTOM_AUDIO, audioDataUrl);
  if (nome) localStorage.setItem(CHAVE_STORAGE_CUSTOM_NOME, nome);
 } catch (_) {}
}

export function removerSomCustomizado() {
 try {
  localStorage.removeItem(CHAVE_STORAGE_CUSTOM_AUDIO);
  localStorage.removeItem(CHAVE_STORAGE_CUSTOM_NOME);
 } catch (_) {}
}

export function obterSomEscolhido() {
 try {
  const salvo = localStorage.getItem(CHAVE_STORAGE_SOM);
  if (salvo && salvo in SONS_NOTIFICACAO) return salvo;
 } catch (_) {}
  return SOM_PADRAO;
}

export function definirSomEscolhido(somId) {
 if (!somId || !(somId in SONS_NOTIFICACAO)) return;
 try {
  if (somId === SOM_PADRAO) {
   localStorage.removeItem(CHAVE_STORAGE_SOM);
  } else {
   localStorage.setItem(CHAVE_STORAGE_SOM, somId);
  }
 } catch (_) {}
}

export function obterSomPorTopico(topico) {
 try {
  if (topico === 'commercial.lead' || topico === 'lead') {
   const salvo = localStorage.getItem(CHAVE_STORAGE_SOM_LEAD);
   if (salvo && salvo in SONS_NOTIFICACAO) return salvo;
  } else if (topico === 'agenda.lembrete' || topico === 'agenda') {
   const salvo = localStorage.getItem(CHAVE_STORAGE_SOM_AGENDA);
   if (salvo && salvo in SONS_NOTIFICACAO) return salvo;
  }
 } catch (_) {}
 return obterSomEscolhido();
}

export function definirSomPorTopico(topico, somId) {
 try {
  const chave = (topico === 'commercial.lead' || topico === 'lead')
   ? CHAVE_STORAGE_SOM_LEAD
   : ((topico === 'agenda.lembrete' || topico === 'agenda') ? CHAVE_STORAGE_SOM_AGENDA : null);
  if (!chave) return;
  if (!somId || somId === 'padrao' || somId === 'default' || somId === obterSomEscolhido()) {
   localStorage.removeItem(chave);
  } else if (somId in SONS_NOTIFICACAO) {
   localStorage.setItem(chave, somId);
  }
 } catch (_) {}
}

export function tocarSomNotificacao(somId = obterSomEscolhido()) {
 if (somId === 'none') return;
 if (somId === 'custom') {
  const custom = obterSomCustomizado();
  if (custom?.audio) {
   tocarAudioDataUrl(custom.audio);
   return;
  }
  somId = SOM_PADRAO;
 }
 const config = SONS_NOTIFICACAO[somId] || SONS_NOTIFICACAO[SOM_PADRAO];
 if (!config || config.id === 'none') return;
 const ctx = obterAudioContext();
 if (!ctx) return;
 if (ctx.state === 'suspended') {
  ctx.resume().then(() => {
   try { config.tocar(ctx); } catch (_) {}
  }).catch(() => {
   try { config.tocar(ctx); } catch (_) {}
  });
  return;
 }
 try {
  config.tocar(ctx);
 } catch (_) {}
}

export function tocarSomNotificacaoPorTag(tag) {
 if (!tag) {
  tocarSomNotificacao();
  return;
 }
 if (typeof tag === 'string' && tag.startsWith('lead:')) {
  const somId = obterSomPorTopico('commercial.lead');
  tocarSomNotificacao(somId);
 } else if (typeof tag === 'string' && tag.startsWith('agenda:')) {
  const somId = obterSomPorTopico('agenda.lembrete');
  tocarSomNotificacao(somId);
 } else {
  tocarSomNotificacao();
 }
}
