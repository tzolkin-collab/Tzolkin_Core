// Arquivos estáticos do painel. Lista fixa: nada de resolução de caminho vinda da URL.
import { readFileSync } from 'node:fs';
import { BANK_LOGOS } from './public/finance-model.js';

// Deriva as entradas das marcas de uma constante do código — continua lista
// fixa, porque a URL nunca influencia o caminho. Evita manter o mesmo conjunto
// escrito em três lugares (aqui, icons.js e finance-model.js), que divergiria.
// O formato do slug é conferido: fonte é nossa, mas caminho montado merece guarda.
const marcas = nomes => Object.fromEntries(nomes.map(nome => {
 if (!/^[a-z0-9]{2,32}$/.test(nome)) throw new Error(`Marca inválida: ${nome}`);
 return [`/logos/${nome}.svg`, [`logos/${nome}.svg`, 'image/svg+xml']];
}));

const FILES = {
 '/': ['index.html', 'text/html'],
 // PWA. O manifest e o service worker precisam ser servidos na raiz do escopo:
 // um service worker so controla o caminho de onde e servido.
 '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
 '/sw.js': ['sw.js', 'text/javascript'],
 '/icon-192.png': ['icon-192.png', 'image/png'],
 '/icon-512.png': ['icon-512.png', 'image/png'],
 '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
 '/app.js': ['app.js', 'text/javascript'],
 '/management-workspace.js': ['management-workspace.js', 'text/javascript'],
 '/tracking.js': ['tracking.js', 'text/javascript'],
 '/tracking.css': ['tracking.css', 'text/css'],
 '/finance.js': ['finance.js', 'text/javascript'],
 '/billing.js': ['billing.js', 'text/javascript'],
 '/product-payments.js': ['product-payments.js', 'text/javascript'],
 '/emails.js': ['emails.js', 'text/javascript'],
 '/emails.css': ['emails.css', 'text/css'],
 '/projects.js': ['projects.js', 'text/javascript'],
 '/projects.css': ['projects.css', 'text/css'],
 '/product-emails.js': ['product-emails.js', 'text/javascript'],
 '/product-emails.css': ['product-emails.css', 'text/css'],
 '/product-icons.css': ['product-icons.css', 'text/css'],
 '/product-favicons/educare.svg': ['product-favicons/educare.svg', 'image/svg+xml'],
 '/product-favicons/sites.svg': ['product-favicons/sites.svg', 'image/svg+xml'],
 '/billing.css': ['billing.css', 'text/css'],
 ...marcas(BANK_LOGOS),
 '/finance-model.js': ['finance-model.js', 'text/javascript'],
 '/finance.css': ['finance.css', 'text/css'],
 '/delivery.js': ['delivery.js', 'text/javascript'],
 '/resource.js': ['resource.js', 'text/javascript'],
 '/easypanel.js': ['easypanel.js', 'text/javascript'],
 '/delivery.css': ['delivery.css', 'text/css'],
 '/style.css': ['style.css', 'text/css'],
 '/design.css': ['design.css', 'text/css'],
 '/icons.js': ['icons.js', 'text/javascript'],
 '/card-summary.js': ['card-summary.js', 'text/javascript'],
 '/logos/github.svg': ['logos/github.svg', 'image/svg+xml'],
 '/logos/vercel.svg': ['logos/vercel.svg', 'image/svg+xml'],
 '/logos/easypanel.svg': ['logos/easypanel.svg', 'image/svg+xml'],
 '/logo.svg': ['logo.svg', 'image/svg+xml'],
 '/checkout.css': ['checkout.css', 'text/css'],
 '/checkout.js': ['checkout.js', 'text/javascript'],
 '/checkout-gateway.js': ['checkout-gateway.js', 'text/javascript'],
};

export function serveAsset(pathname, res) {
 const entry = FILES[pathname];
 if (!entry) return false;
 const [file, type] = entry;
 res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
 res.end(readFileSync(new URL(`./public/${file}`, import.meta.url)));
 return true;
}
