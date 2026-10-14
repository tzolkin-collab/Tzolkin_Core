// Tipo da atividade (Call, Task, Registro): depois que a atividade tem conteúdo, o tipo deixa de poder mudar.
//
// Por quê: cada tipo mostra campos diferentes (Meet só em Call, vínculos só em Task, horário opcional em Registro). Trocar o tipo
// de uma atividade preenchida esconderia ou invalidaria o que já está lá. Quem precisa de outro tipo cria outra atividade.
//
// A regra mora no servidor porque a tela não é a única porta: o MCP também edita o tipo. A tela só avisa antes (agenda-model.js,
// `tipoTravado`, com a MESMA definição de conteúdo).
import { fail } from './http.mjs';

// Mesmos grupos das abas da tela (agenda-model.js, KINDS_DA_ABA): entregavel/feature/tarefa são todos Task.
export const GRUPO_DO_KIND = Object.freeze({ sessao: 'call', tarefa: 'task', entregavel: 'task', feature: 'task', registro: 'registro' });
export const MENSAGEM_TIPO_TRAVADO = 'Esta atividade já tem conteúdo (descrição, local, link, apontamentos ou vínculos), então o tipo não pode mais ser trocado. Crie outra atividade do tipo que você quer.';

/** O editor grava `{"blocks":[...]}`; uma descrição só com a casca vazia não conta como conteúdo. Texto antigo (Markdown/cru) conta. */
export function descricaoVazia(d) {
 if (d == null) return true;
 const s = String(d).trim();
 if (!s) return true;
 try { const j = JSON.parse(s); if (j && Array.isArray(j.blocks)) return j.blocks.length === 0; } catch { /* texto antigo */ }
 return false;
}

const preenchido = v => v != null && String(v).trim() !== '';

/** Conteúdo que vive na própria linha da atividade (sem consultar o banco). */
export const temConteudoNaLinha = a => !descricaoVazia(a.description) || preenchido(a.location) || preenchido(a.meeting_url) || preenchido(a.google_event_id);

/**
 * Recusa (409) trocar o tipo para outro GRUPO quando a atividade tem conteúdo. `novoKind` igual ao atual, ou dentro do mesmo grupo,
 * passa. Chamar dentro da transação da edição: lê a linha com FOR UPDATE para a decisão e a gravação verem o mesmo estado.
 * Devolve a linha lida (a rota pode reaproveitar) ou null se a atividade não existe (a rota segue e responde o 409 de sempre).
 */
export async function exigirTipoLivre(db, atividadeId, novoKind) {
 if (novoKind === undefined) return null;
 const linha = (await db.query('SELECT id, kind, description, location, meeting_url, google_event_id FROM service_activities WHERE id=$1 FOR UPDATE', [atividadeId])).rows?.[0];
 if (!linha) return null;
 const atual = GRUPO_DO_KIND[linha.kind] || 'task', novo = GRUPO_DO_KIND[novoKind] || 'task';
 if (atual === novo) return linha;
 if (temConteudoNaLinha(linha)) throw fail(409, MENSAGEM_TIPO_TRAVADO);
 const apontou = (await db.query('SELECT 1 FROM service_time_logs WHERE activity_id=$1 LIMIT 1', [atividadeId])).rows?.length > 0;
 if (apontou) throw fail(409, MENSAGEM_TIPO_TRAVADO);
 // Vínculos (056) podem não existir em banco mais velho: sem a tabela, não há vínculo a proteger.
 if ((await db.query("SELECT to_regclass('service_activity_links') AS t")).rows?.[0]?.t) {
  if ((await db.query('SELECT 1 FROM service_activity_links WHERE activity_id=$1 LIMIT 1', [atividadeId])).rows?.length > 0) throw fail(409, MENSAGEM_TIPO_TRAVADO);
 }
 return linha;
}
