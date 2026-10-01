# Baseline de carregamento do Core — 2026-10-01

## Resultado

O gargalo medido era composição e latência de rede, não tempo de execução do PostgreSQL.

| Medição | Resultado |
|---|---:|
| Tamanho aproximado do banco | 12 MiB |
| `SELECT 1` pela conexão remota | p50 139 ms · p95 145 ms |
| Execução no servidor (`SELECT 1`) | planejamento 0,124 ms · execução 0,062 ms |
| `/health` público | p50 411 ms · p95 614 ms |
| Carregamento local completo, cache frio | 6.234,7 ms |

### Decomposição do carregamento antigo

| Fase | Duração |
|---|---:|
| Cadastro + catálogo + vínculos + topologia | 3.889,5 ms |
| Financeiro | 551,9 ms |
| Deploys | 1.077,2 ms |
| Infraestrutura | 567,1 ms |
| Health | 148,9 ms |

Na fase inicial, `/api/overview` levou 1.833,1 ms, `/api/ecosystem` 1.141,7 ms,
`/api/product-resource-bindings` 1.156,6 ms e `/api/products/topology` 3.887,7 ms. A topologia
mistura banco com GitHub, Vercel, EasyPanel e DNS; o provedor mais lento segurava a tela inteira.

## Correção aplicada

1. `GET /api/bootstrap` consolida cadastro, catálogo e vínculos em uma viagem ao PostgreSQL.
2. A interface fica utilizável assim que o bootstrap chega.
3. Financeiro, deploys e EasyPanel enriquecem a tela em segundo plano.
4. Topologia só é consultada no contexto de produto.
5. O aviso de transporte usa o dado do bootstrap e deixa de chamar `/health` novamente.

## Como comparar uma migração

Usar os mesmos dados anonimizados, mesma região/rede, mesma autenticação e a mesma sequência de
requisições. Registrar aquecimento, concorrência, erros, CPU, memória, bytes, p50, p95 e p99. Não
comparar um MySQL local com o PostgreSQL remoto: isso mede distância, não banco.

O benchmark pós-correção deve ser capturado no ambiente equivalente antes de decidir a ADR 0010.
