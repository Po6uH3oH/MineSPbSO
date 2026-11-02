import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {safePath, type Manifest} from './files.js';

export const gateFile='community-gate-0.2.0.jar';
export async function withCommunityGate(root:string,manifest:Manifest):Promise<Manifest>{
  // The client mod comes from the launcher package, independent of the selected modpack.
  const bytes=await readFile(path.join(__dirname,gateFile));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const managedPath='mods/'+gateFile;
  const existing=manifest.files.filter(f=>/^mods\/community-gate.*\.jar$/i.test(f.path));
  if(existing.some(f=>f.path!==managedPath||f.sha256!==sha256))
    throw new Error('В сборке есть другая версия community-gate. Обновите исходную сборку.');
  const cache=await safePath(root,'cache/'+sha256);
  await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,bytes);
  const source='https://github.com/Po6uH3oH/MineSPbSO';
  return {...manifest,files:[...manifest.files.filter(f=>f.path!==managedPath),{path:managedPath,size:bytes.length,sha256,source,url:source,license:'MIT',required:true,side:'client',policy:'managed'}]};
}

