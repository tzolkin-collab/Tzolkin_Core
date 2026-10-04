// "Ambiente vivo": o `process.env` do servidor, com as credenciais guardadas pela TELA (Configurações → Integrações) por cima.
//
// A regra (decidida em docs/CONFIGURACOES.md): o valor da tela VENCE o do `.env`; sem valor na tela, vale o `.env`.
// Os módulos já recebem `env` e leem `env.VERCEL_TOKEN` no momento de usar, então o objeto devolvido aqui entra no lugar de `process.env`
// sem que eles mudem a leitura. As credenciais da tela ficam cifradas no banco (CORE_SECRETS_KEY) e só viram texto na memória deste processo.
//
// Sem CORE_SECRETS_KEY (ou META_MARKETING_KEY), ou sem a migração 050, não há nada para carregar: o ambiente vivo é igual ao `process.env`.
import { readKey, open } from './secrets.mjs';

const nomeDaChave = base => (String(base.CORE_SECRETS_KEY ?? '').trim() ? 'CORE_SECRETS_KEY' : 'META_MARKETING_KEY');

export function criarEnvVivo({ base = process.env, relogio = Date.now, ttl = 15000, log = console } = {}) {
 const sobre = new Map();
 let carregadoEm = -Infinity, sujo = true, emCurso = null, avisou = false;

 const env = new Proxy(base, {
  get: (alvo, k) => (typeof k === 'string' && sobre.has(k) ? sobre.get(k) : alvo[k]),
  has: (alvo, k) => (typeof k === 'string' && sobre.has(k)) || k in alvo,
  ownKeys: alvo => [...new Set([...Reflect.ownKeys(alvo), ...sobre.keys()])],
  getOwnPropertyDescriptor: (alvo, k) => (typeof k === 'string' && sobre.has(k) ? { value: sobre.get(k), enumerable: true, configurable: true, writable: true } : Reflect.getOwnPropertyDescriptor(alvo, k)),
  set: () => false,           // ninguém grava no ambiente por aqui: a gravação é pela rota de credenciais
  deleteProperty: () => false,
 });

 const temChave = () => { try { readKey(base, nomeDaChave(base)); return true; } catch { return false; } };

 async function carregar(pool) {
  if (!temChave()) { sobre.clear(); carregadoEm = relogio(); sujo = false; return; }
  let rows;
  try {
   ({ rows } = await pool.query('SELECT nome,token_ciphertext AS ciphertext,token_iv AS iv,token_tag AS tag FROM integration_credentials WHERE revoked_at IS NULL'));
  } catch (e) {
   if (e?.code === '42P01') { sobre.clear(); carregadoEm = relogio(); sujo = false; return; }   // migração 050 ainda não aplicada
   throw e;
  }
  const chave = readKey(base, nomeDaChave(base));
  const novo = new Map();
  for (const r of rows) {
   try { novo.set(r.nome, open({ ciphertext: r.ciphertext, iv: r.iv, tag: r.tag }, chave)); }
   catch { if (!avisou) { avisou = true; log.error('[env-vivo] credencial ilegível (chave trocada?):', r.nome); } }   // só o NOME vai ao log
  }
  sobre.clear(); for (const [k, v] of novo) sobre.set(k, v);
  carregadoEm = relogio(); sujo = false;
 }

 return {
  env,
  carregar,
  /** Chamada no começo de cada pedido: relê do banco a cada `ttl` ms ou quando alguém gravou. Nunca lança (erro de leitura mantém o que já estava). */
  async garantir(pool) {
   if (!temChave()) return;
   if (!sujo && relogio() - carregadoEm < ttl) return;
   emCurso ??= carregar(pool).catch(e => { log.error('[env-vivo] não foi possível ler as credenciais da tela:', e?.message); carregadoEm = relogio(); }).finally(() => { emCurso = null; });
   await emCurso;
  },
  /** Depois de gravar ou remover: a próxima leitura já vem do banco. */
  invalidar() { sujo = true; },
  /** De onde vale hoje o valor de `nome`: 'tela', 'servidor' (.env) ou null. */
  origem(nome) {
   if (sobre.has(nome)) return 'tela';
   return String(base[nome] ?? '').trim() ? 'servidor' : null;
  },
  /** Valor vindo da tela (ou undefined). Só para campos que NÃO são segredo. */
  daTela: nome => sobre.get(nome),
  temChave,
  _sobre: sobre,
 };
}

/** O ambiente vivo do processo: todos os módulos usam o mesmo, e app.mjs o mantém em dia. */
export const vivo = criarEnvVivo();
