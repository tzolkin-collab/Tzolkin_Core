// Gravar na fila de WhatsApp (whatsapp_outbox). Usado pelas automações DENTRO da transação do evento (transactional outbox), como o
// e-mail (platform/email-saida.mjs): o lead e a mensagem que ele dispara são gravados juntos ou nenhum dos dois. O envio é do consumidor
// da fila (modules/whatsapp-fila.mjs).
import { normalizarNumero } from '../integrations/evolution.mjs';
import { numerosDaEquipeNormalizados } from './credenciais.mjs';
import { vivo } from './env-vivo.mjs';

export const MENSAGEM_062 = 'A fila de WhatsApp ainda não está disponível neste banco: falta aplicar a migração 062.';
export const VARIAVEIS_DE_WHATSAPP = Object.freeze(['name', 'first_name', 'email', 'whatsapp', 'company_name', 'product_name']);

/** Variáveis `{{x}}` da mensagem que não existem. Vazio = mensagem válida. */
export const variaveisInvalidas = texto => [...String(texto).matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(m => m[1]).filter(v => !VARIAVEIS_DE_WHATSAPP.includes(v));

/** Troca `{{name}}` etc. pelos valores. Variável sem valor vira vazio, e espaços sobrando são arrumados. */
export function renderizarMensagem(texto, valores) {
 return String(texto).replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_, v) => String(valores[v] ?? '')).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

/** Insere uma linha na fila. Idempotente pela chave. Devolve { criado, id }. */
export async function enfileirar(client, i) {
 const r = await client.query(
  `INSERT INTO whatsapp_outbox(idempotency_key,kind,product_id,event,automation_id,lead_id,to_number,to_name,body_text,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
  [i.chave, i.tipo, i.produto ?? null, i.evento ?? null, i.automacao ?? null, i.lead ?? null, i.para, i.nome ?? null, i.texto, i.por ?? null]);
 return { criado: r.rows.length > 0, id: r.rows[0]?.id ?? null };
}

async function carregarLead(client, spaceId, leadId) {
 const lead = (await client.query(
  `SELECT l.email, l.whatsapp, s.name AS lead_name, s.phone, t.name AS company, p.name AS product
     FROM commercial_leads l LEFT JOIN stakeholders s ON s.id=l.stakeholder_id JOIN tenants t ON t.id=l.tenant_id JOIN products p ON p.id=$2
    WHERE l.id=$1`, [leadId, spaceId])).rows[0];
 if (!lead) throw new Error('Lead não encontrado para a mensagem.');
 const nome = String(lead.lead_name || '').trim();
 const numero = normalizarNumero(String(lead.whatsapp || lead.phone || ''));
 return { nome, numero, valores: { name: nome, first_name: nome.split(/\s+/)[0] || '', email: lead.email || '', whatsapp: numero || '', company_name: lead.company, product_name: lead.product } };
}

const gravar = async (client, dados) => {
 try { return await enfileirar(client, dados); }
 catch (e) { if (e?.code === '42P01') throw new Error(MENSAGEM_062); throw e; }
};
const previa = t => (t.length > 60 ? `${t.slice(0, 57)}…` : t);

/** Ação "Enviar WhatsApp ao lead": renderiza a mensagem com os dados do lead e enfileira. Lança com mensagem clara. */
export async function enfileirarParaLead(client, { mensagem, spaceId, leadId, automationId, evento }) {
 const { numero, nome, valores } = await carregarLead(client, spaceId, leadId);
 if (!numero) throw new Error('O lead não tem um WhatsApp válido: nada foi enfileirado.');
 const texto = renderizarMensagem(mensagem, valores);
 if (!texto) throw new Error('A mensagem ficou vazia depois de preencher os dados do lead.');
 const g = await gravar(client, { chave: `wa:${automationId}:${evento}:${leadId}:lead`, tipo: 'lead', produto: spaceId, evento, automacao: automationId, lead: leadId, para: numero, nome, texto, por: 'automacao' });
 return g.criado ? `WhatsApp "${previa(texto)}" na fila para ${numero}` : `WhatsApp para ${numero} já estava na fila`;
}

/** Ação "Avisar a equipe no WhatsApp": uma mensagem para cada número de WHATSAPP_TEAM_NUMBERS. */
export async function enfileirarParaEquipe(client, { mensagem, spaceId, leadId, automationId, evento, env = vivo.env }) {
 const numeros = numerosDaEquipeNormalizados(env.WHATSAPP_TEAM_NUMBERS);
 if (!numeros.length) throw new Error('Nenhum número da equipe configurado (WHATSAPP_TEAM_NUMBERS, em Integrações → WhatsApp).');
 const { valores } = await carregarLead(client, spaceId, leadId);
 const texto = renderizarMensagem(mensagem, valores);
 if (!texto) throw new Error('A mensagem ficou vazia depois de preencher os dados do lead.');
 let novos = 0;
 for (const numero of numeros) {
  const g = await gravar(client, { chave: `wa:${automationId}:${evento}:${leadId}:equipe:${numero}`, tipo: 'equipe', produto: spaceId, evento, automacao: automationId, lead: leadId, para: numero, texto, por: 'automacao' });
  if (g.criado) novos++;
 }
 return novos ? `Aviso "${previa(texto)}" na fila para ${novos} ${novos === 1 ? 'número da equipe' : 'números da equipe'}` : 'Aviso à equipe já estava na fila';
}
