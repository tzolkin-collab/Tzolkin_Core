-- Draft configuration only: no provider calls or email sends are enabled here.
CREATE TABLE billing_offers (
 product_id text NOT NULL REFERENCES products(id),
 slug text NOT NULL CHECK(slug ~ '^[a-z][a-z0-9-]{1,63}$'),
 payload jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version > 0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(product_id,slug)
);
CREATE TABLE contract_billing (
 tenant_id uuid NOT NULL,
 product_id text NOT NULL,
 offer_slug text NOT NULL,
 offer_version integer NOT NULL,
 snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,product_id),
 FOREIGN KEY(tenant_id,product_id) REFERENCES entitlements(tenant_id,product_id),
 FOREIGN KEY(product_id,offer_slug) REFERENCES billing_offers(product_id,slug)
);
CREATE TABLE billing_offer_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id text NOT NULL,
 offer_slug text NOT NULL,
 version integer NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,offer_slug,version),
 FOREIGN KEY(product_id,offer_slug) REFERENCES billing_offers(product_id,slug)
);
