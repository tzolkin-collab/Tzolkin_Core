-- Quem conectou a credencial de marketing.
--
-- Conectar um token que lê o Gerenciador de Anúncios inteiro é mudança
-- sensível, e mudança sensível tem autor. Sem isto, a única pergunta que o
-- banco respondia era "quando", nunca "quem".
--
-- O histórico já existe: a credencial anterior não é apagada, é marcada
-- `active=false` com `revoked_at`. Estas colunas completam a linha do tempo.
ALTER TABLE marketing_credentials
 ADD COLUMN IF NOT EXISTS connected_by_subject text,
 ADD COLUMN IF NOT EXISTS connected_by_email text,
 -- Como a credencial entrou: pelo painel ou pelo script do servidor.
 ADD COLUMN IF NOT EXISTS connected_via text NOT NULL DEFAULT 'script'
  CHECK (connected_via IN ('script', 'panel'));
