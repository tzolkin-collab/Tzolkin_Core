// Sons sintetizados para notificações do Core via Web Audio API.
// Sem arquivos de áudio externos (.mp3/.wav), zero dependências e sem requisições HTTP adicionais.

export const SOM_PADRAO = 'chime';
export const CHAVE_STORAGE_SOM = 'tzolkin-notificacao-som';

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
 if (audioCtx.state === 'suspended') {
  audioCtx.resume().catch(() => {});
 }
 return audioCtx;
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

export function tocarSomNotificacao(somId = obterSomEscolhido()) {
 const config = SONS_NOTIFICACAO[somId] || SONS_NOTIFICACAO[SOM_PADRAO];
 if (!config || config.id === 'none') return;
 const ctx = obterAudioContext();
 if (!ctx) return;
 try {
  config.tocar(ctx);
 } catch (_) {}
}
