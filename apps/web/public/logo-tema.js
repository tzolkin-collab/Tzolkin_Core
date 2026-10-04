// Logos escuras (GitHub, Vercel...) somem no tema escuro. Em vez de uma lista de nomes que alguém precisa lembrar de
// atualizar, o navegador olha os pixels da própria imagem. Preta/cinza-escura (neutra): marca data-logo-escura="neutra"
// e o theme.css inverte no escuro. Colorida E escura (BTG azul-marinho, Nubank roxo-escuro): marca "cor" e o theme.css põe
// uma placa clara atrás, porque inverter cor produz outra cor. Imagem de fundo cheio (ícone quadrado com o próprio fundo) também fica como está.
// Só analisa imagem da mesma origem ou data:, que o navegador deixa ler; favicon externo (https de terceiros)
// não pode ser lido sem "sujar" o canvas e segue como veio.

const LADO = 32;
const ESCURA_ATE = 90;      // luminância média (0-255) abaixo da qual a marca é escura
const NEUTRA_ATE = 40;      // (max - min) médio dos canais; acima disso é colorida
const FUNDO_CHEIO = 0.9;    // fração de pixels opacos a partir da qual a imagem tem fundo próprio
const COR_ESCURA_ATE = 65;  // marca colorida cuja luminância média fica abaixo disso some no fundo escuro

/**
 * pixels: RGBA (Uint8ClampedArray ou array). Devolve como a logo deve ser tratada no escuro:
 *   'neutra'  preto/cinza-escuro sobre fundo transparente -> o CSS inverte (vira branca)
 *   'cor'     colorida e escura (azul-marinho, roxo-escuro)  -> o CSS põe uma placa clara atrás
 *   null      clara, colorida legível ou com fundo próprio  -> fica como está
 */
export function classificarLogo(pixels) {
 const total = pixels.length / 4;
 let opacos = 0, luz = 0, cor = 0;
 for (let i = 0; i < pixels.length; i += 4) {
  if (pixels[i + 3] < 128) continue;
  const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
  opacos++;
  luz += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  cor += Math.max(r, g, b) - Math.min(r, g, b);
 }
 if (opacos < Math.max(8, total * 0.02)) return null;       // quase vazia: nada a decidir
 if (opacos / total > FUNDO_CHEIO) return null;             // tem fundo próprio
 const luzMedia = luz / opacos, corMedia = cor / opacos;
 if (corMedia < NEUTRA_ATE) return luzMedia < ESCURA_ATE ? 'neutra' : null;
 return luzMedia < COR_ESCURA_ATE ? 'cor' : null;
}

/** Compatível com o uso antigo: verdadeiro só para a marca neutra que se inverte. */
export const logoEscura = pixels => classificarLogo(pixels) === 'neutra';

const SELETOR = 'img.provider-logo, img.product-favicon, .context-current-icon img, .context-option-icon img, .overview-integration-mark img, .owner-logos img';
const vereditos = new Map();   // src -> Promise<boolean>; a mesma logo aparece em dezenas de cartões

function analisar(src) {
 if (!vereditos.has(src)) {
  vereditos.set(src, new Promise(resolver => {
   const imagem = new Image();
   imagem.onload = () => {
    try {
     const tela = document.createElement('canvas');
     tela.width = tela.height = LADO;
     const contexto = tela.getContext('2d', { willReadFrequently: true });
     contexto.drawImage(imagem, 0, 0, LADO, LADO);
     resolver(classificarLogo(contexto.getImageData(0, 0, LADO, LADO).data));
    } catch { resolver(null); }    // canvas sujo (origem externa)
   };
   imagem.onerror = () => resolver(null);
   imagem.src = src;
  }));
 }
 return vereditos.get(src);
}

function marcar(img) {
 const src = img.currentSrc || img.src;
 if (!src || src.startsWith('data:image/gif')) return;    // marcador vazio enquanto o favicon carrega
 let mesma = src.startsWith('data:');
 try { mesma = mesma || new URL(src, location.href).origin === location.origin; } catch { return; }
 if (!mesma) { img.removeAttribute('data-logo-escura'); return; }
 analisar(src).then(tipo => {
  if ((img.currentSrc || img.src) !== src) return;
  if (tipo) img.setAttribute('data-logo-escura', tipo); else img.removeAttribute('data-logo-escura');
 });
}

const varrer = raiz => {
 if (raiz.matches?.(SELETOR)) marcar(raiz);
 raiz.querySelectorAll?.(SELETOR).forEach(marcar);
};

/** Marca as logos que já estão na página e as que o app for criando (ele repinta as telas o tempo todo). */
export function vigiarLogos(raiz = document.body) {
 varrer(raiz);
 new MutationObserver(registros => {
  for (const r of registros) {
   if (r.type === 'attributes') marcar(r.target);
   else r.addedNodes.forEach(n => n.nodeType === 1 && varrer(n));
  }
 }).observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}
