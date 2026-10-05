// Trilha de contas, times e sessões dos operadores (tabela operator_audit, migração 053).
//
// O registro roda NA transação de quem mudou e dentro de um savepoint: ou a mudança e o rastro existem juntos, ou (se a tabela ainda não
// existe) a mudança acontece sem rastro, como sempre foi. Falha do registro nunca impede a mudança.

/** Texto curto do que mudou, só com dados de cadastro (papel, situação, nome, composição do time). */
const PAPEL = { owner: 'Administrador', member: 'Membro', viewer: 'Leitor', lead: 'Líder' };
const SITUACAO = { active: 'Ativa', suspended: 'Suspensa' };
const rot = (mapa, v) => mapa[v] ?? v ?? '—';

export function resumirConta(antes, depois) {
 if (!antes) return `Conta criada: ${rot(PAPEL, depois.role)}, ${rot(SITUACAO, depois.status).toLowerCase()}${depois.name ? `, nome ${depois.name}` : ''}`;
 const partes = [];
 if (antes.role !== depois.role) partes.push(`Papel: ${rot(PAPEL, antes.role)} → ${rot(PAPEL, depois.role)}`);
 if (antes.status !== depois.status) partes.push(`Situação: ${rot(SITUACAO, antes.status)} → ${rot(SITUACAO, depois.status)}`);
 if ((antes.name ?? null) !== (depois.name ?? null)) partes.push(`Nome: ${antes.name ?? '—'} → ${depois.name ?? '—'}`);
 return partes.join(' · ');
}

export function resumirTime(antes, depois) {
 const chave = m => `${m.email}|${m.role}`;
 const a = new Map((antes?.membros ?? []).map(m => [m.email, m])), d = new Map((depois.membros ?? []).map(m => [m.email, m]));
 const partes = [];
 if (!antes) partes.push('Time criado');
 else {
  if (antes.name !== depois.name) partes.push(`Nome: ${antes.name} → ${depois.name}`);
  if ((antes.description ?? null) !== (depois.description ?? null)) partes.push('Descrição alterada');
 }
 const entraram = [...d.keys()].filter(e => !a.has(e)), sairam = [...a.keys()].filter(e => !d.has(e));
 const mudaram = [...d.keys()].filter(e => a.has(e) && chave(a.get(e)) !== chave(d.get(e)));
 if (entraram.length) partes.push(`Entraram: ${entraram.join(', ')}`);
 if (sairam.length) partes.push(`Saíram: ${sairam.join(', ')}`);
 if (mudaram.length) partes.push(`Papel no time: ${mudaram.map(e => `${e} (${rot(PAPEL, a.get(e).role)} → ${rot(PAPEL, d.get(e).role)})`).join(', ')}`);
 return partes.join(' · ');
}

/**
 * Grava uma linha de auditoria. Nunca lança: erro (inclusive tabela ausente) desfaz só o registro e segue.
 * @returns {Promise<boolean>} true se registrou
 */
export async function registrarAuditoria(client, { acao, alvo, operator, detalhes = {} }) {
 try {
  await client.query('SAVEPOINT auditoria_operadores');
  await client.query('INSERT INTO operator_audit(action,target,actor_subject,actor_email,details) VALUES($1,$2,$3,$4,$5)',
   [acao, String(alvo).slice(0, 320), operator?.subject ?? null, operator?.email ?? null, JSON.stringify(detalhes)]);
  await client.query('RELEASE SAVEPOINT auditoria_operadores');
  return true;
 } catch (e) {
  try { await client.query('ROLLBACK TO SAVEPOINT auditoria_operadores'); await client.query('RELEASE SAVEPOINT auditoria_operadores'); } catch { /* a transação caiu: quem chamou decide */ }
  if (e?.code !== '42P01') console.error('[auditoria-operadores] falhou:', e?.message);
  return false;
 }
}
