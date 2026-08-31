// Arquivos estáticos do painel. Lista fixa: nada de resolução de caminho vinda da URL.
import { readFileSync } from 'node:fs';

const FILES = {
 '/': ['index.html', 'text/html'],
 '/app.js': ['app.js', 'text/javascript'],
 '/style.css': ['style.css', 'text/css'],
 '/logo.svg': ['logo.svg', 'image/svg+xml'],
};

export function serveAsset(pathname, res) {
 const entry = FILES[pathname];
 if (!entry) return false;
 const [file, type] = entry;
 res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
 res.end(readFileSync(new URL(`../../public/${file}`, import.meta.url)));
 return true;
}
