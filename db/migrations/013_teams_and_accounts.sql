-- 013 — Contas de operador e times.
--
-- ADITIVO DE PROPÓSITO. Hoje quem entra no Core é decidido por CORE_ALLOWED_EMAILS,
-- uma lista plana no ambiente. Estas tabelas REGISTRAM contas e times; elas ainda
-- NÃO autorizam ninguém. Trocar a fonte de autorização numa migração arriscaria
-- trancar o operador fora da producao — a troca vira uma decisao explicita depois,
-- quando a divergencia entre tabela e env estiver visivel e zerada.
--
-- Ver docs/SECURITY.md e a entrega E2/E3 do ROADMAP.

CREATE TABLE operator_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 320 AND position('@' in email) > 1),
 name text CHECK (name IS NULL OR length(name) BETWEEN 2 AND 160),
 -- 'owner' responde pela conta; 'member' opera; 'viewer' so le.
 -- Papel ainda NAO e aplicado na autorizacao: e cadastro, nao permissao.
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member','viewer')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 -- De onde veio: 'env' quando espelha CORE_ALLOWED_EMAILS, 'manual' quando cadastrado aqui.
 source text NOT NULL DEFAULT 'manual' CHECK (source IN ('env','manual')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
 description text CHECK (description IS NULL OR length(description) <= 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
 -- Papel DENTRO do time, distinto do papel global da conta.
 role text NOT NULL DEFAULT 'member' CHECK (role IN ('lead','member')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (team_id, account_id)
);
CREATE INDEX team_members_account ON team_members(account_id);
