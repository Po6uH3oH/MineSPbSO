import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { secret } from '../shared/identity.js';
import { timingSafeEqual } from 'node:crypto';
function secureSocket(host:string,port:number,ca?:string){
 const socket=tls.connect({host,port,servername:net.isIP(host)?undefined:host,ca,rejectUnauthorized:true,minVersion:'TLSv1.3'});
 socket.setTimeout(8000,()=>socket.destroy(new Error('TLS timeout')));
 socket.once('secureConnect',()=>socket.setTimeout(0));
 return socket;
}
export async function checkGateway(host:string,port:number,ca?:string){
 await new Promise<void>((resolve,reject)=>{
   const socket=secureSocket(host,port,ca);
   socket.once('secureConnect',()=>{socket.destroy();resolve();});
   socket.once('error',()=>reject(new Error('Защищённый вход недоступен. Проверьте адрес, сертификат и запуск игрового TLS-шлюза.')));
   socket.once('close',()=>reject(new Error('Игровой TLS-шлюз закрыл соединение.')));
 });
}
export async function startTunnel(host:string,port:number,ca?:string) {
 const sockets=new Set<net.Socket>();
 const server=net.createServer(local=>{
  // The game only ever sees loopback. DNS and certificate identity are checked here.
  local.pause();const remote=secureSocket(host,port,ca);
  for(const s of [local,remote]){sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{local.destroy();remote.destroy();});}
  remote.once('secureConnect',()=>{local.pipe(remote);remote.pipe(local);local.resume();});
  local.on('close',()=>remote.destroy());remote.on('close',()=>local.destroy());
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {port:(server.address() as net.AddressInfo).port,close:()=>{for(const s of sockets)s.destroy();server.close();}};
}
export async function startBroker(issue:(challenge:string)=>Promise<{ticket:string}>) {
 const key=secret();let busy=false;
 const server=http.createServer(async(q,r)=>{
  const actual=Buffer.from(q.headers.authorization??''),expected=Buffer.from(`Bearer ${key}`);
  if(q.method!=='POST'||q.url!=='/ticket'||q.headers.origin||actual.length!==expected.length||!timingSafeEqual(actual,expected)){r.writeHead(403).end();return;}
  if(busy){r.writeHead(429).end();return;}
  busy=true;
  try{let body='';for await(const b of q){body+=b;if(body.length>1024)throw new Error('Body limit');}const {challenge}=JSON.parse(body);if(typeof challenge!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw new Error('Challenge');const value=await issue(challenge);r.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));}
  catch{r.writeHead(403).end('{"error":"Вход не подтверждён"}');}finally{busy=false;}
 });
 server.requestTimeout=15_000;server.headersTimeout=10_000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {env:{SMP_BROKER_URL:`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,SMP_BROKER_KEY:key},close:()=>{server.closeAllConnections();server.close();}};
}
