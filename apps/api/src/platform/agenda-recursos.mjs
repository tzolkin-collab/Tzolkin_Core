// A agenda cresceu em duas migrações aditivas que podem chegar ao banco depois do código:
//   047  descrição, local e link da reunião               -> `campos`
//   048  lembretes, preferências e séries recorrentes     -> `lembretes` (só vale com a 047 também, porque as ocorrências copiam esses campos)
// Enquanto uma delas não existe, a tela esconde o recurso e a API recusa o uso com mensagem clara (em vez de "column does not exist").
//
// A pergunta ao banco é lembrada: verdadeiro nunca volta a falso; falso só é reverificado depois de `ttl`, para a primeira consulta
// depois de aplicar a migração já enxergar o recurso. Um detector por servidor, compartilhado por quem precisa saber (rotas e jobs).

export const COLUNAS_047 = Object.freeze(['description', 'location', 'meeting_url']);
export const COLUNAS_048 = Object.freeze(['reminders', 'series_id', 'series_ordinal', 'series_detached', 'archived_at']);
export const TABELAS_048 = Object.freeze(['service_activity_series', 'service_activity_series_audit', 'agenda_preferences', 'agenda_reminders_sent']);

export const MENSAGEM_047 = 'Descrição, local e link da reunião ainda não estão disponíveis neste banco: falta aplicar a migração 047.';
export const MENSAGEM_048 = 'Lembretes e repetição ainda não estão disponíveis neste banco: falta aplicar a migração 048.';

export function criarDetector({ relogio = Date.now, ttl = 60000 } = {}) {
 let campos = false, lembretes = false, verificadoEm = -Infinity;
 /** db: qualquer coisa com .query (pool ou client). Devolve { campos, lembretes }. */
 return async function recursos(db) {
  if (campos && lembretes) return { campos, lembretes };
  if (relogio() - verificadoEm < ttl) return { campos, lembretes };
  verificadoEm = relogio();
  const r = await db.query(
   `SELECT
     (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'service_activities' AND column_name = ANY($1)) AS campos,
     (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'service_activities' AND column_name = ANY($2)) AS colunas,
     (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($3)) AS tabelas`,
   [COLUNAS_047, COLUNAS_048, TABELAS_048]);
  const l = r.rows[0] || {};
  campos = campos || l.campos === COLUNAS_047.length;
  lembretes = lembretes || (campos && l.colunas === COLUNAS_048.length && l.tabelas === TABELAS_048.length);
  return { campos, lembretes };
 };
}
