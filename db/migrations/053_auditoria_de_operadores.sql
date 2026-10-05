-- Auditoria de contas, times e sessões dos operadores: quem mudou o quê e quando.
--
-- SÓ ADICIONA. Sem esta migração contas e times se alteram como sempre (o registro é opcional e o erro de tabela ausente é engolido
-- num savepoint) e a tela de Auditoria só não mostra essa fonte.
--
-- POR QUE UMA TABELA NOVA. `audit_events` exige uma empresa (`tenant_id NOT NULL`), e conta de operador é da TZOLKIN, não de um cliente:
-- por isso, até aqui, mudar o papel de alguém ou suspender uma conta não deixava rastro nenhum.
--
-- O QUE GUARDA. A ação, o alvo (e-mail da conta ou identificador do time), quem fez e um resumo ANTES/DEPOIS só do que é de cadastro
-- (papel, situação, nome, composição do time). Nunca senha, token, hash de sessão nem credencial.

CREATE TABLE IF NOT EXISTS operator_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 action text NOT NULL CHECK (action IN ('conta.criada','conta.alterada','time.salvo','sessoes.encerradas')),
 target text NOT NULL CHECK (length(target) BETWEEN 1 AND 320),
 actor_subject text,
 actor_email text,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 8192),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operator_audit_recentes ON operator_audit (created_at DESC);

COMMENT ON TABLE operator_audit IS 'Trilha de contas, times e sessões dos operadores (não é de empresa, por isso fora de audit_events).';
