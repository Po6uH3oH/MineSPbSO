import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, statfs } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { open, walkEntries, openEntryReadStream } from '@xmcl/unzip';
import { download, hashFile, safePath, type Manifest } from './files.js';
import { trustedUrl } from './config.js';
import type { Transfer } from './progress.js';

export async function cacheArchive(root:string, manifest:Manifest, progress:Transfer, fetchFile:typeof fetch=fetch) {
  const archive = manifest.archive;
  if (!archive) return;
  trustedUrl(archive.url,true);
  const needed = new Map<string,Manifest['files'][number]>();
  for (const file of manifest.files) {
    if(await hashFile(await safePath(root,'cache/'+file.sha256)).catch(()=>null)!==file.sha256) needed.set(file.path,file);
  }
  // A partial installation is cheaper to repair from individual signed blobs.
  if (needed.size !== manifest.files.length || !needed.size) return;
  const disk = await statfs(root);
  if(disk.bavail*disk.bsize < archive.size+[...needed.values()].reduce((s,f)=>s+f.size,0)+100*1024**2) throw new Error('Недостаточно места для ZIP и распаковки сборки');
  const target = await safePath(root,'archives/'+archive.sha256+'.zip');
  await download({...manifest.files[0]!,...archive},target,bytes=>progress('Архив сборки',bytes,archive.size),fetchFile);
  const zip = await open(target);
  const byName = new Map(manifest.files.map(f=>[f.path,f]));
  const seen = new Set<string>();
  try {
    await walkEntries(zip,async entry=>{
      if(entry.fileName.endsWith('/'))return false;
      const f=byName.get(entry.fileName);
      if(!f||seen.has(f.path)||entry.uncompressedSize!==f.size)throw new Error('Содержимое ZIP расходится с подписанным выпуском.');
      seen.add(f.path);
      if(!needed.has(f.path))return false;
      const out=await safePath(root,'cache/'+f.sha256);
      await mkdir(path.dirname(out),{recursive:true});
      const tmp=out+'.extract';
      let bytes=0;
      const hash=createHash('sha256');
      const validate=new Transform({transform(chunk,_encoding,done){
        bytes+=chunk.length;
        if(bytes>f.size)return done(new Error('Размер файла в ZIP превышен'));
        hash.update(chunk);done(null,chunk);
      }});
      try{
        await pipeline(await openEntryReadStream(zip,entry),validate,createWriteStream(tmp));
        if(bytes!==f.size||hash.digest('hex')!==f.sha256)throw new Error('Контрольная сумма файла в архиве не совпала');
        await rename(tmp,out);
      }finally{await unlink(tmp).catch(()=>{});}
      return false;
    });
    if(seen.size!==byName.size)throw new Error('В ZIP отсутствуют файлы подписанного выпуска');
  } finally {zip.close();}
}
