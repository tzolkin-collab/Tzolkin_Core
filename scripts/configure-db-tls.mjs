// Migra somente o .env local após testar TLS autenticado, sem imprimir segredos.
import { readFileSync, copyFileSync, writeFileSync, constants } from 'node:fs';
import { parseEnv } from 'node:util';
import { openDatabase } from '../apps/api/src/platform/database.mjs';

let pool;
try {
 const original = readFileSync('.env', 'utf8');
 const env = parseEnv(original);
 const url = new URL(env.DATABASE_URL);
 for (const key of ['ssl', 'sslmode', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
 url.searchParams.set('sslmode', 'verify-full');
 url.searchParams.set('sslrootcert', 'certs/postgres-server.crt');
 const opened = await openDatabase({ connectionString: url.href, mode: 'require', max: 1 });
 pool = opened.pool;
 const { rows } = await pool.query('SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
 if (!rows[0]?.ssl || !opened.security.verified) throw new Error('TLS não verificado.');
 const lines = original.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?(?:DATABASE_URL|DATABASE_SSL)\s*=/.test(line));
 lines.push(`DATABASE_URL=${url.href}`, 'DATABASE_SSL=require', '');
 const next = lines.join('\n');
 if (parseEnv(next).DATABASE_URL !== url.href) throw new Error('Serialização inválida.');
 copyFileSync('.env', `.env.before-tls-${Date.now()}`, constants.COPYFILE_EXCL);
 writeFileSync('.env', next);
 console.log(`Configuração salva: TLS verificado (${rows[0].version}), sem fallback.`);
} catch {
 console.error('Configuração TLS falhou; confira certificado, conexão e arquivo local.');
 process.exitCode = 1;
} finally { if (pool) await pool.end(); }
