// Credencial de provedor guardada no banco, cifrada.
//
// POR QUE NO BANCO, E NÃO NO `.env`
// Um token de longa duração da Graph expira em ~60 dias. O Core precisa saber
// QUANDO ele expira para avisar antes de a coleta parar em silêncio, e precisa
// poder substituí-lo sem redeploy. Variável de ambiente não guarda validade,
// não guarda histórico e não distingue "trocado ontem" de "trocado em março".
//
// POR QUE CIFRADA
// O banco tem backup, e backup circula — hoje são 16 agendamentos em disco
// local. A chave fica em `META_MARKETING_KEY`, FORA do banco: quem leva o dump
// não leva o token. Guardar a chave no mesmo banco anularia o exercício.
//
// POR QUE GCM, E NÃO CBC
// GCM autentica o texto cifrado. Um dump adulterado falha na decifragem em vez
// de devolver um token trocado, que sairia daqui direto para uma chamada externa.
//
// Nada neste arquivo escreve em log. O texto claro só existe em memória, entre
// `open()` e a chamada HTTP que o consome.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // recomendado para GCM: 96 bits
const KEY_BYTES = 32;

/**
 * Lê a chave-mestra do ambiente. Falha alto e cedo: um Core que aceita rodar
 * sem chave acabaria guardando credencial em texto claro sem ninguém notar.
 */
export function readKey(env = process.env, name = 'META_MARKETING_KEY') {
 const raw = env[name];
 if (!raw) throw Object.assign(
  new Error(`Defina ${name} no ambiente do servidor. Gere com: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`),
  { status: 503 });
 let key;
 try { key = Buffer.from(raw, 'base64'); } catch { key = Buffer.alloc(0); }
 // Base64 inválido não lança em Node: devolve lixo truncado. O tamanho é a prova.
 if (key.length !== KEY_BYTES) throw Object.assign(
  new Error(`${name} deve ter exatamente ${KEY_BYTES} bytes em base64.`), { status: 503 });
 return key;
}

/**
 * Impressão digital do token: permite responder "é o mesmo de antes?" e
 * "qual token falhou?" sem nunca devolver o token. Não é reversível.
 */
export const fingerprint = plaintext =>
 createHash('sha256').update(String(plaintext), 'utf8').digest('hex').slice(0, 16);

/** Cifra. Devolve só o que vai para o banco — nunca o texto claro. */
export function seal(plaintext, key) {
 if (typeof plaintext !== 'string' || !plaintext) throw new Error('Nada a cifrar.');
 const iv = randomBytes(IV_BYTES);
 const cipher = createCipheriv(ALGO, key, iv);
 const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
 return { ciphertext, iv, tag: cipher.getAuthTag(), fingerprint: fingerprint(plaintext) };
}

/**
 * Decifra. Se a chave mudou ou a linha foi adulterada, o `final()` lança —
 * e é isso que queremos: melhor a coleta parar do que sair chamando a Graph
 * com um token que não é o que gravamos.
 */
export function open({ ciphertext, iv, tag }, key) {
 const decipher = createDecipheriv(ALGO, key, Buffer.from(iv));
 decipher.setAuthTag(Buffer.from(tag));
 try {
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString('utf8');
 } catch {
  // A mensagem não distingue chave errada de dado adulterado: as duas são
  // "não confie neste registro", e detalhar ajudaria só quem está sondando.
  throw Object.assign(new Error('Credencial ilegível: chave incorreta ou registro adulterado.'), { status: 500 });
 }
}

/** Compara duas impressões digitais sem vazar tempo. */
export function sameFingerprint(a, b) {
 if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
 return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Remove ocorrências do segredo de qualquer texto que vá para log ou tela.
 * Última linha de defesa: mensagens de erro de provedor às vezes ecoam o token.
 */
export function scrub(texto, ...segredos) {
 let saida = String(texto ?? '');
 for (const segredo of segredos) {
  if (typeof segredo === 'string' && segredo.length >= 8) saida = saida.split(segredo).join('[oculto]');
 }
 return saida;
}

export const _internals = { ALGO, IV_BYTES, KEY_BYTES };
