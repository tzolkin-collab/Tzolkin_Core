# SVG sources

Functional icons: lucide-static, selected SVG primitives bundled locally. No runtime CDN requests.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


Brand assets from SVGL: https://svgl.app/library/github_light.svg and https://svgl.app/library/vercel.svg (retrieved 2026-08-31). Logos remain trademarks of their owners; follow https://brand.github.com/ and https://vercel.com/geist/brands .

EasyPanel: official SVG from https://easypanel.io/icon.svg?icon.2sbiocau1w1w9.svg, linked by https://easypanel.io/ (retrieved 2026-08-31). Bundled locally as logos/easypanel.svg for provider identification; the mark remains its owner's trademark.
# Stripe

SVG obtido sem alterações do catálogo SVGL: https://svgl.app/library/stripe.svg (2026-08-31). Marca pertencente à Stripe; uso para identificar a integração, sem sugerir endosso. Asaas e Pluggy não encontrados na consulta ao catálogo https://api.svgl.app nesta data; aguardando SVGs oficiais do usuário.

# Marcas de instituições financeiras

Doze marcas obtidas sem alterações de https://github.com/Tgentil/Bancos-em-SVG (2026-09-02), indicado pelo usuário: `itau`, `bradesco`, `santander`, `bancodobrasil`, `caixa`, `c6bank`, `btgpactual`, `sicredi`, `sicoob`, `mercadopago`, `pagbank`, `picpay`. Somam-se a `nubank`, `inter`, `stripe` e `asaas`, já presentes.

**Aquele repositório não declara licença.** Isso significa que a *coleção* não concede permissão de uso — e é preciso dizer isso em vez de tratar a ausência como permissão. O que sustenta o uso aqui é outra coisa: cada marca pertence ao banco que ela identifica, não a quem reuniu os arquivos, e o uso é nominativo — identificar a instituição de uma conta dentro de um painel administrativo interno, sem sugerir endosso, parceria ou vínculo. É a mesma base já aplicada a GitHub, Vercel, EasyPanel e Stripe acima.

Consequências práticas, para quem revisar depois:

- Se alguma instituição publicar diretriz de marca própria, ela prevalece sobre esta coleção, e o arquivo deve ser trocado pelo oficial.
- O uso vale para identificação. **Não** vale para material comercial, página pública de venda ou qualquer peça que possa sugerir endosso.
- Nenhuma marca foi editada: os SVGs entraram como estavam.

Critério de escolha entre as variantes de cada pasta: proporção conferida por `viewBox` — todas as escolhidas são quadradas (≈1:1), porque o selo renderiza a 20px e logotipo com texto fica ilegível nesse tamanho. A variante do Sicoob chamada "minimalista" foi descartada por conter apenas `fill:none`, invisível sobre fundo claro; usada a `sicoob-vector-logo.svg`.

A lista canônica é `BANK_LOGOS`, em `apps/web/public/finance-model.js`. Ela alimenta o mapa de logos, a allowlist de `icons.js` e os estáticos de `apps/web/assets.mjs` — acrescentar marca é editar um lugar só.
