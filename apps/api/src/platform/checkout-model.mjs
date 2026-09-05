// Schema do montador de checkout: tokens de tema e campos de copy.
//
// Puro — sem rede, sem banco. É a FONTE ÚNICA do que o editor mostra e do que a
// página pública lê. O painel renderiza os campos a partir destes descritores em
// vez de repetir a lista, senão adicionar um token custaria três edições e as
// três divergiriam.
//
// Os padrões são exatamente os literais que checkout.js e checkout.css usam
// hoje. Por isso a migração 023 grava `copy` vazio: vazio significa "usa o
// padrão", o editor mostra o padrão como placeholder, e nenhuma página muda de
// texto no dia em que isto entra.
import { input, text, fail } from './http.mjs';

// Só o que realmente conseguimos servir. Texto livre sempre foi mentira: o
// navegador só renderiza a fonte que existe, e é por isso que o campo antigo
// nunca teve efeito. A lista cresce quando um .woff2 entrar em apps/web/public.
export const FONTS = [
 { id: 'system', name: 'Do sistema', stack: 'system-ui,-apple-system,"Segoe UI",sans-serif' },
];
export const SHADOWS = ['none', 'soft', 'lifted'];
export const DENSITIES = ['compact', 'regular', 'roomy'];
export const WIDTHS = [420, 480, 560];
export const METHODS = ['card', 'pix', 'boleto', 'wallet'];

// kind decide o controle no editor e a validação aqui. Nada além destes tipos:
// um token novo escolhe um kind existente ou ganha validação explícita.
export const THEME_TOKENS = [
 { key: 'color',       kind: 'color', css: '--tpl-color',   default: '#111827', label: 'Cor principal' },
 { key: 'ink',         kind: 'color', css: '--tpl-ink',     default: '#0f172a', label: 'Texto' },
 { key: 'muted',       kind: 'color', css: '--tpl-muted',   default: '#64748b', label: 'Texto secundário' },
 { key: 'line',        kind: 'color', css: '--tpl-line',    default: '#e2e8f0', label: 'Bordas' },
 { key: 'bg',          kind: 'color', css: '--tpl-bg',      default: '#f8fafc', label: 'Fundo da página' },
 { key: 'surface',     kind: 'color', css: '--tpl-surface', default: '#ffffff', label: 'Fundo do cartão' },
 { key: 'danger',      kind: 'color', css: '--tpl-danger',  default: '#b91c1c', label: 'Erro' },
 { key: 'radius',      kind: 'int',   css: '--tpl-radius',  default: 12,  min: 0, max: 24,  unit: 'px', label: 'Arredondamento' },
 { key: 'border_width',kind: 'int',   css: '--tpl-border',  default: 1,   min: 0, max: 3,   unit: 'px', label: 'Espessura da borda' },
 { key: 'scale',       kind: 'int',   css: '--tpl-scale',   default: 100, min: 85, max: 125, unit: '%', label: 'Escala do texto' },
 { key: 'shadow',      kind: 'enum',  css: '--tpl-shadow',  default: 'soft',    options: SHADOWS,    label: 'Sombra' },
 { key: 'density',     kind: 'enum',  css: '--tpl-density', default: 'regular', options: DENSITIES,  label: 'Respiro' },
 { key: 'width',       kind: 'enum',  css: '--tpl-width',   default: 420,       options: WIDTHS,     label: 'Largura do cartão' },
 { key: 'font_family', kind: 'font',  css: '--tpl-font',         default: 'system', label: 'Fonte do corpo' },
 { key: 'font_display',kind: 'font',  css: '--tpl-font-display', default: 'system', label: 'Fonte dos títulos' },
 { key: 'logo_url',    kind: 'url',   default: '', max: 500, label: 'Logo (URL https)' },
];

