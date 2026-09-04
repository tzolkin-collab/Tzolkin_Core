// Roteador mínimo: casa método + caminho, com segmentos ":param".
// Cada módulo publica rotas declarativas; a composição fica em src/app.mjs.

function compile(pattern) {
 const segments = pattern.split('/').filter(Boolean);
 return { segments, params: segments.filter(s => s.startsWith(':')).map(s => s.slice(1)) };
}

export function createRouter() {
 const routes = [];
 const register = (method, pattern, handler, options = {}) =>
  routes.push({ method, pattern, ...compile(pattern), handler, ...options });
 return {
  get: (pattern, handler, options) => register('GET', pattern, handler, options),
  post: (pattern, handler, options) => register('POST', pattern, handler, options),
  put: (pattern, handler, options) => register('PUT', pattern, handler, options),
  delete: (pattern, handler, options) => register('DELETE', pattern, handler, options),
  // Retorna a rota casada e os parâmetros do caminho, ou null.
  match(method, pathname) {
   const parts = pathname.split('/').filter(Boolean);
   for (const route of routes) {
    if (route.method !== method || route.segments.length !== parts.length) continue;
    const params = {};
    let matched = true;
    for (const [index, segment] of route.segments.entries()) {
     if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[index]);
     else if (segment !== parts[index]) { matched = false; break; }
    }
    if (matched) return { route, params };
   }
   return null;
  },
  // Um caminho existente com método diferente merece 405, não 404.
  allows: pathname => routes.some(route => {
   const parts = pathname.split('/').filter(Boolean);
   return route.segments.length === parts.length &&
    route.segments.every((segment, index) => segment.startsWith(':') || segment === parts[index]);
  }),
 };
}
