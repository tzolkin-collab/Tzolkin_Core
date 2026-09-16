-- Cobrança de linha de serviço — ADR 0008, opção B. Fase 1: domínio e registro manual.
--
-- A COBRANÇA NASCE DO CONTRATO ACEITO. Um plano de recebimento só existe a partir
-- de uma versão ativa de commercial_contracts, e guarda a fotografia dela: se o
-- contrato mudar depois, o plano continua dizendo o que foi acordado.
--
-- PAGO NÃO É DISPONÍVEL. `paid` é o que o processador ou o operador confirma;
-- `available` só vem da conciliação com o extrato bancário (fase 3). Nenhuma rota
-- desta fase grava `available`.
--
-- NADA SAI DAQUI PARA UM PROVEDOR nesta fase: a cobrança externa (Cobre PJ ou
-- outra) é registrada à mão. As colunas de provedor já aceitam asaas e stripe
-- para a fase 2 não precisar de migração de CHECK.
--
-- Excluir não existe: cancelar guarda data e motivo, e a trilha fica em
-- service_receivable_audit.

CREATE TABLE IF NOT EXISTS service_receivable_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contract_id uuid NOT NULL REFERENCES commercial_contracts(id),
 -- A versão do contrato que o operador viu ao montar o plano.
 contract_version integer NOT NULL CHECK (contract_version >= 1),
 contract_snapshot jsonb NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id text NOT NULL REFERENCES products(id),
 total_minor bigint NOT NULL CHECK (total_minor > 0),
 currency text NOT NULL CHECK (currency IN ('BRL', 'USD', 'EUR', 'GBP')),
 provider text NOT NULL CHECK (provider IN ('manual', 'asaas', 'stripe')),
 method text NOT NULL CHECK (method IN ('pix', 'boleto', 'card', 'pix_automatic', 'external')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'canceled')),
 created_by text NOT NULL,
 approved_by text,
 approved_at timestamptz,
 canceled_at timestamptz,
 cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 2 AND 1000),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 -- Pix Automático é recorrência negociada com o banco: não existe como registro manual.
 CHECK (provider <> 'manual' OR method <> 'pix_automatic'),
 CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
 CHECK (status <> 'canceled' OR canceled_at IS NOT NULL)
);
-- Um plano vivo por contrato. Refazer o plano é cancelar o anterior e criar outro.
CREATE UNIQUE INDEX IF NOT EXISTS service_receivable_plans_live
 ON service_receivable_plans(contract_id) WHERE status <> 'canceled';
CREATE INDEX IF NOT EXISTS service_receivable_plans_product
 ON service_receivable_plans(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES service_receivable_plans(id),
 sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 120),
 amount_minor bigint NOT NULL CHECK (amount_minor > 0),
 currency text NOT NULL CHECK (currency IN ('BRL', 'USD', 'EUR', 'GBP')),
 due_on date NOT NULL,
 -- planned: plano em rascunho · scheduled: aprovado, a cobrar · issued: cobrança
 -- registrada · paid: pagamento confirmado · available: crédito no extrato (fase 3)
 status text NOT NULL DEFAULT 'planned'
  CHECK (status IN ('planned', 'scheduled', 'issued', 'paid', 'available', 'canceled')),
 external_ref text CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 2 AND 200),
 external_url text CHECK (external_url IS NULL OR (external_url ~ '^https://' AND length(external_url) <= 1000)),
 issued_at timestamptz,
 paid_on date,
 paid_source text CHECK (paid_source IS NULL OR paid_source IN ('manual', 'webhook')),
 payment_reference text CHECK (payment_reference IS NULL OR length(payment_reference) BETWEEN 2 AND 200),
 -- NFS-e emitida pela Contabilizei (ADR 0008): o Core registra, não emite.
 invoice_number text CHECK (invoice_number IS NULL OR length(invoice_number) BETWEEN 1 AND 60),
 invoice_issued_on date,
 invoice_recorded_at timestamptz,
 canceled_at timestamptz,
 cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 2 AND 1000),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (plan_id, sequence),
 CHECK (status <> 'issued' OR issued_at IS NOT NULL),
 CHECK (status NOT IN ('paid', 'available') OR (paid_on IS NOT NULL AND paid_source IS NOT NULL)),
 CHECK (status <> 'canceled' OR canceled_at IS NOT NULL),
 CHECK ((invoice_number IS NULL) = (invoice_issued_on IS NULL)),
 CHECK ((invoice_number IS NULL) = (invoice_recorded_at IS NULL))
);
-- A mesma cobrança externa não pode quitar duas parcelas.
CREATE UNIQUE INDEX IF NOT EXISTS service_installments_external_ref
 ON service_installments(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_installments_due
 ON service_installments(status, due_on);

CREATE TABLE IF NOT EXISTS service_receivable_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES service_receivable_plans(id),
 installment_id uuid REFERENCES service_installments(id),
 action text NOT NULL CHECK (action IN (
  'plan_created', 'plan_approved', 'plan_canceled',
  'installment_issued', 'installment_rescheduled', 'installment_paid',
  'installment_canceled', 'invoice_recorded')),
 before jsonb,
 after jsonb,
 actor_subject text NOT NULL,
 actor_email text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_receivable_audit_plan
 ON service_receivable_audit(plan_id, created_at DESC);
