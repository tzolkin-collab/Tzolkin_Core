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
export const MENSAGEM_054 = 'A atividade do tipo Registro ainda não está disponível neste banco: falta aplicar a migração 054.';

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

/**
 * A migração 054 abriu o tipo 'registro' no CHECK de `service_activities.kind` (o tipo da atividade virou aba:
 * Call, Task e Registro). Detector à parte, como o do Google (criarDetectorGoogle): quem já tem a 047 e a 048 não
 * volta a perguntar por elas, e a pergunta nova — ler o CHECK da coluna — não muda o contrato do detector de cima.
 *
 * Enquanto a 054 não está no banco, a tela não oferece a aba Registro e a API recusa o tipo com MENSAGEM_054, em vez
 * de deixar o INSERT estourar no CHECK (que chegaria à pessoa como erro de banco).
 */
export function criarDetectorRegistro({ relogio = Date.now, ttl = 60000 } = {}) {
 let ok = false, verificadoEm = -Infinity;
 /** db: qualquer coisa com .query (pool ou client). Devolve true quando 'registro' é um tipo aceito. */
 return async function registroDisponivel(db) {
  if (ok) return true;
  if (relogio() - verificadoEm < ttl) return false;
  verificadoEm = relogio();
  const r = await db.query(
   `SELECT count(*)::int AS tipo FROM pg_constraint
     WHERE conrelid = to_regclass(current_schema() || '.service_activities') AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%''registro''%'`);
  ok = (r.rows[0]?.tipo || 0) > 0;
  return ok;
 };
}

/**
 * A migração 056 cria a tabela service_activity_links para guardar vínculos de atividades com
 * sistemas externos (GitHub, Meta, etc).
 */
export function criarDetectorVinculos({ relogio = Date.now, ttl = 60000 } = {}) {
 let ok = false, verificadoEm = -Infinity;
 return async function vinculosDisponiveis(db) {
  if (ok) return true;
  if (relogio() - verificadoEm < ttl) return false;
  verificadoEm = relogio();
  const r = await db.query(`SELECT count(*)::int AS tabelas FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'service_activity_links'`);
  ok = (r.rows[0]?.tabelas || 0) > 0;
  return ok;
 };
}
