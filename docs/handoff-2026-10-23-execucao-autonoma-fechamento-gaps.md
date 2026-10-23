# Handoff: Execução Autônoma de Gaps Técnicos e Fechamento de Especificações

**Data:** 23 de Outubro de 2026  
**Contexto:** Resolução sistemática de pendências técnicas autônomas em `tzolkin-core` e `tzolkin-site` registradas em `LISTA-COMPLETA.md`, `CORE-EXECUTION-TODO.md` e na Auditoria de Arquitetura (Gaps G2, G3, G5), sem introduzir dependências externas e sem quebra de compatibilidade regressiva.

---

## 1. O que foi construído e validado

### 1.1 Contratos comerciais diretos sem `lead_id`
- **Arquivo:** `apps/api/src/modules/commercial-workspace.mjs` e `test/commercial-intake.test.mjs`
- **Commit:** `9501b01`
- **Entrega:** Permitido que `POST /api/commercial/contracts` receba `tenant_id` e `product_id` diretamente, tornando `lead_id` estritamente opcional. Permite formalizar contratos de clientes que não ingressaram por funil de prospecção.

### 1.2 Guarda automatizada do Certificado do Postgres
- **Arquivo:** `test/unit/postgres-cert.test.mjs`
- **Commit:** `bb254a5`
- **Entrega:** Teste unitário de guarda que inspeciona o certificado real `certs/postgres-server.crt`, valida o emissor e a data de expiração (31/08/2027) e emite alerta com antecedência de 90 dias, prevenindo indisponibilidade silenciosa da conexão SSL.

### 1.3 Acessibilidade do menu no celular (`sidebar`)
- **Arquivos:** `apps/web/public/index.html` e `test/unit/web-nav.test.mjs`
- **Commit:** `cec0297`
- **Entrega:** Adicionado `tabindex="-1"` ao elemento `<aside id="sidebar">`, permitindo que o foco programático invocado pela função `openNavigation` em telas móveis funcione de forma nativa e acessível.

### 1.4 Trava de `ASAAS_CARD_ENABLED=false` no código
- **Arquivos:** `apps/api/src/modules/billing.mjs`, `apps/api/src/modules/payment-sales.mjs`, `apps/api/src/modules/product-payments.mjs` e `test/unit/billing.test.mjs`
- **Commit:** `2ca1b02`
- **Entrega:** Rejeição explícita no backend para tentativas de cobrança com cartão via Asaas quando a flag de ambiente estiver desativada, e reflexo consistente da capacidade no manifesto de vendas.

### 1.5 Eliminação do único `DELETE` de runtime (`team_members`)
- **Arquivos:** `db/migrations/067_team_members_soft_delete.sql`, `apps/api/src/modules/accounts.mjs` e `scripts/configure-runtime-role.mjs`
- **Commit:** `eaa97a2`
- **Entrega:** Substituição de `DELETE FROM team_members` por soft-delete com coluna `removed_at`. Isso permitiu remover com segurança o privilégio `DELETE` da role restrita de runtime do banco, eliminando o último risco de deleção física acidental em produção. O código mantém compatibilidade retroativa resiliente caso a migração ainda não tenha sido aplicada.

### 1.6 Teste unitário do filtro por tipo de serviço
- **Arquivo:** `test/unit/services-filter.test.mjs`
- **Commit:** `407195f`
- **Entrega:** Cobertura de teste com dados sintéticos garantindo a filtragem de serviços e mentorias nas abas e opções da tela.

### 1.7 Lint de migrações e rollback de falha injetada (Gap G2)
- **Arquivo:** `test/unit/migrations-lint.test.mjs`
- **Commit:** `770772e`
- **Entrega:** Linter que valida que nenhum script `.sql` contém comandos manuais de transação (`BEGIN`, `COMMIT`, `ROLLBACK`), garantindo que o runner `migrate.mjs` seja o único dono da transação. Inclui teste simulando falha no meio da migração comprovando rollback automático da transação sem gravação órfã em `schema_migrations`.

