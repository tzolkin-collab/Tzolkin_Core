// Dois processos independentes, uma entrada conveniente para desenvolvimento.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const children=[];let stopping=false;
const stop=(code=0)=>{
 if(stopping)return;stopping=true;
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 process.exitCode=code;
};
const iniciar=args=>{
 const child=spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});children.push(child);
 child.on('error',()=>stop(1));
 // Reiniciar de propósito não é falha: quem reinicia marca o processo antes de matá-lo.
 child.on('exit',code=>{if(!stopping&&!child.reiniciando)stop(code || 1);});
 return child;
};
const api=iniciar(['--env-file=.env','apps/api/src/server.mjs']);
let web=iniciar(['apps/web/server.mjs']);

// O servidor da tela só entrega o que está no mapa de arquivos (apps/web/assets.mjs), lido
// uma vez na partida. Arquivo novo em public/ (ou o próprio mapa mudando) com o servidor
// já no ar dá 404, o app.js não importa o módulo novo e a tela inteira, o login junto,
// deixa de carregar. Por isso, quando um arquivo aparece ou some, ou o mapa muda, só o
// processo da tela reinicia: a sessão de login vive na API e não se perde.
let pendente=null;
const reiniciarTela=motivo=>{
 clearTimeout(pendente);
 pendente=setTimeout(()=>{
  if(stopping)return;
  console.log(`[dev] ${motivo}: reiniciando o servidor da tela.`);
  const antigo=web;antigo.reiniciando=true;
  antigo.once('exit',()=>{if(!stopping)web=iniciar(['apps/web/server.mjs']);});
  antigo.kill('SIGTERM');
 },300);
};
// 'rename' é o evento de arquivo criado ou removido; editar o conteúdo não precisa
// reiniciar, porque o servidor lê o arquivo do disco a cada pedido.
watch(new URL('../apps/web/public/',import.meta.url),(evento,arquivo)=>{
 if(evento==='rename'&&/\.(?:js|css|svg|png|html)$/.test(arquivo||''))reiniciarTela(`${arquivo} apareceu ou sumiu em public/`);
});
watch(new URL('../apps/web/assets.mjs',import.meta.url),()=>reiniciarTela('assets.mjs mudou'));
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
void api;
