// Sessão administrativa do bootstrap local: memória do processo, sem persistência.
// Substituir por IdP + sessões persistentes antes de qualquer ambiente compartilhado.
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT = 'tzolkin-core-local-v1';
const TTL_MS = 3600000;
const WINDOW_MS = 60000;
const MAX_ATTEMPTS = 10;

export const digest = value => createHash('sha256').update(value).digest('hex');

export function createSessionStore({ adminPassword, clock }) {
 if (!adminPassword || adminPassword.length < 24) throw new Error('A strong bootstrap password is required');
 const passwordHash = scryptSync(adminPassword, SALT, 32);
 const sessions = new Map();
 let attempts = 0;
 let attemptReset = 0;

 return {
  mode:'local-password',secure:false,
  // Limite global de tentativas: adequado a um bootstrap de loopback,
  // NÃO substitui proteção por origem/IP em ambiente exposto.
  throttleLogin() {
   if (clock() > attemptReset) { attempts = 0; attemptReset = clock() + WINDOW_MS; }
   return ++attempts <= MAX_ATTEMPTS;
  },
  verifyPassword: (password, _email) => {
   try { return timingSafeEqual(scryptSync(password, SALT, 32), passwordHash); } catch { return false; }
  },
  issue({ email } = {}) {
   for (const [key, sess] of sessions) {
    const expires = typeof sess === 'number' ? sess : sess.expires;
    if (expires < clock()) sessions.delete(key);
   }
   const token = randomBytes(32).toString('base64url');
   sessions.set(digest(token), { expires: clock() + TTL_MS, email: email || null });
   return { token, maxAge: TTL_MS / 1000 };
  },
  isValid: token => {
   if (!token) return false;
   const sess = sessions.get(digest(token));
   const expires = typeof sess === 'number' ? sess : sess?.expires;
   return (expires || 0) > clock();
  },
  revoke: token => sessions.delete(digest(token)),
  resolve: async (_req,token) => {
   if (!token) return null;
   const sess = sessions.get(digest(token));
   const expires = typeof sess === 'number' ? sess : sess?.expires;
   if ((expires || 0) <= clock()) return null;
   const email = typeof sess === 'object' && sess?.email ? sess.email : null;
   return { subject: 'local-bootstrap', email };
  },
  loginDisabled:()=>false,
 };
}

export const readSessionCookie = req =>
 req.headers.cookie?.match(/(?:^|;\s*)core_session=([A-Za-z0-9_-]+)/)?.[1];
