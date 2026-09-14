# Handoff — estado atual do TZOLKIN Core

Sessão de **2026-09-14**. Para continuar em outra conversa, peça:

> Leia `docs/handoff-2026-09-14-core-estado-atual.md` e prossiga a partir das pendências priorizadas.

- **Repositório:** `D:\Códigos\Tzolkin\Projetos\Outros\Site - Tzolkin\tzolkin-core`
- **Branch:** `codex/revisao-seguranca-core`
- **Remote:** `origin/codex/revisao-seguranca-core`, sincronizado
- **Produção:** `https://core.tzolkin.cloud`
- **EasyPanel:** projeto `other`, serviço `core`
- **Banco:** PostgreSQL na migração `032_classificacao_do_portfolio.sql`
- **Última verificação completa:** 386 testes aprovados, 0 falhas e 1 ignorado por ausência de `DATABASE_URL_TEST` dedicado

Não expor valores de `.env`, tokens, chaves ou strings de conexão. Credenciais ficam somente no servidor.

## 1. Estado entregue

### Chaves de integração

A interface foi redesenhada, testada em desktop e em viewport móvel de 390 × 844 e publicada em produção.

- Cabeçalho explica que são credenciais de servidor.
- Criação fica em fluxo dedicado “Nova chave”.
- O operador escolhe finalidade, permissões e validade.
- O segredo aparece uma única vez, com ação para copiar e ocultar.
- A listagem diferencia chave ativa, em transição, expirada e revogada.
- Rotação permite período de transição de 0, 60 ou 1.440 minutos.
- Revogação exige confirmação.
- Estado vazio orienta a criação da primeira chave.
- O frontend nunca recebe hashes nem segredos antigos.

Arquivos principais:

- `apps/web/public/commercial.js`
- `apps/web/public/commercial.css`
- `apps/api/src/modules/commercial-keys.mjs`

Commit: `8c3e75a feat: redesenhar chaves de integracao`.

As estruturas de banco já existiam; a mudança visual não exigiu nova migração:

- `015_commercial_intake.sql`: `label` e `created_at` em `app_clients`.
- `025_commercial_workspace.sql`: UUID, escopos, validade, último uso, revogação, rotação e auditoria.

### Portfólio e capacidades

O portfólio ativo agora é:

| ID | Tipo | Estado |
|---|---|---|
| `core` | `internal` | ativo |
| `skiller` | `product` | ativo |
| `educare` | `platform` | ativo |
| `sites` | `service_line` | ativo |
| `mentorias` | `service_line` | ativo |
| `consultorias` | `service_line` | ativo |

Barber, Commerce e Data foram removidos pela migração 031. A migração 032 criou Mentorias e Consultorias, reclassificou o Core e vinculou duas contratações educacionais a Mentorias.

A opção B da ADR 0007 está implementada: o tipo do item governa suas capacidades. Produtos e plataformas podem conceder acesso e vender por checkout; linhas de serviço operam por contratação; itens internos não expõem funções comerciais ou de acesso incompatíveis.

Commits:

- `04d08da feat: remover Barber, Commerce e Data do portfolio`
- `dde07ef feat: classificar portfolio e contextos de mentorias e consultorias`
- `98cd9f5 feat: capacidades do portfolio por tipo`

### Importação e cobrança de serviços

O importador do catálogo do Notion passou a inserir `portfolio_kind`, sem sobrescrever a classificação operacional de itens existentes durante sincronizações.

Commit: `7d4b4c8 fix: preservar classificacao no importador do catalogo`.

A cobrança de Mentorias, Consultorias e Sites foi documentada como um fluxo diferente de checkout. A proposta atual é:

1. proposta aceita;
2. contrato comercial aprovado;
3. parcelas imutáveis;
4. emissão por um único provedor;
5. confirmação por webhook autenticado;
6. conciliação até o valor ficar disponível;
7. emissão fiscal por uma única fonte.

A ADR 0008 recomenda a opção B, em que a cobrança nasce do contrato comercial aceito, mas continua **proposta** e não deve ser implementada como decisão definitiva sem aceite do dono.

Arquivos:

- `docs/BILLING.md`
- `docs/INTEGRATIONS.md`
- `docs/decisions/0008-origem-da-cobranca-de-servicos.md`

Commit: `b4f7296 docs: desenhar cobranca de linhas de servico`.

## 2. Banco e migrações

O comando `npm run db:migrate` foi executado novamente no encerramento desta sessão e respondeu:

> Banco já está na última migração.

Últimas migrações relevantes:

