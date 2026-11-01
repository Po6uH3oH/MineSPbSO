import { importInstalledNeoForge, importNeoForgeCache } from './local-runtime.js';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hashFile } from './files.js';
import { noProgress, type Transfer } from './progress.js';
import os from 'node:os';
import { MinecraftFolder, Version, launch, type LaunchOption } from '@xmcl/core';
import { getVersionList, resolveMinecraftVersionJsonInstallFile, resolveMinecraftJarInstallFile, resolveLibraryInstallFiles, resolveAssetMetadataInstallManifest, resolveAssetObjectInstallFiles, createDefaultNodeInstallRuntime, executeInstallManifest, executeInstallWorkflow, resolveNeoForgedInstallerFile, createModernForgeInstallWorkflow, createJavaRuntimeInstallWorkflow, DEFAULT_RUNTIME_ALL_URL, ProgressTrackerMultiple, createFileTransferInstallDownload, type InstallFile } from '@xmcl/installer';

export function memoryBudget(total=os.totalmem(),free=os.freemem(),requested=4){
 const gib=1024**3,max=Math.max(4,Math.min(10,Math.floor(total/gib-4))),recommended=Math.min(max,Math.max(4,Math.floor(total/gib/2)));
 const selected=Math.max(4,Math.min(max,Math.floor(requested)));
 return {max,recommended,selected,canLaunch:total>=7.5*gib&&free>=(selected+1.5)*gib};
}
async function officialInstaller(folder:MinecraftFolder,root:string) {
 const name='neoforge-21.1.256-installer.jar';
 const relative='net/neoforged/neoforge/21.1.256/'+name;
 const filePath=folder.getLibraryByPath(relative);
 const receipt=path.join(root,'neoforge-21.1.256-installer.sha1');
 const expected=(await readFile(receipt,'utf8').catch(()=>'')).trim();
 if(/^[0-9a-f]{40}$/.test(expected) && await hashFile(filePath,'sha1').catch(()=>null)===expected){
   return {path:filePath,urls:['https://maven.neoforged.net/releases/'+relative],checksum:{algorithm:'sha1',value:expected},validator:'zip' as const};
 }
 const {file}=await resolveNeoForgedInstallerFile('neoforge','21.1.256',folder,{signal:AbortSignal.timeout(9000)});
 if(!file.checksum)throw new Error('Maven NeoForge недоступен или не вернул контрольную сумму 21.1.256. Проверьте maven.neoforged.net и нажмите «Играть» ещё раз.');
 await writeFile(receipt,file.checksum.value);
 return file;
}
export async function installGame(root:string,status:(s:string)=>void=console.log,localProfile?:string, progress:Transfer=noProgress, installedCache?:string) {
 if(process.platform!=='win32'||process.arch!=='x64')throw new Error('В этой версии поддерживается Windows x64');
 const folder=MinecraftFolder.from(path.join(root,'minecraft'));await mkdir(folder.root,{recursive:true});
 let phase = 'Проверяем NeoForge';
 status(phase);
 let version = localProfile ? await importInstalledNeoForge(localProfile, folder.root) : undefined;
 if(!version && installedCache) {
   status('Проверяем установленный NeoForge в кеше Modrinth');
   version=await importNeoForgeCache(installedCache,folder.root);
 }
 const installer = version ? undefined : await officialInstaller(folder,root);
 const runtime = createDefaultNodeInstallRuntime({
   download: async pending => {
     const tracker = new ProgressTrackerMultiple();
     const known = pending.every(file => typeof file.size === 'number' && file.size >= 0);
     const total = known ? pending.reduce((sum,file) => sum + file.size!,0) : undefined;
     const render = () => progress(phase, tracker.progress, total);
     render();
     const timer = setInterval(render, 250);
     try { await createFileTransferInstallDownload({tracker})(pending); progress(phase,total ?? tracker.progress,total); }
     catch(error) {
       if(pending.some(file=>file.urls.some(url=>url.startsWith('https://maven.neoforged.net/'))))
         throw new Error('Не удалось скачать файлы NeoForge. Проверьте доступ к maven.neoforged.net и повторите запуск.',{cause:error});
       throw new Error('Не удалось загрузить файлы на этапе «'+phase+'». Проверьте связь и повторите запуск.',{cause:error});
     } finally { clearInterval(timer); }
   }
 });
 const files=async(id:string,items:InstallFile[])=>executeInstallManifest({schemaVersion:1,tasks:[{id,type:'files',files:items}]},runtime);
 status(phase = 'Подготавливаем Java 21');
 const r=await fetch(DEFAULT_RUNTIME_ALL_URL,{signal:AbortSignal.timeout(30_000)});if(!r.ok)throw new Error('Недоступен каталог Java Mojang');
 const catalog=await r.json() as any;const target=catalog['windows-x64']['java-runtime-delta'][0];
 if(!target.version.name.startsWith('21.'))throw new Error('Источник вернул Java не версии 21');
 const javaHome=path.join(root,'runtime');
 await executeInstallWorkflow(createJavaRuntimeInstallWorkflow({target,destination:javaHome}),runtime);
 const javaPath=path.join(javaHome,'bin','java.exe');
 const versionCheck=await promisify(execFile)(javaPath,['-version'],{windowsHide:true});if(!/version "21\./.test(versionCheck.stderr))throw new Error('Проверка Java 21 не пройдена');
 status(phase = 'Читаем каталог Minecraft 1.21.1');
 const list=await getVersionList();const base=list.versions.find(v=>v.id==='1.21.1');if(!base)throw new Error('Minecraft 1.21.1 отсутствует в официальном каталоге');
 await files('version',[resolveMinecraftVersionJsonInstallFile(base,folder)]);
 const vanilla=await Version.parse(folder,'1.21.1');const jar=resolveMinecraftJarInstallFile(vanilla);if(!jar)throw new Error('Отсутствует client.jar');

 await executeInstallManifest(resolveAssetMetadataInstallManifest(vanilla,folder),runtime);
 status(phase = 'Minecraft 1.21.1 · клиент, библиотеки и ресурсы');
 await files('minecraft',[jar,...resolveLibraryInstallFiles(vanilla.libraries,folder),...await resolveAssetObjectInstallFiles(vanilla,folder)]);
 status(phase = 'Устанавливаем NeoForge 21.1.256');
 if(installer){
 const result=await executeInstallWorkflow(createModernForgeInstallWorkflow({id:'neoforge',minecraft:folder,minecraftVersion:'1.21.1',artifactVersion:'21.1.256',installer,java:javaPath,installOptions:{},side:'client'}),runtime);
 version=result.version;
 }
 if (!version) throw new Error('Установщик NeoForge не вернул версию');
 const resolved=await Version.parse(folder,version);await files('neoforge-libraries',resolveLibraryInstallFiles(resolved.libraries,folder));
 await writeFile(path.join(root,'game-install.json'),JSON.stringify({version,javaPath,resourcePath:folder.root},null,2));
 return {version,javaPath,resourcePath:folder.root};
}
export function gameLaunchOptions(root:string,installation:{version:string,javaPath:string,resourcePath:string},profile:{nickname:string,uuid:string},port:number|string|undefined,env:NodeJS.ProcessEnv,memory:number):LaunchOption {
 return {...installation,gamePath:path.join(root,'game'),gameProfile:{name:profile.nickname,id:profile.uuid.replaceAll('-','')},accessToken:'0',userType:'legacy',minMemory:1024,maxMemory:memory*1024,extraJVMArgs:['-XX:+UseG1GC'],quickPlayMultiplayer:typeof port==='number'?`127.0.0.1:${port}`:port,extraExecOption:{env:{...process.env,...env},windowsHide:true}};
}
export async function launchGame(root:string,profile:{nickname:string,uuid:string},port:number|string|undefined,env:NodeJS.ProcessEnv,memory:number) {
 const budget=memoryBudget(undefined,undefined,memory);if(!budget.canLaunch)throw new Error('Недостаточно свободной памяти. Закройте другие приложения; игре нужно от 4 ГБ, также нужен запас для Windows и JVM.');
 const installation=JSON.parse(await readFile(path.join(root,'game-install.json'),'utf8'));
 return launch(gameLaunchOptions(root,installation,profile,port,env,budget.selected));
}
