import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {manifestSchema,type Manifest} from './files.js';

export async function profileGraphics(source:string,m:Manifest){
 const raw=await readFile(path.join(source,'launcher-graphics.json'),'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});
 if(raw===null)return m;
 const graphics=manifestSchema.shape.graphics.unwrap().strict().parse(JSON.parse(raw));
 if(new Set(graphics.mods).size!==graphics.mods.length)throw new Error('Дубли модов в launcher-graphics.json');
 for(const name of graphics.mods){
  const file=m.files.find(f=>f.path===name);
  if(!file||file.side!=='client'||!/^mods\/[^/]+\.jar$/.test(name)||/community-gate/i.test(name))throw new Error('Проверьте клиентский графический мод '+name);
 }
 return {...m,graphics,files:m.files.map(f=>graphics.mods.includes(f.path)?{...f,required:false}:f)};
}
