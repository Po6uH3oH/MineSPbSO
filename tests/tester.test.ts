import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp,mkdir,readFile,writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { cacheArchive } from '../src/launcher/tester-release.js';
import { configureSkins } from '../src/launcher/skins.js';
import { serverTargets } from '../src/launcher/server-status.js';
import type { Manifest } from '../src/launcher/files.js';

test('один IP для Quick Play и BlueMap, без внедрения URL или смены порта',()=>{
 assert.deepEqual(serverTargets('10.99.52.8'),{host:'10.99.52.8',game:'10.99.52.8:48905',map:'http://10.99.52.8:8100/'});
 assert.equal(serverTargets('localhost').game,'127.0.0.1:48905');
 assert.equal(serverTargets('::1').game,'[::1]:48905');
 for(const bad of ['127.0.0.1:123','http://localhost','localhost/../../foo','a@127.0.0.1'])assert.throws(()=>serverTargets(bad));
});
test('CustomSkinLoader получает источник сообщества первым, сохраняет настройки и резервную копию',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'скины '));
 const dir=path.join(root,'game/CustomSkinLoader');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'CustomSkinLoader.json');
 const initial={version:'15.1',enableCape:true,loadlist:[{name:'Mojang',type:'MojangAPI'}]};
 await writeFile(file,JSON.stringify(initial));await configureSkins(root,'http://127.0.0.1:2000');
 await configureSkins(root,'http://127.0.0.1:3000');
 const actual=JSON.parse(await readFile(file,'utf8'));
 assert.equal(actual.enableCape,true);assert.equal(actual.loadlist.length,2);assert.equal(actual.loadlist[0].root,'http://127.0.0.1:3000/csl/');assert.deepEqual(actual.loadlist[1],initial.loadlist[0]);
 assert.deepEqual(JSON.parse(await readFile(file+'.before-minespbso','utf8')),initial);
});
test('проверенный ZIP по HTTP: прогресс, извлечение только по манифесту и повторное использование кеша',async()=>{
 const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const root=await mkdtemp(path.join(os.tmpdir(),'архив '));
 const bytes=Buffer.from('test-jar'),url='https://example.test/pack.zip';
 const zip=new AdmZip();zip.addFile('mods/test.jar',bytes);const archive=zip.toBuffer();
 const manifest:Manifest={schema:1,version:'test',minecraft:'1.21.1',neoforge:'21.1.256',sequence:1,expires:'2099-01-01T00:00:00Z',allowedAddons:[],files:[{path:'mods/test.jar',url,source:url,license:'fixture',sha256:digest(bytes),size:bytes.length,policy:'managed',side:'client',required:true}],archive:{url,size:archive.length,sha256:digest(archive)}};
 let requests=0,received=0;
 const fetchZip=async()=>{requests++;return new Response(new Uint8Array(archive));};
 await cacheArchive(root,manifest,(_label,bytes)=>{received=bytes;},fetchZip);
 assert.equal(received,archive.length);assert.deepEqual(await readFile(path.join(root,'cache',digest(bytes))),bytes);
 await cacheArchive(root,manifest,()=>{},fetchZip);assert.equal(requests,1);
 manifest.files[0]!.path='mods/missing.jar';manifest.files[0]!.sha256='a'.repeat(64);
 await assert.rejects(cacheArchive(root,manifest,()=>{},fetchZip),/расходится/);
});