// Cada campo aqui substitui um literal que hoje está dentro de checkout.js.
//
// `pending: true` marca o que a página AINDA NÃO RENDERIZA — os textos de Pix,
// boleto, cupom e parcelamento, que só ganham tela nas etapas 4 a 6. O editor os
// agrupa à parte e diz isso. Campo que finge funcionar é o defeito central da
// implementação de referência: lá seis opções eram gravadas, devolvidas pela API
// e nunca lidas por nada, e ninguém percebia.
export const COPY_FIELDS = [
 { key: 'headline',            max: 120, default: '', label: 'Título' },
 { key: 'subheadline',         max: 200, default: '', label: 'Subtítulo' },
 { key: 'cta_label',           max: 60,  default: 'Pagar com cartão', label: 'Botão de pagar' },
 { key: 'cta_label_processing',max: 60,  default: 'Abrindo pagamento…', label: 'Botão enquanto processa' },
 // Cita a Stripe porque hoje só existe Stripe. Quando o Asaas entrar (etapa 6),
 // o padrão passa a depender do provedor da oferta — não do template.
 { key: 'security_note',       max: 400, default: 'Pagamento processado pela Stripe. A confirmação chega por e-mail assim que aprovada.', label: 'Nota de rodapé' },
 { key: 'guarantee',           max: 400, default: '', label: 'Garantia' },
 { key: 'success_title',       max: 120, default: 'Recebemos seu pagamento', label: 'Sucesso — título' },
 { key: 'success_body',        max: 400, default: 'A confirmação chega em instantes por e-mail.', label: 'Sucesso — texto' },
 { key: 'cancel_title',        max: 120, default: 'Pagamento cancelado', label: 'Cancelado — título' },
 { key: 'cancel_body',         max: 400, default: 'Nenhuma cobrança foi feita. Você pode tentar novamente.', label: 'Cancelado — texto' },
 { key: 'error_generic',       max: 200, default: 'Não foi possível continuar.', label: 'Erro genérico' },
 { key: 'invalid_link',        max: 200, default: 'Link de pagamento inválido.', label: 'Link inválido' },
 { key: 'coupon_toggle',       max: 60,  default: 'Tenho um cupom', pending: true, label: 'Cupom — link' },
 { key: 'coupon_placeholder',  max: 60,  default: 'Código do cupom', pending: true, label: 'Cupom — campo' },
 { key: 'coupon_applied',      max: 120, default: 'Cupom aplicado.', pending: true, label: 'Cupom — aplicado' },
 // Mesma mensagem para inexistente, expirado e esgotado, de propósito: três
 // respostas distintas transformariam o endpoint em oráculo de enumeração.
 { key: 'coupon_invalid',      max: 120, default: 'Cupom inválido.', pending: true, label: 'Cupom — recusado' },
 { key: 'installments_label',  max: 60,  default: 'Parcelamento', pending: true, label: 'Parcelamento — rótulo' },
 { key: 'method_label',        max: 60,  default: 'Forma de pagamento', pending: true, label: 'Forma de pagamento — rótulo' },
 { key: 'pix_title',           max: 120, default: 'Pague com Pix', pending: true, label: 'Pix — título' },
 { key: 'pix_instructions',    max: 400, default: 'Abra o app do seu banco, escolha Pix e leia o QR Code. A confirmação é imediata.', pending: true, label: 'Pix — instruções' },
 { key: 'pix_copy_label',      max: 60,  default: 'Copiar código Pix', pending: true, label: 'Pix — botão copiar' },
 { key: 'pix_waiting',         max: 200, default: 'Aguardando o pagamento…', pending: true, label: 'Pix — aguardando' },
 { key: 'boleto_title',        max: 120, default: 'Boleto gerado', pending: true, label: 'Boleto — título' },
 // Diz a verdade sobre o prazo. Esconder isso gera suporte, não conversão.
 { key: 'boleto_instructions', max: 400, default: 'Pague em qualquer banco ou app. A compensação leva até 3 dias úteis.', pending: true, label: 'Boleto — instruções' },
 { key: 'boleto_copy_label',   max: 60,  default: 'Copiar linha digitável', pending: true, label: 'Boleto — botão copiar' },
];

// Camadas: o vocabulário compartilhado entre a página pública e o editor.
//
// O layout é FIXO — estas não são peças que se adiciona ou remove, são as partes
// que a página sempre tem. A camada existe para dar nome ao objetivo de cada
// pedaço e ligar "cliquei nisto na prévia" a "estes campos controlam isto".
//
// `id` é o contrato: checkout.js marca cada elemento com data-layer="<id>" e o
// editor casa por esse id. Um teste garante que as duas listas não divergem.
export const LAYERS = [
 { id: 'brand',    label: 'Marca',            purpose: 'Logo do produto no topo do cartão.',                    copy: [],                                   theme: ['logo_url'] },
 { id: 'headline', label: 'Chamada',          purpose: 'Título e subtítulo. Vazios, não aparecem.',             copy: ['headline', 'subheadline'],          theme: ['font_display', 'ink'] },
 { id: 'offer',    label: 'Oferta',           purpose: 'Nome da oferta e do produto. Vêm do cadastro, não se editam aqui.', copy: [],                theme: ['font_display', 'muted'] },
 { id: 'price',    label: 'Preço',            purpose: 'Valor e periodicidade. Vêm da oferta — nunca do template.',        copy: [],                theme: ['font_display', 'ink', 'scale'] },
 { id: 'payment',  label: 'Área de pagamento',purpose: 'Onde o pagamento acontece. Não pode ser removida.',      copy: [],                                   theme: ['color', 'radius', 'line'] },
 { id: 'cta',      label: 'Botão de pagar',   purpose: 'A ação principal. A tinta é calculada a partir da cor.', copy: ['cta_label', 'cta_label_processing'],theme: ['color', 'radius', 'font_family'] },
 { id: 'guarantee',label: 'Garantia',         purpose: 'Reforço de confiança acima do rodapé. Vazio, não aparece.', copy: ['guarantee'],                     theme: ['muted'] },
 { id: 'note',     label: 'Nota de rodapé',   purpose: 'Quem processa o pagamento e o que acontece depois.',     copy: ['security_note'],                    theme: ['muted', 'scale'] },
];

