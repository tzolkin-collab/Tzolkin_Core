// Autenticação do operador interno (bootstrap local).
// Não é portal de cliente: não há login de organização nesta versão.
import { json, input, text, fail } from '../platform/http.mjs';

export function identityRoutes(router) {
 router.get('/api/auth/mode',async({reply,sessions})=>reply(200,{mode:sessions.mode, google: Boolean(sessions.begin), password: !sessions.loginDisabled()}),{auth:'public'});
 router.get('/api/auth/google/start',async({res,sessions})=>{if(!sessions.begin)throw fail(404,'Login Google indisponível.');const target=await sessions.begin();res.writeHead(302,{Location:target.href,'Cache-Control':'no-store'});res.end();},{auth:'public'});
 router.get('/api/auth/google/callback',async({url,res,sessions})=>{if(!sessions.finish)throw fail(404,'Login Google indisponível.');try{const {token,maxAge}=await sessions.finish(url);res.writeHead(302,{Location:'/', 'Set-Cookie':`core_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,'Cache-Control':'no-store'});res.end();}catch{res.writeHead(302,{Location:'/?auth_error=1','Cache-Control':'no-store'});res.end();}},{auth:'public'});
 router.post('/api/login', async ({ req, reply, res, sessions }) => {
  if(sessions.loginDisabled())throw fail(404,'Login gerenciado pela identidade corporativa.');
  if (sessions.throttleLogin && !sessions.throttleLogin()) throw fail(429, 'Aguarde um minuto.');
  const body = await json(req);
  input(body, ['password', 'email']);
  const email = body.email ? text(body.email, 3, 256).toLowerCase().trim() : null;
  const password = text(body.password, 1, 256);
  const ok = await sessions.verifyPassword(password, email);
  if (!ok) throw fail(401, 'Credenciais inválidas.');
  const { token, maxAge } = await sessions.issue({ email });
  res.setHeader('Set-Cookie', `core_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${sessions.secure?'; Secure':''}`);
  return reply(200, { ok: true });
 }, { auth: 'public' });

 router.post('/api/logout', async ({ reply, res, sessions, sessionToken }) => {
  await sessions.revoke(sessionToken);
  res.setHeader('Set-Cookie', `core_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${sessions.secure?'; Secure':''}`);
  return reply(200, { ok: true, logout_url:null });
 }, { body: false });
}
