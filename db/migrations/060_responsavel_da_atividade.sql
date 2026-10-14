-- 060 — Responsável da atividade.
--
-- NÃO APLICADA. Escrita em 2026-10-13, pendente de autorização do dono (o banco compartilhado é o de produção).
-- Até ela ser aplicada o Core funciona como antes: GET /api/tracking responde `agenda_responsavel: false`, a tela não
-- oferece o campo e quem tentar gravar um responsável recebe 409 com MENSAGEM_060, nunca a violação da coluna.
--
-- UMA COLUNA, ADITIVA. A atividade passa a poder ter uma pessoa responsável, que é uma CONTA de operador
-- (operator_accounts), a mesma que já é "Responsável" de lead, tarefa e contrato no comercial (013/025). Não é texto
-- livre, nem e-mail: é a conta, para o aviso só chegar a quem foi escolhido e para a pessoa suspensa deixar de ser
-- alcançada sem ninguém precisar lembrar de trocar o texto.
--
-- NULL = "sem responsável", e é o estado de TODA atividade que já existe. Sem responsável o lembrete continua indo para
-- quem assinou o tópico, como hoje; com responsável, vai SÓ para os aparelhos dessa pessoa.
--
-- Nada é apagado nem reescrito. Sem DELETE: trocar ou tirar o responsável é UPDATE, com trilha em service_activity_audit.
-- Conta não se exclui no Core (só se suspende), então a chave estrangeira nunca fica pendurada.
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

ALTER TABLE service_activities
 ADD COLUMN IF NOT EXISTS responsible_id uuid REFERENCES operator_accounts(id);

-- "Minhas atividades": a lista de quem é o responsável só olha as que têm um.
CREATE INDEX IF NOT EXISTS service_activities_responsavel_idx
 ON service_activities (responsible_id, starts_at) WHERE responsible_id IS NOT NULL;

COMMENT ON COLUMN service_activities.responsible_id IS
 'Conta de operador responsável pela atividade. NULL = sem responsável (o lembrete vai a quem assinou o tópico). Com responsável, o aviso vai só aos aparelhos dele.';
