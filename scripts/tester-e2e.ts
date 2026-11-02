import assert from 'node:assert/strict';
import {testServer,until,duplicateLogin} from './test-server-fixture.js';
import {launchGame} from '../src/launcher/game.js';
import {offlineUuid} from '../src/shared/identity.js';
import {startTunnel,startBroker} from '../src/launcher/tunnel.js';
import { once } from 'node:events';
import { sign,randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile,link,cp } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { _electron as electron } from 'playwright';
import { PNG } from 'pngjs';
import { database,migrate } from '../src/service/db.js';
import { createService } from '../src/service/app.js';
import { createTesterBridge } from '../src/service/tester-bridge.js';
import { verifyManifest,installPack } from '../src/launcher/files.js';
import { communityFetch } from '../src/launcher/tester-network.js';
import { queryServer } from '../src/launcher/server-status.js';

const data=path.resolve('.local','Сетевой тест '+Date.now());
const dist=path.join(data,'distribution');
await mkdir(path.join(dist,'files'),{recursive:true});
const cfg=JSON.parse(await readFile('config/launcher.tester.json','utf8'));
const manifest=verifyManifest(await readFile('.local/tester-distribution/current.json','utf8'),cfg.testerPackKey);
const db=await database('pglite:');await migrate(db);
let code='';
const serverKey=randomBytes(32).toString('hex');
const api=await createService({db,serverId:'test',serverKey,publicUrl:'http://localhost',sendMail:async(_to,_subject,body)=>{code=body.split('\n\n')[1]!;}});
let deniedProofs=0;
api.addHook('onResponse',async(req,reply)=>{if(req.url==='/server/consume'&&reply.statusCode===403)deniedProofs++;});
const localApi=await api.listen({host:'127.0.0.1',port:0});
const bridge=await createTesterBridge('.local/tester-keys',dist,Number(new URL(localApi).port));
bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
const apiUrl='https://127.0.0.1:'+(bridge.address() as AddressInfo).port;
const fetchFile=communityFetch(apiUrl,cfg.apiCA);
const counts={blobs:0,skinProfiles:0,textures:0};
bridge.on('request',req=>{
 if(req.url?.startsWith('/packs/files/'))counts.blobs++;
 if(req.url?.startsWith('/csl/textures/'))counts.textures++;
 else if(req.url?.startsWith('/csl/'))counts.skinProfiles++;
});
let app:Awaited<ReturnType<typeof electron.launch>>|undefined;
let backend:Awaited<ReturnType<typeof testServer>>|undefined;
const account={nickname:'LayerNetTest',email:'net-test@example.test',password:randomBytes(24).toString('hex')};
try{
 const linked=new Set<string>();
 for(const f of manifest.files){
   f.url=apiUrl+'/packs/files/'+f.sha256;
   if(!linked.has(f.sha256))await link(path.resolve('.local/tester-distribution/files',f.sha256),path.join(dist,'files',f.sha256));
   linked.add(f.sha256);
 }
 delete manifest.archive;
 const payload=Buffer.from(JSON.stringify(manifest));
 await writeFile(path.join(dist,'current.json'),JSON.stringify({payload:payload.toString('base64'),signature:sign(null,payload,await readFile('.local/tester-keys/pack-private.pem')).toString('base64')}));
 const register=await api.inject({method:'POST',url:'/auth/register',payload:account});assert.ok(register.statusCode<300,register.body);
 assert.equal((await api.inject({method:'POST',url:'/auth/verify',payload:{token:code}})).statusCode,200);
 backend=await testServer(apiUrl,serverKey);
 const mc=backend;
 const listed=async()=>JSON.parse(await readFile(path.join(mc.root,'whitelist.json'),'utf8').catch(()=>'[]')).some((p:any)=>p.uuid===offlineUuid(account.nickname));
 await until(listed,'Аккаунт не попал в whitelist.json');
 console.log('WHITELIST verified player added');
 await mkdir(path.join(data,'config'));await writeFile(path.join(data,'config/launcher.local.json'),JSON.stringify({...cfg,apiUrl,testerHost:'localhost',gatewayCA:cfg.apiCA,gatewayPort:mc.gatewayPort}));
 const png=new PNG({width:64,height:64});png.data.fill(200);const skin=path.join(data,'skin.png');await writeFile(skin,PNG.sync.write(png));
 // Exercise the real network installer separately so a Maven/Mojang outage cannot hide a broken pack distribution.
 const isolated=path.join(data,'empty-pack');await mkdir(isolated);let transferred=0;
 await installPack(isolated,manifest,'client',()=>{},[],(_label,bytes)=>{transferred=Math.max(bytes,transferred);},fetchFile);
 assert.ok(transferred>500_000_000);
 const firstRequests=counts.blobs;
 await installPack(isolated,manifest,'client',()=>{},[],()=>{},fetchFile);
 assert.equal(counts.blobs,firstRequests);
 console.log('REMOTE_PACK',JSON.stringify({files:manifest.files.length,bytes:transferred,requests:firstRequests,repeatRequests:0}));
 if(process.env.TESTER_SMOKE_ENGINE){
   for(const dir of ['runtime','minecraft'])await cp(path.join(process.env.TESTER_SMOKE_ENGINE,dir),path.join(data,'instance',dir),{recursive:true});
 }
 app=await electron.launch({cwd:data,args:[path.resolve('.')],env:{...process.env,SMP_DEV_USERDATA:data,SMP_TEST_HEADLESS:'1'},timeout:30000});
 const page=await app.firstWindow();
 await page.locator('[data-tab=profile]').click();await page.locator('[name=email]').fill(account.email);await page.locator('[name=password]').fill(account.password);await page.locator('#auth-submit').click();
 await page.locator('#profile-name').getByText(account.nickname).waitFor();
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[file]})) as typeof dialog.showOpenDialog;},skin);
 await page.locator('#skin').click();await page.getByText('Скин сохранён.',{exact:false}).waitFor();
 // Observe the real child, so only this smoke test's Java process is stopped in finally.
 await app.evaluate(()=>{
   const cp=process.getBuiltinModule('child_process') as typeof import('node:child_process');
   const spawn=cp.spawn;
   (cp as any).spawn=function(...args:any[]){
     const child=(spawn as any)(...args);
     if(String(args[0]).endsWith('java.exe') && !args[1]?.includes('-version')) (globalThis as any).smokeJava=child;
     return child;
   };
 });
 await page.locator('[data-tab=home]').click();await page.locator('#play').click();
 const deadline=Date.now()+15*60000;
 let stage='',joined=false;
 while(Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,2000));
   const next=await page.locator('#stage').textContent();
   if(next!==stage){stage=next??'';console.log('STAGE',stage);}
   if(await page.locator('#notice').isVisible())throw new Error(await page.locator('#notice').innerText());
   const log=await readFile(path.join(data,'instance/game/logs/latest.log'),'utf8').catch(()=>'');
   if(/Couldn't connect to server|Can't connect to server|AnnotatedSocketException: Permission denied: getsockopt/.test(log))throw new Error('Клиент не смог подключиться к игровому серверу');
   if(log.includes('Connecting to 127.0.0.1, ') && /joined the game|Loaded \d+ advancements|Received client config|Connected to server|Получено достижений|присоединился к игре/i.test(log)){
     const status=await queryServer('127.0.0.1',mc.port);joined=!!status.players?.online;
   }
   if(joined && counts.textures)break;
   if(stage.startsWith('Игра завершилась')||stage==='Игра закрыта')break;
 }
 const report={joined,...counts,remotePackBytes:transferred,firstPackRequests:firstRequests,testFolder:data};
 console.log('GAME_RESULT',JSON.stringify(report));
 assert.ok(joined,'Тестовый клиент не подтвердил вход в мир');
 assert.ok(counts.textures,'Нет запроса текстуры от игры');
 assert.equal((await db.query('SELECT id FROM challenges WHERE consumed')).rows.length,1);
 assert.ok(await duplicateLogin(mc.gatewayPort,cfg.apiCA,account.nickname,offlineUuid(account.nickname)),'Ранний отказ дубликату не получен');
 assert.equal((await queryServer('127.0.0.1',mc.port)).players?.online,1);
 console.log('Duplicate login rejected before evicting the genuine player');
 await db.query('UPDATE accounts SET banned=true WHERE nickname=$1',[account.nickname]);
 await until(async()=>!(await listed())&&(await queryServer('127.0.0.1',mc.port)).players?.online===0,'Заблокированный игрок остался на сервере');
 await app.evaluate(()=>{(globalThis as any).smokeJava?.kill();});
 await db.query('UPDATE accounts SET banned=false WHERE nickname=$1',[account.nickname]);await until(listed,'Вайт-лист не восстановился');
 const tunnel=await startTunnel('127.0.0.1',mc.gatewayPort,cfg.apiCA);
 const fakeBroker=await startBroker(async()=>({ticket:randomBytes(32).toString('base64url')}));
 let spoof:Awaited<ReturnType<typeof launchGame>>|undefined;
 try{
   spoof=await launchGame(path.join(data,'instance'),{nickname:account.nickname,uuid:offlineUuid(account.nickname)},tunnel.port,{...fakeBroker.env,SMP_GAME_PORT:String(tunnel.port)},4);
   spoof.stdout?.resume();spoof.stderr?.resume();
   await until(async()=>deniedProofs>0,'Нет отказа реальному клиенту с поддельным билетом',150000);
   assert.equal((await queryServer('127.0.0.1',mc.port)).players?.online,0);
   assert.equal((await db.query('SELECT id FROM challenges WHERE consumed')).rows.length,1);
   console.log('SECURITY genuine login, ban/kick, unban and denial of identical nickname/UUID with a fabricated ticket passed');
   const exited=once(spoof,'exit');spoof.kill();await exited;
   await api.close();
   const serverLog=()=>readFile(path.join(mc.root,'logs/latest.log'),'utf8');
   await until(async()=>(await serverLog()).includes('whitelist sync failed; new logins denied'),'Сервер не обнаружил остановку API');
   assert.ok(await listed(),'Сбой API перезаписал whitelist.json');
   spoof=await launchGame(path.join(data,'instance'),{nickname:account.nickname,uuid:offlineUuid(account.nickname)},tunnel.port,{...fakeBroker.env,SMP_GAME_PORT:String(tunnel.port)},4);
   spoof.stdout?.resume();spoof.stderr?.resume();
   await until(async()=>(await serverLog()).includes('Сервис списка допуска недоступен'),'При выключенном API не получен отказ входа',150000);
   assert.equal((await queryServer('127.0.0.1',mc.port)).players?.online,0);
   console.log('API outage denied new login despite persisted whitelist');
 }finally{spoof?.kill();fakeBroker.close();tunnel.close();}
}finally{
 if(app){
   const closed=app.waitForEvent('close',{timeout:15000});
   await app.evaluate(({app:desktop})=>{(globalThis as any).smokeJava?.kill();setTimeout(()=>desktop.exit(0),100);}).catch(()=>{});
   await closed;
 }
 if(backend)await backend.close();
 bridge.closeAllConnections();bridge.close();await api.close();await db.close();
}
