import { fail, onlyParams } from '../platform/http.mjs';
import { createEvolutionAdapter } from '../integrations/evolution.mjs';
import { envioLigado } from './whatsapp-fila.mjs';
import { vivo } from '../platform/env-vivo.mjs';

// Saúde e resultado básico de cada instância da Evolution, para a primeira aba da tela "WhatsApp" (F2 do desenho, ver
// docs/WHATSAPP-FLUXOS-DESENHO.md, seções 5 e 5A). Só leitura: nada aqui envia, grava ou altera a Evolution.
//
// SAÚDE: a instância está conectada? O webhook dela aponta para ESTE Core? Quando chegou a última mensagem? Há fila parada?
// RESULTADO (período, 7 dias por padrão): quantas pessoas escreveram e quanto tempo levamos para responder.
//
// "Espera" = uma mensagem do lead que abre uma espera por resposta nossa: ela chega sem nada nosso antes (conversa nova) ou logo depois
// de uma mensagem nossa. Várias mensagens seguidas do lead contam como UMA espera. Ela é respondida quando sai a primeira mensagem
// nossa depois dela; o tempo é desse intervalo. Mensagem enviada pelo celular (fora do Core) ainda não entra: é o evento da F3.

const DIAS_PADRAO = 7, DIAS_MAXIMO = 90;
const ENDERECO_DO_WEBHOOK = '/api/webhooks/evolution';
const MAX_INSTANCIAS = 30;

/** Para onde o webhook de uma instância aponta, em relação a ESTE Core. Função pura. `origem` é a URL pública do Core (ou null). */
export function classificarWebhook(leitura, origem) {
 if (!leitura?.ok) return { estado: 'erro', motivo: leitura?.reason ?? 'desconhecido' };
 const w = leitura.webhook;
 if (!w) return { estado: 'sem' };
 let destino = null; try { destino = new URL(w.url); } catch { /* url ilegível na Evolution */ }
 const host = destino?.host ?? null;
 if (!w.enabled) return { estado: 'desligado', host };
 // Sem a URL pública do Core configurada (ambiente local), só o caminho prova que é o webhook do Core.
 const doCore = Boolean(destino && (!origem || destino.host === origem.host) && destino.pathname.replace(/\/+$/, '') === ENDERECO_DO_WEBHOOK);
 if (!doCore) return { estado: 'outro', host };
 const recebeMensagem = w.events.includes('MESSAGES_UPSERT');
 return { estado: recebeMensagem ? 'core' : 'core_sem_evento', host, segredo: w.headerNames.some(n => n.toLowerCase() === 'x-webhook-secret') };
}

const numero = v => (v == null ? null : Number(v));
const iso = v => (v ? new Date(v).toISOString() : null);

/**
 * Junta o que a Evolution disse com o que o banco sabe. Função pura: `linhas` traz as três consultas já lidas, por nome de instância.
 * `resultado` é null quando o banco ainda não tem as tabelas (sem a migração 062/063).
 */
export function montarInstancia({ instancia, webhook, atividade, caixa, fila, agora, dias }) {
 const esperas = numero(atividade?.esperas) ?? 0, respondidas = numero(atividade?.respondidas) ?? 0;
 const ultima = caixa?.ultima ? new Date(caixa.ultima) : null;
 const maisAntiga = fila?.mais_antiga ? new Date(fila.mais_antiga) : null;
 return {
  nome: instancia.name,
  estado: instancia.state,
  conectada: instancia.state === 'open',
  numero: instancia.number ?? null,
  perfil: instancia.profile ?? null,
  webhook,
  ultima_mensagem_recebida: iso(ultima),
  fila: { na_fila: numero(fila?.na_fila) ?? 0, mais_antiga_min: maisAntiga ? Math.max(0, Math.round((agora - maisAntiga.getTime()) / 60000)) : null, falhas: numero(fila?.falhas) ?? 0, enviadas: numero(fila?.enviadas) ?? 0 },
  resultado: {
   periodo_dias: dias,
   pessoas_que_escreveram: numero(caixa?.conversas) ?? 0,
   mensagens_recebidas: numero(caixa?.recebidas) ?? 0,
   esperas,
   respondidas,
   sem_resposta: numero(atividade?.sem_resposta) ?? 0,
   mediana_min: atividade?.mediana_min == null ? null : Number(atividade.mediana_min),
   respondidas_em_1h: numero(atividade?.em_1h) ?? 0,
   taxa_resposta: esperas ? Math.round((respondidas / esperas) * 100) : null,
  },
 };
}

const porInstancia = linhas => new Map((linhas ?? []).map(l => [l.inst, l]));

