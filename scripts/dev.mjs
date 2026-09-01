// Dois processos independentes, uma entrada conveniente para desenvolvimento.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const children=[];let stopping=false;
const stop=(code=0)=>{
 if(stopping)return;stopping=true;
 for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
 process.exitCode=code;
};
for(const args of [['--env-file=.env','apps/api/src/server.mjs'],['apps/web/server.mjs']]) {
 const child=spawn(process.execPath,args,{cwd,stdio:'inherit',windowsHide:true});children.push(child);
 child.on('error',()=>stop(1));child.on('exit',code=>{if(!stopping)stop(code || 1);});
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
