# ADR 0010 — Go + MySQL somente após gates de paridade e desempenho

- **Status:** `[PROPOSTO]` em 2026-10-01
- **Decisão necessária:** aceitar ou rejeitar a migração depois do spike comparável
- **Referência de medição:** [baseline de carregamento](../benchmarks/2026-10-01-core-loading.md)

## Contexto

O Core atual usa Node.js e PostgreSQL. A tela geral levava cerca de **6,2 s** para concluir o
carregamento local com cache frio. Isso não demonstrou que PostgreSQL fosse lento:

- uma conexão ao banco remoto gastou cerca de 139 ms por viagem, enquanto o servidor PostgreSQL
  gastou menos de 1 ms para planejar e executar a consulta de controle;
- o primeiro quadro esperava quatro APIs de banco e a topologia de GitHub, Vercel, EasyPanel e DNS;
- depois ainda esperava financeiro, deploys e infraestrutura em série;
- o banco tem cerca de 12 MiB, portanto volume não explica a espera.

Antes desta ADR, o primeiro quadro foi alterado para usar `GET /api/bootstrap`: uma viagem ao
PostgreSQL para cadastro, catálogo e vínculos. Inventários externos passaram a enriquecer a tela em
segundo plano.

Trocar runtime e banco ao mesmo tempo impede saber qual mudança produziu ganho. Também há custo de
portabilidade real: a base atual contém, entre outros, 131 usos de `timestamptz`, 76 de `jsonb`, 59
de `RETURNING`, 42 de `ON CONFLICT`, 32 de `gen_random_uuid()` e 27 de `FOR UPDATE`. Isso não é uma
troca mecânica de driver.

## Decisão proposta

**Não substituir produção agora.** Construir um spike isolado de Go + MySQL e só aprovar a
migração completa se todos os gates abaixo passarem.

1. Congelar o contrato HTTP existente como referência. O spike não cria uma API nova.
2. Comparar quatro efeitos separadamente sempre que houver ambiente disponível:
   Node + PostgreSQL otimizado (baseline), Go + PostgreSQL, Node + MySQL e Go + MySQL.
3. Migrar primeiro apenas o caminho de leitura do bootstrap para uma cópia anonimizada.
4. Não usar escrita dupla. Depois da paridade, o corte de escrita deverá usar janela de manutenção,
   cópia final, checksums/contagens, smoke test e chave de rollback.
5. Migrar módulos verticais somente depois de o bootstrap provar desempenho e correção.

O spike em `spikes/go-mysql` é deliberadamente **não publicável** e não participa do build do Core.

## Gates obrigatórios

| Gate | Critério de aprovação |
|---|---|
| Contrato | mesmas chaves, tipos, nulabilidade e semântica do Node; fixtures e testes passam |
| Dados | contagem por tabela, chaves órfãs, checksums por lote e amostra manual sem divergência |
| Correção | transações, concorrência otimista, idempotência, auditoria e autorização equivalentes |
| Desempenho | Go + MySQL melhora o p95 do endpoint em pelo menos 20% contra Node + PostgreSQL já otimizado, sob a mesma rede e dados |
| Operação | backup e restauração cronometrados; observabilidade e runbook de incidente prontos |
| Segurança | TLS verificado, segredo fora do código, menor privilégio e logs sem dados sensíveis |
| Rollback | retorno ao Node + PostgreSQL ensaiado dentro do RTO definido |

Se o ganho vier apenas do bootstrap consolidado ou da proximidade de rede, a migração é rejeitada.

## Alternativas avaliadas

| Alternativa | Avaliação |
|---|---|
| Manter Node + PostgreSQL e corrigir o caminho crítico | **Executada primeiro.** Menor risco e ataca o gargalo observado. |
| Reescrever em Go mantendo PostgreSQL | Isola o efeito do runtime e reduz a superfície da migração; deve entrar no benchmark. |
| Trocar só PostgreSQL por MySQL | Isola o efeito do banco, mas ainda exige converter SQL e tipos; deve entrar no benchmark. |
| Reescrever tudo em Go + MySQL de uma vez | **Rejeitada.** Maior blast radius, rollback difícil e causa de regressão impossível de isolar. |
| Microserviços por módulo durante a reescrita | **Rejeitada.** O Core não tem escala que justifique rede, deploy e observabilidade adicionais. |

## Consequências

- Há trabalho duplicado temporário no spike, mas nenhum caminho de produção fica dividido.
- MySQL deixa de ser uma suposição de performance e vira uma hipótese mensurável.
- A equipe mantém a opção de adotar Go sem trocar o banco, ou MySQL sem trocar o runtime.
- O esforço de migração só começa de verdade após inventário completo de SQL, schema convertido e
  ambiente MySQL reproduzível.

## Custo de reverter

Baixo enquanto o spike estiver isolado: remover `spikes/go-mysql` e esta proposta não altera
produção. Depois de um corte de escrita, o custo passa a ser alto porque os bancos divergem; por isso
o plano proíbe escrita dupla aberta e exige janela, verificação e rollback ensaiado.

## Fontes técnicas

- [Go: acesso a bancos relacionais](https://go.dev/doc/database/)
- [Go: gerenciamento do pool de conexões](https://go.dev/doc/database/manage-connections)
- [MySQL Workbench: migração de PostgreSQL](https://dev.mysql.com/doc/workbench/en/wb-migration-overview-supported.html)
- [MySQL 8.4: compatibilidade e JSON](https://dev.mysql.com/doc/refman/8.4/en/compatibility.html)
