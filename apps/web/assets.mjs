// Arquivos estáticos do painel. Lista fixa: nada de resolução de caminho vinda da URL.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib';
import { BANK_LOGOS, BANK_LOGO_FILES } from './public/finance-model.js';

// Deriva as entradas das marcas de uma constante do código — continua lista
// fixa, porque a URL nunca influencia o caminho. Evita manter o mesmo conjunto
// escrito em três lugares (aqui, icons.js e finance-model.js), que divergiria.
// O formato do slug é conferido: fonte é nossa, mas caminho montado merece guarda.
const marcas = nomes => Object.fromEntries(nomes.map(nome => {
 if (!/^[a-z0-9]{2,32}$/.test(nome)) throw new Error(`Marca inválida: ${nome}`);
 return [`/logos/${nome}.svg`, [`logos/${nome}.svg`, 'image/svg+xml']];
}));

const FILES = {
 '/commercial.js':['commercial.js','text/javascript'],
 '/commercial.css':['commercial.css','text/css'],
 '/media.js':['media.js','text/javascript'],
 '/space-fields.js':['space-fields.js','text/javascript'],
 '/automations.js':['automations.js','text/javascript'],
 '/client-edit.js':['client-edit.js','text/javascript'],
 '/client-history.js':['client-history.js','text/javascript'],
 '/stage-requirements.js':['stage-requirements.js','text/javascript'],
 '/media.css':['media.css','text/css'],
 '/': ['index.html', 'text/html'],
 // O favicon precisa de uma rota própria e estável. Não depender de
 // /logo.svg aqui: navegadores, crawlers e instaladores PWA procuram
 // /favicon.svg ou /favicon.ico diretamente.
 '/favicon.svg': ['logo.svg', 'image/svg+xml'],
 // Compatibilidade com navegadores/crawlers que ignoram favicon SVG e
 // solicitam este caminho por convenção.
 '/favicon.ico': ['icon-192.png', 'image/png'],
 // PWA. O manifest e o service worker precisam ser servidos na raiz do escopo:
 // um service worker so controla o caminho de onde e servido.
 '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
 '/sw.js': ['sw.js', 'text/javascript'],
 '/icon-192.png': ['icon-192.png', 'image/png'],
 '/icon-512.png': ['icon-512.png', 'image/png'],
 '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
 '/app.js': ['app.js', 'text/javascript'],
 '/data-table.js': ['data-table.js', 'text/javascript'],
 '/controls.css': ['controls.css', 'text/css'],
 '/peek.js': ['peek.js', 'text/javascript'],
 '/inline-edit.js': ['inline-edit.js', 'text/javascript'],
 '/peek.css': ['peek.css', 'text/css'],
 '/badge.css': ['badge.css', 'text/css'],
 '/theme.css': ['theme.css', 'text/css'],
 '/theme-boot.js': ['theme-boot.js', 'text/javascript'],
 '/settings.js': ['settings.js', 'text/javascript'],
 '/notificacoes.js': ['notificacoes.js', 'text/javascript'],
 '/config-indice.js': ['config-indice.js', 'text/javascript'],
 '/config-aparencia.js': ['config-aparencia.js', 'text/javascript'],
 '/config-aplicativo.js': ['config-aplicativo.js', 'text/javascript'],
 '/config-integracoes.js': ['config-integracoes.js', 'text/javascript'],
 '/config-agenda.js': ['config-agenda.js', 'text/javascript'],
 '/config-teclado.js': ['config-teclado.js', 'text/javascript'],
 '/agenda-prefs.js': ['agenda-prefs.js', 'text/javascript'],
 '/agenda-atalhos.js': ['agenda-atalhos.js', 'text/javascript'],
 '/logo-tema.js': ['logo-tema.js', 'text/javascript'],
 // Inter (variável, só o subconjunto latino: cobre o português). Licença SIL OFL 1.1 em fonts/INTER-LICENSE.txt.
 '/fonts/inter-latin-wght-normal.woff2': ['fonts/inter-latin-wght-normal.woff2', 'font/woff2'],
 '/management-workspace.js': ['management-workspace.js', 'text/javascript'],
 '/database-model.js': ['database-model.js', 'text/javascript'],
 '/database-workspace.css': ['database-workspace.css', 'text/css'],
 '/tracking.js': ['tracking.js', 'text/javascript'],
 '/agenda-model.js': ['agenda-model.js', 'text/javascript'],
 '/agenda-dom.js': ['agenda-dom.js', 'text/javascript'],
 '/agenda-evento.js': ['agenda-evento.js', 'text/javascript'],
 '/agenda-repeticao.js': ['agenda-repeticao.js', 'text/javascript'],
 '/tracking.css': ['tracking.css', 'text/css'],
 '/finance.js': ['finance.js', 'text/javascript'],
 '/billing.js': ['billing.js', 'text/javascript'],
 '/product-payments.js': ['product-payments.js', 'text/javascript'],
 '/service-receivables.js': ['service-receivables.js', 'text/javascript'],
 '/emails.js': ['emails.js', 'text/javascript'],
 '/emails.css': ['emails.css', 'text/css'],
 '/projects.js': ['projects.js', 'text/javascript'],
 '/projects.css': ['projects.css', 'text/css'],
 '/product-emails.js': ['product-emails.js', 'text/javascript'],
 '/campaigns.js': ['campaigns.js', 'text/javascript'],
 '/campaigns.css': ['campaigns.css', 'text/css'],
 '/product-emails.css': ['product-emails.css', 'text/css'],
 '/product-icons.css': ['product-icons.css', 'text/css'],
 '/product-favicons/educare.svg': ['product-favicons/educare.svg', 'image/svg+xml'],
 '/product-favicons/sites.svg': ['product-favicons/sites.svg', 'image/svg+xml'],
 '/billing.css': ['billing.css', 'text/css'],
 ...marcas(BANK_LOGOS),
 ...Object.fromEntries(Object.values(BANK_LOGO_FILES).map(file=>[`/logos/${file}`, [`logos/${file}`, 'image/png']])),
 '/finance-model.js': ['finance-model.js', 'text/javascript'],
 '/finance.css': ['finance.css', 'text/css'],
 '/delivery.js': ['delivery.js', 'text/javascript'],
 '/resource.js': ['resource.js', 'text/javascript'],
 '/easypanel.js': ['easypanel.js', 'text/javascript'],
 '/delivery.css': ['delivery.css', 'text/css'],
 '/style.css': ['style.css', 'text/css'],
 '/design.css': ['design.css', 'text/css'],
 '/overview.css': ['overview.css', 'text/css'],
 '/relationships.css': ['relationships.css', 'text/css'],
 '/portfolio.css': ['portfolio.css', 'text/css'],
 '/connections.js': ['connections.js', 'text/javascript'],
 '/owner-suggestions.js': ['owner-suggestions.js', 'text/javascript'],
 '/owner-link.js': ['owner-link.js', 'text/javascript'],
 '/tabs.js': ['tabs.js', 'text/javascript'],
 '/space-form.js': ['space-form.js', 'text/javascript'],
 '/tabs.css': ['tabs.css', 'text/css'],
 '/connections.css': ['connections.css', 'text/css'],
 '/management.css': ['management.css', 'text/css'],
 '/icons.js': ['icons.js', 'text/javascript'],
 '/card-summary.js': ['card-summary.js', 'text/javascript'],
 '/logos/github.svg': ['logos/github.svg', 'image/svg+xml'],
 '/logos/vercel.svg': ['logos/vercel.svg', 'image/svg+xml'],
 '/logos/easypanel.svg': ['logos/easypanel.svg', 'image/svg+xml'],
 '/logo.svg': ['logo.svg', 'image/svg+xml'],
 '/checkout.css': ['checkout.css', 'text/css'],
 '/checkout.js': ['checkout.js', 'text/javascript'],
 '/checkout-gateway.js': ['checkout-gateway.js', 'text/javascript'],
 '/checkout-editor.js': ['checkout-editor.js', 'text/javascript'],
 '/checkout-editor.css': ['checkout-editor.css', 'text/css'],
};

