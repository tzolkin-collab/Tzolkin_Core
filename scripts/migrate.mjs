// Aplica db/migrations/*.sql em ordem, uma transação por arquivo, registrando
// o que já rodou. Rodar de novo não reaplica nada.
//
// `db/schema.sql` é a linha de base; as migrações vêm depois dela.
// Usado por `npm run db:migrate` e por scripts/setup.mjs.
// Ver docs/INFRASTRUCTURE.md#3-migrações
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIR = new URL('../db/migrations/', import.meta.url);

export async function applyMigrations(client, log = console.log) {
 await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
   id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

 const applied = new Set((await client.query('SELECT id FROM schema_migrations')).rows.map(row => row.id));
 const pending = readdirSync(DIR).filter(name => name.endsWith('.sql') && !applied.has(name)).sort();
 if (!pending.length) { log('Banco já está na última migração.'); return true; }

 for (const name of pending) {
  // Uma transação por migração: falhou, nada daquela migração fica aplicado.
  await client.query('BEGIN');
  try {
   await client.query(readFileSync(new URL(name, DIR), 'utf8'));
   await client.query('INSERT INTO schema_migrations(id) VALUES($1)', [name]);
   await client.query('COMMIT');
   log('aplicada: ' + name);
  } catch (error) {
   await client.query('ROLLBACK');
   console.error('falhou em', name, '—', error.message);
   return false;
  }
 }
 return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
 const client = await pool.connect();
 try { if (!await applyMigrations(client)) process.exitCode = 1; }
 finally { client.release(); await pool.end(); }
}
