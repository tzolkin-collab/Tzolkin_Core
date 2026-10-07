-- Acompanhamento: o tipo da atividade virou aba (Call · Task · Registro) e 'registro' é um tipo novo.
--
-- Escrita em 2026-10-06; APLICADA em 2026-10-07, com autorização do dono e depois de backup completo dos dados.
-- Em um banco sem ela, o Core funciona como antes e nada quebra: GET /api/tracking responde `agenda_registro: false`,
-- a tela não oferece a aba Registro (diz que ela espera esta migração) e quem tentar gravar o tipo recebe 409 com
-- MENSAGEM_054 em vez da violação do CHECK. Mesma regra aditiva da 047 e da 048.
--
-- SÓ TROCA UM CHECK de lista fechada, como a 048 fez com os tópicos de push. Nada é apagado nem reescrito: as
-- atividades existentes continuam com 'sessao', 'entregavel', 'feature' e 'tarefa', que seguem valendo — 'entregavel' e
-- 'feature' são de antes das abas e abrem na aba Task.
--
-- service_activity_series NÃO muda: repetir um registro não quer dizer nada (registro é o que já aconteceu e se
-- guarda), então serieInput recusa esse tipo no código e a lista da série fica como está.

ALTER TABLE service_activities DROP CONSTRAINT IF EXISTS service_activities_kind_check;
ALTER TABLE service_activities ADD CONSTRAINT service_activities_kind_check
 CHECK (kind IN ('sessao','entregavel','feature','tarefa','registro'));

COMMENT ON COLUMN service_activities.kind IS 'Tipo da atividade, que na tela é aba: sessao = Call; tarefa, entregavel e feature = Task; registro = Registro (algo guardado na base, sem hora marcada).';
