-- CRUD de portfólio (produtos, plataformas, linhas de serviço) e de contratações.
--
-- EXCLUIR É ARQUIVAR. 18 tabelas apontam para products e 2 para
-- client_engagements, todas sem cascata, e a role de produção não tem DELETE.
-- Arquivar tira o item da operação corrente sem apagar o histórico que depende dele.
--
-- REVISÃO. Com duas pessoas editando o mesmo item, a segunda recebe 409 em vez de
-- sobrescrever a primeira em silêncio. Mesmo padrão de delivery_projects.revision.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
ALTER TABLE products
 ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS archived_at timestamptz,
 -- Estado anterior ao arquivamento. Restaurar devolve exatamente a ele: um
 -- rascunho arquivado não volta ativo por acidente, nem o contrário.
 ADD COLUMN IF NOT EXISTS archived_from text;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_archived_from_check;
ALTER TABLE products ADD CONSTRAINT products_archived_from_check
 CHECK (archived_from IS NULL OR archived_from IN ('draft', 'active'));

-- Arquivado tem data e origem; não arquivado não tem nenhuma das duas.
-- Sem isto, um item "archived" sem data ou uma data solta num item ativo
-- deixariam a tela e o restaurar sem saber em que estado confiar.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_archive_consistency_check;
ALTER TABLE products ADD CONSTRAINT products_archive_consistency_check
 CHECK ((lifecycle_status = 'archived') = (archived_at IS NOT NULL AND archived_from IS NOT NULL));

-- ---------------------------------------------------------------------------
-- client_engagements
-- ---------------------------------------------------------------------------
ALTER TABLE client_engagements
 ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
 -- Arquivar é diferente de encerrar. "Concluída" e "descontinuada" são estados
 -- de negócio e seguem visíveis; arquivada sai das listas de trabalho.
 ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Coerência mínima entre os dois eixos: contratação do tipo produto aponta para
-- um produto. As de serviço podem apontar para uma linha do portfólio, mas não
-- precisam. Os dados atuais já cumprem (a única do tipo produto tem product_id).
ALTER TABLE client_engagements DROP CONSTRAINT IF EXISTS client_engagements_product_model_check;
ALTER TABLE client_engagements ADD CONSTRAINT client_engagements_product_model_check
 CHECK (service_model <> 'product' OR product_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Trilha de alterações
-- ---------------------------------------------------------------------------
-- products não tem tenant e não cabe em audit_events (tenant_id NOT NULL). Uma
-- trilha só para os dois lados, com antes e depois: reclassificar ou arquivar um
-- item do portfólio muda o que aparece em contrato, checkout e campanha, e
-- mudança assim tem autor.
CREATE TABLE IF NOT EXISTS portfolio_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity text NOT NULL CHECK (entity IN ('product', 'engagement')),
 entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 64),
 action text NOT NULL CHECK (action IN ('created', 'updated', 'archived', 'restored', 'activated', 'deactivated')),
 before jsonb,
 after jsonb,
 actor_subject text,
 actor_email text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portfolio_audit_entity_idx
 ON portfolio_audit(entity, entity_id, created_at DESC);
