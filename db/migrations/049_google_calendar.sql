-- Google Agenda e Meet: conexão da conta Google de cada operador e vínculo de uma atividade com o evento criado lá.
--
-- SÓ ADICIONA. O código funciona antes e depois: sem esta migração a API diz `disponivel: false`, a tela não oferece "Criar sala do Meet"
-- e quem tentar usar recebe 409 com mensagem clara. Mesma regra das migrações 047 e 048.
--
-- 1) google_calendar_connections: UMA linha por operador. Guarda só o REFRESH TOKEN, CIFRADO (AES-256-GCM, chave fora do banco: CORE_SECRETS_KEY).
--    O token de acesso (dura ~1 h) nunca é gravado. Desconectar marca `revoked_at`: a role do Core não tem DELETE.
-- 2) google_calendar_flows: o `state` de cada pedido de conexão, em hash, válido por 10 minutos e usado uma vez (como marketing_oauth_states).
-- 3) service_activities.google_event_id / google_owner_subject: qual evento do Google Agenda, e de quem, corresponde à atividade.
--    É o que permite acompanhar mudança de horário e cancelamento.

CREATE TABLE IF NOT EXISTS google_calendar_connections (
 operator_subject text PRIMARY KEY,
 email text,
 token_ciphertext bytea NOT NULL,
 token_iv bytea NOT NULL,
 token_tag bytea NOT NULL,
 scopes text[] NOT NULL DEFAULT '{}',
 connected_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 last_error text
);

CREATE TABLE IF NOT EXISTS google_calendar_flows (
 state_hash text PRIMARY KEY,
 operator_subject text NOT NULL,
 redirect_uri text NOT NULL,
 code_verifier text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS google_owner_subject text;
CREATE INDEX IF NOT EXISTS service_activities_google_event ON service_activities (google_event_id) WHERE google_event_id IS NOT NULL;

COMMENT ON TABLE google_calendar_connections IS 'Conta Google conectada por operador. Só o refresh token, cifrado.';
COMMENT ON COLUMN service_activities.google_event_id IS 'Evento do Google Agenda criado para esta atividade (sala do Meet).';
