// Repara descrições de atividade gravadas ANTES de o conversor de Markdown conhecer citação, tabela e divisória.
//
// O conversor antigo só produzia header, list, checklist e paragraph: o resto do Markdown do bot caía
// em parágrafo, com o símbolo no meio do texto ("> ", "| a | b |", "---"). A ficha desenhava esse texto
// cru. A correção do conversor só vale para o que for gravado daqui em diante; este script refaz o que
// já está no banco, passando o texto desses parágrafos pelo mesmo conversor que o bot usa.
//
// PADRÃO É SIMULAR. Sem --aplicar nada é gravado: imprime só contagens e os tipos de bloco antes e depois,
// nunca o conteúdo. Com --aplicar: uma transação só, cópia do estado anterior fora do repositório,
// conferência dentro da transação (mesma quantidade de atividades, nenhuma descrição vazia) e ROLLBACK
// se algo não bater. Só mexe em atividade cujo parágrafo tem marca de Markdown; o resto fica intacto.
//
//   node --env-file=.env scripts/reparar-descricoes.mjs            (simula)
//   node --env-file=.env scripts/reparar-descricoes.mjs --aplicar  (grava)
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDatabase } from '../apps/api/src/platform/database.mjs';
import { markdownParaEditorJs, inlineParaMarkdown } from '../apps/api/src/platform/markdown-editorjs.mjs';

const aplicar = process.argv.includes('--aplicar');
// Marcas que o conversor antigo deixava passar. Lista, título e negrito ficam de fora de propósito:
// o conversor antigo já os convertia, então o que sobrou assim foi escrito à mão como texto.
const MARCAS = [/^\s*>\s/, /^\s*\|.*\|/, /^\s*(-{3,}|\*{3,}|_{3,})\s*$/, /^\s*```/];
const temMarca = texto => texto.split('\n').some(linha => MARCAS.some(re => re.test(linha)));

/** Parágrafo -> texto Markdown. O HTML do editor guarda quebra de linha como <br>. */
const paraMarkdown = html => inlineParaMarkdown(String(html ?? '').replace(/<br\s*\/?>/gi, '\n'));

/** Refaz uma descrição. Devolve null quando nada nela precisa de reparo. */
export function repararDescricao(descricao) {
 let doc;
 try { doc = JSON.parse(descricao); } catch { return null; }
 if (!doc || !Array.isArray(doc.blocks)) return null;
 let mudou = false;
 const blocos = [];
 for (const bloco of doc.blocks) {
  const md = bloco.type === 'paragraph' ? paraMarkdown(bloco.data?.text) : '';
  if (bloco.type !== 'paragraph' || !temMarca(md)) { blocos.push(bloco); continue; }
  const refeito = markdownParaEditorJs(md);
  const novos = refeito ? JSON.parse(refeito).blocks : null;
  // Se o conversor não devolver nada, o bloco antigo fica: nunca se troca texto por vazio.
  if (!novos?.length) { blocos.push(bloco); continue; }
  blocos.push(...novos);
  mudou = true;
 }
 return mudou ? JSON.stringify({ ...doc, blocks: blocos }) : null;
}

const contar = descricao => {
 const por = {};
 for (const b of JSON.parse(descricao).blocks) por[b.type] = (por[b.type] || 0) + 1;
 return por;
};

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('reparar-descricoes.mjs')) {
 const { pool } = await openDatabase({ connectionString: process.env.DATABASE_URL, mode: 'require', max: 1 });
 const client = await pool.connect();
 try {
  await client.query(aplicar ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  const linhas = (await client.query(
   // Só ao gravar se trava a linha: a simulação roda em leitura, onde o Postgres não aceita FOR UPDATE nem FOR SHARE.
   'SELECT id, description, revision FROM service_activities WHERE description IS NOT NULL' + (aplicar ? ' FOR UPDATE' : ''))).rows;
  const reparos = [];
  for (const l of linhas) {
   const nova = repararDescricao(l.description);
   if (nova) reparos.push({ id: l.id, antes: l.description, depois: nova, revision: l.revision });
  }
  console.log(`atividades com descrição: ${linhas.length} · a reparar: ${reparos.length}`);
  for (const r of reparos) console.log(`  ${r.id.slice(0, 8)}…  antes ${JSON.stringify(contar(r.antes))}  depois ${JSON.stringify(contar(r.depois))}`);
  if (!aplicar) { console.log('\nSimulação: nada foi gravado. Use --aplicar para gravar.'); await client.query('ROLLBACK'); }
  else if (!reparos.length) { console.log('Nada a reparar.'); await client.query('ROLLBACK'); }
  else {
   const pasta = new URL('../.tmp/', import.meta.url);
   mkdirSync(pasta, { recursive: true });
   const copia = new URL(`reparo-descricoes-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, pasta);
   writeFileSync(copia, JSON.stringify(reparos.map(r => ({ id: r.id, description: r.antes })), null, 1));
   for (const r of reparos) {
    await client.query(
     'UPDATE service_activities SET description=$2, revision=revision+1, updated_at=now() WHERE id=$1 AND revision=$3', [r.id, r.depois, r.revision]);
   }
   const depois = (await client.query('SELECT count(*)::int n, count(*) FILTER (WHERE description IS NULL OR description=\'\')::int vazias FROM service_activities WHERE description IS NOT NULL OR id = ANY($1::uuid[])', [reparos.map(r => r.id)])).rows[0];
   if (depois.vazias) throw new Error(`conferência falhou: ${depois.vazias} descrições ficaram vazias`);
   await client.query('COMMIT');
   console.log(`\nGravado: ${reparos.length} atividades. Cópia do estado anterior em ${copia.pathname}`);
  }
 } catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('ROLLBACK — nada foi alterado:', e.message);
  process.exitCode = 1;
 } finally { client.release(); await pool.end(); }
}
