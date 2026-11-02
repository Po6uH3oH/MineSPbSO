import path from 'node:path';
import {appendFile,mkdir,readdir,rename,rm,stat,unlink} from 'node:fs/promises';
import {safePath} from './files.js';

export async function clearDownloadCache(root:string){
 let count=0;
 for(const [dir,pattern] of [['cache',/^[a-f\d]{64}(?:\.part)?$/],['archives',/^[a-f\d]{64}\.zip(?:\.part)?$/]] as const){
  const target=await safePath(root,dir);
  const entries=await readdir(target,{withFileTypes:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  for(const entry of entries){
   if(!entry.isFile()||!pattern.test(entry.name))continue;
   await unlink(await safePath(root,dir+'/'+entry.name));count++;
  }
 }
 return count;
}
export function createJournal(folder:string){
 let queue=Promise.resolve();
 return (event:string)=>{
  queue=queue.then(async()=>{
   await mkdir(folder,{recursive:true});
   const file=path.join(folder,'launcher.log');
   if(((await stat(file).catch(()=>null))?.size??0) >= 256*1024){
    const previous=file+'.1';await rm(previous,{force:true});await rename(file,previous);
   }
   await appendFile(file,new Date().toISOString()+' '+event+'\n','utf8');
  }).catch(()=>{});
  return queue;
 };
}