### 1.8 Bloqueio HTTP de checkout para linhas de serviço / Sites (Gap G5)
- **Arquivo:** `test/checkout-gateway.test.mjs`
- **Commit:** `74ebbac`
- **Entrega:** Teste automatizado HTTP direto via `/api/checkout/sessions` comprovando que produtos com capacidade de linha de serviço (como `sites`) respondem 404 e rejeitam criação de sessão de pagamento transparente.

### 1.9 Deduplicação por hash de CPF e CNPJ alfanumérico no intake comercial (Gap G3)
- **Arquivos:** `apps/api/src/platform/documents.mjs`, `db/migrations/068_stakeholders_tenants_documents.sql`, `apps/api/src/modules/commercial-intake.mjs` e `test/unit/intake-dedupe.test.mjs`
- **Commit:** `a3dc778`
- **Entrega:** Módulo completo de validação de documentos brasileiros:
  - CPF: validação matemática de dígitos verificadores e cômputo de hash SHA-256 (`cpfHash`). O documento em texto claro nunca é armazenado no banco, assegurando conformidade com a LGPD.
  - CNPJ: validação e suporte nativo ao novo padrão alfanumérico da Receita Federal (2026+), além dos formatos clássicos, normalizando para 14 caracteres alfanuméricos (`tax_id`).
  - `resolveParties`: deduplica pessoas por hash de CPF e organizações por CNPJ diretamente ou por nome sob a pessoa, com advisory locks dedicados e ordenados (locks 28, 29 e 30).
  - Migração `068` acrescenta `document_hash` em `stakeholders` e `tax_id` em `tenants`, com fallback retroativo resiliente (código 42703).

### 1.10 Limpeza de código morto no `tzolkin-site`
- **Repositório:** `tzolkin-site`
- **Commit:** `3568f28`
- **Entrega:** Remoção de arquivos legados descontinuados após a centralização dos leads no Core (`db/001_leads.sql`, `db/002_lead_delivery.sql`, `db/003_email_worker.sql`, `scripts/email-worker.mjs`, `scripts/migrate-leads.mjs`, etc.).

### 1.11 Sincronização de Documentação Técnica
- **Arquivos:** `docs/LISTA-COMPLETA.md`, `docs/STATUS.md`, `docs/decisions/0009-tipos-de-espaco-do-portfolio.md`
- **Commit:** `9665677`
- **Entrega:** Atualizado estado dos Gaps de auditoria, marcada a conclusão de campos próprios (`enforceRequired: false` em edições) e atualizada a ADR 0009 com a confirmação de aplicação da migração 036.

---

## 2. Indicadores de Testes e Integridade

- **`tzolkin-core`:** 876 testes unitários executados e aprovados (`npm run test:unit`, 0 falhas, ~3.6s).
- **`tzolkin-site`:** 39 testes executados e aprovados (`npm test`, 0 falhas).
- **Worktree:** Limpa em ambos os repositórios.

---

## 3. Próximos Passos Recomendados

1. **Ações que dependem do dono (`[VOCÊ]`):**
   - **Webhooks Stripe e Asaas:** Cadastrar as URLs finais de destino nos respectivos painéis administrativos (bloqueador para confirmação de recebimentos em produção).
   - **Aplicar Migrações Pendentes no Banco Compartilhado:**
     - `067_team_members_soft_delete.sql` (necessária para revogar com segurança o DELETE da role de runtime).
     - `068_stakeholders_tenants_documents.sql` (adiciona as colunas indexadas de hash de CPF e CNPJ).
2. **Itens autônomos na esteira:**
   - Tela e leitor de trilha de auditoria para projetos de entrega (`delivery_audit`).
   - Sincronização documental dos arquivos conceituais antigos (`docs/PRODUCT.md`, `docs/DATA-OWNERSHIP.md`).
