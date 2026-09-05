-- 023 — Montador de checkout: histórico, cupom, order bump e pedido.
--
-- Aditiva de propósito. NÃO toca em checkout_templates.type: virar os templates
-- para ELEMENTS antes de o caminho Elements existir faria checkout-gateway.mjs
-- recusar todos e derrubaria todo link de pagamento em circulação. Essa virada
-- é a migração 025, no mesmo deploy do código que a sustenta.
--
-- Critério de onde cada coisa mora: tema e copy ficam no payload do template
-- (lidos sempre juntos, nunca filtrados, nunca joinados); cupom, bump, pedido e
-- revisão viram tabela — cardinalidade N, integridade referencial, contador
-- quente e trilha que precisa sobreviver ao DELETE da linha que a originou.

-- ── Histórico e auditoria numa tabela só ──────────────────────────────────
-- billing_offer_history versiona; product_resource_audit responde "quem mudou".
-- Aqui as duas perguntas se encontram: o DELETE não tem versão em que pendurar,
-- e separar em duas tabelas obrigaria a consultar as duas para saber quem apagou.
CREATE TABLE IF NOT EXISTS checkout_template_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id text NOT NULL,
 template_slug text NOT NULL,
 version integer NOT NULL CHECK(version > 0),
 action text NOT NULL CHECK(action IN ('created','updated','deleted')),
 actor text NOT NULL,
 -- NULL no delete: não há estado posterior. before_value carrega o que sumiu.
 payload jsonb,
 before_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,template_slug,version,action)
);
CREATE INDEX IF NOT EXISTS checkout_template_revisions_recent
 ON checkout_template_revisions(product_id,template_slug,created_at DESC);

-- ── Cupom ─────────────────────────────────────────────────────────────────
-- Fora do payload por três motivos, em ordem de peso:
--   1. redeemed_count é contador incrementado sob FOR UPDATE a cada pedido.
--      Dentro do payload, cada resgate colidiria com a trava otimista do editor
--      (checkout-templates.mjs) e o operador não conseguiria salvar durante um
--      lançamento — exatamente quando mais precisa.
--   2. o teto de 16 KB por requisição: 50 cupons seriam reenviados a cada
--      gravação do template.
--   3. cupom é objeto comercial compartilhado entre templates, não aparência.
CREATE TABLE IF NOT EXISTS checkout_coupons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id text NOT NULL REFERENCES products(id),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 kind text NOT NULL CHECK(kind IN ('percent','fixed')),
 percent_off integer CHECK(percent_off IS NULL OR percent_off BETWEEN 1 AND 100),
 amount_off_minor bigint CHECK(amount_off_minor IS NULL OR amount_off_minor > 0),
 currency text CHECK(currency IS NULL OR currency ~ '^[a-z]{3}$'),
 -- Um e só um dos dois lados preenchido, com moeda obrigatória no fixo:
 -- desconto fixo sem moeda é ambíguo em base multimoeda.
 CHECK((kind='percent' AND percent_off IS NOT NULL AND amount_off_minor IS NULL AND currency IS NULL)
    OR (kind='fixed'  AND amount_off_minor IS NOT NULL AND currency IS NOT NULL AND percent_off IS NULL)),
 max_redemptions integer CHECK(max_redemptions IS NULL OR max_redemptions > 0),
 redeemed_count integer NOT NULL DEFAULT 0 CHECK(redeemed_count >= 0),
 starts_at timestamptz,
 expires_at timestamptz,
 CHECK(starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,code)
);

-- ── Order bump ────────────────────────────────────────────────────────────
-- O bump NÃO carrega preço. Ele aponta para uma billing_offers existente.
-- checkout-gateway.mjs já estabelece a invariante: preço, moeda e nome vêm da
-- oferta, e o corpo da requisição não carrega preço nenhum. Um amount_minor
-- aqui criaria uma segunda fonte de preço, sem versão e sem histórico. Só a
-- copy (headline/description) é aparência, e por isso é o que mora aqui.
CREATE TABLE IF NOT EXISTS checkout_order_bumps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id text NOT NULL,
 template_slug text NOT NULL,
 bump_offer_slug text NOT NULL,
 headline text NOT NULL CHECK(length(headline) BETWEEN 1 AND 120),
 description text CHECK(description IS NULL OR length(description) BETWEEN 1 AND 400),
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 100),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(product_id,template_slug,bump_offer_slug),
 FOREIGN KEY(product_id,template_slug) REFERENCES checkout_templates(product_id,slug) ON DELETE CASCADE,
 FOREIGN KEY(product_id,bump_offer_slug) REFERENCES billing_offers(product_id,slug)
);

