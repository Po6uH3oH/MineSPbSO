import {access,copyFile,lstat,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import net from 'node:net';

const [action,input]=process.argv.slice(2);
if(!['configure','start'].includes(action)||!input)throw new Error('secure-server.mjs configure|start СЕРВЕРНАЯ_ПАПКА');
const root=path.resolve(input),project=fileURLToPath(new URL('../',import.meta.url));
const propFile=path.join(root,'server.properties'),props=await readFile(propFile,'utf8');
const javaArgs='libraries/net/neoforged/neoforge/21.1.256/'+(process.platform==='win32'?'win_args.txt':'unix_args.txt');
await access(path.join(root,javaArgs));
const required={'server-ip':'127.0.0.1','server-port':'48906','online-mode':'false','enforce-secure-profile':'false','white-list':'true','enforce-whitelist':'true'};
const values=Object.fromEntries(props.split(/\r?\n/).filter(line=>/^[-\w]+\s*=/.test(line)).map(line=>{const eq=line.indexOf('=');return [line.slice(0,eq).trim(),line.slice(eq+1).trim()];}));
const gate='community-gate-0.2.0.jar';
const settings=process.env;
if(action==='configure'){
 const port=Number(values['server-port']||25565);
 const running=await new Promise(resolve=>{
   const s=net.connect(port,values['server-ip']||'127.0.0.1');
   s.setTimeout(2000,()=>s.destroy());
   s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));s.on('close',()=>resolve(false));
 });
 if(running)throw new Error('Сначала введите stop в консоли Minecraft и дождитесь сохранения мира.');
 const source=settings.GATE_JAR || path.join(project,'release',gate);
 await access(source);
 const mods=path.join(root,'mods');await mkdir(mods,{recursive:true});
 const {readdir}=await import('node:fs/promises');
 const old=(await readdir(mods)).filter(name=>/^community-gate.*\.jar$/i.test(name)&&name!==gate);
 if(old.length)throw new Error('Сохраните прежний community-gate вне mods: '+old.join(', '));
 const backup=propFile+'.before-community-gate';
 try{await copyFile(propFile,backup,constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
 const lines=props.trimEnd().split(/\r?\n/).filter(line=>!Object.hasOwn(required,line.split('=')[0].trim()));
 for(const [key,value] of Object.entries(required))lines.push(key+'='+value);
 await copyFile(source,path.join(mods,gate+'.tmp'));await rename(path.join(mods,gate+'.tmp'),path.join(mods,gate));
 await writeFile(propFile+'.tmp',lines.join('\n')+'\n');await rename(propFile+'.tmp',propFile);
 console.log('Мод установлен. Параметры сохранены. Резервная копия: '+backup);
}else{
 for(const [key,value] of Object.entries(required))if(values[key]!==value)throw new Error('Проверьте server.properties: '+key+'='+value);
 await access(path.join(root,'mods',gate));
 const secret=settings.SMP_SERVER_KEY??parseEnv(await readFile(path.join(project,'.env.local'),'utf8')).SERVER_KEY;
 if(!secret || secret.length<32)throw new Error('Настройте серверный ключ.');
 const java=settings.JAVA_EXE || 'java';
 const args=[];
 if(await lstat(path.join(root,'user_jvm_args.txt')).catch(()=>null))args.push('@user_jvm_args.txt');
 args.push('@'+javaArgs,'nogui');
 const env={...settings,SMP_API_URL:settings.SMP_API_URL||'http://127.0.0.1:3000',SMP_SERVER_KEY:secret};
 const child=spawn(java,args,{cwd:root,stdio:'inherit',env});
 child.on('error',()=>{console.error('Не удалось запустить Java 21.');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
}

