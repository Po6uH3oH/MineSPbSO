import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import tls from 'node:tls';
import net from 'node:net';
import {startBroker,startTunnel} from '../src/launcher/tunnel.js';
test('локальный broker требует отдельный секрет и отклоняет Origin',async()=>{
 let called=0;const broker=await startBroker(async()=>{called++;return {ticket:'ok'};});
 try{const body=JSON.stringify({challenge:'a'.repeat(43)});const url=broker.env.SMP_BROKER_URL+'/ticket';
  assert.equal((await fetch(url,{method:'POST',body})).status,403);
  assert.equal((await fetch(url,{method:'POST',body,headers:{Authorization:`Bearer ${broker.env.SMP_BROKER_KEY}`,Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await fetch(url,{method:'POST',body,headers:{Authorization:`Bearer ${broker.env.SMP_BROKER_KEY}`}})).status,200);assert.equal(called,1);
 }finally{broker.close();}
});
test('TLS tunnel проверяет сертификат и передаёт поток только доверенному серверу',async t=>{
 const cert=await readFile('.local/localhost-cert.pem','utf8').catch(()=>null),key=await readFile('.local/localhost-key.pem','utf8').catch(()=>null);
 if(!cert||!key){t.skip('Для проверки TLS выполните scripts/dev-init.ps1');return;}
 const server=tls.createServer({cert,key,minVersion:'TLSv1.3'},s=>{s.on('error',()=>{});s.pipe(s);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as net.AddressInfo).port;
 const bad=await startTunnel('127.0.0.1',port);const good=await startTunnel('127.0.0.1',port,cert);
 try{
  const rejected=await new Promise<boolean>(r=>{const s=net.connect(bad.port,'127.0.0.1');let data=false;s.on('data',()=>{data=true;});s.on('error',()=>{});s.on('close',()=>r(!data));s.on('connect',()=>s.write('secret'));});assert.equal(rejected,true);
  const echoed=await new Promise<string>(r=>{const s=net.connect(good.port,'127.0.0.1');s.on('connect',()=>s.write('encrypted echo'));s.once('data',b=>{r(b.toString());s.destroy();});});assert.equal(echoed,'encrypted echo');
 }finally{good.close();bad.close();server.close();}
});
