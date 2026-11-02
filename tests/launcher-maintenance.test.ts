import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {generateKeyPairSync,sign} from 'node:crypto';
import {read,write} from 'nbtify';
import {saveCommunityServer} from '../src/launcher/saved-server.js';
import {newer,verifiedInstaller} from '../src/launcher/launcher-updates.js';

test('видимая запись следует за портом туннеля и сохраняет чужие серверы и их данные',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'saved-server-'));
 await mkdir(path.join(root,'game'));
 const file=path.join(root,'game/servers.dat');
 const original=await write({servers:[{name:'Личный 🦊',ip:'example.test',icon:new Uint8Array([1,2,3])},{ip:'localhost:5555',name:'Скрытый',hidden:true}]});
 await writeFile(file,original);
 await saveCommunityServer(root,'MineSPbSO',12345);await saveCommunityServer(root,'MineSPbSO',34567);
 const list=(await read<any>(await readFile(file))).data.servers;
 assert.equal(list.length,3);assert.equal(list[0].name,'Личный 🦊');assert.deepEqual([...list[0].icon],[1,2,3]);
 assert.equal(Number(list[1].hidden),1);assert.equal(list[2].ip,'127.83.80.1:34567');assert.ok(!Number(list[2].hidden));
 await writeFile(file,'damaged');await assert.rejects(saveCommunityServer(root,'MineSPbSO',23456));
 assert.equal(await readFile(file,'utf8'),'damaged');
});
test('обновление принимает только подписанный Windows-установщик правильного назначения',()=>{
 const pair=generateKeyPairSync('ed25519');const key=pair.publicKey.export({format:'pem',type:'spki'}).toString();
 const meta={purpose:'MineSPbSO Windows x64 installer v1',version:'0.10.0',size:100,sha256:'1'.repeat(64)};
 const envelope=(m:unknown)=>{const bytes=Buffer.from(JSON.stringify(m));return {payload:bytes.toString('base64'),signature:sign(null,bytes,pair.privateKey).toString('base64')};};
 assert.deepEqual(verifiedInstaller(envelope(meta),key),meta);assert.ok(newer(meta.version,'0.2.1'));assert.ok(!newer('0.2.0','0.2.1'));
 assert.throws(()=>verifiedInstaller({...envelope(meta),payload:envelope({...meta,size:3}).payload},key));
 assert.throws(()=>verifiedInstaller(envelope({...meta,purpose:'pack'}),key));
});