export function whatsappSaudeRoutes(router, { env = vivo.env, clock = Date.now, criarAdaptador = createEvolutionAdapter } = {}) {
 const padrao = () => String(env.EVOLUTION_INSTANCE ?? '').trim();
 const origemDoCore = () => { try { return new URL(String(env.PUBLIC_ORIGIN || env.WEB_ORIGIN || '')); } catch { return null; } };

 router.get('/api/whatsapp/saude', async ({ pool, url, reply }) => {
  onlyParams(url.searchParams, ['dias']);
  const bruto = url.searchParams.get('dias');
  const dias = bruto == null || bruto === '' ? DIAS_PADRAO : Number(bruto);
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMO) throw fail(400, `Informe de 1 a ${DIAS_MAXIMO} dias.`);

  const adaptador = criarAdaptador({ env });
  const envio = envioLigado(env);
  if (!adaptador.configured) return reply(200, { configurada: false, envio_ligado: envio, periodo_dias: dias, instancias: [] });

  // Com a chave global a Evolution lista todas as instâncias; com a de uma só, cai para a padrão (o que o Core sempre usou).
  let todas = true, instancias;
  const lista = await adaptador.listInstances();
  if (lista.ok && lista.instances.length) instancias = lista.instances.slice(0, MAX_INSTANCIAS);
  else {
   todas = false;
   const estado = await adaptador.connectionState();
   instancias = [{ name: padrao(), state: estado.ok ? estado.state : 'close', number: null, profile: null }];
  }

  const origem = origemDoCore();
  const webhooks = new Map(await Promise.all(instancias.map(async i => [i.name, classificarWebhook(await criarAdaptador({ env, instance: i.name }).getWebhook(), origem)])));

  const desde = new Date(clock() - dias * 86400000).toISOString();
  const nomePadrao = padrao();
  let atividade = new Map(), caixa = new Map(), fila = new Map(), aviso = null, banco = true;
  try {
   atividade = porInstancia((await pool.query(
    `WITH msgs AS (
       SELECT coalesce(instance, $1) AS inst, from_number AS n, received_at AS t, 'in' AS d FROM whatsapp_inbox WHERE received_at >= $2::timestamptz - interval '30 days'
       UNION ALL
       SELECT coalesce(instance, $1), to_number, sent_at, 'out' FROM whatsapp_outbox WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at >= $2::timestamptz - interval '30 days'
     ), ord AS (
       SELECT inst, n, t, d, lag(d) OVER (PARTITION BY inst, n ORDER BY t) AS ant FROM msgs
     ), esperas AS (
       SELECT inst, n, t FROM ord WHERE d = 'in' AND (ant IS NULL OR ant = 'out') AND t >= $2::timestamptz
     ), resp AS (
       SELECT e.inst, e.t, (SELECT min(m.t) FROM msgs m WHERE m.inst = e.inst AND m.n = e.n AND m.d = 'out' AND m.t > e.t) AS r FROM esperas e
     )
     SELECT inst, count(*)::int AS esperas, count(r)::int AS respondidas, (count(*) FILTER (WHERE r IS NULL))::int AS sem_resposta,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (r - t)) / 60) FILTER (WHERE r IS NOT NULL))::numeric, 1) AS mediana_min,
            (count(*) FILTER (WHERE r IS NOT NULL AND r - t <= interval '1 hour'))::int AS em_1h
       FROM resp GROUP BY inst`, [nomePadrao, desde])).rows);
   caixa = porInstancia((await pool.query(
    `SELECT coalesce(instance, $1) AS inst, (count(*) FILTER (WHERE received_at >= $2::timestamptz))::int AS recebidas,
            (count(DISTINCT from_number) FILTER (WHERE received_at >= $2::timestamptz))::int AS conversas, max(received_at) AS ultima
       FROM whatsapp_inbox GROUP BY 1`, [nomePadrao, desde])).rows);
   fila = porInstancia((await pool.query(
    `SELECT coalesce(instance, $1) AS inst, (count(*) FILTER (WHERE status = 'queued'))::int AS na_fila,
            (count(*) FILTER (WHERE status = 'failed' AND created_at >= $2::timestamptz))::int AS falhas,
            (count(*) FILTER (WHERE status = 'sent' AND sent_at >= $2::timestamptz))::int AS enviadas,
            min(created_at) FILTER (WHERE status = 'queued') AS mais_antiga
       FROM whatsapp_outbox GROUP BY 1`, [nomePadrao, desde])).rows);
  } catch (e) {
   if (e?.code !== '42P01' && e?.code !== '42703') throw e;
   banco = false;
   aviso = 'Os números de conversa ainda não estão disponíveis neste banco: falta aplicar as migrações 062, 063 e 064.';
  }

  const agora = clock();
  reply(200, {
   configurada: true, todas, envio_ligado: envio, periodo_dias: dias, banco_disponivel: banco, ...(aviso ? { aviso } : {}),
   webhook_esperado: origem ? `${origem.host}${ENDERECO_DO_WEBHOOK}` : null,
   instancias: instancias.map(i => montarInstancia({ instancia: i, webhook: webhooks.get(i.name), atividade: atividade.get(i.name), caixa: caixa.get(i.name), fila: fila.get(i.name), agora, dias })),
  });
 }, { body: false });
}
