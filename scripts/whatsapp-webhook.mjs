// Confere e, se pedido, aponta o webhook da instância da Evolution para o Core (E7 do WhatsApp).
//
// Sem argumentos NÃO ALTERA NADA: mostra se a instância está conectada e para onde o webhook dela aponta hoje.
// Com --aplicar, grava o webhook (evento MESSAGES_UPSERT, cabeçalho x-webhook-secret) na instância.
// Chave e segredo nunca saem na tela.
//
// Uso:
//   node --env-file=.env scripts/whatsapp-webhook.mjs
//   node --env-file=.env scripts/whatsapp-webhook.mjs --aplicar [--url https://core.tzolkin.cloud/api/webhooks/evolution]
// Precisa de EVOLUTION_URL, EVOLUTION_INSTANCE, EVOLUTION_API_KEY e, para --aplicar, EVOLUTION_WEBHOOK_SECRET.
// Saída: 0 tudo certo · 2 falta variável ou o webhook não está como deveria · 1 a Evolution não respondeu.

const PADRAO = 'https://core.tzolkin.cloud/api/webhooks/evolution';
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const iUrl = args.indexOf('--url');
const alvo = iUrl >= 0 ? args[iUrl + 1] : PADRAO;

const base = String(process.env.EVOLUTION_URL ?? '').trim().replace(/\/+$/, '');
const instancia = String(process.env.EVOLUTION_INSTANCE ?? '').trim();
const chave = String(process.env.EVOLUTION_API_KEY ?? '').trim();
const segredo = String(process.env.EVOLUTION_WEBHOOK_SECRET ?? '').trim();

const faltam = [['EVOLUTION_URL', base], ['EVOLUTION_INSTANCE', instancia], ['EVOLUTION_API_KEY', chave], ...(aplicar ? [['EVOLUTION_WEBHOOK_SECRET', segredo]] : [])].filter(([, v]) => !v).map(([n]) => n);
if (faltam.length) { console.error(`Faltam variáveis: ${faltam.join(', ')}`); process.exit(2); }
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) { console.error('EVOLUTION_URL precisa ser https.'); process.exit(2); }
if (!/^https:\/\/[^\s?#]+$/.test(alvo ?? '')) { console.error('A URL do webhook precisa ser https e sem parâmetros.'); process.exit(2); }
if (aplicar && segredo.length < 24) { console.error('EVOLUTION_WEBHOOK_SECRET é curto demais: use pelo menos 24 caracteres aleatórios.'); process.exit(2); }

const chamar = async (metodo, caminho, corpo) => {
 const r = await fetch(`${base}${caminho}`, { method: metodo, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { apikey: chave, accept: 'application/json', ...(corpo ? { 'content-type': 'application/json' } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
 let json = null; try { json = await r.json(); } catch { /* sem corpo */ }
 return { ok: r.ok, status: r.status, json };
};

try {
 const nome = encodeURIComponent(instancia);
 const estado = await chamar('GET', `/instance/connectionState/${nome}`);
 const conexao = estado.json?.instance?.state ?? estado.json?.state ?? null;
 console.log(`Instância ${instancia}: ${estado.ok ? `estado "${conexao}"` : `a Evolution respondeu ${estado.status}`}`);
 if (!estado.ok) process.exit(estado.status === 404 || estado.status === 401 || estado.status === 403 ? 2 : 1);
 if (conexao !== 'open') console.log('  ⚠ não está conectada (open): pareie o número antes de ligar o envio.');

 if (aplicar) {
  const r = await chamar('POST', `/webhook/set/${nome}`, { webhook: { enabled: true, url: alvo, headers: { 'x-webhook-secret': segredo }, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } });
  console.log(r.ok ? `Webhook gravado → ${alvo}` : `A Evolution recusou o webhook (${r.status}).`);
  if (!r.ok) process.exit(1);
 }

 const atual = await chamar('GET', `/webhook/find/${nome}`);
 const w = atual.json?.webhook ?? atual.json ?? {};
 const url = w.url ?? null, eventos = w.events ?? [], temSegredo = Boolean(w.headers?.['x-webhook-secret'] ?? w.headers?.['X-Webhook-Secret']);
 console.log(`Webhook hoje: ${w.enabled === false ? 'DESLIGADO' : url ? 'ligado' : 'não configurado'}`);
 console.log(`  url: ${url ?? '—'}`);
 console.log(`  eventos: ${eventos.length ? eventos.join(', ') : '—'}`);
 console.log(`  cabeçalho x-webhook-secret: ${temSegredo ? 'presente (valor não exibido)' : 'AUSENTE'}`);
 const certo = w.enabled !== false && url === alvo && eventos.includes('MESSAGES_UPSERT') && temSegredo;
 console.log(certo ? '✔ Webhook como deveria.' : '✖ Webhook fora do esperado. Rode com --aplicar.');
 process.exit(certo ? 0 : 2);
} catch (e) {
 console.error('A Evolution não respondeu:', e?.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede');
 process.exit(1);
}
