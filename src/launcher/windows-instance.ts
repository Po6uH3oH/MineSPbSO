import { lstat, mkdir, mkdtemp, readFile, realpath, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicJson } from './files.js';

// Some Java 21 Windows launchers resolve java.dll through the ANSI code page.
// Give Java and its processors an ASCII path to the same files without moving player data.
export async function javaInstancePath(root:string) {
  const physical=path.resolve(root);
  if(process.platform!=='win32'||/^[\x20-\x7e]+$/.test(physical))return physical;
  await mkdir(physical,{recursive:true});
  const canonical=(await realpath(physical)).toLowerCase();
  const base=[process.env.LOCALAPPDATA,os.tmpdir(),process.env.ProgramData]
    .find((p):p is string=>!!p && path.isAbsolute(p) && /^[\x20-\x7e]+$/.test(p));
  if(!base)throw new Error('Не удалось найти каталог Windows с латинским путём для запуска Java.');
  const receipt=path.join(physical,'windows-instance-link.json');
  const saved=JSON.parse(await readFile(receipt,'utf8').catch(()=>'null'));
  if(typeof saved==='string' && /^MineSPbSO-[A-Za-z0-9]{6}$/.test(saved)){
    const link=path.join(base,saved,'instance');
    if((await lstat(link).catch(()=>null))?.isSymbolicLink() && (await realpath(link).catch(()=>'')).toLowerCase()===canonical)return link;
  }
  const directory=await mkdtemp(path.join(base,'MineSPbSO-'));
  const link=path.join(directory,'instance');
  await symlink(physical,link,'junction');
  if((await realpath(link)).toLowerCase()!==canonical)throw new Error('Проверка пути Java не пройдена.');
  await atomicJson(receipt,path.basename(directory));
  return link;
}
