# Atribuição estendida do intake comercial

Contrato do bloco `attribution` em `POST /v1/commercial/intake`. Implementação: `apps/api/src/platform/attribution.mjs`; colunas: migração `038_atribuicao_estendida.sql`.

## Campos aceitos (além dos de sempre)

`utm_term`, `utm_tzolkin`, `meta_campaign_id`, `meta_adset_id`, `meta_ad_id`, `fbclid`, `gclid`, `fbc`, `fbp`, `session_key`, `first_touch_at`, `last_touch`, `session`, `geo`.

- `meta_*_id`: só dígitos (5 a 25). `meta_campaign_id` casa com `marketing_campaigns.external_id`.
- `utm_tzolkin`: `<espaço>.<nicho>` minúsculo, ex.: `sites.corretor`. **Escolhe o funil do lead:** o nicho casa com o `slug` de um funil ativo do espaço da chave (`pipelines`, migração 040); sem casamento, o lead cai no funil padrão do espaço, e o prefixo de outro espaço é ignorado para esse fim. Convenção na URL do anúncio da Meta: `meta_campaign_id={{campaign.id}}&meta_adset_id={{adset.id}}&meta_ad_id={{ad.id}}`.
- `fbp`/`fbc`: exigem `session.consent = 'granted'`, senão 400.
- `geo`: exige `precision` (`ip`, `cnpj`, `declared`). Por `ip`, coordenadas viram 2 casas.
- `session.events`: no máximo 20. `last_touch`, `session` e `geo` têm teto de tamanho no banco.
- Chave desconhecida em qualquer nível: 400.

## Dados próprios do espaço (`space_data`)

Bloco opcional do intake: um objeto chave → valor, validado contra os campos que o **espaço da chave** define em
`space_fields` (migração 043; entidade `lead`). Tipos: TEXT (até 500), NUMBER, DATE (AAAA-MM-DD), SELECT, MULTISELECT,
BOOLEAN e LINK (http/https). Vazio (`""`, `null`) significa sem valor e não vira chave.

- Chave que o espaço não define, ou que está desativada: **400**, a mesma política dos outros blocos. Obrigatório que falta: 400.
- O espaço **sites** nasce com quatro campos TEXT opcionais: `porte`, `funcionarios`, `instagram`, `site`.
- Os valores sobem do lead para a oportunidade e para a contratação nos campos que o espaço também define lá (mesma chave e mesmo tipo).
- Só entra no pedido normalizado quando enviado, então pedido antigo mantém o hash.
- O site, se um Core antigo recusar o bloco (400), reenvia uma vez no formato antigo (campos no início da mensagem).

## Compatibilidade

Só entra no pedido normalizado o que foi enviado, então pedidos antigos têm o mesmo hash de antes (sem 409 em reenvio).

## Casamento com a Meta

`commercial_attributions.meta_campaign_id` = `marketing_campaigns.external_id`. A Meta só entrega números por campanha/dia; o vínculo por pessoa vem deste campo.

## O que não entra

Telemetria bruta. O emissor guarda a trilha completa; o Core recebe o resumo.
