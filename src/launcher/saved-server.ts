import {read,write,NBTData,type CompoundTag} from 'nbtify';
import {readFile,writeFile,rename,copyFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {safePath} from './files.js';

// This loopback IP identifies the community tunnel even when Windows assigns a new port.
export const gameLoopback='127.83.80.1';
export async function saveCommunityServer(root:string,name:string,port:number){
 const file=await safePath(root,'game/servers.dat');
 await mkdir(path.dirname(file),{recursive:true});
 const original=await readFile(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 type List={servers:CompoundTag[]};
 const data=original?await read<List>(original,{endian:'big',compression:null,rootName:true,strict:true}):new NBTData<List>({servers:[]});
 if(!Array.isArray(data.data.servers))throw new Error('Не удалось прочитать список серверов Minecraft.');
 const address=gameLoopback+':'+port;
 const row=data.data.servers.find(s=>typeof s.ip==='string' && /^127\.83\.80\.1:\d+$/.test(s.ip));
 if(row){row.ip=address;delete row.hidden;}else data.data.servers.push({ip:address,name});
 const tmp=file+'.'+randomUUID()+'.tmp';
 const buf=await write(data);
 if(original)await copyFile(file,await safePath(root,'game/servers.dat.before-MineSPbSO'),1).catch(e=>{if(e.code!=='EEXIST')throw e;});
 await writeFile(tmp,buf,{flag:'wx'});await rename(tmp,file);
}