- `030_portfolio_crud.sql`
- `031_remove_barber_commerce_data.sql`
- `032_classificacao_do_portfolio.sql`

Existem dois arquivos numerados como 015 (`015_commercial_intake.sql` e `015_e9_produto_draft.sql`). O migrador controla o nome completo dos arquivos, então ambos foram aplicados, mas a numeração duplicada deve ser evitada em novas migrações.

Não rodar testes de integração contra o banco compartilhado sem avaliar o impacto: parte da suíte cria e remove registros sintéticos. Preferir `DATABASE_URL_TEST` dedicado.

## 3. Deploy

As mudanças funcionais de interface e portfólio foram enviadas ao GitHub e implantadas no EasyPanel.

- Última ação funcional observada no EasyPanel: `cmu1qzwko00d007l798df15um`
- Estado: `SUCCEEDED`
- Saúde em produção: HTTP 200
- TLS do domínio: verificado
- Asset de produção confirmou `ACESSO DE SERVIDOR` e a política `VIEW_CAPABILITIES`

Os commits `7d4b4c8` e `b4f7296` alteram apenas o importador manual e documentação. Não houve execução automática do importador nem operação financeira.

O adaptador do EasyPanel pode devolver 502 mesmo quando a operação foi aceita. Diante de resposta ambígua, não repetir o deploy imediatamente; consultar o histórico de ações e verificar o estado final.

## 4. Segurança que deve permanecer

- Nunca enviar credenciais ao navegador, documentação ou logs.
- Segredos emitidos aparecem uma única vez; o banco guarda somente hash.
- Webhooks Stripe e Asaas devem continuar autenticados e deduplicados.
- Eventos financeiros podem chegar fora de ordem; manter a máquina de estados não regressiva.
- Pagamento só é confirmado pelo webhook e pela conciliação, nunca pelo retorno do checkout.
- Não cobrar por um segundo provedor quando o primeiro estiver em estado desconhecido.
- Valores monetários usam centavos inteiros.
- Não armazenar dados brutos de cartão.
- Não executar cobranças reais, movimentar dinheiro ou alterar provedores externos sem autorização específica.

## 5. Próximas decisões

### Prioridade alta

1. **Decidir a ADR 0008:** confirmar se a cobrança de serviço nasce do contrato comercial aceito.
2. **Definir emissor fiscal único:** Contabilizei ou Asaas, evitando duplicidade de NFS-e.
3. **Definir `pago` versus `disponível`:** prazo e evidência usados na conciliação.
4. **Criar banco exclusivo de testes:** configurar `DATABASE_URL_TEST` e parar de usar o banco compartilhado na suíte.

### Produto e operação

5. Modelar propostas, contratos comerciais e parcelas antes de automatizar cobrança de linhas de serviço.
6. Resolver a ambiguidade de `service_model = 'education'` entre Educare e Mentorias.
7. Adicionar `acquisition_mode` e `billing_mode` ao modelo comercial após decisão de domínio.
8. Revisar `delivery.mjs`, que ainda presume que todo novo projeto técnico nasce como `product`.

### Integrações e infraestrutura

9. Substituir `PLUGGY_ITEM_IDS` por cadastro persistente de conexões bancárias e permitir adicionar instituições pelo Pluggy Connect dentro do Core.
10. Finalizar push no iPhone: VAPID, tabela de subscriptions por tópico, preferências e avaliação de alertas no servidor.
11. Levar as perguntas documentadas à Contabilizei e ao Asaas sobre API, Pix Automático, disponibilidade e NFS-e.
12. Completar backups com destino externo, retenção definida e teste de restauração. Os backups atuais usam disco local do mesmo servidor.

## 6. Comandos seguros para retomar

```powershell
git status -sb
git log -8 --oneline
npm run test:unit
npm run db:migrate
```

Antes de `npm test`, confirmar que existe um banco dedicado de teste.

## 7. Referências

- `docs/BACKLOG.md`: riscos e lacunas organizados pela auditoria.
- `docs/FEATURES.md`: estado das funcionalidades.
- `docs/DOMAIN-MODEL.md`: tipos e relações do domínio.
- `docs/decisions/0007-portfolio-kind-rotulo-ou-regra.md`: política de capacidades aceita.
- `docs/decisions/0008-origem-da-cobranca-de-servicos.md`: decisão de cobrança pendente.
- `docs/PRODUCTION-DEPLOY.md`: operação de produção.
- `docs/handoff-2026-09-14-portfolio-e-cobranca.md`: handoff histórico anterior, parcialmente superado por este documento.