-- ── Pedido ────────────────────────────────────────────────────────────────
-- O elo que falta hoje entre uma cobrança e o produto que a originou. O painel
-- admite a lacuna em product-payments.js: "o Core não atribui uma transação a
-- este produto sem metadata explícita". Esta tabela é o outro lado dessa
-- metadata — payment_charges continua sendo do webhook (só REGISTRA, ver 011);
-- checkout_orders é do gateway. O join é (provider, provider_ref) =
-- (payment_charges.provider, payment_charges.charge_ref).
--
-- NÃO EXISTE COLUNA DE CARTÃO AQUI, E ISSO É DELIBERADO. Nem PAN, nem last4,
-- nem bandeira: `method` basta para operar e conciliar. Guardar qualquer
-- fragmento de cartão ampliaria o escopo PCI sem melhorar nenhuma tela.
-- Ver docs/decisions/0006.
--
-- state/state_rank repetem a régua de payment_charges de propósito: o mesmo
-- código de webhook aplica a mesma regra de "só avança" nas duas tabelas.
-- Estorno, contestação e cancelamento são fatos que convivem com o progresso,
-- não posições da régua.
CREATE TABLE IF NOT EXISTS checkout_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id text NOT NULL,
 offer_slug text NOT NULL,
 template_slug text NOT NULL,
 template_version integer NOT NULL CHECK(template_version > 0),
 provider text NOT NULL CHECK(provider IN ('stripe','asaas')),
 -- Nulo entre a criação do pedido e a resposta do provedor. UNIQUE tolera
 -- vários nulos, que é o que essa janela exige.
 provider_ref text CHECK(provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 200),
 -- Parcelamento no Asaas emite N cobranças com ids distintos; este é o id do
 -- carnê que as agrupa. Na Stripe permanece nulo: lá é uma cobrança só.
 installment_ref text CHECK(installment_ref IS NULL OR length(installment_ref) BETWEEN 1 AND 200),
 method text CHECK(method IS NULL OR method IN ('card','pix','boleto','wallet')),
 installments integer NOT NULL DEFAULT 1 CHECK(installments BETWEEN 1 AND 21),
 currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 base_amount_minor bigint NOT NULL CHECK(base_amount_minor >= 0),
 bump_amount_minor bigint NOT NULL DEFAULT 0 CHECK(bump_amount_minor >= 0),
 discount_minor bigint NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
 total_amount_minor bigint NOT NULL CHECK(total_amount_minor >= 0),
 -- A aritmética do total é conferida aqui também. O servidor já calcula, mas
 -- soma que não fecha é o erro que ninguém percebe até a conciliação.
 CHECK(total_amount_minor = base_amount_minor + bump_amount_minor - discount_minor),
 coupon_code text CHECK(coupon_code IS NULL OR coupon_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
 bump_slugs text[] NOT NULL DEFAULT '{}',
 customer_email text CHECK(customer_email IS NULL OR length(customer_email) BETWEEN 3 AND 320),
 customer_name text CHECK(customer_name IS NULL OR length(customer_name) BETWEEN 1 AND 240),
 -- Hash, nunca o CPF em claro. O tratamento final é pendência da ADR-0006;
 -- até lá a coluna aceita nulo e o caminho que a preenche não existe.
 customer_tax_id_hash text CHECK(customer_tax_id_hash IS NULL OR length(customer_tax_id_hash)=64),
 provider_customer_ref text CHECK(provider_customer_ref IS NULL OR length(provider_customer_ref) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'created' CHECK(state IN ('created','open','confirmed','received')),
 state_rank integer NOT NULL DEFAULT 10 CHECK(state_rank BETWEEN 0 AND 1000),
 overdue_at timestamptz,
 refunded_at timestamptz,
 disputed_at timestamptz,
 canceled_at timestamptz,
 -- Congela oferta, bumps e cupom no instante da intenção, pelo mesmo motivo de
 -- contract_billing.snapshot: preço que mudou depois não reescreve o passado.
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_ref),
 FOREIGN KEY(product_id,offer_slug) REFERENCES billing_offers(product_id,slug),
 -- Sem ON DELETE: um template com pedido não pode ser excluído, e é a própria
 -- FK que garante isso — a rota de DELETE só precisa dar a mensagem boa.
 FOREIGN KEY(product_id,template_slug) REFERENCES checkout_templates(product_id,slug)
);
CREATE INDEX IF NOT EXISTS checkout_orders_product_idx ON checkout_orders(product_id,created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_orders_installment_idx ON checkout_orders(provider,installment_ref);

-- Torna max_redemptions verificável sem confiar no contador, e permite liberar
-- o resgate de um pedido cancelado sem recontar o mundo.
CREATE TABLE IF NOT EXISTS checkout_coupon_redemptions (
 coupon_id uuid NOT NULL REFERENCES checkout_coupons(id) ON DELETE CASCADE,
 order_id uuid NOT NULL REFERENCES checkout_orders(id) ON DELETE CASCADE,
 redeemed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(coupon_id,order_id)
);

-- ── Conversão dos templates existentes ────────────────────────────────────
-- Adiciona `theme` e `copy` e PRESERVA `branding` por uma release: se o código
-- for revertido, o dado antigo continua lá e nenhuma página quebra.
--
-- `copy` nasce vazio de propósito. Os padrões vivem em platform/checkout-model.mjs
-- e são exatamente os literais que checkout.js usa hoje, então nenhuma página
-- muda de texto. Copiá-los para cá criaria uma segunda fonte que envelheceria em
-- silêncio — e "vazio significa usa o padrão" é o que o editor precisa para
-- mostrar o padrão como placeholder.
--
-- font_family vira 'system' em todos os casos porque ainda não hospedamos fonte
-- nenhuma. Manter o texto livre que está lá seria carregar uma promessa que o
-- navegador não cumpre — era justamente por isso que o campo nunca teve efeito.
UPDATE checkout_templates SET payload = payload || jsonb_build_object(
 'theme', jsonb_build_object(
  'color', COALESCE(payload->'branding'->>'primary_color','#111827'),
  'radius', COALESCE(NULLIF(payload->'branding'->>'border_radius','')::integer,12),
  'logo_url', COALESCE(payload->'branding'->>'logo_url',''),
  'font_family', 'system'
 ),
 'copy', '{}'::jsonb
) WHERE NOT payload ? 'theme';
