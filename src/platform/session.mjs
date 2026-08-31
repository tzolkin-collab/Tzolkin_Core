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
  // Limite global de tentativas: adequado a um bootstrap de loopback,
  // NÃO substitui proteção por origem/IP em ambiente exposto.
  throttleLogin() {
   if (clock() > attemptReset) { attempts = 0; attemptReset = clock() + WINDOW_MS; }
   return ++attempts <= MAX_ATTEMPTS;
  },
  verifyPassword: password => timingSafeEqual(scryptSync(password, SALT, 32), passwordHash),
  issue() {
   for (const [key, expires] of sessions) if (expires < clock()) sessions.delete(key);
   const token = randomBytes(32).toString('base64url');
   sessions.set(digest(token), clock() + TTL_MS);
   return { token, maxAge: TTL_MS / 1000 };
  },
  isValid: token => Boolean(token) && (sessions.get(digest(token)) || 0) > clock(),
  revoke: token => sessions.delete(digest(token)),
 };
}

export const readSessionCookie = req =>
 req.headers.cookie?.match(/(?:^|;\s*)core_session=([A-Za-z0-9_-]+)/)?.[1];
