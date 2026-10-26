-- Conectar uma instância do WhatsApp a um funil, e o gatilho de um fluxo dentro do próprio fluxo.
-- Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md, seção 10 (decisões tiradas dos concorrentes: Kommo cria o lead da conversa nova na etapa de
-- entrada do funil e liga as automações à etapa; Respond.io deixa o gatilho dentro do workflow).
--
-- SÓ ADICIONA. Sem esta migração nada muda: a tela avisa e a captura de conversas não roda. Nada é apagado.
--
-- 1) whatsapp_instance_funnels: a instância X entrega as conversas novas ao funil Y. `create_leads` liga e desliga (a role do Core não tem
--    DELETE: desligar é `create_leads = false`). `last_scan_at` marca até onde a captura já olhou: só conversa NOVA depois de conectar vira
--    lead (o histórico antigo não é importado).
-- 2) whatsapp_flows.automation_id: o fluxo guarda qual automação o inicia. O gatilho ("quando o lead for criado no funil Y") é escolhido
--    no próprio fluxo e a automação por trás é criada e mantida pelo Core; a pessoa não precisa ir a outra tela.

CREATE TABLE IF NOT EXISTS whatsapp_instance_funnels (
 instance text PRIMARY KEY CHECK (instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 space_id text NOT NULL REFERENCES products(id),
 pipeline_id uuid NOT NULL REFERENCES pipelines(id),
 create_leads boolean NOT NULL DEFAULT true,
 last_scan_at timestamptz NOT NULL DEFAULT now(),
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_instance_funnels_ativas ON whatsapp_instance_funnels (instance) WHERE create_leads;

ALTER TABLE whatsapp_flows ADD COLUMN IF NOT EXISTS automation_id uuid REFERENCES automations(id);
