import { app,BrowserWindow,ipcMain,safeStorage,shell,dialog,Menu } from 'electron';
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
import { acquireLock,verifyManifest,installPack,atomicJson } from './files.js';
import { installGame,launchGame,memoryBudget } from './game.js';
import { startBroker,startTunnel } from './tunnel.js';
import { importLocalPack } from './local-pack.js';
import { configureSkins } from './skins.js';

async function main(){
if(!app.isPackaged&&process.env.SMP_DEV_USERDATA)app.setPath('userData',path.resolve(process.env.SMP_DEV_USERDATA));
if(!app.requestSingleInstanceLock()){app.quit();return;}
let win:BrowserWindow,access='',refresh='',remember=false,busy=false,memory=4,updating:Promise<void>|undefined;
let stage='Готов к работе';const events:{time:string,event:string}[]=[];
const status=(text:string)=>{progressValue=null;win?.webContents.send('progress',null);stage=text;events.push({time:new Date().toISOString(),event:text});if(events.length>100)events.shift();win?.webContents.send('status',text);};
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
memory=z.number().int().min(4).max(10).catch(4).parse(settings.memory);
localPack=z.string().catch('').parse(settings.localPack);
const isOwner=Object.values(os.networkInterfaces()).flat().some(n=>n?.address===config.testerHost);
let host=serverTargets(settings.host ?? (isOwner?'localhost':config.testerHost)).host;
const saveSettings=()=>atomicJson(settingsFile,{memory,localPack,host});

async function saveSession(){if(remember&&refresh){if(!safeStorage.isEncryptionAvailable())throw new Error('Защищённое хранилище Windows недоступно');await writeFile(tokenPath,safeStorage.encryptString(refresh));}else await unlink(tokenPath).catch(()=>{});}
async function request(route:string,body?:unknown,token?:string){
 const r=await fetchFile(config.apiUrl+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15_000)}).catch(()=>{throw new Error('Сервис аккаунтов недоступен. Проверьте подключение к сети сообщества и запуск сервиса владельцем.');});
 const value=await r.json() as any;if(!r.ok)throw Object.assign(new Error(value.error??'Сервис недоступен'),{status:r.status});return value;
}
async function renew(){if(!refresh)throw new Error('Войдите в аккаунт');if(!updating)updating=(async()=>{const v=await request('/auth/refresh',{refresh});access=v.access;refresh=v.refresh;await saveSession();})().finally(()=>{updating=undefined;});await updating;}
async function authenticated(route:string,body?:unknown){try{return await request(route,body,access);}catch(e:any){if(e.status!==401)throw e;await renew();return request(route,body,access);}}
try{if(safeStorage.isEncryptionAvailable()){refresh=safeStorage.decryptString(await readFile(tokenPath));remember=true;await renew();}}catch{access='';refresh='';}
let gameProcess:Awaited<ReturnType<typeof launchGame>>|undefined;
win=new BrowserWindow({show:process.env.SMP_TEST_HEADLESS!=='1',width:1060,height:760,minWidth:800,minHeight:650,backgroundColor:'#f1f6fd',title:config.name,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
win.on('close',e=>{if(busy){e.preventDefault();status('Игра или установка ещё работает. Закройте игру перед выходом из лаунчера.');}});
function handler(name:string,fn:(value:any)=>Promise<any>){ipcMain.handle(name,async(event,value)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw new Error('Недопустимый запрос');try{return {ok:true,value:await fn(value)};}catch(e:any){return {ok:false,error:e.message??'Не удалось выполнить действие'};}});}
handler('state',async()=>({name:config.name,news:config.news,stage,memory,localPack,host,tester,progress:progressValue,remotePack:!!config.testerPackKey,budget:memoryBudget(),account:access?await authenticated('/me').catch(()=>null):null,hasMap:tester||!!config.blueMapUrl,updates:!!config.updateUrl&&config.signedUpdates}));
handler('auth',async raw=>{
 const v=z.object({action:z.enum(['login','register','verify','forgot','reset','resend','logout','revoke-all']),data:z.record(z.string(),z.unknown()).default({})}).parse(raw);
 if(v.action==='login'){remember=v.data.remember===true;const r=await request('/auth/login',{email:v.data.email,password:v.data.password});access=r.access;refresh=r.refresh;await saveSession();return r.account;}
 if(v.action==='logout'||v.action==='revoke-all'){await authenticated(`/auth/${v.action}`,{});access='';refresh='';remember=false;await saveSession();return null;}
 if(v.action==='resend')return authenticated('/auth/resend',{});
 return request(`/auth/${v.action}`,v.data);
});
handler('memory',async value=>{memory=z.number().int().min(4).max(memoryBudget().max).parse(value);await saveSettings();return memory;});
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
   check('Minecraft',async()=>{const r=await queryServer(host);return r.players?r.players.online+' из '+r.players.max:'сервер в сети';}),
   check('BlueMap',async()=>{const r=await get(targets.map);await r.body?.cancel();return 'HTTP '+r.status;}),
   check('Maven NeoForge',async()=>{const r=await get('https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.256/neoforge-21.1.256-installer.jar.sha1');if(!/^[a-f0-9]{40}/i.test((await r.text()).trim()))throw new Error();return 'версия 21.1.256 доступна';}),
 ]);
 return lastChecks;
});
handler('host',async value=>{if(!tester||busy)throw new Error('Смена адреса сейчас недоступна');host=serverTargets(z.string().parse(value)).host;await saveSettings();return host;});
handler('remote-pack',async()=>{if(busy)throw new Error('Закройте игру');localPack='';await saveSettings();});
handler('server-status',async()=>{if(!tester)return null;try{return await queryServer(host);}catch{return null;}});
handler('map',async()=>{if(tester){await shell.openExternal(serverTargets(host).map);return;}if(!config.blueMapUrl)throw new Error('Карта ещё не настроена');await shell.openExternal(trustedUrl(config.blueMapUrl));});
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
 if(busy)throw new Error('Игра или установка уже запущена');busy=true;let unlock:(()=>Promise<void>)|undefined,broker:Awaited<ReturnType<typeof startBroker>>|undefined,tunnel:Awaited<ReturnType<typeof startTunnel>>|undefined;
 let skins:Awaited<ReturnType<typeof skinEndpoint>>|undefined;
 const cleanup=async()=>{skins?.close();skins=undefined;broker?.close();broker=undefined;tunnel?.close();tunnel=undefined;const release=unlock;unlock=undefined;if(release)await release();busy=false;gameProcess=undefined;};
 try{
  const profile=await authenticated('/me');if(!profile.verified)throw new Error('Сначала подтвердите почту');
  if(!tester && (!config.manifestUrl || !config.manifestPublicKey))throw new Error('Владелец ещё не настроил подписанный серверный выпуск.');
  if(!localPack&&!config.testerPackKey&&(!config.manifestUrl||!config.manifestPublicKey))throw new Error('Выберите папку сборки в настройках. Серверный выпуск пока не настроен.');
  if(!memoryBudget(undefined,undefined,memory).canLaunch)throw new Error('Недостаточно свободной памяти. Закройте другие приложения и повторите попытку.');
    unlock=await acquireLock(root);
  if(tester){
   if(localPack){
     await installGame(root,status,localPack,progress);
     await importLocalPack(localPack,root,status);
   }else{
     status('Получаем подписанный список файлов');
     const response=await fetchFile(config.apiUrl+'/packs/current.json',{signal:AbortSignal.timeout(12000)});
     if(!response.ok)throw new Error('Список файлов сборки недоступен. Владелец должен подготовить выпуск и запустить раздачу.');
     const checkpoint=path.join(root,'tester-sequence.json');
     const previous=JSON.parse(await readFile(checkpoint,'utf8').catch(()=>'{}'));
     const manifest=verifyManifest(await response.text(),config.testerPackKey,previous.sequence??0);
     await installGame(root,status,undefined,progress,path.join(app.getPath('appData'),'ModrinthApp','meta'));
     if(manifest.archive){status('Проверяем архив сборки');await cacheArchive(root,manifest,progress,fetchFile);}
     await installPack(root,manifest,'client',status,[],progress,fetchFile);
     await atomicJson(checkpoint,{sequence:manifest.sequence});
   }
   skins=await skinEndpoint(config.apiUrl,fetchFile);
   await configureSkins(root,skins.url);
   const address=serverTargets(host).game;
   status('Запускаем Minecraft · подключение к '+address);
   gameProcess=await launchGame(root,profile,address,{},memory);
  }else{
   status('Проверяем выпуск сборки');
  const response=await fetch(trustedUrl(config.manifestUrl,true),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Выпуск недоступен');
  const current=JSON.parse(await readFile(path.join(root,'trusted-sequence.json'),'utf8').catch(()=>'{}'));
  const text=await response.text();if(text.length>3_000_000)throw new Error('Манифест слишком велик');const manifest=verifyManifest(text,config.manifestPublicKey,current.sequence??0);
  if(!manifest.files.some(f=>f.required&&f.side!=='server'&&/^mods\/community-gate[^/]*\.jar$/.test(f.path)))throw new Error('В сборке отсутствует обязательный мод проверки входа');
  await installGame(root,status,undefined,progress);await installPack(root,manifest,'client',status,[],progress);await configureSkins(root,config.apiUrl);await atomicJson(path.join(root,'trusted-sequence.json'),{sequence:manifest.sequence});
  tunnel=await startTunnel(config.gatewayHost,config.gatewayPort,config.gatewayCA||undefined);
  broker=await startBroker(challenge=>authenticated('/join/ticket',{challenge}));
  status('Запускаем игру');gameProcess=await launchGame(root,profile,tunnel.port,{...broker.env,SMP_GAME_PORT:String(tunnel.port)},memory);
  }
  gameProcess.stdout?.resume();gameProcess.stderr?.resume();
  gameProcess.once('error',()=>{status('Не удалось запустить Java');void cleanup();});
  gameProcess.once('exit',(code)=>{status(code===0?'Игра закрыта':'Игра завершилась с ошибкой. Проверьте журнал в папке игры.');void cleanup();});return true;
 }catch(e){await cleanup();status('Не удалось запустить игру — можно повторить попытку');throw e;}
});
if(config.updateUrl&&config.signedUpdates){trustedUrl(config.updateUrl);autoUpdater.setFeedURL({provider:'generic',url:config.updateUrl});autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.on('error',()=>status('Не удалось проверить обновление лаунчера'));autoUpdater.on('update-available',()=>status('Доступно обновление лаунчера'));autoUpdater.on('update-downloaded',()=>status('Обновление скачано. Можно установить.'));}
handler('update',async action=>{if(!config.updateUrl||!config.signedUpdates)throw new Error('Подписанные обновления ещё не настроены');if(busy)throw new Error('Сначала закройте игру');if(action==='check')return !!await autoUpdater.checkForUpdates();if(action==='download'){await autoUpdater.downloadUpdate();return true;}if(action==='install'){autoUpdater.quitAndInstall();return true;}throw new Error('Неизвестное действие');});
await win.loadFile(path.join(__dirname,'index.html'));
app.on('window-all-closed',()=>app.quit());
}
void main().catch(e=>{dialog.showErrorBox('Не удалось открыть лаунчер',e instanceof Error?e.message:'Ошибка конфигурации');app.quit();});
