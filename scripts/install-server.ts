import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {download} from '../src/launcher/files.js';
// Installer source and digest are resolved from the same official HTTPS Maven origin.
// Java 21 path is explicit for server administrators; client runtime is automatic.
const root=path.resolve(process.argv[2]??'.local/server'),java=process.argv[3];
if(!java)throw new Error('install-server ПАПКА ПУТЬ_К_JAVA21');
const version=await promisify(execFile)(java,['-version'],{windowsHide:true});if(!/version "21\./.test(version.stderr))throw new Error('Требуется Java 21');
await mkdir(root,{recursive:true});const url='https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.256/neoforge-21.1.256-installer.jar';
const checksum=await fetch(url+'.sha256',{signal:AbortSignal.timeout(30000)});if(!checksum.ok)throw new Error('Недоступна официальная SHA-256 NeoForge');const hash=(await checksum.text()).trim().split(/\s+/)[0]!;if(!/^[a-fA-F0-9]{64}$/.test(hash))throw new Error('Неверный формат SHA-256');
const response=await fetch(url,{method:'HEAD',signal:AbortSignal.timeout(30000)});const size=Number(response.headers.get('content-length'));if(!response.ok||!Number.isSafeInteger(size)||size<1)throw new Error('Не удалось проверить размер установщика');
const jar=path.join(root,'neoforge-installer.jar');await download({path:'installer.jar',url,size,sha256:hash.toLowerCase(),side:'server',policy:'managed',required:true,license:'LGPL-2.1-only',source:'https://github.com/neoforged/NeoForge'},jar);
await promisify(execFile)(java,['-jar',jar,'--installServer',root],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024});
await writeFile(path.join(root,'server.properties'),await readFile('config/server.properties.example'),{flag:'wx'}).catch((e:any)=>{if(e.code!=='EEXIST')throw e;});
console.log('NeoForge установлен. Изучите EULA Minecraft и примите её самостоятельно. Затем установите community-gate и проверенный серверный набор.');
