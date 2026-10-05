// Gravar na fila de e-mail (email_outbox). Usado pelas automações DENTRO da transação do evento (transactional outbox):
// o lead e o e-mail que ele dispara são gravados juntos ou nenhum dos dois. O envio de fato é do consumidor da fila (modules/email-fila.mjs).
import { renderizar, rodapeDoLead, VARIAVEIS_DO_LEAD } from './email-modelo.mjs';
import { enderecoValido } from './email.mjs';

export const MENSAGEM_051 = 'A fila de e-mail ainda não está disponível neste banco: falta aplicar a migração 051.';

/** Insere uma linha na fila. Idempotente pela chave: o mesmo evento reentregue não enfileira duas vezes. Devolve { criado, id }. */
export async function enfileirar(client, i) {
 const r = await client.query(
  `INSERT INTO email_outbox(idempotency_key,kind,product_id,template_slug,event,automation_id,lead_id,to_email,to_name,subject,body_text,body_html,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  [i.chave, i.tipo ?? 'automacao', i.produto ?? null, i.modelo ?? null, i.evento ?? null, i.automacao ?? null, i.lead ?? null, i.para, i.nome ?? null, i.assunto, i.texto, i.html, i.por ?? null]);
 return { criado: r.rows.length > 0, id: r.rows[0]?.id ?? null };
}

/**
 * Ação "Enviar e-mail" de uma automação de lead: renderiza o modelo do espaço com os dados do lead e enfileira.
 * Lança com mensagem clara (a automação registra FAILED e o resto do funil segue).
 */
export async function enfileirarParaLead(client, { modelo, spaceId, leadId, automationId, evento }) {
 const lead = (await client.query(
  `SELECT l.email, s.name AS lead_name, t.name AS company, p.name AS product
     FROM commercial_leads l LEFT JOIN stakeholders s ON s.id=l.stakeholder_id JOIN tenants t ON t.id=l.tenant_id JOIN products p ON p.id=$2
    WHERE l.id=$1`, [leadId, spaceId])).rows[0];
 if (!lead) throw new Error('Lead não encontrado para o e-mail.');
 const para = String(lead.email ?? '').trim().toLowerCase();
 if (!enderecoValido(para)) throw new Error('O lead não tem um e-mail válido: nada foi enfileirado.');
 const tpl = (await client.query('SELECT payload FROM email_templates WHERE product_id=$1 AND slug=$2', [spaceId, modelo])).rows[0]?.payload;
 if (!tpl) throw new Error(`O template "${modelo}" não existe neste espaço.`);
 const nome = lead.lead_name || '';
 const r = renderizar(tpl, { name: nome, email: para, product_name: lead.product, company_name: lead.company }, { permitidas: VARIAVEIS_DO_LEAD, rodape: rodapeDoLead(lead.product) });
 let g;
 try {
  g = await enfileirar(client, { chave: `auto:${automationId}:${evento}:${leadId}:${modelo}`, tipo: 'automacao', produto: spaceId, modelo, evento, automacao: automationId, lead: leadId, para, nome, assunto: r.assunto, texto: r.texto, html: r.html, por: 'automacao' });
 } catch (e) {
  if (e?.code === '42P01') throw new Error(MENSAGEM_051);
  throw e;
 }
 return g.criado ? `E-mail "${r.assunto}" na fila para ${para}` : `E-mail "${r.assunto}" já estava na fila para ${para}`;
}
