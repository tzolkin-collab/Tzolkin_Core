// Confere, SOMENTE LENDO, se a Evolution do servidor responde no formato que o adaptador espera (F1 do WhatsApp).
//
// Existe porque a documentação oficial deixa campos em aberto (campos de um chat, corpo de `findMessages`, o que `webhook/find` devolve)
// e o adaptador não deve adivinhar. Nada é enviado, criado, apagado ou alterado.
//
// O que NÃO sai na tela: chave, números de telefone, nomes e texto de mensagem. Saem só nomes de campos, contagens e estados.
// Uso:  node --env-file=.env scripts/evolution-smoke.mjs [--instancia nome]
// Saída: 0 tudo no formato esperado · 2 há diferença ou falta configuração · 1 a Evolution não respondeu.
import { createEvolutionAdapter } from '../apps/api/src/integrations/evolution.mjs';

const i = process.argv.indexOf('--instancia');
const adaptador = createEvolutionAdapter({ env: process.env, ...(i >= 0 ? { instance: process.argv[i + 1] } : {}) });
if (!adaptador.configured) { console.error('Faltam ou estão inválidas: EVOLUTION_URL (https), EVOLUTION_INSTANCE, EVOLUTION_API_KEY.'); process.exit(2); }

let diferencas = 0, caiu = false;
const ver = (rotulo, ok, detalhe = '') => { console.log(`${ok ? 'OK   ' : 'DIFERE'} ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`); if (!ok) diferencas++; };
const motivo = r => `${r.reason}${r.status ? ` ${r.status}` : ''}${r.message ? `: ${r.message}` : ''}`;
const chaves = o => (o && typeof o === 'object' ? Object.keys(o).sort().join(', ') : '(vazio)');

const lista = await adaptador.listInstances();
if (lista.ok) {
 ver('fetchInstances (chave global): lista as instâncias', true, `${lista.instances.length} instância(s): ${lista.instances.map(x => `${x.name}=${x.state}`).join(', ')}`);
} else {
 if (lista.reason === 'unavailable') caiu = true;
 ver('fetchInstances (chave global)', false, `${motivo(lista)} (com a chave de uma instância só, a lista é recusada: normal)`);
}

const estado = await adaptador.connectionState();
ver(`connectionState da instância ${adaptador.instance}`, estado.ok, estado.ok ? `estado "${estado.state}"` : motivo(estado));
if (estado.reason === 'unavailable') caiu = true;

const w = await adaptador.getWebhook();
if (w.ok) ver('webhook/find', true, w.webhook ? `${w.webhook.enabled ? 'ligado' : 'desligado'}, eventos: ${w.webhook.events.join(', ') || '—'}, cabeçalhos devolvidos: ${w.webhook.headerNames.join(', ') || 'nenhum (a Evolution não devolve os cabeçalhos)'}` : 'sem webhook configurado');
else ver('webhook/find', false, motivo(w));

const chats = await adaptador.findChats({ take: 1 });
if (chats.ok) ver('chat/findChats', true, chats.chats.length ? `campos de um chat: ${chaves(chats.chats[0])}` : 'sem chats (nada a conferir)');
else ver('chat/findChats', false, motivo(chats));

const msgs = await adaptador.findMessages({ take: 1 });
if (msgs.ok) ver('chat/findMessages', true, `total ${msgs.total}, páginas ${msgs.pages}${msgs.messages.length ? `; campos de uma mensagem: ${chaves(msgs.messages[0].message)} / key: ${chaves(msgs.messages[0].key)}` : ''}`);
else ver('chat/findMessages', false, motivo(msgs));

const contatos = await adaptador.findContacts({ take: 1 });
if (contatos.ok) ver('chat/findContacts', true, `${contatos.contacts.length} contato(s) na amostra`);
else ver('chat/findContacts', false, motivo(contatos));

console.log(diferencas ? `\n${diferencas} ponto(s) diferem do esperado: leia a linha e ajuste o adaptador ou a doc.` : '\nTudo no formato esperado.');
process.exit(caiu ? 1 : diferencas ? 2 : 0);
