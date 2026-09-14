# Handoff — portfólio por tipo e cobrança das linhas de serviço

Sessão de **2026-09-14**. Para continuar num chat novo, peça:
*"Leia `docs/handoff-2026-09-14-portfolio-e-cobranca.md` e continue de onde parou."*

- **Repositório:** `D:\Códigos\Tzolkin\Projetos\Outros\Site - Tzolkin\tzolkin-core`
- **Branch:** `codex/revisao-seguranca-core` (a `main` preserva o estado antigo)
- **Encerrado em:** 2026-09-14
- **Commits:** `dde07ef` (classificação e ADR) e `feat: capacidades do portfolio por tipo`
- **Migração:** `032_classificacao_do_portfolio.sql` aplicada e conferida no banco compartilhado
- **Verificação final:** 386 aprovados, 0 falhas e 1 teste isolado ignorado

> Este handoff foi concluído. As seções abaixo preservam o estado recebido e as decisões que
> orientaram a implementação; a cobrança das linhas de serviço continua como próxima frente.

---

## 1. Estado em uma olhada

| Frente | Código | Banco compartilhado | Commit |
|---|---|---|---|
| Remover Barber, Commerce e Data | pronto | **aplicado** (migração `031`) | ✅ `04d08da` |
| Classificação do portfólio (Core `internal`, Mentorias e Consultorias) | pronto | ✅ migração `032` aplicada | ✅ `dde07ef` |
| Opção B da ADR 0007: o tipo governa o que o item pode fazer | pronto e testado | não precisa de migração | ✅ commit de capacidades |
| Pesquisa de cobrança (Contabilizei e alternativas) | — | — | resultado só neste arquivo (§6) |

Conferido no fim da sessão: última migração aplicada é a `031`. Os produtos são
`core:platform`, `educare:platform`, `sites:service_line` e `skiller:product`.

---

## 2. Decisões do dono nesta sessão

1. **Barber, Commerce e Data saem do portfólio.** A remoção é definitiva: apagou a
   contratação planejada do Bzbarber e as fichas do Notion. A empresa Bzbarber
   continua cadastrada.
2. **O Core é `internal`.** Está no portfólio só para guardar a própria
   infraestrutura. Isso responde a pendência D2 do `CONTEXT.md`.
3. **Skiller é `product`**: software que o cliente usa, por assinatura.
4. **Educare é `platform`**: plataforma de assinatura de cursos e conteúdos.
5. **Sites é `service_line`**: trabalho feito por projeto; ninguém faz login por ele.
6. **Mentorias e Consultorias viram linhas de serviço próprias**, cada uma com
   contexto no painel. Os IDs são `mentorias` e `consultorias`.
7. **Mentoria e consultoria não vendem por checkout.** A cobrança é pela conta PJ da
   Contabilizei ou por outra via com API; ver §6.
8. **O tipo governa regra** (opção B da ADR 0007). O painel precisava parar de mostrar
   "Clientes com acesso" e "Cobrança" em linha de serviço.

Teste para separar produto de serviço: **se o cliente cancelar, ele perde acesso a
algo nosso (produto) ou fica com o que entregamos (serviço)?**

---

## 3. O que está no working tree, sem commit

### Migração `db/migrations/032_classificacao_do_portfolio.sql` (nova)

- **Tipo `internal`:** entra no `CHECK` de `portfolio_kind`.
- **`core`:** passa de `platform` para `internal`.
- **Itens novos:** cria `mentorias` e `consultorias` como `service_line` ativos.
- **Contratações:** as sem item, com `service_model` `education` ou `consulting`,
  passam a apontar para a linha do seu tipo. São as duas mentorias (João e Rafael
  Sales).
- **Auditoria:** tudo fica em `portfolio_audit` com `actor_subject = 'migration:032'`.
- **Validação:** ensaiada no banco compartilhado com ROLLBACK e testada num banco
  descartável. Rodar duas vezes não duplica nada.