// Texto comprime bem (JS e CSS perdem ~75%); imagem e fonte já vêm comprimidas.
const COMPRIMIVEL = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/;
const memoria = new Map();

// Cache em memória invalidado pela data e pelo tamanho do arquivo: ler do disco a cada pedido (como era)
// mantém o fluxo de desenvolvimento ("editar o arquivo e recarregar"), e o cache evita refazer a
// compressão. O ETag sai do conteúdo, então o navegador revalida com 304 em vez de rebaixar tudo.
function carregar(file, type) {
 const url = new URL(`./public/${file}`, import.meta.url);
 const { mtimeMs, size } = statSync(url);
 const guardado = memoria.get(file);
 if (guardado && guardado.mtimeMs === mtimeMs && guardado.size === size) return guardado;
 const corpo = readFileSync(url);
 const item = { mtimeMs, size, corpo, br: null, gz: null, etag: `"${createHash('sha1').update(corpo).digest('base64url').slice(0, 22)}"` };
 if (COMPRIMIVEL.test(type) && corpo.length > 1024) {
  const br = brotliCompressSync(corpo, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } });
  const gz = gzipSync(corpo, { level: 9 });
  if (br.length < corpo.length) item.br = br;
  if (gz.length < corpo.length) item.gz = gz;
 }
 memoria.set(file, item);
 return item;
}

export function serveAsset(pathname, res, req) {
 const entry = FILES[pathname];
 if (!entry) return false;
 const [file, type] = entry;
 // Fonte e marca não mudam de nome nem de conteúdo sem mudar de versão: uma semana no navegador.
 const duravel = pathname.startsWith('/fonts/') || pathname.startsWith('/logos/');
 const cacheControl = pathname === '/favicon.svg' || pathname === '/favicon.ico' || pathname.startsWith('/product-favicons/') ? 'no-store' : duravel ? 'public, max-age=604800' : 'no-cache';
 const item = carregar(file, type);
 const cabecalhos = { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': cacheControl, ETag: item.etag, Vary: 'Accept-Encoding' };
 if (cacheControl !== 'no-store' && req?.headers?.['if-none-match'] === item.etag) {
  res.writeHead(304, { 'Cache-Control': cacheControl, ETag: item.etag, Vary: 'Accept-Encoding' });
  res.end();
  return true;
 }
 const aceita = String(req?.headers?.['accept-encoding'] || '');
 let corpo = item.corpo;
 if (item.br && /\bbr\b/.test(aceita)) { cabecalhos['Content-Encoding'] = 'br'; corpo = item.br; }
 else if (item.gz && /\bgzip\b/.test(aceita)) { cabecalhos['Content-Encoding'] = 'gzip'; corpo = item.gz; }
 cabecalhos['Content-Length'] = corpo.length;
 res.writeHead(200, cabecalhos);
 res.end(corpo);
 return true;
}
