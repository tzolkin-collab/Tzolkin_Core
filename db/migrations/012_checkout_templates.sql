-- Templates de checkout: aparência e modo (HOSTED/EMBEDDED/ELEMENTS) por produto.
-- Espelha billing_offers de propósito -- mesma forma, mesma disciplina de versão.
-- "Padrão" (is_default) vive dentro do payload e é mantido único por produto
-- na própria transação de escrita (ver checkout-templates.mjs), não por
-- constraint aqui: um único template por produto não precisa da rigidez de
-- contract_billing, que trava condição comercial já assinada.
CREATE TABLE checkout_templates (
 product_id text NOT NULL REFERENCES products(id),
 slug text NOT NULL CHECK(slug ~ '^[a-z][a-z0-9-]{1,63}$'),
 payload jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_id,slug)
);
