-- Conteúdo editável dos e-mails por produto. O vínculo com a oferta continua
-- em billing_offers.email_templates; esta tabela guarda o conteúdo versionado.
CREATE TABLE email_templates (
 product_id text NOT NULL REFERENCES products(id),
 slug text NOT NULL CHECK(slug ~ '^[a-z][a-z0-9-]{1,63}$'),
 payload jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_id,slug)
);
