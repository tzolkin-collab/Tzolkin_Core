// Responsável da atividade contra o PostgreSQL de verdade: o SQL que os testes unitários só enxergam como texto.
//
// O que isto prova que o teste unitário não prova: o LEFT JOIN do lembrete, a busca do aparelho por e-mail (e pelo
// subject da sessão) e a restrição da coluna existem e funcionam no Postgres. Um erro de digitação neles só apareceria
// no primeiro lembrete real.
//
// SÓ roda em banco descartável (npm test / scripts/test-commercial.mjs): testConnectionString() cai em DATABASE_URL, que é
// a produção, e este teste cria e apaga linhas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { testConnectionString } from '../apps/api/src/platform/database.mjs';
import { enviarLembretes } from '../apps/api/src/modules/agenda-jobs.mjs';
import { criarDetector, criarDetectorResponsavel } from '../apps/api/src/platform/agenda-recursos.mjs';

const DESCARTAVEL = /\/tzolkin_test_/.test(String(process.env.DATABASE_URL_TEST ?? ''));
const chave = n => randomBytes(n).toString('base64url');

test('Responsável: o lembrete vai só aos aparelhos dele; sem responsável, a quem assinou o tópico', { skip: DESCARTAVEL ? false : 'só roda em banco descartável (DATABASE_URL_TEST tzolkin_test_*)' }, async () => {
 const pool = new pg.Pool({ connectionString: testConnectionString().connectionString, max: 2 });
 const marca = randomUUID().slice(0, 8);
 const ids = { tenant: randomUUID(), ana: randomUUID(), bia: randomUUID(), comDono: randomUUID(), semDono: randomUUID(), suspensa: randomUUID(), contaSuspensa: randomUUID() };
 const inicio = new Date(Date.now() + 15 * 60000 - 30000);   // daqui a 14min30: o aviso de 15 min venceu há 30 segundos
 try {
  await pool.query('INSERT INTO tenants(id,name,slug) VALUES($1,$2,$3)', [ids.tenant, `Empresa ${marca}`, `empresa-${marca}`]);
  await pool.query("INSERT INTO operator_accounts(id,email,name,role,status) VALUES($1,$2,'Ana','member','active'),($3,$4,'Bia','owner','active'),($5,$6,'Sue','member','suspended')",
   [ids.ana, `ana-${marca}@tzolkin.test`, ids.bia, `bia-${marca}@tzolkin.test`, ids.contaSuspensa, `sue-${marca}@tzolkin.test`]);
  const aparelho = (email, sufixo) => pool.query(
   `INSERT INTO push_subscriptions(operator_subject,operator_email,endpoint,p256dh,auth,topics) VALUES($1,$2,$3,$4,$5,ARRAY['agenda.lembrete'])`,
   [`sub-${sufixo}-${marca}`, email, `https://push.test/${sufixo}-${marca}`, chave(65).slice(0, 87), chave(16).slice(0, 22)]);
  await aparelho(`ana-${marca}@tzolkin.test`, 'ana');
  await aparelho(`bia-${marca}@tzolkin.test`, 'bia');
  const atividade = (id, responsavel, titulo) => pool.query(
   `INSERT INTO service_activities(id,tenant_id,category,kind,title,starts_at,ends_at,status,reminders,responsible_id)
    VALUES($1,$2,'mentoria','sessao',$3,$4,$5,'planned',ARRAY[15],$6)`, [id, ids.tenant, titulo, inicio.toISOString(), new Date(inicio.getTime() + 3600000).toISOString(), responsavel]);
  await atividade(ids.comDono, ids.ana, `Com dono ${marca}`);
  await atividade(ids.semDono, null, `Sem dono ${marca}`);
  await atividade(ids.suspensa, ids.contaSuspensa, `Dono suspenso ${marca}`);

  const enviadosPara = [];
  const r = await enviarLembretes(pool, {
   enviar: async assinatura => { enviadosPara.push(assinatura.endpoint); },
   detector: criarDetector(), responsavel: criarDetectorResponsavel(), agora: () => Date.now(),
   janelaMin: 20,
  });
  const meus = enviadosPara.filter(e => e.endsWith(marca));
  assert.equal(r.falhas, 0, 'nenhum lembrete falhou: o SQL do JOIN e da busca por e-mail é válido');
  // Com dono: só a Ana. Sem dono: quem assinou o tópico (Ana e Bia). Dono suspenso: cai no comportamento de sem dono.
  const contar = alvo => meus.filter(e => e.includes(alvo)).length;
  assert.equal(contar('/ana-'), 3, 'Ana recebe o dela, o sem dono e o de dono suspenso');
  assert.equal(contar('/bia-'), 2, 'Bia NÃO recebe o da Ana: só os dois que ninguém "possui"');
  assert.equal(meus.length, 5);

  // A coluna existe, é uma chave estrangeira para a conta e aceita NULL.
  await assert.rejects(pool.query('UPDATE service_activities SET responsible_id=$2 WHERE id=$1', [ids.semDono, randomUUID()]), e => e.code === '23503', 'conta inexistente: o banco recusa');
  await pool.query('UPDATE service_activities SET responsible_id=NULL WHERE id=$1', [ids.comDono]);

  // O segundo caminho do aparelho: sem e-mail gravado, o subject da sessão da mesma pessoa serve.
  const { notificarPessoa } = await import('../apps/api/src/modules/push.mjs');
  await pool.query("UPDATE push_subscriptions SET operator_email=NULL WHERE operator_subject=$1", [`sub-bia-${marca}`]);
  await pool.query('INSERT INTO operator_sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval \'1 hour\')', [randomBytes(32).toString('hex'), `sub-bia-${marca}`, `bia-${marca}@tzolkin.test`]);
  const alcancados = [];
  await notificarPessoa(pool, 'agenda.lembrete', `BIA-${marca}@tzolkin.test`, { title: 't' }, async a => { alcancados.push(a.endpoint); });
  assert.deepEqual(alcancados, [`https://push.test/bia-${marca}`], 'achou o aparelho pelo subject da sessão, sem diferenciar maiúscula');
 } finally {
  await pool.query('DELETE FROM agenda_reminders_sent WHERE activity_id = ANY($1::uuid[])', [[ids.comDono, ids.semDono, ids.suspensa]]).catch(() => {});
  await pool.query('DELETE FROM service_activities WHERE tenant_id=$1', [ids.tenant]).catch(() => {});
  await pool.query('DELETE FROM operator_sessions WHERE subject LIKE $1', [`%${marca}`]).catch(() => {});
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint LIKE $1', [`%${marca}`]).catch(() => {});
  await pool.query('DELETE FROM operator_accounts WHERE email LIKE $1', [`%-${marca}@tzolkin.test`]).catch(() => {});
  await pool.query('DELETE FROM tenants WHERE id=$1', [ids.tenant]).catch(() => {});
  await pool.end();
 }
});
