import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,realpath,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const busy='Этот экземпляр уже используется. Закройте игру или дождитесь завершения установки.';
export async function acquireLock(root:string){
 await mkdir(root,{recursive:true});
 const canonical=await realpath(root);
 const windows=process.platform==='win32';
 const id=createHash('sha256').update(windows?canonical.toLowerCase():canonical).digest('hex').slice(0,32);
 const address=windows?'\\\\.\\pipe\\MineSPbSO-'+id:path.join(os.tmpdir(),'minespbso-'+id+'.sock');
 const guard=createServer(socket=>socket.destroy());
 await new Promise<void>((resolve,reject)=>{
  guard.once('error',(e:NodeJS.ErrnoException)=>reject(e.code==='EADDRINUSE'?new Error(busy):e));
  guard.listen(address,resolve);
 });
 const close=()=>new Promise<void>(resolve=>guard.close(()=>resolve()));
 const file=path.join(root,'operation.lock');
 try {
  let handle;
  try {handle=await open(file,'wx');}
  catch(e:any){
   if(e.code!=='EEXIST')throw e;
   const previous=(await readFile(file,'utf8')).trim();
   if(/^\d+$/.test(previous)&&Number(previous)>0&&Number(previous)<=2147483647){
    let live=true;
    try{process.kill(Number(previous),0);}catch(error:any){if(error.code!=='ESRCH')throw error;live=false;}
    if(live){
     let reused=false;
     if(windows){
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',
       '([DateTimeOffset](Get-Process -Id '+Number(previous)+' -ErrorAction Stop).StartTime).ToUnixTimeMilliseconds()'],{windowsHide:true,timeout:5000}).catch(()=>({stdout:''}));
      reused=Number(stdout.trim())>(await stat(file)).mtimeMs+1000;
     }
     if(!reused)throw new Error(busy);
    }
   }
   // Windows denies write access to a mapped executable, including through a junction.
   // Opening r+ never truncates or changes the private runtime.
   if(windows)for(const name of ['java.exe','javaw.exe']){
    try{await (await open(path.join(root,'runtime','bin',name),'r+')).close();}
    catch(error:any){if(error.code!=='ENOENT')throw new Error('Java этого экземпляра ещё работает или её файл занят. Закройте Minecraft и повторите попытку.');}
   }
   await unlink(file);
   handle=await open(file,'wx');
  }
  try{await handle.writeFile('MineSPbSO-v2');}finally{await handle.close();}
  return async()=>{try{await unlink(file);}finally{await close();}};
 }catch(error){await close();throw error;}
}
