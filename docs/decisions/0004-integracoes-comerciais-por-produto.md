# ADR-0004: Integrações comerciais no contexto do produto

**Status:** Aceito  
**Data:** 2026-09-01  
**Decisores:** TZOLKIN

## Contexto

Stripe, Asaas, ofertas e regras de e-mail estavam divididos entre Financeiro, Produtos e planos e E-mails. O cadastro de produto já é o limite correto para oferta, contrato e comunicação, mas as credenciais dos provedores são infraestrutura global.

## Decisão

O contexto de cada produto terá uma página **Pagamentos**. Ela projeta o estado global das conexões Stripe, Asaas e e-mail, e gerencia ofertas e regras pertencentes ao produto. Financeiro permanece como tesouraria consolidada. Transações só serão atribuídas a produtos quando o provedor fornecer metadata explícita e validada.

## Opções consideradas

1. Manter telas globais separadas: simples, mas fragmenta o fluxo e mistura portfólio com tesouraria.
2. Duplicar credenciais por produto: aumenta isolamento aparente, mas multiplica segredos e risco operacional.
3. Credenciais globais com configuração por produto: escolhido; centraliza o trabalho sem duplicar segredos.

## Consequências

- “Produtos e planos” passa a se chamar **Portfólio**.
- E-mail financeiro deixa de ser uma área global de navegação e aparece junto da oferta do produto.
- A tela declara que vendas atuais ainda são consolidadas e não inventa rateio por produto.
- Uma futura conciliação exigirá metadata de produto/oferta no Stripe e no Asaas.
