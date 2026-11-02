import { promisify } from 'node:util';
import { spawn,execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp,copyFile,readFile,mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import {createGameGateway} from '../src/service/game-gateway.js';

export const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export async function until(check:()=>Promise<boolean>,message:string,timeout=45000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await check())return;await delay(400);}
 throw new Error(message);
}
// Login Start from an unauthenticated vanilla client with the victim's exact UUID.
export async function duplicateLogin(port:number,ca:string,name:string,id:string) {
 const socket=tls.connect({host:'127.0.0.1',port,ca,minVersion:'TLSv1.3'});
 try{
   await once(socket,'secureConnect');
   const address=Buffer.from('localhost');
   const handshake=Buffer.concat([Buffer.from([0,255,5,address.length]),address,Buffer.from([port>>8,port&255,2])]);
   const login=Buffer.concat([Buffer.from([0,name.length]),Buffer.from(name),Buffer.from(id.replaceAll('-',''),'hex')]);
   socket.write(Buffer.concat([Buffer.of(handshake.length),handshake,Buffer.of(login.length),login]));
   const chunks:Buffer[]=[];
   socket.setTimeout(7000,()=>socket.destroy(new Error('Duplicate was not rejected')));
   for await(const chunk of socket)chunks.push(Buffer.from(chunk));
   return Buffer.concat(chunks).includes(Buffer.from('MineSPbSO:'));
 }finally{socket.destroy();}
}
export async function testServer(api:string,key:string) {
 const source=process.env.GATE_SERVER_TEMPLATE;
 if(!source)throw new Error('Укажите GATE_SERVER_TEMPLATE — путь к установленному серверу с принятым владельцем EULA.');
 const root=await mkdtemp(path.resolve('.local/security-server-'));
 await cp(path.join(source,'libraries'),path.join(root,'libraries'),{recursive:true});
 await cp(path.join(source,'mods'),path.join(root,'mods'),{recursive:true,filter:f=>!/^bluemap-|^community-gate/i.test(path.basename(f))});
 await copyFile(path.join(source,'eula.txt'),path.join(root,'eula.txt'));
 await copyFile('dist/app/community-gate-0.2.0.jar',path.join(root,'mods/community-gate-0.2.0.jar'));
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(r=>probe.close(()=>r()));
 await writeFile(path.join(root,'server.properties'),[
   'server-ip=127.0.0.1','server-port='+port,'online-mode=false','enforce-secure-profile=false','white-list=true','enforce-whitelist=true','view-distance=3','simulation-distance=3','generate-structures=false','spawn-protection=0'
 ].join('\n'));
 await mkdir(path.join(root,'config/voicechat'),{recursive:true});
 await writeFile(path.join(root,'config/voicechat/voicechat-server.properties'),'port=0\nbind_address=127.0.0.1\n');
 const trust=path.join(root,'test-api-trust.p12');
 await promisify(execFile)(process.env.KEYTOOL_EXE||'keytool',['-importcert','-noprompt','-alias','test-api','-storetype','PKCS12','-keystore',trust,'-storepass','public-fixture','-file',path.resolve('.local/tester-keys/tls-cert.pem')],{windowsHide:true});
 const server=spawn(process.env.JAVA_EXE||'java',['-Djavax.net.ssl.trustStore='+trust,'-Djavax.net.ssl.trustStorePassword=public-fixture','-Xmx3G','@libraries/net/neoforged/neoforge/21.1.256/win_args.txt','nogui'],{
  cwd:root,env:{...process.env,SMP_API_URL:api,SMP_SERVER_KEY:key},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='';const collect=(b:Buffer)=>{output=(output+b.toString()).slice(-8000);};server.stdout.on('data',collect);server.stderr.on('data',collect);
 const gateway=createGameGateway(await readFile('.local/tester-keys/tls-cert.pem'),await readFile('.local/tester-keys/tls-private.pem'),port);
 const close=async()=>{
   gateway.close();
   if(server.exitCode===null){
     server.stdin.write('stop\n');
     for(let i=0;i<60&&server.exitCode===null;i++)await delay(250);
     if(server.exitCode===null)server.kill();
   }
 };
 try{
   await until(async()=>{if(server.exitCode!==null)throw new Error('Тестовый сервер остановлен: '+output.slice(-2000));return /Done \([\d.,]+s\)!/.test(output) || /Done \([\d.,]+s\)!/.test(await readFile(path.join(root,'logs/latest.log'),'utf8').catch(()=>''));},'Тестовый сервер не запустился: '+root,240000);
   gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
   return {root,port,gatewayPort:(gateway.address() as net.AddressInfo).port,close};
 }catch(err){await close();throw err;}
}
