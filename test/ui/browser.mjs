// Mini-driver do Chrome/Edge pelo protocolo de depuração (CDP), sem dependência.
//
// Por que não Playwright/Puppeteer: o Core só depende de `pg`, e o Node 24 já traz
// WebSocket. O que os testes de tela precisam (abrir uma página, executar JS nela, esperar uma
// condição, olhar erros de console e de rede, mudar o viewport, tirar uma imagem) cabe em
// ~120 linhas e usa o navegador que já está instalado, sem baixar nada.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const CANDIDATOS = [
 process.env.CHROME_PATH,
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const acharNavegador = () => CANDIDATOS.find(caminho => existsSync(caminho)) ?? null;

/** Abre o navegador sem janela. Devolve `null` se não houver Chrome/Edge instalado. */
export async function abrirNavegador() {
 const caminho = acharNavegador();
 if (!caminho) return null;
 const perfil = mkdtempSync(join(tmpdir(), 'core-ui-'));
 const processo = spawn(caminho, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
  `--user-data-dir=${perfil}`, 'about:blank',
 ], { stdio: ['ignore', 'ignore', 'pipe'] });

 const url = await new Promise((resolve, reject) => {
  let texto = '';
  const limite = setTimeout(() => reject(new Error('O navegador não abriu a porta de depuração em 15 s.')), 15000);
  processo.stderr.on('data', pedaco => { texto += pedaco; const m = texto.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(limite); resolve(m[1]); } });
  processo.on('exit', codigo => reject(new Error(`O navegador saiu (código ${codigo}) antes de abrir a porta.`)));
 });
 const ws = new WebSocket(url);
 await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = () => falha(new Error('Não foi possível conectar ao navegador.')); });

 let seq = 0; const pendentes = new Map(); const ouvintes = new Set();
 ws.onmessage = evento => {
  const msg = JSON.parse(evento.data);
  if (msg.id && pendentes.has(msg.id)) {
   const { ok, falha } = pendentes.get(msg.id); pendentes.delete(msg.id);
   msg.error ? falha(new Error(`${msg.error.message}`)) : ok(msg.result);
  } else for (const ouvir of ouvintes) ouvir(msg);
 };
 const enviar = (metodo, params = {}, sessionId) => new Promise((ok, falha) => {
  const id = ++seq; pendentes.set(id, { ok, falha });
  ws.send(JSON.stringify({ id, method: metodo, params, sessionId }));
 });

 async function novaPagina() {
  const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
  const chamar = (metodo, params) => enviar(metodo, params, sessionId);
  const problemas = { excecoes: [], consoleErros: [], requisicoes: [] };
  const urlDaRequisicao = new Map();
  let aoCarregar = null;
  ouvintes.add(msg => {
   if (msg.sessionId !== sessionId) return;
   const p = msg.params ?? {};
   if (msg.method === 'Page.loadEventFired' && aoCarregar) aoCarregar();
   else if (msg.method === 'Runtime.exceptionThrown') problemas.excecoes.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exceção');
   else if (msg.method === 'Runtime.consoleAPICalled' && p.type === 'error') problemas.consoleErros.push((p.args ?? []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
   else if (msg.method === 'Network.requestWillBeSent') urlDaRequisicao.set(p.requestId, p.request.url);
   else if (msg.method === 'Network.responseReceived' && p.response.status >= 400) problemas.requisicoes.push({ url: p.response.url, status: p.response.status });
   else if (msg.method === 'Network.loadingFailed' && !p.canceled) problemas.requisicoes.push({ url: urlDaRequisicao.get(p.requestId) ?? '?', status: 0, erro: p.errorText });
  });
  for (const dominio of ['Page', 'Runtime', 'Network']) await chamar(`${dominio}.enable`);

  const pagina = {
   problemas,
   limparProblemas() { problemas.excecoes.length = problemas.consoleErros.length = problemas.requisicoes.length = 0; },
   async ir(endereco) {
    const carregou = new Promise(ok => { aoCarregar = ok; });
    await chamar('Page.navigate', { url: endereco });
    await Promise.race([carregou, new Promise((_, falha) => setTimeout(() => falha(new Error(`Timeout carregando ${endereco}`)), 20000))]);
   },
   async avaliar(expressao) {
    const r = await chamar('Runtime.evaluate', { expression: expressao, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Erro na página: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
   },
   async esperar(expressao, { limite = 8000, passo = 100, descricao = expressao } = {}) {
    const fim = Date.now() + limite; let ultimo;
    while (Date.now() < fim) {
     try { ultimo = await pagina.avaliar(expressao); if (ultimo) return ultimo; } catch (erro) { ultimo = erro.message; }
     await new Promise(ok => setTimeout(ok, passo));
    }
    throw new Error(`Não aconteceu em ${limite} ms: ${descricao}${typeof ultimo === 'string' ? ` (${ultimo})` : ''}`);
   },
   async tela(largura, altura) {
    await chamar('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: 1, mobile: largura < 500 });
   },
   // Preferência de cor do SISTEMA (o que o aparelho diz ao navegador): 'light' | 'dark'
   // Roda um script em TODA página nova (inclusive depois de recarregar), antes do app. Devolve quem desfaz.
   async injetar(codigo) {
    const { identifier } = await chamar('Page.addScriptToEvaluateOnNewDocument', { source: codigo });
    return () => chamar('Page.removeScriptToEvaluateOnNewDocument', { identifier });
   },
   async esquema(cor) {
    await chamar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: cor }] });
   },
   async imagem(arquivo) {
    const { data } = await chamar('Page.captureScreenshot', { format: 'png' });
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, Buffer.from(data, 'base64'));
   },
  };
  return pagina;
 }

 return {
  caminho, novaPagina,
  async fechar() {
   try { ws.close(); } catch {}
   processo.kill();
   await new Promise(ok => setTimeout(ok, 300));
   // No Windows o perfil pode ficar preso por instantes: tenta de novo, sem falhar o teste.
   for (let i = 0; i < 5; i++) { try { rmSync(perfil, { recursive: true, force: true }); break; } catch { await new Promise(ok => setTimeout(ok, 300)); } }
  },
 };
}