// Teto interno, metade do limite de transporte de platform/http.mjs. Existe para
// o erro útil chegar primeiro: json() lê o corpo ANTES do handler, então um
// payload gordo dá 413 genérico sem dizer qual campo estourou.
export const PAYLOAD_LIMIT = 8192;

const TOKEN = new Map(THEME_TOKENS.map(t => [t.key, t]));
const COPY = new Map(COPY_FIELDS.map(f => [f.key, f]));
const color = value => {
 if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw fail(400, 'Cor inválida. Use #rrggbb.');
 return value.toLowerCase();
};

export const isFont = id => FONTS.some(f => f.id === id);
export const fontStack = id => (FONTS.find(f => f.id === id) ?? FONTS[0]).stack;

// Luminância relativa (WCAG). A tinta sobre a cor principal é CALCULADA, nunca
// escolhida: é o que impede alguém publicar branco sobre amarelo e só descobrir
// quando o comprador não achar o botão.
export function contrastInk(hex) {
 const channel = n => { const c = n / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
 const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
 const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
 return (luminance + 0.05) / 0.05 > 4.5 ? '#111827' : '#ffffff';
}

export const defaultTheme = () => Object.fromEntries(THEME_TOKENS.map(t => [t.key, t.default]));

// Só o que o operador escreveu. O merge com os padrões acontece na leitura, para
// que mudar um padrão alcance quem nunca editou aquele campo.
export function validateTheme(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Tema inválido.');
 input(value, THEME_TOKENS.map(t => t.key));
 const theme = {};
 for (const [key, raw] of Object.entries(value)) {
  const token = TOKEN.get(key);
  if (token.kind === 'color') theme[key] = color(raw);
  else if (token.kind === 'int') {
   if (!Number.isInteger(raw) || raw < token.min || raw > token.max) throw fail(400, `Valor fora do intervalo em ${key}.`);
   theme[key] = raw;
  } else if (token.kind === 'enum') {
   if (!token.options.includes(raw)) throw fail(400, `Opção inválida em ${key}.`);
   theme[key] = raw;
  } else if (token.kind === 'font') {
   if (!isFont(raw)) throw fail(400, 'Fonte indisponível.');
   theme[key] = raw;
  } else {
   const url = raw === '' || raw == null ? '' : text(raw, 1, token.max);
   if (url && !url.startsWith('https://')) throw fail(400, 'Use uma URL https.');
   theme[key] = url;
  }
 }
 return theme;
}

export function validateCopy(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(400, 'Textos inválidos.');
 input(value, COPY_FIELDS.map(f => f.key));
 const copy = {};
 // Vazio é apagar a personalização e voltar ao padrão, não gravar string vazia.
 for (const [key, raw] of Object.entries(value)) if (raw !== '' && raw != null) copy[key] = text(raw, 1, COPY.get(key).max);
 return copy;
}

export const mergeTheme = theme => ({ ...defaultTheme(), ...(theme ?? {}) });
export const mergeCopy = copy => Object.fromEntries(COPY_FIELDS.map(f => [f.key, copy?.[f.key] ?? f.default]));

export function validateMethods(value) {
 if (!Array.isArray(value) || !value.length || value.length > METHODS.length) throw fail(400, 'Escolha ao menos uma forma de pagamento.');
 if (value.some(m => !METHODS.includes(m)) || new Set(value).size !== value.length) throw fail(400, 'Forma de pagamento inválida.');
 return value;
}

// Chamado depois de montar o payload inteiro, não campo a campo: o que importa
// é o tamanho do que vai para o jsonb.
export function assertPayloadSize(payload) {
 const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
 if (bytes > PAYLOAD_LIMIT) throw fail(400, `Configuração muito longa (${bytes} bytes; máximo ${PAYLOAD_LIMIT}). Encurte os textos.`);
 return bytes;
}

// Descritor que o editor consome para desenhar os campos sozinho.
export const editorSchema = () => ({
 theme_tokens: THEME_TOKENS,
 copy_fields: COPY_FIELDS,
 layers: LAYERS,
 fonts: FONTS,
 methods: METHODS,
 payload_limit: PAYLOAD_LIMIT,
 defaults: { theme: defaultTheme(), copy: Object.fromEntries(COPY_FIELDS.map(f => [f.key, f.default])) },
});
