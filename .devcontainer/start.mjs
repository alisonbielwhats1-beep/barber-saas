import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { demoEnvironment } from './environment.mjs';

if(!existsSync('.demo/ready')) { console.log('Aguardando a preparação da demo.'); process.exit(0); }
if(existsSync('.demo/server.pid')) {
  try {
    const pid = Number(readFileSync('.demo/server.pid','utf8'));
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('Stale process marker');
    process.kill(pid,0);
    const stat = readFileSync(`/proc/${pid}/stat`,'utf8');
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
    const command = readFileSync(`/proc/${pid}/cmdline`,'utf8');
    if (state !== 'Z' && (command.includes('next-server') || command.includes('node_modules/next/dist/bin/next'))) {
      console.log('Demo já está em execução.'); process.exit(0);
    }
  } catch { /* previous session ended */ }
}
const output = openSync('.demo/server.log','a',0o600);
const child = spawn('node',['node_modules/next/dist/bin/next','start','-p','3000','-H','0.0.0.0'], {
  env:demoEnvironment(), detached:true, stdio:['ignore',output,output]
});
writeFileSync('.demo/server.pid',String(child.pid),{mode:0o600});
child.unref();
console.log('Everflair Demo iniciada na porta 3000.');

