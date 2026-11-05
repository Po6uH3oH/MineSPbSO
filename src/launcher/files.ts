import { createHash, verify, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, lstat, readFile, writeFile, rename, copyFile, readdir, statfs, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { noProgress, type Transfer } from './progress.js';
import { z } from 'zod';

export const fileSchema=z.object({path:z.string(),url:z.url(),size:z.number().int().min(0).max(2**31),sha256:z.string().regex(/^[a-f0-9]{64}$/),side:z.enum(['client','server','both']),policy:z.enum(['managed','default']),required:z.boolean(),license:z.string().min(1),source:z.url()});
export const graphicsSchema = z.object({
 mods: z.array(z.string()).max(200),
 basicDistance: z.number().int().min(2).max(32),
 enhancedDistance: z.number().int().min(2).max(32),
 shaderPack: z.string().regex(/^shaderpacks\/[^/\\]+\.zip$/i).optional(),
 basicLodRadius: z.number().int().min(16).max(1024).optional(),
 enhancedLodRadius: z.number().int().min(16).max(1024).optional(),
});
export const manifestSchema=z.object({schema:z.literal(1),version:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),sequence:z.number().int().min(1),minecraft:z.literal('1.21.1'),neoforge:z.literal('21.1.256'),expires:z.iso.datetime(),files:z.array(fileSchema).max(2000),archive:z.object({url:z.url(),size:z.number().int().positive().max(4*1024**3),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),graphics:graphicsSchema.optional(),allowedAddons:z.array(z.string().regex(/^[a-f0-9]{64}$/)).default([])});
export type Manifest=z.infer<typeof manifestSchema>;
export function safeRelative(p:string) {
 if(p.length>220||p.includes('\\')||p.includes(':')||p.startsWith('/')||p.split('/').some(v=>!v||v==='.'||v==='..'||/[. ]$/.test(v)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(v)||/[<>"|?*\x00-\x1f]/.test(v)))throw new Error('Недопустимый путь в выпуске');
 return p;
}
export async function safePath(root:string,relative:string) {
 safeRelative(relative);let p=path.resolve(root);
 // Inspect every existing component, including the root; never follow user junctions.
 for(const segment of [p,...relative.split('/')]){p=path.isAbsolute(segment)?segment:path.join(p,segment);const s=await lstat(p).catch((e:any)=>{if(e.code==='ENOENT')return undefined;throw e;});if(s?.isSymbolicLink())throw new Error('Ссылки и junction в управляемых путях запрещены');}
 return p;
}
export function verifyManifest(envelope:string,key:string,minSequence=0):Manifest {
 const e=z.object({payload:z.string().max(2_000_000),signature:z.string().max(200)}).parse(JSON.parse(envelope));
 const bytes=Buffer.from(e.payload,'base64');if(!verify(null,bytes,key,Buffer.from(e.signature,'base64')))throw new Error('Подпись сборки недействительна');
 const m=manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
 if(Date.parse(m.expires)<=Date.now())throw new Error('Срок действия манифеста истёк');if(m.sequence<minSequence)throw new Error('Отклонён устаревший выпуск');
 const seen=new Set<string>();for(const f of m.files){safeRelative(f.path);if(seen.has(f.path.toLowerCase()))throw new Error('Дублирующийся путь');seen.add(f.path.toLowerCase());
  if(!(/^mods\/[^/]+\.jar$/i.test(f.path)&&f.policy==='managed')&&!((/^(config|resourcepacks|datapacks|shaderpacks)\/.+/.test(f.path)||f.path==='options.txt')&&f.policy==='default'))throw new Error('Путь или правило обновления не разрешены');
  const u=new URL(f.url);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('Источник должен использовать HTTPS');
 }
 if(m.graphics){
  if (m.graphics.shaderPack) {
   const shader = m.files.find(file => file.path === m.graphics!.shaderPack);
   if (!shader || shader.required || shader.side !== 'client' || shader.policy !== 'default')
    throw new Error('Шейдерпак должен быть необязательным клиентским ZIP в выпуске.');
  }
  if(new Set(m.graphics.mods).size!==m.graphics.mods.length)throw new Error('Дубли в графическом наборе');
  for(const p of m.graphics.mods){
   const f=m.files.find(f=>f.path===p);
   if(!f||f.required||f.side!=='client'||!/^mods\/[^/]+\.jar$/.test(p)||/community-gate/i.test(p))throw new Error('Графический набор должен содержать только необязательные клиентские моды');
  }
 }
 return m;
}
export async function hashFile(file:string,algorithm='sha256'){const h=createHash(algorithm);for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
export async function atomicJson(file:string,data:unknown){const temp=file+'.tmp';const h=await open(temp,'w');try{await h.writeFile(JSON.stringify(data,null,2));await h.sync();}finally{await h.close();}await rename(temp,file);}
export async function download(file:Pick<z.infer<typeof fileSchema>,'url'|'size'|'sha256'> & Partial<z.infer<typeof fileSchema>>,destination:string, report:(bytes:number)=>void=()=>{}, fetchFile:typeof fetch=fetch) {
 await mkdir(path.dirname(destination),{recursive:true});
 if(await hashFile(destination).catch(()=>null)===file.sha256)return;
 const part=destination+'.part';
 for(let attempt=0;attempt<3;attempt++){
  const controller=new AbortController();
  let idleTimer:NodeJS.Timeout|undefined;
  const resetTimeout=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(),120_000);};
  try {
   let offset=(await lstat(part).catch(()=>null))?.size??0;
   if(offset>file.size){await unlink(part);offset=0;}
   if(file.size===0)await writeFile(part,Buffer.alloc(0));
   if(offset<file.size){
    resetTimeout();
    const response=await fetchFile(file.url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal:controller.signal});
    if(response.headers.get('content-type')?.includes('text/html'))throw new Error('По ссылке открывается HTML. Нужна прямая ссылка на файл без входа и подтверждения.');
    if(!response.ok||!response.body)throw new Error('Не удалось скачать файл');
    const append=response.status===206&&response.headers.get('content-range')?.startsWith(`bytes ${offset}-`);
    if(response.status===206&&!append)throw new Error('Сервер вернул неверный диапазон');
    if(!append)offset=0;
    const h=await open(part,append?'a':'w');let size=offset;report(size);
    try{for await(const b of response.body){resetTimeout();size+=b.length;if(size>file.size)throw new Error('Размер файла превышает манифест');await h.writeFile(b);report(size);}await h.sync();}finally{await h.close();}
   }
   if((await lstat(part)).size!==file.size||await hashFile(part)!==file.sha256){await unlink(part);throw new Error('Контрольная сумма файла не совпала');}
   await rename(part,destination);return;
  }catch(e:any){if(e.code==='ENOSPC')throw new Error('Недостаточно места на диске');if(attempt===2)throw e;}finally{clearTimeout(idleTimer);controller.abort();}
 }
}
export {acquireLock} from './operation.js';

// Directory-level commit. The journal is written before the first rename. Recovery
// always restores the previous complete mods directory, never guesses partial success.
export async function recover(root:string) {
 const journal=path.join(root,'transaction.json');const text=await readFile(journal,'utf8').catch(()=>null);if(!text)return;
 const j=z.object({stage:z.string().regex(/^stage-[a-f0-9]{64}$/),backup:z.string().regex(/^backup-[a-f0-9]{64}$/),hadOld:z.boolean(),previous:z.unknown().optional()}).parse(JSON.parse(text));
 const mods=await safePath(root,'game/mods'),backup=await safePath(root,j.backup);
 if(await lstat(backup).catch(()=>null)){
  if(await lstat(mods).catch(()=>null))await rename(mods,await safePath(root,`recovered-${Date.now()}`));
  await rename(backup,mods);
 }else if(!j.hadOld&&await lstat(mods).catch(()=>null))await rename(mods,await safePath(root,`recovered-${Date.now()}`));
 if(j.previous)await atomicJson(path.join(root,'installed.json'),j.previous);else await unlink(path.join(root,'installed.json')).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});
 await unlink(journal);
}
export async function installPack(root:string,m:Manifest,side:'client'|'server',status:(s:string)=>void=()=>{},selectedOptional:string[]=[],progress:Transfer=noProgress,fetchFile:typeof fetch=fetch) {
 await recover(root);const id=createHash('sha256').update(JSON.stringify({manifest:m,side,selected:[...selectedOptional].sort()})).digest('hex');
 const stage=await safePath(root,`stage-${id}`);await mkdir(stage,{recursive:true});
 const files=m.files.filter(f=>(f.side===side||f.side==='both')&&(f.required||selectedOptional.includes(f.path)));
 const installed=JSON.parse(await readFile(path.join(root,'installed.json'),'utf8').catch(()=>'{}'));
 const expectedMods=files.filter(f=>f.path.startsWith('mods/'));
 const modsPath=await safePath(root,'game/mods');
 const currentNames:string[]=await readdir(modsPath).catch(()=>[]);
 const extras=await readdir(await safePath(root,'addons')).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
 status('Сверяем моды с выпуском');
 if(installed.sequence===m.sequence&&!extras.length&&currentNames.length===expectedMods.length
   &&expectedMods.every(f=>currentNames.includes(f.path.slice(5))&&installed.managedFiles?.includes(f.path.slice(5).toLowerCase()))){
  let intact=true;
  for(const f of files){
   const target=await safePath(root,'game/'+f.path);
   if(f.policy==='default'&&f.path!==m.graphics?.shaderPack?!(await lstat(target).catch(()=>null))?.isFile():await hashFile(target).catch(()=>null)!==f.sha256){intact=false;break;}
  }
  if(intact)return;
 }
 const disk=await statfs(root);if(disk.bavail*disk.bsize<files.reduce((s,f)=>s+f.size,0)*2+100*1024*1024)throw new Error('Недостаточно места для безопасного обновления');
 status('Скачиваем сборку');const names=new Set<string>();
 const pending = new Map<string,typeof files[number]>();
 for(const f of files) if(!pending.has(f.sha256) && await hashFile(await safePath(root,'cache/'+f.sha256)).catch(()=>null)!==f.sha256) pending.set(f.sha256,f);
 const total = [...pending.values()].reduce((sum,file)=>sum+file.size,0);
 let completed = 0;
 for (const file of pending.values()) {
   const label = 'Сборка · '+file.path;
   progress(label,completed,total);
   await download(file,await safePath(root,'cache/'+file.sha256),bytes=>progress(label,completed+bytes,total),fetchFile);
   completed+=file.size;
 }
 if(total)progress('Сборка скачана',completed,total);
 status('Устанавливаем файлы сборки');
 for(const f of files){const cache=await safePath(root,`cache/${f.sha256}`);if(f.path.startsWith('mods/')){names.add(f.path.slice(5).toLowerCase());await copyFile(cache,path.join(stage,f.path.slice(5)));}}
 const addons=await safePath(root,'addons');await mkdir(addons,{recursive:true});
 for(const name of await readdir(addons)){const f=await safePath(addons,name);if(!name.endsWith('.jar')||!(await lstat(f)).isFile()||!m.allowedAddons.includes(await hashFile(f)))throw new Error(`Дополнение ${name} не разрешено для этой сборки`);if(names.has(name.toLowerCase()))throw new Error('Дополнение заменяет обязательный мод');names.add(name.toLowerCase());await copyFile(f,path.join(stage,name));}
 // A retried stage may contain files from a previous aborted attempt. Refuse it.
 for(const name of await readdir(stage))if(!names.has(name.toLowerCase()))throw new Error('Временный каталог содержит посторонний файл; перенесите его для диагностики');
 status('Проверяем файлы');
 const mods=await safePath(root,'game/mods');await mkdir(path.dirname(mods),{recursive:true});
 for (const file of files.filter(file => file.policy === 'default')) {
  const dest = await safePath(root, 'game/' + file.path);
  await mkdir(path.dirname(dest), {recursive:true});
  const cache = path.join(root, 'cache', file.sha256);
  if (file.path === m.graphics?.shaderPack) {
   if (await hashFile(dest).catch(() => '') !== file.sha256) {
    const temp = await safePath(root, 'game/' + file.path + '.download.tmp');
    await copyFile(cache,temp);
    await rename(temp,dest);
   }
  } else {
   try { await copyFile(cache,dest,1); } catch (e:any) { if (e.code !== 'EEXIST') throw e; }
  }
 }
 const oldNames=await readdir(mods).catch(()=>[]);
 const previous=JSON.parse(await readFile(path.join(root,'installed.json'),'utf8').catch(()=>'{}'));
 for(const name of oldNames)if(!(previous.managedFiles??[]).includes(name.toLowerCase()))throw new Error(`В папке mods найден неуправляемый файл ${name}. Перенесите дополнения в addons для проверки.`);
 if(oldNames.length===names.size&&oldNames.every(n=>names.has(n.toLowerCase()))){
  let same=true;for(const name of oldNames){const old=await safePath(mods,name);if(await hashFile(old)!==await hashFile(path.join(stage,name)))same=false;}
  if(same){await atomicJson(path.join(root,'installed.json'),{...previous,version:m.version,sequence:m.sequence});return;}
 }
 const backup=`backup-${randomBytes(32).toString('hex')}`;
 const hadOld=!!await lstat(mods).catch(()=>null);
 await atomicJson(path.join(root,'transaction.json'),{stage:path.basename(stage),backup,hadOld,previous:Object.keys(previous).length?previous:null});
 try{if(hadOld)await rename(mods,path.join(root,backup));await rename(stage,mods);await atomicJson(path.join(root,'installed.json'),{version:m.version,sequence:m.sequence,backup:hadOld?backup:null,managedFiles:[...names]});await unlink(path.join(root,'transaction.json'));}
 catch(e){await recover(root);throw e;}
 // Every launch verifies/downloads from a trusted manifest, including cached files.
}
