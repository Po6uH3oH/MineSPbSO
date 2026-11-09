import {gamePreferencesSchema,parseJvmArgs} from './preferences.js';
import {graphicsSelection,applyGraphics} from './graphics.js';
import { app,BrowserWindow,ipcMain,safeStorage,shell,dialog,Menu } from 'electron';
import {verifiedInstaller,newer,releases} from './launcher-updates.js';
import { autoUpdater } from 'electron-updater';
import { readFile,writeFile,mkdir,unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { serverTargets,queryServer } from './server-status.js';
import { communityFetch,skinEndpoint } from './tester-network.js';
import { cacheArchive } from './tester-release.js';
import type { Transfer } from './progress.js';
import { z } from 'zod';
import { configSchema,trustedUrl } from './config.js';
import { acquireLock,verifyManifest,installPack,atomicJson,download,hashFile,safePath } from './files.js';
import { installGame,launchGame,memoryBudget } from './game.js';
import {gameLoopback,saveCommunityServer} from './saved-server.js';
import { withCommunityGate } from './gate.js';
import { startBroker,startTunnel,checkGateway } from './tunnel.js';
import { importLocalPack } from './local-pack.js';
import { configureSkins } from './skins.js';

import {clearDownloadCache,createJournal} from './maintenance.js';
async function main(){
if(!app.isPackaged&&process.env.SMP_DEV_USERDATA)app.setPath('userData',path.resolve(process.env.SMP_DEV_USERDATA));
if(!app.requestSingleInstanceLock()){app.quit();return;}
let win:BrowserWindow,access='',refresh='',remember=false,busy=false,memoryMb=4096,updating:Promise<void>|undefined;
let stage='Готов к работе';const events:{time:string,event:string}[]=[];
const status=(text:string)=>{progressValue=null;win?.webContents.send('progress',null);stage=text;if(logging)void journal(text);events.push({time:new Date().toISOString(),event:text});if(events.length>100)events.shift();win?.webContents.send('status',text);};
await app.whenReady();
Menu.setApplicationMenu(null);
const root=path.join(app.getPath('userData'),'instance');await mkdir(root,{recursive:true});
const configPath=app.isPackaged?path.join(process.resourcesPath,'launcher-config.json'):path.resolve('config/launcher.local.json');
const config=configSchema.parse(JSON.parse(await readFile(configPath,'utf8').catch(()=>readFile(path.resolve('config/launcher.example.json'),'utf8'))));
trustedUrl(config.apiUrl,true);
const fetchFile=communityFetch(config.apiUrl,config.apiCA);
const tester=config.testerMode && !config.manifestUrl;
let progressValue:{label:string,bytes:number,total?:number}|null=null;
let lastProgress=0;
const progress:Transfer=(label,bytes,total)=>{
 const now=Date.now();
 if (progressValue?.label===label && now-lastProgress<180 && bytes!==total)return;
 lastProgress=now; progressValue={label,bytes,total};win?.webContents.send('progress',progressValue);
};
const tokenPath=path.join(app.getPath('userData'),'session.bin');
let localPack = '';
const settingsFile=path.join(app.getPath('userData'),'settings.json');
const settings=JSON.parse(await readFile(settingsFile,'utf8').catch(()=>'{}'));
const logFolder=path.join(app.getPath('userData'),'launcher-logs');
const journal=createJournal(logFolder);let logging=settings.logging===true;
let enhancedGraphics=settings.enhancedGraphics===true;
let preferences=gamePreferencesSchema.parse(settings.preferences??{});
let sessionError:{message:string,status?:number,detail?:string}|null=null;
const legacyMemory = z.number().int().min(3).max(10).catch(4).parse(settings.memory) * 1024;
memoryMb = Math.min(memoryBudget().max * 1024, z.number().int().min(3072).max(10240).catch(legacyMemory).parse(settings.memoryMb));
localPack=z.string().catch('').parse(settings.localPack);
const isOwner=Object.values(os.networkInterfaces()).flat().some(n=>n?.address===config.testerHost);
let host=serverTargets(settings.host ?? (isOwner?'localhost':config.testerHost)).host;
const gatewayArgs=():[string,number,string|undefined]=>[tester?(host==='localhost'?'127.0.0.1':host):config.gatewayHost,config.gatewayPort,config.gatewayCA || (tester?config.apiCA:undefined) || undefined];
const openGameTunnel=()=>startTunnel(...gatewayArgs());
async function protectedStatus(){
 const channel=await openGameTunnel();
 try{return await queryServer('127.0.0.1',channel.port);}finally{channel.close();}
}
const saveSettings=()=>atomicJson(settingsFile,{memoryMb,localPack,host,logging,enhancedGraphics,preferences});

async function saveSession(){if(remember&&refresh){if(!safeStorage.isEncryptionAvailable())throw new Error('Защищённое хранилище Windows недоступно');await writeFile(tokenPath,safeStorage.encryptString(refresh));}else await unlink(tokenPath).catch(()=>{});}
async function request(route:string,body?:unknown,token?:string){
 const r=await fetchFile(config.apiUrl+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)}).catch((e:any)=>{throw Object.assign(new Error('Сервис аккаунтов недоступен. Проверьте подключение и попробуйте снова.'),{status:0,detail:`${body===undefined?'GET':'POST'} ${route} · ${e.cause?.code??e.name??'NETWORK_ERROR'}`});});
 let value:any;try{value=await r.json();}catch{throw Object.assign(new Error('Сервис аккаунтов вернул некорректный ответ.'),{status:502,detail:`${route} · HTTP ${r.status} · ожидался JSON`});}
 if(!r.ok)throw Object.assign(new Error(value.error??'Сервис недоступен'),{status:r.status,detail:`${route} · HTTP ${r.status}`});return value;
}
async function renew(){if(!refresh)throw new Error('Войдите в аккаунт');if(!updating)updating=(async()=>{const v=await request('/auth/refresh',{refresh});access=v.access;refresh=v.refresh;await saveSession();})().finally(()=>{updating=undefined;});await updating;}
async function authenticated(route:string,body?:unknown){try{return await request(route,body,access);}catch(e:any){if(e.status!==401)throw e;await renew();return request(route,body,access);}}
try{if(preferences.autoLogin&&safeStorage.isEncryptionAvailable()){refresh=safeStorage.decryptString(await readFile(tokenPath));remember=true;await renew();}}catch(e:any){if(e.code!=='ENOENT')sessionError={message:e.message,status:e.status,detail:e.detail};access='';refresh='';if(e.status===401)await unlink(tokenPath).catch(()=>{});}
let gameProcess:Awaited<ReturnType<typeof launchGame>>|undefined;
win=new BrowserWindow({show:process.env.SMP_TEST_HEADLESS!=='1',width:1100,height:760,resizable:false,maximizable:false,fullscreenable:false,frame:false,backgroundColor:'#101b2c',title:config.name,icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
win.on('close',e=>{if(busy){e.preventDefault();status('Игра или установка ещё работает. Закройте игру перед выходом из лаунчера.');}});
function handler(name:string,fn:(value:any)=>Promise<any>){ipcMain.handle(name,async(event,value)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Недопустимый запрос');try{return {ok:true,value:await fn(value)};}catch(e:any){if(logging)void journal('Ошибка операции '+name+' · '+(/^(ENOENT|EACCES|EPERM|ENOSPC|EBUSY|ECONNRESET|ETIMEDOUT)$/.test(e.code)?e.code:e.status>=400&&e.status<600?'HTTP '+Number(e.status):'см. сообщение в окне'));return {ok:false,error:e.message??'Не удалось выполнить действие',status:e.status,detail:e.detail};}});}
let candidate:ReturnType<typeof verifiedInstaller>|undefined,downloaded=false,updateWork=false;
const nativeUpdates=!!config.updateUrl&&config.signedUpdates;
async function currentAccount(){if(!access)return null;try{return await authenticated('/me');}catch(e:any){sessionError={message:e.message,status:e.status,detail:e.detail};access='';if(e.status===401){refresh='';await saveSession();}return null;}}
handler('window',async value=>{if(value==='minimize')win.minimize();else if(value==='close')win.close();else throw new Error('Неизвестное действие окна');});
handler('preferences',async value=>{if(busy)throw new Error('Закройте игру перед изменением параметров.');const next=gamePreferencesSchema.parse(value);parseJvmArgs(next.jvmArgs);preferences=next;await saveSettings();});
handler('state',async()=>({name:config.name,news:config.news,stage,memoryMb,localPack,host,logging,enhancedGraphics,preferences,tester,progress:progressValue,remotePack:!!config.testerPackKey,budget:memoryBudget(),account:await currentAccount(),sessionError,hasMap:tester||!!config.blueMapUrl,updates:nativeUpdates,version:app.getVersion(),availableVersion:candidate?.version,downloaded}));
handler('auth',async raw=>{
 const v=z.object({action:z.enum(['login','register','verify','forgot','reset','resend','logout','revoke-all']),data:z.record(z.string(),z.unknown()).default({})}).parse(raw);
 if(v.action==='login'){sessionError=null;remember=v.data.remember===true;const r=await request('/auth/login',{email:v.data.email,password:v.data.password});access=r.access;refresh=r.refresh;await saveSession();return r.account;}
 if(v.action==='logout'||v.action==='revoke-all'){if(v.action==='revoke-all')await authenticated('/auth/revoke-all',{});else await authenticated('/auth/logout',{}).catch(()=>{});access='';refresh='';remember=false;sessionError=null;await saveSession();return null;}
 if(v.action==='resend')return authenticated('/auth/resend',{});
 return request(`/auth/${v.action}`,v.data);
});
handler('logging',async value=>{logging=z.boolean().parse(value);await saveSettings();if(logging)await journal('Включён журнал · версия '+app.getVersion());});
handler('open-logs',async()=>{await mkdir(logFolder,{recursive:true});if(await shell.openPath(logFolder))throw new Error('Не удалось открыть папку журнала.');});
handler('maintenance',async value=>{
 const mode=z.enum(['check','clear']).parse(value);
 if(busy||updateWork)throw new Error('Дождитесь завершения операции или закройте игру.');
 busy=true;
 try{const release=await acquireLock(root);try{
  if(mode==='clear')return 'Удалено файлов кеша: '+await clearDownloadCache(root);
  return 'Экземпляр свободен. Можно запускать игру.';
 }finally{await release();}}finally{busy=false;}
});
handler('graphics',async value=>{if(busy||updateWork)throw new Error('Закройте игру и дождитесь установки');const next=z.boolean().parse(value);if(next!==enhancedGraphics)memoryMb=Math.min(memoryBudget().max*1024,next?6144:4096);enhancedGraphics=next;await saveSettings();});
handler('memory', async value => {
 const max = memoryBudget().max * 1024;
 if (!Number.isInteger(value) || value < 3072 || value > max) throw new Error('Введите целое число от 3072 до '+max+' МБ.');
 memoryMb = value;
 await saveSettings();
 return memoryMb;
});
handler('folder',async()=>{await mkdir(path.join(root,'game'),{recursive:true});const e=await shell.openPath(path.join(root,'game'));if(e)throw new Error(e);});
let lastChecks:{label:string,ok:boolean,detail:string}[]=[];
handler('check-network',async()=>{
 if(!tester)throw new Error('Проверка предназначена для тестового сервера.');
 const targets=serverTargets(host);
 const check=async(label:string,run:()=>Promise<string>)=>{
   try{return {label,ok:true,detail:await run()};}catch{return {label,ok:false,detail:'нет подтверждённого ответа'};}
 };
 const get=async(url:string,useCommunity=false)=>{
   const r=await (useCommunity?fetchFile:fetch)(url,{signal:AbortSignal.timeout(9000)});
   if(!r.ok){await r.body?.cancel();throw new Error('HTTP '+r.status);}return r;
 };
 lastChecks=await Promise.all([
   check('Аккаунты',async()=>{const r=await get(config.apiUrl+'/health',true);if(!(await r.json() as any)?.ok)throw new Error();return 'база доступна';}),
   check('Сборка',async()=>{const r=await get(config.apiUrl+'/packs/current.json',true);const m=verifyManifest(await r.text(),config.testerPackKey);return m.files.length+' файлов, подпись верна';}),
   check('Minecraft',async()=>{const r=await protectedStatus();return r.players?r.players.online+' из '+r.players.max:'сервер в сети';}),
   check('BlueMap',async()=>{const r=await get(targets.map);await r.body?.cancel();return 'HTTP '+r.status;}),
   check('Maven NeoForge',async()=>{const r=await get('https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.256/neoforge-21.1.256-installer.jar.sha1');if(!/^[a-f0-9]{40}/i.test((await r.text()).trim()))throw new Error();return 'версия 21.1.256 доступна';}),
 ]);
 return lastChecks;
});
handler('host',async value=>{if(!tester||busy)throw new Error('Смена адреса сейчас недоступна');host=serverTargets(z.string().parse(value)).host;await saveSettings();return host;});
handler('remote-pack',async()=>{if(busy)throw new Error('Закройте игру');localPack='';await saveSettings();});
handler('server-status',async()=>{try{return await protectedStatus();}catch{return null;}});
handler('map',async()=>{if(tester){await shell.openExternal(serverTargets(host).map);return;}if(!config.blueMapUrl)throw new Error('Карта ещё не настроена');await shell.openExternal(trustedUrl(config.blueMapUrl));});
handler('skin-preview', async hash => {
 if (!access || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return null;
 const response = await fetchFile(config.apiUrl+'/csl/textures/'+hash, {signal:AbortSignal.timeout(5000)});
 if (!response.ok) return null;
 const bytes = Buffer.from(await response.arrayBuffer());
 return bytes.length <= 65536 ? 'data:image/png;base64,'+bytes.toString('base64') : null;
});
handler('skin',async raw=>{const model=z.enum(['default','slim']).parse(raw);const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'PNG-скин',extensions:['png']}]});if(result.canceled)return;
 const data=await readFile(result.filePaths[0]!);if(data.length>65536)throw new Error('Скин должен быть меньше 64 КБ');await renew();const form=new FormData();form.set('skin',new Blob([data]),'skin.png');const r=await fetchFile(`${config.apiUrl}/me/skin?model=${model}`,{method:'POST',headers:{Authorization:`Bearer ${access}`},body:form,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error((await r.json() as any).error);return true;});
handler('diagnostics',async()=>{const target=await dialog.showSaveDialog(win,{defaultPath:'smp-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(target.canceled||!target.filePath)return;await writeFile(target.filePath,JSON.stringify({launcher:app.getVersion(),platform:process.platform,arch:process.arch,memoryGiB:memoryBudget().max+4,stages:events,network:lastChecks},null,2));return true;});
handler('select-pack',async()=>{
 if(busy)throw new Error('Сначала дождитесь установки или закройте игру');
 const selected=await dialog.showOpenDialog(win,{title:'Папка сборки с каталогом mods',properties:['openDirectory'],defaultPath:path.join(app.getPath('appData'),'ModrinthApp','profiles')});
 if(selected.canceled)return;
 localPack=selected.filePaths[0]!;
 await saveSettings();
});
handler('play',async()=>{
 if(busy||updateWork)throw new Error('Игра или установка уже запущена');busy=true;let unlock:(()=>Promise<void>)|undefined,broker:Awaited<ReturnType<typeof startBroker>>|undefined,tunnel:Awaited<ReturnType<typeof startTunnel>>|undefined;
 let skins:Awaited<ReturnType<typeof skinEndpoint>>|undefined;
 let cleaned=false;
 const cleanup=async()=>{if(cleaned)return;cleaned=true;skins?.close();skins=undefined;broker?.close();broker=undefined;tunnel?.close();tunnel=undefined;const release=unlock;unlock=undefined;try{if(release)await release();}catch{if(logging)await journal('Не удалось удалить отметку запуска');}finally{busy=false;gameProcess=undefined;}};
 try{
  const profile=await authenticated('/me');if(!profile.verified)throw new Error('Сначала подтвердите почту');
  if(!tester && (!config.manifestUrl || !config.manifestPublicKey))throw new Error('Владелец ещё не настроил подписанный серверный выпуск.');
  if(!localPack&&!config.testerPackKey&&(!config.manifestUrl||!config.manifestPublicKey))throw new Error('Выберите папку сборки в настройках. Серверный выпуск пока не настроен.');
  if(!memoryBudget(undefined,undefined,memoryMb/1024).canLaunch)throw new Error('Недостаточно свободной памяти. Закройте другие приложения и повторите попытку.');
  unlock=await acquireLock(root);
  status('Проверяем защищённый вход на сервер');
  await checkGateway(...gatewayArgs());
  if(tester){
   if(localPack){
     await installGame(root,status,localPack,progress);
     await importLocalPack(localPack,root,status,m=>withCommunityGate(root,m),enhancedGraphics);
   }else{
     status('Получаем подписанный список файлов');
     const response=await fetchFile(config.apiUrl+'/packs/current.json',{signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw new Error('Список файлов сборки недоступен. Владелец должен подготовить выпуск и запустить раздачу.');
     const checkpoint=path.join(root,'tester-sequence.json');
     const previous=JSON.parse(await readFile(checkpoint,'utf8').catch(()=>'{}'));
     const manifest=verifyManifest(await response.text(),config.testerPackKey,previous.sequence??0);
     await installGame(root,status,undefined,progress,path.join(app.getPath('appData'),'ModrinthApp','meta'));
     const legacyConfigs=manifest.files.some(f=>f.path.startsWith('config/'));
     manifest.files=manifest.files.filter(f=>!f.path.startsWith('config/'));
     if(manifest.archive&&!manifest.graphics&&!legacyConfigs&&!await readFile(path.join(root,'installed.json')).then(()=>true,()=>false)){status('Проверяем архив сборки');await cacheArchive(root,manifest,progress,fetchFile);}
     await installPack(root,await withCommunityGate(root,manifest),'client',status,graphicsSelection(manifest,enhancedGraphics),progress,fetchFile);
     await applyGraphics(root,manifest,enhancedGraphics);
     await atomicJson(checkpoint,{sequence:manifest.sequence});
   }
   skins=await skinEndpoint(config.apiUrl,fetchFile);
   await configureSkins(root,skins.url);

  }else{
   status('Проверяем выпуск сборки');
  const response=await fetch(trustedUrl(config.manifestUrl,true),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Выпуск недоступен');
  const current=JSON.parse(await readFile(path.join(root,'trusted-sequence.json'),'utf8').catch(()=>'{}'));
  const text=await response.text();if(text.length>3_000_000)throw new Error('Манифест слишком велик');const manifest=verifyManifest(text,config.manifestPublicKey,current.sequence??0);
  manifest.files=manifest.files.filter(f=>!f.path.startsWith('config/'));
  await installGame(root,status,undefined,progress);await installPack(root,await withCommunityGate(root,manifest),'client',status,graphicsSelection(manifest,enhancedGraphics),progress);await applyGraphics(root,manifest,enhancedGraphics);await configureSkins(root,config.apiUrl);await atomicJson(path.join(root,'trusted-sequence.json'),{sequence:manifest.sequence});
  }
  tunnel=await startTunnel(...gatewayArgs(),gameLoopback);
  await saveCommunityServer(root,config.name,tunnel.port);
  broker=await startBroker(challenge=>authenticated('/join/ticket',{challenge}));
  status('Запускаем игру');gameProcess=await launchGame(root,profile,preferences.autoJoin?gameLoopback+':'+tunnel.port:undefined,{...broker.env,SMP_GAME_PORT:String(tunnel.port)},memoryMb/1024,preferences);
  gameProcess.stdout?.resume();gameProcess.stderr?.resume();
  gameProcess.once('error',()=>{status('Не удалось запустить Java');void cleanup();});
  gameProcess.once('exit',(code,signal)=>{if(logging)void journal('Java завершилась · код '+code+' · сигнал '+signal);status(code===0?'Игра закрыта':'Игра завершилась с ошибкой. Проверьте журнал в папке игры.');void cleanup();});return true;
 }catch(e){await cleanup();status('Не удалось запустить игру — можно повторить попытку');throw e;}
});
if(config.updateUrl&&config.signedUpdates){trustedUrl(config.updateUrl);autoUpdater.setFeedURL({provider:'generic',url:config.updateUrl});autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.on('error',()=>status('Не удалось проверить обновление лаунчера'));autoUpdater.on('update-available',()=>status('Доступно обновление лаунчера'));autoUpdater.on('update-downloaded',()=>status('Обновление скачано. Можно установить.'));}
handler('update',async action=>{
 if(action==='releases'){
   await shell.openExternal(candidate?releases+'/tag/tester-v'+candidate.version:releases);return;
 }
 if(!nativeUpdates){
   if(updateWork||busy)throw new Error('Дождись завершения установки или закрой игру.');
   updateWork=true;
   try{
     if(action==='check'){
       const r=await fetchFile(config.apiUrl+'/launcher/current.json',{signal:AbortSignal.timeout(8000)});
       if(r.status===404){candidate=undefined;downloaded=false;return 'Владелец ещё не опубликовал обновление в канале лаунчера. Выпуски доступны на GitHub.';}
       if(!r.ok)throw new Error('Не удалось проверить обновления лаунчера.');
       const meta=verifiedInstaller(await r.json(),config.testerPackKey||config.manifestPublicKey);
       if(meta.sha256!==candidate?.sha256)downloaded=false;
       candidate=newer(meta.version,app.getVersion())?meta:undefined;
       return candidate?'Доступна версия '+candidate.version:'Установлена актуальная версия '+app.getVersion()+'.';
     }
     if(!candidate)throw new Error('Сначала проверь наличие новой версии.');
     const file=await safePath(app.getPath('userData'),'updates/MineSPbSO-'+candidate.version+'-Setup.exe');
     if(action==='download'){
       await download({...candidate,url:config.apiUrl+'/packs/files/'+candidate.sha256},file,bytes=>progress('Обновление лаунчера',bytes,candidate!.size),fetchFile);
       downloaded=true;status('Обновление скачано и проверено.');return 'Установщик готов.';
     }
     if(action==='install'){
       if(!downloaded||await hashFile(file)!==candidate.sha256){downloaded=false;throw new Error('Нужно повторно скачать обновление.');}
       const error=await shell.openPath(file);if(error)throw new Error(error);
       app.quit();return;
     }
     throw new Error('Неизвестное действие');
   }finally{updateWork=false;}
 }
 if(busy)throw new Error('Сначала закройте игру');if(action==='check')return !!await autoUpdater.checkForUpdates();if(action==='download'){await autoUpdater.downloadUpdate();return true;}if(action==='install'){autoUpdater.quitAndInstall();return true;}throw new Error('Неизвестное действие');});
await win.loadFile(path.join(__dirname,'index.html'));
app.on('window-all-closed',()=>app.quit());
}
void main().catch(e=>{dialog.showErrorBox('Не удалось открыть лаунчер',e instanceof Error?e.message:'Ошибка конфигурации');app.quit();});
