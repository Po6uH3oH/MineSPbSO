import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import {safePath,atomicJson} from './files.js';
export async function configureSkins(root:string,apiUrl:string) {
 const file=await safePath(root,'game/CustomSkinLoader/CustomSkinLoader.json');
 const expected=apiUrl.replace(/\/$/,'')+'/csl/';
 const existing=await readFile(file,'utf8').catch((e:any)=>{if(e.code==='ENOENT')return null;throw e;});
 const config = existing ? JSON.parse(existing) : {};
 const list = config.loadlist ?? [];
 if (!Array.isArray(list)) throw new Error('Проверьте формат CustomSkinLoader.json в папке игры.');
 const loadlist = [{name:'MineSPbSO',type:'CustomSkinAPI',root:expected}, ...list.filter(entry => entry?.name !== 'MineSPbSO' && entry?.root !== expected)];
 if (existing && JSON.stringify(list) === JSON.stringify(loadlist) && config.enableLocalProfileCache === false) return;
 await mkdir(path.dirname(file),{recursive:true});
 if (existing) await writeFile(file+'.before-minespbso',existing,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 await atomicJson(file,{cacheExpiry:30,...config,loadlist,enableLocalProfileCache:false});
}
