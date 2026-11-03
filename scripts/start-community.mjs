import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';

const host='10.99.52.8',login=process.env.YANDEX_LOGIN??'bruh1bruh1bruh';
const folder=process.argv[2]??path.join(os.homedir(),'Desktop','test_server');
const tsx=['--import','tsx'];
const children=[];
let game,stopping=false,failed;
function start(name,args,extra={}){
 const child=spawn(process.execPath,args,{stdio:name==='Аккаунты'?['pipe','inherit','inherit','ipc']:['pipe','inherit','inherit'],windowsHide:true,env:{...process.env,...extra}});
 const done=once(child,'close').then(([code])=>{
  if(!stopping && (child!==game||code!==0))failed=name+' завершился (код '+code+').';
  if(!stopping)void stop();
 });
 children.push({child,done});return child;
}
async function stop(){
 if(stopping)return;
 stopping=true;
 if(game&&game.exitCode===null){
  console.log('Сохраняем мир. Дождитесь завершения Minecraft.');
  game.stdin.write('stop\n');await children.find(x=>x.child===game).done;
 }
 for(const {child} of children)if(child!==game&&child.exitCode===null){
  if(child.connected)child.send('shutdown');else child.kill();
 }
}
async function free(address,port){
 const server=net.createServer();
 try{server.listen(port,address);await once(server,'listening');}
 catch{throw new Error('Не удалось занять '+address+':'+port+'. Проверьте Porthole и закройте прежние сервисы.');}
 await new Promise(resolve=>server.close(resolve));
}
async function ready(label,probe){
 for(let i=0;i<120&&!stopping;i++){
  if(await probe())return;
  await delay(500);
 }
 throw new Error(failed??'Не дождались запуска: '+label);
}
function tcp(address,port){
 return new Promise(resolve=>{
  const s=net.connect(port,address);s.setTimeout(500);
  const finish=value=>{s.destroy();resolve(value);};
  s.once('connect',()=>finish(true)).once('error',()=>finish(false)).once('timeout',()=>finish(false));
 });
}
let lines;
try{
 console.log('MineSPbSO · Проверяем порты и адрес Porthole…');
 for(const [address,port] of [['127.0.0.1',3000],[host,3443],['127.0.0.1',48905],[host,48905],['127.0.0.1',48906]])await free(address,port);
 console.log('Открываем окно «MineSPbSO — пароль почты». Вставьте пароль приложения и нажмите «Запустить».');
 let password;
 try{({stdout:password}=await promisify(execFile)('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','RemoteSigned','-File','scripts/smtp-prompt.ps1'],{windowsHide:false,timeout:300000}));}
 catch{throw new Error('Ввод пароля отменён или окно Windows недоступно.');}
 process.on('SIGINT',()=>void stop());
 console.log('Проверяем SMTP и запускаем сервис аккаунтов…');
 start('Аккаунты',['--env-file=.env.local',...tsx,'src/service/main.ts'],{SMTP_HOST:'smtp.yandex.ru',SMTP_PORT:'465',SMTP_SECURE:'true',SMTP_VERIFY_ON_START:'true',SMTP_USER:login,SMTP_FROM:login+'@yandex.ru',SMTP_PASSWORD:password});
 password=undefined;
 await ready('сервис аккаунтов',async()=>{try{return (await (await fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(800)})).json()).ok;}catch{return false;}});
 console.log('Запускаем раздачу и защищённый шлюз…');
 start('Раздача',[...tsx,'scripts/tester-bridge.ts']);
 start('Шлюз',[...tsx,'src/service/gateway.ts'],{TLS_CERT:'.local/tester-keys/tls-cert.pem',TLS_KEY:'.local/tester-keys/tls-private.pem',GATEWAY_HOST:'127.0.0.1,'+host,GATEWAY_PORT:'48905',MINECRAFT_PORT:'48906'});
 await ready('раздача и игровой шлюз',async()=>await tcp(host,3443)&&await tcp(host,48905));
 game=start('Minecraft',['scripts/secure-server.mjs','start',folder]);
 game.stdin.on('error',()=>{});
 console.log('Команды в этом окне идут в Minecraft. Для сохранения мира и остановки всех сервисов введите stop.');
 lines=readline.createInterface({input:process.stdin,output:process.stdout});
 lines.on('SIGINT',()=>void stop());
 lines.on('line',line=>{if(line.trim()==='stop')void stop();else if(!stopping)game.stdin.write(line+'\n');});
 await children.find(x=>x.child===game).done;
}catch(err){failed=failed??err.message;}
finally{
 lines?.close();await stop();await Promise.all(children.map(x=>x.done));
 if(failed){console.error(failed);process.exitCode=1;}
}
