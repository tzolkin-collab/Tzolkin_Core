// Rotaciona a senha da role da aplicação e reescreve a DATABASE_URL do .env.
//
// RECUSA texto claro e TLS sem certificado/hostname verificados. Trocar a senha por um
// canal que a expõe entrega a senha nova a quem já lia a antiga: piora a situação
// dando falsa sensação de resolvido.
//
// Ordem correta: corrigir o transporte (docs/SECURITY.md), confirmar tls-verified
// com DATABASE_SSL=require, e só então rodar isto. Loopback não é exceção.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { openDatabase, assertVerifiedTransport } from '../src/platform/database.mjs';

const ENV = '.env';

function replaceUrl(contents, url) {
 if (!/^DATABASE_URL=.*$/m.test(contents)) throw new Error('DATABASE_URL não encontrada em .env');
 return contents.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + url);
}

let pool;
try {
 const current = process.env.DATABASE_URL;
 const opened = await openDatabase({ connectionString: current, mode: 'require', max: 1 });
 pool = opened.pool;

 assertVerifiedTransport(opened.security);

 const url = new URL(current);
 const role = url.username;
 if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Nome de role inesperado; rotação cancelada.');

 const senha = randomBytes(36).toString('hex');
 // ALTER ROLE é comando utilitário: não aceita parâmetro. Em vez de concatenar à mão,
 // o próprio servidor produz o identificador e o literal já escapados.
 const quoted = await pool.query('SELECT quote_ident($1) AS ident, quote_literal($2) AS lit', [role, senha]);
 const { ident, lit } = quoted.rows[0];
 await pool.query(`ALTER ROLE ${ident} PASSWORD ${lit}`);

 url.password = senha;
 copyFileSync(ENV, ENV + '.bak');
 writeFileSync(ENV, replaceUrl(readFileSync(ENV, 'utf8'), url.href));

 console.log('Senha rotacionada e .env atualizado. Cópia anterior em .env.bak — apague depois de confirmar.');
 console.log('Nenhum segredo foi impresso. Reinicie o Core e rode `npm test`.');
} catch (error) {
 console.error('Rotação não concluída:', error.message);
 process.exitCode = 1;
} finally { await pool?.end().catch(() => {}); }
