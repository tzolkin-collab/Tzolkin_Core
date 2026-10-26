// Confere e, se pedido, aponta o webhook da instância da Evolution para o Core (E7 do WhatsApp).
//
// Sem argumentos NÃO ALTERA NADA: mostra se a instância está conectada e para onde o webhook dela aponta hoje.
// Com --aplicar, grava o webhook (evento MESSAGES_UPSERT, cabeçalho x-webhook-secret) na instância, no corpo plano da Evolution 2.3.7.
// Chave e segredo nunca saem na tela. A Evolution não devolve o valor do cabeçalho, só dá para conferir que ele existe.
//
// Uso:
//   node --env-file=.env scripts/whatsapp-webhook.mjs
//   node --env-file=.env scripts/whatsapp-webhook.mjs --aplicar [--url https://core.tzolkin.cloud/api/webhooks/evolution] [--instancia nome]
// Precisa de EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY e, para --aplicar, EVOLUTION_WEBHOOK_SECRET.
// Saída: 0 tudo certo · 2 falta variável ou o webhook não está como deveria · 1 a Evolution não respondeu.
import { createEvolutionAdapter } from '../apps/api/src/integrations/evolution.mjs';

const PADRAO = 'https://core.tzolkin.cloud/api/webhooks/evolution';
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const valorDe = nome => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
const alvo = valorDe('--url') ?? PADRAO;
const instancia = valorDe('--instancia');
const segredo = String(process.env.EVOLUTION_WEBHOOK_SECRET ?? '').trim();

const adaptador = createEvolutionAdapter({ env: process.env, ...(instancia ? { instance: instancia } : {}) });
if (!adaptador.configured) { console.error('Faltam ou estão inválidas: EVOLUTION_URL (https), EVOLUTION_INSTANCE, EVOLUTION_API_KEY.'); process.exit(2); }
if (aplicar && segredo.length < 24) { console.error('EVOLUTION_WEBHOOK_SECRET ausente ou curto: use pelo menos 24 caracteres aleatórios.'); process.exit(2); }

const falhou = (o, o2) => { console.error(`${o} (${o2.reason}${o2.status ? ` ${o2.status}` : ''}${o2.message ? `: ${o2.message}` : ''})`); process.exit(o2.reason === 'unavailable' ? 1 : 2); };

const estado = await adaptador.connectionState();
if (!estado.ok) falhou(`Instância ${adaptador.instance}: a Evolution não respondeu como esperado`, estado);
console.log(`Instância ${adaptador.instance}: estado "${estado.state}"`);
if (!estado.connected) console.log('  ⚠ não está conectada (open): pareie o número antes de ligar o envio.');

if (aplicar) {
 const r = await adaptador.setWebhook({ url: alvo, events: ['MESSAGES_UPSERT'], headers: { 'x-webhook-secret': segredo } });
 if (!r.ok) falhou('A Evolution recusou o webhook', r);
 console.log(`Webhook gravado → ${alvo}`);
}

const atual = await adaptador.getWebhook();
if (!atual.ok) falhou('Não consegui ler o webhook', atual);
const w = atual.webhook;
console.log(`Webhook hoje: ${!w ? 'não configurado' : w.enabled ? 'ligado' : 'DESLIGADO'}`);
console.log(`  url: ${w?.url ?? '—'}`);
console.log(`  eventos: ${w?.events?.length ? w.events.join(', ') : '—'}`);
const temSegredo = w?.headerNames?.some(n => n.toLowerCase() === 'x-webhook-secret');
console.log(`  cabeçalho x-webhook-secret: ${temSegredo ? 'presente (valor não exibido)' : 'NÃO CONFIRMADO (a Evolution pode não devolver os cabeçalhos; teste mandando uma mensagem)'}`);
const certo = Boolean(w?.enabled) && w.url === alvo && w.events.includes('MESSAGES_UPSERT');
console.log(certo ? '✔ Webhook aponta para o Core.' : '✖ Webhook fora do esperado. Rode com --aplicar.');
process.exit(certo ? 0 : 2);
