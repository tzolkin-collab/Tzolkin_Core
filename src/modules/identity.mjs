// Autenticação do operador interno (bootstrap local).
// Não é portal de cliente: não há login de organização nesta versão.
import { json, input, text, fail } from '../platform/http.mjs';

export function identityRoutes(router) {
 router.post('/api/login', async ({ req, reply, res, sessions }) => {
  if (!sessions.throttleLogin()) throw fail(429, 'Aguarde um minuto.');
  const body = await json(req);
  input(body, ['password']);
  if (!sessions.verifyPassword(text(body.password, 1, 256))) throw fail(401, 'Senha inválida.');
  const { token, maxAge } = sessions.issue();
  res.setHeader('Set-Cookie', `core_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  return reply(200, { ok: true });
 }, { auth: 'public' });

 router.post('/api/logout', async ({ reply, res, sessions, sessionToken }) => {
  sessions.revoke(sessionToken);
  res.setHeader('Set-Cookie', 'core_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return reply(200, { ok: true });
 }, { body: false });
}
