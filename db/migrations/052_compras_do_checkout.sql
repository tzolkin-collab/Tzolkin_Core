-- Compras feitas pelo checkout do Core: liga cada cobrança a um cliente e a uma oferta. Base do e-mail de cobrança.
--
-- SÓ ADICIONA. Sem esta migração o webhook segue só registrando o estado da cobrança, como antes, e nenhum e-mail de cobrança é
-- enfileirado (o erro de tabela ausente é engolido pelo gancho de e-mail e nunca derruba o registro do webhook).
--
-- POR QUE EXISTE. O webhook só guardava `payment_charges` (estado e valor): nada dizia QUEM comprou nem QUAL oferta. O checkout do Core
-- agora grava no Stripe o produto e a oferta (metadata da sessão), e o evento `checkout.session.completed` — o único que traz o e-mail
-- do comprador junto com a oferta — vira UMA linha aqui. Os eventos seguintes (renovação, falha, estorno, cancelamento) chegam só com
-- ids do Stripe (assinatura, intenção de pagamento): é por esses ids que se acha a compra, o comprador e a oferta.
--
-- DADO PESSOAL. `customer_email` e `customer_name` são do comprador. Servem só para falar com ele sobre a própria compra.
-- Compra feita fora do checkout do Core (sem metadata) não entra aqui: não há como saber a oferta, então nenhum e-mail sai.

CREATE TABLE IF NOT EXISTS billing_purchases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL CHECK (provider IN ('stripe')),
 session_id text NOT NULL CHECK (length(session_id) BETWEEN 5 AND 255),
 payment_intent_id text,
 subscription_id text,
 customer_id text,
 product_id text NOT NULL,
 offer_slug text NOT NULL,
 customer_email text NOT NULL CHECK (customer_email = lower(customer_email) AND length(customer_email) BETWEEN 5 AND 254),
 customer_name text,
 amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
 currency text CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (provider, session_id),
 FOREIGN KEY (product_id, offer_slug) REFERENCES billing_offers (product_id, slug)
);
CREATE INDEX IF NOT EXISTS billing_purchases_subscription ON billing_purchases (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS billing_purchases_payment_intent ON billing_purchases (payment_intent_id) WHERE payment_intent_id IS NOT NULL;

COMMENT ON TABLE billing_purchases IS 'Compra feita pelo checkout do Core: liga ids do Stripe a comprador e oferta. Dado pessoal.';