### Política de capacidades (servidor)

**`apps/api/src/modules/catalog.mjs`** guarda a regra: `CAPABILITIES`,
`capabilitiesOf`, `findProductFor` e `requireProductFor`.

| Capacidade | `product` | `platform` | `service_line` | `internal` |
|---|:-:|:-:|:-:|:-:|
| `access`: contrato de acesso, vínculo de pessoa, chave `context:read`, `/v1/context` | sim | sim | não | não |
| `checkout`: oferta, template, checkout público | sim | sim | não | não |
| `product_engagement`: contratação com `service_model = 'product'` | sim | sim | não | não |
| `commercial`: captação, chaves `commercial:*`, demais contratações | sim | sim | sim | não |
| `operate`: recursos, deploys, e-mails, campanhas | sim | sim | sim | sim |

**Onde a regra é aplicada:**
- **Acesso:** `contracts.mjs` e `directory.mjs`.
- **Chaves:** `commercial-keys.mjs` valida cada escopo pelo mapa `SCOPE_CAPABILITY`
  ao emitir. `access.mjs` confere de novo a cada uso, em `authenticateApp` e em
  `/v1/context`.
- **Checkout e ofertas:** `billing.mjs`, `checkout-templates.mjs` e
  `checkout-gateway.mjs`. Saíram os `if productId === 'sites'`. No checkout público,
  item sem a capacidade recebe o mesmo 404 de oferta inexistente.
- **Portfólio (`portfolio.mjs`):**
  - contratação de produto exige `product_engagement`; as demais exigem `commercial`;
  - `PUT /api/portfolio/:id` recusa mudar o tipo se isso tirar uma capacidade da
    qual algo vivo depende;
  - `internal` entra em `PORTFOLIO_KINDS`.
- **Leitura:** `workspace.mjs` (`/api/overview`) e `product-console.mjs` devolvem as
  `capabilities` de cada item. O console também traz as `engagements` do item.

**Recusa no painel:** 409 com o motivo, por exemplo "TZOLKIN Mentorias é uma linha
de serviço e não vende por checkout."

### Painel (`apps/web/public/app.js` e `index.html`)

- **Navegação por capacidade:** o contexto monta as telas pelas capacidades vindas
  da API (`VIEW_CAPABILITIES`, `viewAllowed`).
  - Linha de serviço: Visão geral, Inbound, Chaves, **Contratações** (tela nova
    `view-product-engagements`), E-mails e Campanhas.
  - Item interno: só Visão geral, E-mails e Campanhas.
- **Sem regra pelo id:** saíram os testes de `sites` e `skiller` pelo id.
- **Formulários de vínculo e contrato:** só listam itens com `access`.
- **Placeholder "Mentorias" removido** da navegação geral. Ele descrevia turmas e
  matrículas, que são do Educare.
- **Rótulos:** mapa `PORTFOLIO_KIND_LABELS` (Produto, Plataforma, Linha de serviço,
  Interno) na ficha, no eyebrow e na navegação.

### Testes

- **Novo:** `test/unit/capabilities.test.mjs` cobre a matriz, a recusa por tipo, a
  emissão de chave e a trava de reclassificação.
- **`test/unit/access.test.mjs`:** parâmetros com os tipos; teste novo de
  `authenticateApp` por escopo.
- **`test/unit/portfolio.test.mjs`:** aceita os quatro tipos.
- **`test/core.test.mjs`:** acesso exercitado com `educare` (antes, `sites`).
- **`test/product-console.test.mjs`:** reorganizado para `educare` e `skiller`, com
  teste novo que exige 409 para contrato ou vínculo em `sites` e confere as
  contratações no console.
- **`test/commercial-intake.test.mjs`:** chave `context:read` para `sites` precisa
  dar 409; o teste de escopo usa `skiller`.

### Documentação

- **`docs/decisions/0007-portfolio-kind-rotulo-ou-regra.md` (nova):** `[ACEITA]` para
  a classificação e para a opção B. Traz contexto, vocabulário, opções, implementação,
  custo de reverter e pendências.
