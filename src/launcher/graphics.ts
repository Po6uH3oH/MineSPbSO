import path from 'node:path';
import {copyFile,readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {atomicJson,safePath,type Manifest} from './files.js';

export function graphicsSelection(m:Manifest,enabled:boolean){
 return enabled?m.graphics?.mods??[]:[];
}

// A profile change adjusts only distance. Later in-game edits remain until the next switch.
export async function applyGraphics(root:string,m:Manifest,enabled:boolean){
 if(!m.graphics)return;
 const profile=enabled?'enhanced':'basic';
 const stateFile=path.join(root,'graphics-profile.json');
 const previous=JSON.parse(await readFile(stateFile,'utf8').catch(()=>'null'));
 if(previous?.profile===profile)return;
 const options=await safePath(root,'game/options.txt');
 await mkdir(path.dirname(options),{recursive:true});
 const text=await readFile(options,'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return '';throw e;});
 const backup=await safePath(root,'game/options.txt.before-graphics');
 const temporary=await safePath(root,'game/options.txt.graphics.tmp');
 if(text)await copyFile(options,backup);
 const distance=enabled?m.graphics.enhancedDistance:m.graphics.basicDistance;
 const lines=text.split(/\r?\n/).filter(line=>!line.startsWith('renderDistance:'));
 while(lines.at(-1)==='')lines.pop();
 lines.push('renderDistance:'+distance);
 await writeFile(temporary,lines.join('\n')+'\n');
 await rename(temporary,options);
 await atomicJson(stateFile,{profile});
}
