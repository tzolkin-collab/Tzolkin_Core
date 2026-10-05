import { fail, input, json } from '../platform/http.mjs';
import { readKey, seal } from '../platform/secrets.mjs';
import { PROVEDORES, campoDe, validarValores, testarProvedor } from '../platform/credenciais.mjs';
import { vivo as vivoPadrao } from '../platform/env-vivo.mjs';
import { gerarChavesVapid } from '../platform/webpush.mjs';

// Credenciais de integração pela TELA. O valor sai do navegador para o servidor, é testado no provedor, cifrado e gravado; nunca volta.
// A tela só recebe: o campo existe, de onde ele vale (tela ou servidor), e — só para campos que NÃO são segredo, como o endereço do
// painel — o valor. Admin interno, como o resto do Core (papel de administrador: decisão adiada, docs/CONFIGURACOES.md).
// Depende da migração 050; sem ela, a leitura mostra só o que vem do servidor e a escrita responde 409.

export const MENSAGEM_050 = 'Guardar credenciais pela tela ainda não está disponível neste banco: falta aplicar a migração 050.';
const MENSAGEM_CHAVE = 'Defina CORE_SECRETS_KEY no servidor para guardar credenciais pela tela.';

const ator = o => o?.email || o?.subject || 'desconhecido';