- **`docs/decisions/README.md`:** linha da 0007.
- **`docs/DOMAIN-MODEL.md`:** tipos, portfólio atual e a regra.
- **`docs/CONTEXT.md`:** D2 marcada como resolvida.

---

## 4. Primeiros passos no próximo chat

1. **O dono aplica a 032.** O assistente foi bloqueado pelo sistema de permissões ao
   tentar alterar o banco compartilhado.
   ```bash
   npm run db:migrate
   ```
2. **Conferir, só leitura.** Esperado: `schema_migrations` com a `032`; produtos
   `consultorias:service_line`, `core:internal`, `educare:platform`,
   `mentorias:service_line`, `sites:service_line`, `skiller:product`; as duas
   contratações `education` com `product_id = 'mentorias'`.
3. **Rodar a suíte no banco compartilhado.** Esperado: 386 aprovados, 0 falhas,
   1 ignorado.
   ```bash
   npm test
   ```
4. **Conferir o painel.** Precisa de login do dono; o assistente não entra com senha.
   Checar:
   - Mentorias e Consultorias no seletor de espaços;
   - a navegação de linha de serviço, sem Clientes nem Cobrança;
   - a tela Contratações de Mentorias com as duas mentorias;
   - o Core só com Visão geral, E-mails e Campanhas.
5. **Commitar**, se estiver tudo certo, separado em dois:
   - `feat: classificar portfolio e contextos de mentorias e consultorias` (032,
     ADR 0007 e docs);
   - `feat: capacidades do portfolio por tipo` (política, tela e testes).

---

## 5. Verificação já feita e armadilhas conhecidas

**Números desta sessão**
- `npm run test:unit`: 232 de 232.
- `npm test` no banco compartilhado, sem a 032: 386 aprovados, 0 falhas, 1 ignorado.
- `npm run test:isolated` (banco descartável, com a 032): 392 aprovados.
  - **As 3 falhas restantes já existiam e vêm do ambiente:**
    - `ecosystem persisted with three products`: o banco descartável não roda a
      importação do Notion;
    - `catalogued product carries its Notion record`: mesma causa;
    - `issue key returns secret once`: a contagem de chaves de `sites` colide com o
      `product-console.test` rodando em paralelo.
  - As suítes que agrupam essas falhas também aparecem como falha.

**Armadilhas**
- **`npm test` escreve no banco compartilhado**, o mesmo da produção (`.env`). Os
  testes criam e apagam registros sintéticos.
- **Exclusão permanente e migração nesse banco são com o dono.** O assistente não
  apaga dado de forma definitiva e foi bloqueado ao tentar `db:migrate`.
- **Mocks dos testes unitários casam o SQL pelo prefixo**
  `SELECT id,name FROM products`. `findProductFor` mantém esse prefixo de propósito.
- **Rascunho aceitar contrato de acesso é intencional.** O checklist de ativação do
  projeto (`delivery.mjs`) exige contrato preparado antes de ativar. Rascunho nunca
  dá acesso: vínculo e `/v1/context` exigem item ativo.
- **ID de item do portfólio nunca muda:** aparece em `/c/:productId` e em chaves
  emitidas. Excluir é arquivar; a role de produção não tem DELETE.
- **O importador do Notion** (`scripts/import-notion.mjs`) insere produto com o tipo
  padrão `product`. Num banco novo, `core` nasceria `product`. Não foi corrigido.

---

## 6. Cobrança de Mentorias e Consultorias — resultado da pesquisa

Pesquisa na web de 2026-09-14. 🟡 marca o que não foi confirmado em fonte oficial.

### Contabilizei: não tem API

