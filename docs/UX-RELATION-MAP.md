# Mapa de UX e relações do Core

Este mapa transforma o desenho do Notion em regras de navegação e relacionamento para o Core.

## Tela por tela

| Tela | Entidade principal | Relações exibidas a priori | Não deve misturar |
|---|---|---|---|
| Visão geral | operação | clientes ativos, receita, produtos, projetos e alertas | cadastro detalhado ou edição inline |
| Clientes | organização cliente | ofertas, contratos, pessoas, projetos e pagamentos | leads e empresas sem contratação |
| Leads | oportunidade/prospect | empresa, contato principal, origem, próximo passo e interesse | cliente ativo ou stakeholder solto |
| Empresas | organização | pessoas vinculadas, tipo, domínio e relacionamento atual | transformar toda empresa em cliente |
| Pessoas | stakeholder | empresas vinculadas, papel, contatos e permissões por produto | tratar pessoa como empresa |
| Produtos | item de portfólio | ofertas, marcas, clientes contratantes e linha (Skiller, Barber, Educare etc.) | projeto executado ou pagamento avulso |
| Serviços/Projetos | execução | cliente, produto/linha, responsável, repositório, tarefas e status | catálogo de produtos |
| Pagamentos | evento financeiro | cliente, produto, oferta, assinatura, parcelas, repasses e previsão | cadastro de empresa/pessoa como transação |
| Financeiro | consolidação | recebimentos, despesas, previsões e repasses por cliente/produto/projeto | substituir o detalhe da transação |
| Acessos | autorização | pessoa, organização, produto, papel e status | ser a fonte do cadastro de pessoas |

## Relações que podem ser feitas agora

- Organização cliente → stakeholders → produtos contratados → contratos/acessos.
- Organização prospect → pessoas → interesse/oferta → próximo passo comercial.
- Empresa → pessoas vinculadas, independentemente de ser cliente ou prospect.
- Produto → ofertas → clientes contratantes → pagamentos.
- Cliente + produto → projeto/serviço quando houver execução.
- Pagamento → cliente, produto e oferta; previsão → projeto e tags quando disponíveis.
- Pessoa → organização e, separadamente, permissões de produto.

## Regras de linguagem

- “Cliente” é relacionamento comercial, não tipo jurídico.
- “Empresa” é organização; pode ser cliente, lead, parceira ou interna.
- “Pessoa” é stakeholder; a empresa vinculada é contexto, não a mesma entidade.
- “Lead” é estágio comercial; não é uma empresa diferente.
- “Produto” é catálogo; “serviço/projeto” é execução.

## Relações que precisam de modelagem antes de entrar na UX

1. Identificar a venda do checkout por cliente explícito, sem inferência apenas por e-mail.
2. Contrato com anexos, parcelas, vencimentos e data de repasse.
3. Nota fiscal Asaas ligada à parcela/recebimento.
4. Vocabulário de tags por marca, linha, projeto e canal.
5. Educare com turmas, alunos, matrícula e cobrança próprios.

Fonte: mapa de bases do Notion e ADR-0005. O Notion continua sendo a fonte de verdade; este arquivo apenas registra a tradução da estrutura para a UX.
