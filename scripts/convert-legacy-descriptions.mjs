// Converte descrições em Markdown cru (gravadas pelo bot MCP antes do conversor) para o JSON do Editor.js que a tela lê.
// Uso:  node --env-file=.env scripts/convert-legacy-descriptions.mjs            (só mostra o que mudaria)
//       node --env-file=.env scripts/convert-legacy-descriptions.mjs --apply    (grava; antes salva o original em scratch/)
// Só toca linhas cuja descrição não é JSON do Editor.js. Série e atividade são tratadas; nada é apagado.
import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { markdownParaEditorJs } from '../apps/api/src/platform/markdown-editorjs.mjs';

const aplicar = process.argv.includes('--apply');
const TABELAS = ['service_activities', 'service_activity_series'];
const ehEditorJs = t => { try { return Array.isArray(JSON.parse(t)?.blocks); } catch { return false; } };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const client = await pool.connect();
const backup = {};
try {
 await client.query('BEGIN');
 for (const tabela of TABELAS) {
  const { rows } = await client.query(`SELECT id, title, description FROM ${tabela} WHERE description IS NOT NULL`);
  const alvo = rows.filter(r => !ehEditorJs(r.description));
  console.log(`${tabela}: ${rows.length} com descrição, ${alvo.length} em texto/Markdown cru`);
  backup[tabela] = [];
  for (const r of alvo) {
   const novo = markdownParaEditorJs(r.description);
   if (!novo || novo.length > 20000) { console.log('  pulada (vazia ou grande demais):', r.id, r.title); continue; }
   console.log('  ->', r.id, '|', r.title);
   backup[tabela].push({ id: r.id, description: r.description });
   if (aplicar) await client.query(`UPDATE ${tabela} SET description = $2 WHERE id = $1`, [r.id, novo]);
  }
 }
 if (aplicar) {
  mkdirSync(new URL('../scratch/', import.meta.url), { recursive: true });
  const arquivo = new URL(`../scratch/descricoes-originais-${Date.now()}.json`, import.meta.url);
  writeFileSync(arquivo, JSON.stringify(backup, null, 1));
  await client.query('COMMIT');
  console.log('Gravado. Originais salvos em', arquivo.pathname);
 } else {
  await client.query('ROLLBACK');
  console.log('Simulação: nada foi gravado. Use --apply para converter.');
 }
} catch (e) {
 await client.query('ROLLBACK'); throw e;
} finally { client.release(); await pool.end(); }