- **A conta PJ existe: é o Contabilizei.bank**, sobre a Dock (instituição de
  pagamento 301).
  - Pix grátis e extrato automático na contabilidade.
  - Boleto: 10 por mês grátis, depois R$ 2,49.
  - Fontes: [suporte](https://suporte.contabilizei.com.br/hc/pt-br/articles/7759702691996),
    [tarifas](https://suporte.contabilizei.com.br/hc/pt-br/articles/7759732444828).
- **A cobrança se chama "Cobre PJ"**, processada pela Iugu.
  - Link de cartão 2,99% + R$ 0,99, até 12x; Pix; envio mensal automático.
  - Boleto fechado para novos clientes desde 07/02/2025.
  - Exige certificado digital.
  - Fonte: [FAQ](https://suporte.contabilizei.com.br/hc/pt-br/articles/17301842162588).
- **Nenhuma API, portal de desenvolvedores ou webhook** em fonte oficial: nem para
  cobrança, nem para extrato, nem para nota fiscal.
- **Integração com bancos é só importação de OFX.** A lista de tutoriais inclui
  Asaas, Inter, Nubank, Mercado Pago, PagSeguro e bancos grandes. Stripe, Cora, Efí,
  Iugu e Pagar.me não aparecem
  ([suporte](https://suporte.contabilizei.com.br/hc/pt-br/articles/360008338200)).
- **Uso possível pelo Core:** registrar como "cobrança externa manual" e conciliar
  pelo extrato. Não usar o projeto de terceiros com engenharia reversa.

### Alternativas com API

| | API de cobrança | Webhook | Pix Automático | NFS-e integrada | Autenticação | Custo público |
|---|:-:|:-:|:-:|---|---|---|
| **Asaas** (já no Core) | sim | sim | sim ([doc](https://docs.asaas.com/docs/pix-automatico)) | sim, R$ 0,49 por nota | chave de API | Pix ou boleto R$ 1,99; cartão 2,99% + R$ 0,49 ([preços](https://www.asaas.com/precos-e-taxas)) |
| **Inter Empresas** | sim | sim | sim ([doc](https://developers.inter.co/references/pix-automatico)) | 🟡 não encontrada | certificado anual + OAuth | não publicado |
| **Efí** | sim | sim | sim ([doc](https://dev.efipay.com.br/en/docs/api-pix/pix-automatico/)) | não | certificado | Pix 1,19%; Pix Automático R$ 3,50; boleto R$ 3,45 |
| **Iugu** | sim | sim | sim ([doc](https://dev.iugu.com/docs/cobrar-com-pix-automatico-por-api)) | 🟡 via parceiros | 🟡 não verificada | por plano |
| **Cora** | sim, só no plano CoraPro | sim | 🟡 não confirmado | não | certificado | boleto com Pix R$ 0,50 |
| **Nubank PJ** | **não** | não | 🟡 | não | — | Pix e boleto grátis pelo app |
| **Stripe Brasil** | sim | sim | **não** ([doc](https://docs.stripe.com/payments/pix)) | não | chave | Pix só por convite, até R$ 3.000 |

Mercado Pago, PagBank e Pagar.me têm API, mas a recorrência é focada em cartão, e o
Pix Automático não foi confirmado.

### Pix Automático

- **Situação:** lançado em 16/06/2025. A IN BCB 769, de 19/08/2026, ajustou o manual
  (🟡 a data diverge da notícia da Agência Gov, de 08/09/2026).
- **Quem recebe:** pessoa jurídica.
- **Onde se aplica:** **só cobrança periódica**, com prazo definido. Mentoria mensal
  se enquadra; consultoria pontual não.
- **Tarifa:** o recebedor paga o que negociar com o banco; cobrar do pagador é
  proibido.
- **Aviso de pagamento:** o resultado chega por conciliação depois das 21h.
- **Fonte:** [FAQ do BCB](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/pix-automatico-FAQ-participantes.pdf).

### Recomendação

1. **Asaas como caminho principal.** O fluxo:
   - proposta aceita;
   - o Core cria cobrança avulsa, parcelamento ou assinatura;
   - o webhook marca **paga**;
   - só vira **disponível** quando o saldo confirmar.

   O cliente paga na fatura hospedada do Asaas, então o Core não toca em cartão.
   Sem split.
2. **Pix Automático só para mentoria mensal.** O Asaas exige CNPJ com 6 meses ou mais
   e CNAE aceito.
3. **NFS-e com um único emissor:** a Contabilizei (hoje) ou o Asaas. Nunca os dois.
4. **Stripe só para cartão e clientes do exterior.**
5. **Inter como plano B**, para receber direto na conta bancária. Custa o certificado
   anual e tem tarifas não publicadas. O Core já lê o Inter pela Pluggy.

### Confirmar direto

- **Contabilizei:**
  - existe API ou webhook do Contabilizei.bank ou do Cobre PJ, ou está nos planos?
  - o Cobre PJ está liberado para a TZOLKIN, e com qual tarifa de Pix?
  - o extrato do Asaas entra automático ou por upload de OFX?
  - se o Asaas emitir a NFS-e, ela é importada sem duplicar?
  - a conta pode ser lida por Open Finance (Pluggy)?
- **Asaas:**
  - a TZOLKIN é elegível ao Pix Automático?
  - qual a tarifa efetiva? O blog e a página de preços divergem.
  - em quanto tempo o saldo fica disponível, por meio de pagamento?
- **Inter:** tabela de tarifas de API Cobrança, Pix e Pix Automático.

---

## 7. Próximos passos sugeridos, em ordem

1. Aplicar a 032, verificar e commitar (§4).
2. **Registrar a pesquisa** no `docs/INTEGRATIONS.md` §7 (que ainda diz só "não foi
   localizada API", de 30/08) e no `docs/BILLING.md`.
3. **Levar as perguntas de §6** à Contabilizei e ao Asaas.
4. **Desenhar a cobrança por proposta das linhas de serviço**, provavelmente como
   ADR 0008.
   - Não é a capacidade `checkout`: é outro fluxo, que pede uma capacidade nova,
     algo como `proposal_billing` para `service_line`.
   - Decidir: a cobrança nasce da contratação (`client_engagements`) ou do contrato
     comercial (`commercial_contracts`)?
   - Diferenciar pago de disponível, e a conciliação com o extrato.
   - Definir quem emite a nota.
5. **Pendências da ADR 0007:**
   - `delivery.mjs` ainda cria todo projeto técnico como `product`, e o checklist de
     ativação pressupõe produto;
   - `service_model = 'education'` ficou ambíguo: a tela chama o mesmo valor de
     "Educacional" em `app.js` e de "Mentoria" em `campaigns.js`;
   - dimensões `acquisition_mode` e `billing_mode`, apontadas pela auditoria de 07/09.
6. **Pequenos:** o importador do Notion cria item com tipo `product` (§5), e a
   documentação datada (`PRODUCT.md`, auditoria de 07/09) ainda cita Barber, Commerce
   e Data como registro da época.

---

## 8. Arquivos de referência

- **Decisões:** `docs/decisions/0007-portfolio-kind-rotulo-ou-regra.md` e
  `docs/decisions/0005-taxonomia-cliente-produto-servico.md`.
- **Modelo e pendências:** `docs/DOMAIN-MODEL.md` e `docs/CONTEXT.md` (D2 a D5).
- **Estado de funcionalidades e riscos:** `docs/FEATURES.md` e `docs/BACKLOG.md`.
- **Integrações e cobrança:** `docs/INTEGRATIONS.md` (§7 Contabilizei) e
  `docs/BILLING.md`.
- **Código da política:** `apps/api/src/modules/catalog.mjs`,
  `apps/api/src/modules/portfolio.mjs` e `apps/web/public/app.js`
  (`VIEW_CAPABILITIES`).
- **Migrações:** `db/migrations/031_remove_barber_commerce_data.sql` e
  `db/migrations/032_classificacao_do_portfolio.sql`.
