-- 038 — Atribuição estendida do lead: anúncio, sessão e localização.
--
-- O Core sincroniza da Meta só números por campanha e por dia (marketing_campaign_insights:
-- gasto, impressões, cliques, leads). A Meta não tem dado por pessoa para lead de site.
-- O que une um lead a uma campanha precisa ficar na tabela do lead. Até aqui
-- commercial_attributions guardava só utm_campaign em TEXTO LIVRE, enquanto a campanha da
-- Meta é identificada por ID (marketing_campaigns.external_id): o casamento dependia de o
-- nome digitado no anúncio ser igual ao nome da campanha, e ele muda.
--
-- O QUE ENTRA
--   * IDs do anúncio (meta_campaign_id, meta_adset_id, meta_ad_id): a chave do casamento
--     com marketing_campaigns. Vêm dos parâmetros dinâmicos da URL do anúncio.
--   * utm_term e utm_tzolkin (UTM próprio, "<produto>.<nicho>", ex.: sites.corretor).
--   * fbclid, gclid (vêm da URL) e fbc, fbp (vêm de cookies do pixel: só com consentimento).
--   * session_key: a sessão do emissor, para ligar o lead ao que ele fez antes de enviar.
--   * first_touch_at e last_touch: o primeiro toque fica nas colunas de sempre; o último
--     (o mais próximo da conversão) vai em last_touch.
--   * session (resumo: páginas, duração, consentimento, eventos de anúncio) e geo
--     (cidade/região/país e coordenada COM a precisão que ela tem).
--
-- O QUE NÃO ENTRA: telemetria bruta. O emissor guarda a trilha completa; o Core recebe o
-- resumo que serve a atribuição.
--
-- EXPANSÃO, NÃO CONTRAÇÃO. Só ADD COLUMN IF NOT EXISTS e índices. Linhas antigas ficam com
-- NULL. O código antigo ignora as colunas, então esta migração pode rodar ANTES do deploy.
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

ALTER TABLE commercial_attributions
 ADD COLUMN IF NOT EXISTS utm_term text,
 ADD COLUMN IF NOT EXISTS utm_tzolkin text,
 ADD COLUMN IF NOT EXISTS meta_campaign_id text,
 ADD COLUMN IF NOT EXISTS meta_adset_id text,
 ADD COLUMN IF NOT EXISTS meta_ad_id text,
 ADD COLUMN IF NOT EXISTS fbclid text,
 ADD COLUMN IF NOT EXISTS gclid text,
 ADD COLUMN IF NOT EXISTS fbc text,
 ADD COLUMN IF NOT EXISTS fbp text,
 ADD COLUMN IF NOT EXISTS session_key text,
 ADD COLUMN IF NOT EXISTS first_touch_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_touch jsonb,
 ADD COLUMN IF NOT EXISTS session jsonb,
 ADD COLUMN IF NOT EXISTS geo jsonb;

-- Formato e tamanho: o mesmo que o intake valida, para uma gravação por outro caminho
-- não furar a regra. Cada CHECK aceita NULL (coluna opcional).
ALTER TABLE commercial_attributions DROP CONSTRAINT IF EXISTS commercial_attributions_meta_ids_fmt;
ALTER TABLE commercial_attributions ADD CONSTRAINT commercial_attributions_meta_ids_fmt CHECK (
 (meta_campaign_id IS NULL OR meta_campaign_id ~ '^[0-9]{5,25}$')
 AND (meta_adset_id IS NULL OR meta_adset_id ~ '^[0-9]{5,25}$')
 AND (meta_ad_id IS NULL OR meta_ad_id ~ '^[0-9]{5,25}$'));

ALTER TABLE commercial_attributions DROP CONSTRAINT IF EXISTS commercial_attributions_ids_fmt;
ALTER TABLE commercial_attributions ADD CONSTRAINT commercial_attributions_ids_fmt CHECK (
 (utm_tzolkin IS NULL OR utm_tzolkin ~ '^[a-z0-9][a-z0-9._-]{0,79}$')
 AND (session_key IS NULL OR session_key ~ '^[A-Za-z0-9_-]{8,64}$')
 AND (fbp IS NULL OR fbp ~ '^fb\.[0-9]\.[0-9]{10,13}\.[0-9]{5,20}$')
 AND (fbc IS NULL OR fbc ~ '^fb\.[0-9]\.[0-9]{10,13}\.[A-Za-z0-9_-]{10,500}$'));

ALTER TABLE commercial_attributions DROP CONSTRAINT IF EXISTS commercial_attributions_json_size;
ALTER TABLE commercial_attributions ADD CONSTRAINT commercial_attributions_json_size CHECK (
 (last_touch IS NULL OR length(last_touch::text) <= 3000)
 AND (session IS NULL OR length(session::text) <= 6000)
 AND (geo IS NULL OR length(geo::text) <= 1000));

-- O casamento com a campanha da Meta e a leitura por sessão e por UTM próprio.
CREATE INDEX IF NOT EXISTS commercial_attributions_meta_campaign_idx
 ON commercial_attributions (meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_attributions_session_idx
 ON commercial_attributions (session_key) WHERE session_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_attributions_utm_tzolkin_idx
 ON commercial_attributions (utm_tzolkin) WHERE utm_tzolkin IS NOT NULL;

COMMENT ON COLUMN commercial_attributions.meta_campaign_id IS
 'ID da campanha na Meta (parâmetro dinâmico {{campaign.id}}). Casa com marketing_campaigns.external_id.';
COMMENT ON COLUMN commercial_attributions.utm_tzolkin IS
 'UTM próprio da Tzolkin: "<produto>.<nicho>", ex.: sites.corretor.';
COMMENT ON COLUMN commercial_attributions.geo IS
 'Localização com a precisão declarada (ip, cnpj ou declared). Coordenada por IP tem ~1 km de resolução.';
COMMENT ON COLUMN commercial_attributions.fbp IS
 'Cookie _fbp do pixel. Só é aceito com consentimento registrado em session.consent.';
