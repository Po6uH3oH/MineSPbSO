import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {verifyManifest,safeRelative,installPack,acquireLock,recover,atomicJson,download,type Manifest} from '../src/launcher/files.js';
import {digest} from '../src/shared/identity.js';
const keys=generateKeyPairSync('ed25519'),key=keys.publicKey.export({type:'spki',format:'pem'}).toString();
const manifest=():Manifest=>({schema:1,version:'1.0.0',sequence:1,minecraft:'1.21.1',neoforge:'21.1.256',expires:'2099-01-01T00:00:00Z',files:[],allowedAddons:[]});
const envelope=(v:any)=>{const bytes=Buffer.from(JSON.stringify(v));return JSON.stringify({payload:bytes.toString('base64'),signature:sign(null,bytes,keys.privateKey).toString('base64')});};
test('подпись, срок, downgrade, коллизии Windows и обход каталогов',()=>{
 const m=manifest();assert.equal(verifyManifest(envelope(m),key).version,'1.0.0');
 const forged=JSON.parse(envelope(m));forged.payload=Buffer.from(JSON.stringify({...m,version:'evil'})).toString('base64');assert.throws(()=>verifyManifest(JSON.stringify(forged),key));
 assert.throws(()=>verifyManifest(envelope(m),key,2));assert.throws(()=>verifyManifest(envelope({...m,expires:'2000-01-01T00:00:00Z'}),key));
 for(const s of ['../x','C:/x','mods/../../x','mods\\x','mods/NUL.jar','mods/x.','mods/x:y','/x','mods//x'])assert.throws(()=>safeRelative(s));
});
test('обновление сохраняет данные и конфиги, удаляет старые управляемые моды, проверяет дополнения',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'СМП тест '));const bytes=Buffer.from('jar fixture');
 const server=http.createServer((_q,r)=>r.end(bytes));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/mod.jar`;
 const f=(p:string)=>({path:p,url,size:bytes.length,sha256:digest(bytes),side:'client' as const,policy:p.startsWith('mods/')?'managed' as const:'default' as const,required:true,license:'MIT',source:'https://example.org/project'});
 try{
  const unlock=await acquireLock(root);await assert.rejects(()=>acquireLock(root));
  const m={...manifest(),files:[f('mods/old.jar'),f('config/options.toml')]};await installPack(root,m,'client');
  await mkdir(path.join(root,'game','screenshots'),{recursive:true});await writeFile(path.join(root,'game','screenshots','картина.png'),'user-data');await writeFile(path.join(root,'game','config','options.toml'),'user-setting');
  const next={...m,version:'2.0.0',sequence:2,files:[f('mods/new.jar'),f('config/options.toml')]};await installPack(root,next,'client');await installPack(root,next,'client');
  assert.equal(await readFile(path.join(root,'game','screenshots','картина.png'),'utf8'),'user-data');assert.equal(await readFile(path.join(root,'game','config','options.toml'),'utf8'),'user-setting');
  assert.equal(await lstat(path.join(root,'game','mods','old.jar')).catch(()=>null),null);
  await writeFile(path.join(root,'addons','extra.jar'),'unknown');await assert.rejects(()=>installPack(root,next,'client'),/не разрешено/);assert.equal(await readFile(path.join(root,'game','mods','new.jar'),'utf8'),bytes.toString());await unlock();
 }finally{server.close();}
});
test('восстановление между переименованиями возвращает целый старый каталог',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'smp-crash-'));const stage='stage-'+'a'.repeat(64),backup='backup-'+'b'.repeat(64);
 await mkdir(path.join(root,'game','mods'),{recursive:true});await writeFile(path.join(root,'game','mods','old.jar'),'old');await mkdir(path.join(root,stage));await writeFile(path.join(root,stage,'new.jar'),'new');
 await atomicJson(path.join(root,'transaction.json'),{stage,backup,hadOld:true});await rename(path.join(root,'game','mods'),path.join(root,backup));await rename(path.join(root,stage),path.join(root,'game','mods'));await recover(root);
 assert.equal(await readFile(path.join(root,'game','mods','old.jar'),'utf8'),'old');assert.equal(await lstat(path.join(root,'game','mods','new.jar')).catch(()=>null),null);
});
test('повреждённая загрузка отклоняется; частичный файл возобновляется Range-запросом',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'smp-download-'));let ranges=0,corrupt=false;const bytes=Buffer.from('a verified artifact');
 const server=http.createServer((q,r)=>{if(corrupt){r.end(Buffer.alloc(bytes.length));return;}const range=q.headers.range;if(range){ranges++;const n=Number(range.slice(6,-1));r.writeHead(206,{'Content-Range':`bytes ${n}-${bytes.length-1}/${bytes.length}`});r.end(bytes.subarray(n));}else r.end(bytes);});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const dest=path.join(root,'download');const file={path:'mods/file.jar',url:`http://127.0.0.1:${(server.address() as any).port}/file`,size:bytes.length,sha256:digest(bytes),side:'both' as const,policy:'managed' as const,required:true,license:'test',source:'https://example.org'};
 try{await writeFile(dest+'.part',bytes.subarray(0,5));await download(file,dest);assert.equal(ranges,1);assert.equal(await readFile(dest,'utf8'),bytes.toString());corrupt=true;await assert.rejects(()=>download(file,path.join(root,'bad')),/сумма/);}finally{server.close();}
});
