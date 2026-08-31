# ADR 0003 — Configuração de cobrança por conta e oferta, não por produto

- **Status:** `[PROPOSTO]` — nenhuma linha de código financeiro existe. Não vale como acordo.
- **Data:** 2026-08-30

## Contexto

A direção do usuário é: **Stripe** como padrão para assinaturas SaaS, **Asaas** como padrão para cobranças gerais no Brasil (Pix, boleto, serviços). E, explicitamente: essa direção **não deve virar uma associação rígida entre produto e provedor**.

A tentação é o atalho `produto → provedor` (Barber = Stripe, Sites = Asaas). Ele quebra em quatro situações previsíveis:

1. O mesmo produto vendido como assinatura (Stripe) **e** como projeto parcelado no Pix (Asaas).
2. Um cliente que só paga por boleto num produto tipicamente cobrado no cartão.
3. Uma segunda entidade jurídica recebendo por parte do portfólio.
4. Sandbox e produção convivendo — o mesmo produto, contas diferentes.

Também é preciso ter em conta que **capacidade varia por conta**: recurso disponível depende de aprovação e do contrato de cada provedor ([CONTEXT.md §6](../CONTEXT.md#6-hipóteses-ainda-não-validadas)).

## Decisão proposta

**A unidade de configuração de cobrança não é o produto. É a combinação de entidade jurídica recebedora, conta do provedor, ambiente e oferta.** O produto é uma das dimensões, não a chave.

A configuração carrega: entidade jurídica recebedora · conta do provedor · ambiente (teste/produção, sempre explícito, nunca inferido) · produto · oferta e versão do preço · contrato · modalidade · moeda · referências externas com o provedor identificado.

Decorrências:

- **O adaptador é escolhido pela configuração da oferta**, resolvida em tempo de execução — não por `if (produto === …)`.
- **Um adaptador por provedor**, atrás de uma interface do domínio financeiro. O domínio fala em cobrança, tentativa, pagamento e liquidação; o adaptador traduz para o vocabulário do provedor.
- **Versão de preço é imutável.** Contrato assinado guarda a versão que assinou; mudar o preço cria versão nova.
- **Ambiente é dimensão de primeira classe**, e nunca deduzido do formato da chave.

## Por quê

- Sem entidade jurídica na configuração, não há como uma segunda empresa receber sem reescrever o modelo.
- Sem versão de preço, aumento de preço reescreve o passado — e a conciliação passa a mentir.
- Sem ambiente explícito, cedo ou tarde uma chave de sandbox encontra uma URL de produção. Nos dois provedores isso é falha silenciosa ou erro obscuro: no Asaas a chave é `$aact_hmlg_` ou `$aact_prod_` e precisa casar com a URL base.
- Com adaptadores, trocar de provedor é trabalho localizado, não reescrita.

## Consequências

**Boas**
- Produto e provedor deixam de estar acoplados.
- Múltiplas entidades jurídicas cabem sem redesenho.
- Sandbox conviver com produção deixa de ser risco.

**Ruins, e assumidas**
- Mais tabelas e mais configuração do que "um provedor por produto". É o preço de não precisar migrar depois.
- A interface do domínio financeiro precisa ser genérica o bastante para os dois provedores **sem** virar o mínimo denominador comum. Onde os modelos divergirem de fato (split, antecipação, negativação), o adaptador expõe a capacidade explicitamente em vez de fingir equivalência.

## Limites desta ADR

**Não decide o fluxo 2** (consumidor paga ao cliente). Split, repasse e conta conectada estão fora até [D3](../CONTEXT.md#d3--quem-vende-e-quem-recebe-no-fluxo-consumidor--cliente) ser respondida — [BILLING.md](../BILLING.md#fluxo-2--consumidor-paga-ao-cliente).

**Não escolhe provedor por produto.** Escolha comercial do usuário, tomada oferta a oferta.

**Não presume capacidade.** Confirmar no painel de cada conta antes de desenhar em cima.

## Custo de reverter

- **Configuração desacoplada → provedor fixo por produto:** trivial (basta configurar assim).
- **Provedor fixo → desacoplado, depois de haver cobranças reais:** alto. Exige remodelar referências externas e reprocessar histórico. É o motivo de propor a forma desacoplada desde a primeira tabela.
