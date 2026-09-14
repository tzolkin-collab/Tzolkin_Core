# ADR-0008: Origem da cobrança de linhas de serviço

**Status:** `[ACEITA]` — opção B, em 2026-09-14
**Data:** 2026-09-14
**Decisores:** TZOLKIN

## Contexto

Mentorias, Consultorias e Sites são linhas de serviço. Elas não concedem acesso a um software e,
pela ADR 0007, não usam a capacidade `checkout`. Ainda assim precisam registrar propostas,
parcelas, cobranças, pagamento, disponibilidade do saldo e emissão fiscal.

Hoje `client_engagements` representa a contratação operacional e `commercial_contracts` registra
escopo, valor, período, aceite e situação. Criar cobranças diretamente de qualquer uma das duas
sem definir autoridade produz valores divergentes e reemissão acidental.

## Opções

### A — Cobrança nasce da contratação

`client_engagements` recebe valor, moeda e calendário de parcelas.

- Simplifica a primeira tela.
- Mistura relacionamento operacional com condições financeiras e versões do contrato.
- Uma assessoria com aditivo ou renovação perde a origem exata do valor vigente.

### B — Cobrança nasce do contrato comercial `[RECOMENDADA]`

Somente um `commercial_contract` aceito pode gerar um plano de recebimento. A contratação agrupa a
operação; o contrato guarda a condição acordada; parcelas e cobranças referenciam a versão aceita.

- Mantém escopo e dinheiro na mesma versão auditável.
- Permite várias renovações ou aditivos na mesma contratação.
- Exige modelar parcelas e idempotência antes de chamar o provedor.

### C — Criar uma entidade de proposta anterior ao contrato

A proposta gera o contrato depois do aceite; a cobrança nasce da proposta aceita.

- Representa melhor negociação com várias versões.
- Adiciona um ciclo completo antes de haver necessidade comprovada no Core.
- Pode ser acrescentada depois sem quebrar B, fazendo o contrato referenciar a proposta vencedora.

## Recomendação proposta

Escolher **B**. O Core deve gerar parcelas imutáveis a partir de uma versão aceita de
`commercial_contracts`. Cada tentativa usa chave de idempotência própria e um único provedor. Estado
desconhecido bloqueia fallback automático. Webhook confirma `paid`; conciliação confirma
`available`. Alteração posterior do contrato cria nova versão e não reescreve cobranças emitidas.

Contabilizei/Cobre PJ entra como cobrança externa manual enquanto não houver API oficial. Asaas é o
adaptador principal para Pix, boleto, cartão e Pix Automático periódico. Stripe fica disponível para
cartão e exterior. O emissor de NFS-e precisa ser único por operação.

## Consequências se aceita

1. Criar `service_receivable_plans`, `service_installments` e vínculo com contrato/versionamento.
2. Preparar cobrança e mostrar preview antes de qualquer chamada externa.
3. Exigir autorização administrativa para emitir, cancelar ou alterar vencimento.
4. Reutilizar deduplicação e histórico dos webhooks sem transformar pagamento em acesso.
5. Conciliar processador e banco como eventos distintos; repasse não vira segunda receita.

## Custo de reverter

De B para C é aditivo. De B para A exige mover versões financeiras para a contratação e perde a
separação entre renovação, aditivo e operação. Trocar o provedor não muda a origem da cobrança,
porque o domínio guarda parcelas e o adaptador traduz para Asaas, Stripe ou registro manual.

## Decisão — 2026-09-14

Decidido pelo dono:

- **Opção B aceita.** A cobrança de linha de serviço nasce de uma versão aceita de
  `commercial_contracts`. A contratação agrupa a operação; o contrato guarda a condição acordada.
- **Emissor de NFS-e: Contabilizei, por enquanto.** O Core registra a nota emitida, não emite.
  Migrar a emissão para o Asaas só depois de a Contabilizei confirmar que importa nota emitida
  pelo Asaas sem gerar uma segunda nota para a mesma venda.
- **Disponível = crédito no extrato bancário**, confirmado pela conciliação via Pluggy. O webhook
  do provedor marca **pago**; o saldo informado pelo processador (Asaas, Stripe) não basta para a
  parcela contar como caixa nem entrar nos indicadores de dinheiro disponível.

Continua pendente:

- Confirmar elegibilidade e tarifa efetiva do Pix Automático no Asaas — pergunta ao fornecedor.