export function integrationsCredentialsRoutes(router, { vivo = vivoPadrao, env = process.env, fetchImpl = fetch } = {}) {
 const nomeDaChave = () => (String(env.CORE_SECRETS_KEY ?? '').trim() ? 'CORE_SECRETS_KEY' : 'META_MARKETING_KEY');
 const chave = () => { try { return readKey(env, nomeDaChave()); } catch { throw fail(503, MENSAGEM_CHAVE); } };
 const atuais = nome => { const v = vivo.env[nome]; return typeof v === 'string' ? v : ''; };

 router.get('/api/integrations/credentials', async ({ pool, reply }) => {
  let ativas = [], historico = [], migracao = true;
  try {
   ativas = (await pool.query('SELECT provider,nome,fingerprint,updated_by,created_at FROM integration_credentials WHERE revoked_at IS NULL')).rows;
   historico = (await pool.query('SELECT provider,nome,action,actor,created_at FROM integration_credentials_history ORDER BY created_at DESC, id DESC LIMIT 60')).rows;
  } catch (e) { if (e?.code === '42P01') migracao = false; else throw e; }
  const provedores = Object.entries(PROVEDORES).map(([id, def]) => ({
   id, nome: def.nome,
   campos: def.campos.map(c => {
    const origem = vivo.origem(c.nome), linha = ativas.find(a => a.nome === c.nome);
    return {
     nome: c.nome, rotulo: c.rotulo, secreto: c.secreto, obrigatorio: Boolean(c.obrigatorio), ajuda: c.ajuda ?? null,
     critico: Boolean(c.critico), ...(c.critico ? { aviso_troca: c.avisoTroca ?? null } : {}),
     origem,                                              // 'tela' | 'servidor' | null
     definido: origem !== null,
     // Só campo que não é segredo devolve o valor. Segredo: nem parte dele.
     ...(c.secreto ? {} : { valor: origem ? atuais(c.nome) : '' }),
     ...(origem === 'tela' && linha ? { impressao: linha.fingerprint, atualizado_por: linha.updated_by, atualizado_em: linha.created_at } : {}),
    };
   }),
   historico: historico.filter(h => h.provider === id).slice(0, 5).map(h => ({ nome: h.nome, acao: h.action, por: h.actor, em: h.created_at })),
  }));
  reply(200, { migracao, chave: vivo.temChave(), provedores });
 });

 router.post('/api/integrations/credentials/test', async ({ req, reply }) => {
  const b = await json(req); input(b, ['provider', 'valores']);
  const limpos = b.valores && Object.keys(b.valores).length ? validarValores(b.provider, b.valores, fail) : {};
  if (!PROVEDORES[b.provider]) throw fail(400, 'Provedor desconhecido.');
  reply(200, await testarProvedor(b.provider, limpos, atuais, fetchImpl));
 });


 /** Revoga o valor antigo de cada variável, insere o novo (cifrado) e registra no histórico, sem valor. */
 async function gravar(client, provedor, limpos, operator, k) {
  for (const [nome, valor] of Object.entries(limpos)) {
   const s = seal(valor, k);
   await client.query('UPDATE integration_credentials SET revoked_at=now() WHERE nome=$1 AND revoked_at IS NULL', [nome]);
   await client.query('INSERT INTO integration_credentials(provider,nome,token_ciphertext,token_iv,token_tag,fingerprint,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [provedor, nome, s.ciphertext, s.iv, s.tag, s.fingerprint, ator(operator)]);
   await client.query("INSERT INTO integration_credentials_history(provider,nome,action,fingerprint,actor) VALUES($1,$2,'set',$3,$4)", [provedor, nome, s.fingerprint, ator(operator)]);
  }
 }

 router.put('/api/integrations/credentials', async ({ client, body, operator }) => {
  input(body, ['provider', 'valores', 'confirmar']);
  const limpos = validarValores(body.provider, body.valores, fail);
  const k = chave();
  // Trocar o que já está em uso e mexe com dinheiro (chave, segredo de webhook, ambiente) exige confirmação explícita.
  const criticos = Object.keys(limpos).filter(n => campoDe(body.provider, n).critico && vivo.origem(n) !== null);
  if (criticos.length && body.confirmar !== true) throw fail(409, `Confirme a troca: ${criticos.map(n => campoDe(body.provider, n).avisoTroca ?? n).join(' ')}`);
  // Testa ANTES de gravar: valor que o provedor recusa nunca substitui um que funciona.
  const teste = await testarProvedor(body.provider, limpos, atuais, fetchImpl);
  if (!teste.ok) throw fail(422, teste.mensagem);
  try { await client.query('SELECT 1 FROM integration_credentials LIMIT 1'); } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_050); throw e; }
  await gravar(client, body.provider, limpos, operator, k);
  vivo.invalidar();
  return { response: { ok: true, mensagem: teste.mensagem, campos: Object.keys(limpos) } };
 }, { transactional: true, audit: false });

 router.delete('/api/integrations/credentials/:provider/:nome', async ({ client, params, operator, url }) => {
  if (!campoDe(params.provider, params.nome)) throw fail(404, 'Credencial desconhecida.');
  if (campoDe(params.provider, params.nome).critico && url.searchParams.get('confirmar') !== '1') throw fail(409, `Confirme a remoção: ${campoDe(params.provider, params.nome).avisoTroca ?? 'este valor está em uso.'} Ao remover, passa a valer o que o servidor tiver (ou nada).`);
  try {
   const r = await client.query('UPDATE integration_credentials SET revoked_at=now() WHERE nome=$1 AND revoked_at IS NULL RETURNING fingerprint', [params.nome]);
   if (!r.rowCount) throw fail(404, 'Este valor não foi definido pela tela. Se vem do servidor, remova a variável no EasyPanel.');
   await client.query("INSERT INTO integration_credentials_history(provider,nome,action,fingerprint,actor) VALUES($1,$2,'removed',$3,$4)", [params.provider, params.nome, r.rows[0].fingerprint, ator(operator)]);
  } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_050); throw e; }
  vivo.invalidar();
  return { response: { ok: true } };
 }, { transactional: true, body: false, audit: false });

 // Gera as chaves VAPID NO SERVIDOR (a privada nunca sai daqui) e já as guarda. Trocar as chaves desativa os aparelhos já ativados:
 // a assinatura de cada um foi feita com a chave pública antiga. Por isso, havendo chaves hoje, exige `confirmar: true`.
 router.post('/api/integrations/credentials/push/gerar', async ({ client, body, operator }) => {
  input(body, ['confirmar', 'subject']);
  const k = chave();
  try { await client.query('SELECT 1 FROM integration_credentials LIMIT 1'); } catch (e) { if (e?.code === '42P01') throw fail(409, MENSAGEM_050); throw e; }
  const existem = vivo.origem('VAPID_PUBLIC_KEY') !== null || vivo.origem('VAPID_PRIVATE_KEY') !== null;
  if (existem && body.confirmar !== true) throw fail(409, 'Já existem chaves de push. Trocar desativa os aparelhos já ativados (cada pessoa precisa ativar de novo). Confirme para gerar.');
  let assunto = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : String(vivo.env.VAPID_SUBJECT ?? '').trim();
  if (!assunto) { try { assunto = new URL(env.PUBLIC_ORIGIN).origin; } catch { /* sem origem pública */ } }
  const campoAssunto = campoDe('push', 'VAPID_SUBJECT');
  const erroAssunto = assunto ? campoAssunto.validar(assunto) : 'Informe o assunto (https://… ou mailto:).';
  if (erroAssunto) throw fail(400, `Assunto: ${erroAssunto}`);
  const par = gerarChavesVapid();
  await gravar(client, 'push', { VAPID_PUBLIC_KEY: par.publicKey, VAPID_PRIVATE_KEY: par.privateKey, VAPID_SUBJECT: assunto }, operator, k);
  // Os aparelhos antigos assinaram com a chave pública antiga: ficam inativos até a pessoa ativar de novo.
  const desativados = (await client.query('UPDATE push_subscriptions SET revoked_at=now(), updated_at=now() WHERE revoked_at IS NULL')).rowCount ?? 0;
  vivo.invalidar();
  // Só a chave PÚBLICA volta. A privada fica no servidor, cifrada.
  return { response: { ok: true, publica: par.publicKey, assunto, aparelhos_desativados: desativados } };
 }, { transactional: true, audit: false });
}
