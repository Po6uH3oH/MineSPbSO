import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import net from 'node:net';

test('supervisor passes SMTP only to accounts and stops all four services after world save',{timeout:25000},async()=>{
 await mkdir('.local',{recursive:true});
 const dir=await mkdtemp(path.resolve('.local/stack-test-'));
 for(const sub of ['scripts','src/service'])await mkdir(path.join(dir,sub),{recursive:true});
 const save=(file:string,data:string)=>writeFile(path.join(dir,file),data);
 const ports=[];
 for(let i=0;i<4;i++){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');ports.push(s);}
 const numbers=ports.map(s=>(s.address() as net.AddressInfo).port);
 await Promise.all(ports.map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))));
 let source=await readFile('scripts/start-community.mjs','utf8');
 for(const [i,p] of ['3000','3443','48905','48906'].entries())source=source.replaceAll(p,String(numbers[i]));
 source=source.replaceAll('10.99.52.8','127.0.0.1').replace("'powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','RemoteSigned','-File','scripts/smtp-prompt.ps1']", "process.execPath,['-e','process.stdout.write(\"fake-secret\")']");
 await save('start.mjs',source);await save('.env.local','');await save('package.json','{"type":"module"}');
 await save('src/service/main.ts',`import http from 'node:http';import fs from 'node:fs';if(process.env.SMTP_PASSWORD!=='fake-secret')process.exit(4);const s=http.createServer((q,r)=>r.end('{"ok":true}')).listen(${numbers[0]},'127.0.0.1');process.on('message',()=>s.close(()=>{fs.writeFileSync('db-closed','ok');process.disconnect();}));`);
 const probe="if(process.env.SMTP_PASSWORD==='fake-secret')process.exit(4);";
 for(const [i,file] of ['scripts/tester-bridge.ts','src/service/gateway.ts'].entries())await save(file,probe+`import net from 'node:net';net.createServer(s=>s.end()).listen(${numbers[i+1]},'127.0.0.1');`);
 await save('scripts/secure-server.mjs',probe+"import fs from 'node:fs';process.stdin.on('data',d=>{if(d.toString().trim()==='stop'){fs.writeFileSync('saved','ok');process.exit(0)}});");
 const child=spawn(process.execPath,['start.mjs'],{cwd:dir,windowsHide:true});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;if(chunk.toString().includes('Minecraft.'))child.stdin.write('stop\n');});child.stderr.on('data',chunk=>output+=chunk);
 const [code]=await once(child,'exit');assert.equal(code,0,output);assert.ok(!output.includes('fake-secret'));
 for(const file of ['saved','db-closed'])assert.equal(await readFile(path.join(dir,file),'utf8'),'ok');
});
