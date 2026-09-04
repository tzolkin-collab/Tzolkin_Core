// Validação de entrada, erros e serialização HTTP.
// Fonte única das regras de formato usadas por todos os módulos.

export const fail = (status, message) => Object.assign(new Error(message), { status });

export const isUuid = value =>
 typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Identificador de produto: mesmo formato aceito pela constraint de products.id.
export const isProductId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(value);

export function input(body, keys) {
 if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !keys.includes(key)))
  throw fail(400, 'Campos inválidos.');
}

export function text(value, min = 1, max = 200) {
 if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u001f]/.test(value))
  throw fail(400, 'Texto inválido.');
 return value.trim();
}

export function onlyParams(searchParams, keys) {
 if ([...searchParams.keys()].some(key => !keys.includes(key))) throw fail(400, 'Parâmetros inválidos.');
}

export async function json(req, limit = 16384) {
 if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Envie JSON.');
 const chunks = []; let length = 0;
 for await (const chunk of req) {
  length += chunk.length;
  if (length > limit) throw fail(413, 'Requisição muito grande.');
  chunks.push(chunk);
 }
 try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'JSON inválido.'); }
}

export function securityHeaders(res) {
 res.setHeader('Cache-Control', 'no-store');
 res.setHeader('X-Content-Type-Options', 'nosniff');
 res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
 res.setHeader('Referrer-Policy', 'no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(), usb=()');
 res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
}

export const replier = res => (status, body) => {
 res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
 res.end(JSON.stringify(body));
};

// Traduz erros de integridade do PostgreSQL sem vazar detalhes internos.
export function describeError(error) {
 if (error.status) return { status: error.status, message: error.message };
 if (error.code === '23505') return { status: 409, message: 'Identificador já cadastrado.' };
 if (error.code === '23503') return { status: 409, message: 'Empresa ou produto não encontrado.' };
 return { status: 500, message: 'Não foi possível concluir a operação.' };
}
