-- Coleta de campanhas de marketing.
--
-- Três decisões que moldam este schema:
--
-- 1. A CREDENCIAL FICA CIFRADA. `marketing_credentials` guarda texto cifrado
--    (AES-256-GCM) e nunca o token. A chave vive em META_MARKETING_KEY, fora
--    do banco — backup vazado não vira acesso ao Gerenciador de Anúncios.
--
-- 2. CAMPANHA PERTENCE A PRODUTO **OU** A CONTRATAÇÃO, NUNCA AOS DOIS.
--    É o mesmo par que já existe em product_deploy_bindings (produto) e
--    service_deploy_bindings (contratação). Um anúncio de "Assinatura Marca
--    Própria" é da contratação; um anúncio do Skiller é do produto. Misturar
--    faria o custo aparecer duas vezes no total.
--
-- 3. NADA AQUI EXIGE DELETE. A role de produção tem DELETE revogado
--    (scripts/configure-runtime-role.mjs). Desvincular é UPDATE active=false,
--    recoletar é UPSERT. Um schema que precisasse apagar quebraria em produção
--    exatamente como o login do Google quebrou.
--
-- Valores monetários em centavos inteiros (bigint). Nunca ponto flutuante.

-- ---------------------------------------------------------------------------
-- Credencial do provedor
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL CHECK (provider IN ('meta')),
 label text NOT NULL CHECK (length(label) BETWEEN 2 AND 120),
 -- Texto cifrado + vetor + selo de autenticidade do GCM.
 token_ciphertext bytea NOT NULL,
 token_iv bytea NOT NULL,
 token_tag bytea NOT NULL,
 -- Identifica o token sem revelá-lo: responde "é o mesmo de antes?".
 token_fingerprint text NOT NULL CHECK (length(token_fingerprint) = 16),
 token_type text NOT NULL DEFAULT 'long_lived_user'
  CHECK (token_type IN ('long_lived_user','system_user','page')),
 scopes text[] NOT NULL DEFAULT '{}',
 -- NULL = não expira (Usuário do Sistema). É estado legítimo, não desconhecido.
 expires_at timestamptz,
 app_id text,
 active boolean NOT NULL DEFAULT true,
 -- Última vez que o Core CONFERIU o token contra a Meta, não que o usou.
 last_verified_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
-- Uma credencial ativa por provedor: duas ativas significaria coleta ambígua.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_credentials_active_idx
 ON marketing_credentials(provider) WHERE active;

-- ---------------------------------------------------------------------------
-- Contas de anúncio descobertas sob a credencial
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_accounts (
 provider text NOT NULL CHECK (provider IN ('meta')),
 external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
 name text,
 currency text CHECK (currency IS NULL OR length(currency) BETWEEN 2 AND 8),
 account_status integer,
 active boolean NOT NULL DEFAULT true,
 business_name text,
 timezone text,
 discovered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider, external_id)
);

-- ---------------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_campaigns (
 provider text NOT NULL CHECK (provider IN ('meta')),
 external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
 account_external_id text NOT NULL,
 name text,
 objective text,
 status text,
 effective_status text,
 daily_budget_cents bigint,
 lifetime_budget_cents bigint,
 budget_remaining_cents bigint,
 start_time timestamptz,
 stop_time timestamptz,
 created_time timestamptz,
 updated_time timestamptz,
 -- Quando o Core viu esta linha pela última vez. Campanha que sumiu da Meta
 -- para de ser recoletada e o campo denuncia isso sem apagar histórico.
 collected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider, external_id),
 FOREIGN KEY (provider, account_external_id) REFERENCES marketing_accounts(provider, external_id)
);
CREATE INDEX IF NOT EXISTS marketing_campaigns_account_idx
 ON marketing_campaigns(provider, account_external_id);

-- ---------------------------------------------------------------------------
-- Métrica diária por campanha
-- ---------------------------------------------------------------------------
-- Uma linha por campanha por dia. Guardar o dia (e não só o total do período)
-- é o que permite responder "quanto custou em setembro?" sem pedir de novo à
-- Meta, e o que torna a recoleta idempotente.
CREATE TABLE IF NOT EXISTS marketing_campaign_insights (
 provider text NOT NULL CHECK (provider IN ('meta')),
 campaign_external_id text NOT NULL,
 date_start date NOT NULL,
 date_stop date,
 spend_cents bigint,
 currency text,
 impressions bigint,
 clicks bigint,
 reach bigint,
 leads bigint,
 purchases bigint,
 messaging bigint,
 actions_total bigint,
 collected_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider, campaign_external_id, date_start),
 FOREIGN KEY (provider, campaign_external_id) REFERENCES marketing_campaigns(provider, external_id)
);
CREATE INDEX IF NOT EXISTS marketing_insights_periodo_idx
 ON marketing_campaign_insights(date_start DESC);

-- ---------------------------------------------------------------------------
-- Vínculo: produto XOR contratação
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_campaign_bindings (
 provider text NOT NULL CHECK (provider IN ('meta')),
 external_campaign_id text NOT NULL,
 product_id text REFERENCES products(id),
 engagement_id uuid REFERENCES client_engagements(id),
 active boolean NOT NULL DEFAULT true,
 -- 'manual' = alguém decidiu. 'suggested' = heurística de nome, ainda não
 -- confirmada. A diferença impede que um palpite vire fato no relatório.
 origin text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','suggested')),
 note text,
 actor_subject text,
 actor_email text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider, external_campaign_id),
 FOREIGN KEY (provider, external_campaign_id) REFERENCES marketing_campaigns(provider, external_id),
 -- O coração da regra: vínculo ativo aponta para exatamente um lado.
 -- Inativo pode ter os dois nulos — é assim que se desvincula sem DELETE.
 CONSTRAINT marketing_binding_um_lado_so
  CHECK (NOT active OR num_nonnulls(product_id, engagement_id) = 1)
);
CREATE INDEX IF NOT EXISTS marketing_bindings_product_idx
 ON marketing_campaign_bindings(product_id) WHERE active AND product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS marketing_bindings_engagement_idx
 ON marketing_campaign_bindings(engagement_id) WHERE active AND engagement_id IS NOT NULL;

-- Trilha do vínculo: quem apontou esta campanha para este produto, e quando.
-- Atribuir custo é decisão comercial; decisão comercial tem autor.
CREATE TABLE IF NOT EXISTS marketing_binding_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL,
 external_campaign_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('bound','rebound','unbound')),
 product_id text,
 engagement_id uuid,
 previous jsonb NOT NULL DEFAULT '{}',
 actor_subject text,
 actor_email text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_binding_audit_campanha_idx
 ON marketing_binding_audit(provider, external_campaign_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Histórico de coleta
-- ---------------------------------------------------------------------------
-- Sem isto, "a campanha não aparece" é indistinguível de "a coleta nunca rodou".
CREATE TABLE IF NOT EXISTS marketing_sync_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL,
 status text NOT NULL CHECK (status IN ('ok','partial','failed')),
 accounts_seen integer NOT NULL DEFAULT 0,
 campaigns_seen integer NOT NULL DEFAULT 0,
 insights_written integer NOT NULL DEFAULT 0,
 window_since date,
 window_until date,
 truncated boolean NOT NULL DEFAULT false,
 error text,
 actor_subject text,
 actor_email text,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS marketing_sync_runs_recentes_idx
 ON marketing_sync_runs(provider, started_at DESC);
