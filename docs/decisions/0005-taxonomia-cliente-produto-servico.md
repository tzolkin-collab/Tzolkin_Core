# ADR-0005: Separar cliente, pessoa, oferta, projeto e linha educacional

**Status:** Accepted  
**Date:** 2026-09-02  
**Deciders:** Tzolkin

## Contexto

O Core precisa representar operações diferentes: Skiller, Tzolkin Barber,
consultoria, assessoria, sob demanda e Educare. Um seletor único confunde
empresa com pessoa, produto com serviço e venda com projeto executado.

## Decisão

- **Clientes/Empresas:** organizações e seu ciclo comercial.
- **Pessoas:** stakeholders ligados a uma ou mais organizações.
- **Portfólio:** produtos, plataformas e linhas de serviço (incluindo Educare).
- **Serviços/Projetos:** execução técnica e operacional vinculada a uma organização
  e, quando aplicável, a um item do portfólio.
- **Pagamentos:** oferta, assinatura, parcelas, repasse e previsão vinculados ao
  produto, cliente e projeto por tags e referências explícitas.
- **Educacional:** é uma linha de serviço/portfólio com regras próprias, não uma
  categoria genérica misturada com consultoria.

## O que já está implementado

- Clientes e Pessoas separados.
- Portfólio separado de Acessos.
- Projetos e serviços em área técnica própria.
- Previsões financeiras com `project_id`, `tenant_id`, `product_id` e `tags`.
- Checkout por produto e oferta.

## Pendências de desenho

1. [ ] Criar tela CRUD de previsões recorrentes.
2. [ ] Definir o vocabulário final de tags e seus donos.
3. [ ] Associar checkout a cliente por identificação explícita, sem inferir por e-mail.
4. [ ] Modelar contrato/anexo e emissão de nota fiscal Asaas.
5. [ ] Modelar cronograma de parcelas e data de repasse.
6. [ ] Criar visão dedicada Educare para turmas, alunos, matrícula e cobrança.
