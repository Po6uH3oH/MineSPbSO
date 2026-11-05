import {profileGraphics} from '../src/launcher/profile-graphics.js';
import path from 'node:path';
import { copyFile, mkdir, readdir, readFile, writeFile, lstat, access } from 'node:fs/promises';
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { safePath, hashFile, atomicJson, verifyManifest, type Manifest } from '../src/launcher/files.js';
import { open, walkEntries, openEntryReadStream } from '@xmcl/unzip';
import { createHash } from 'node:crypto';
import { trustedUrl } from '../src/launcher/config.js';

const args=process.argv.slice(2);
const stageOnly=args.at(-1)==='--stage';
if(stageOnly)args.pop();
const [source,archive,archiveUrl]=args;
if(!source || Boolean(archive)!==Boolean(archiveUrl))throw new Error('prepare-testers.ts ПАПКА_ПРОФИЛЯ [ЛОКАЛЬНЫЙ_ZIP ПРЯМАЯ_HTTPS_ССЫЛКА]');
const dir=path.resolve('.local/tester-distribution');
const keyDir=path.resolve('.local/tester-keys');
await mkdir(keyDir,{recursive:true});
await mkdir(path.join(dir,'files'),{recursive:true});
const privateFile=path.join(keyDir,'pack-private.pem');
try{await access(privateFile);}catch{
  const keys=generateKeyPairSync('ed25519');
  await writeFile(privateFile,keys.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
}
const key=await readFile(privateFile,'utf8');
const publicKey=createPublicKey(key).export({type:'spki',format:'pem'}).toString();
const config=JSON.parse(await readFile('config/launcher.example.json','utf8'));
const base='https://10.99.52.8:3443';
const files:Manifest['files']=[];
async function visit(relative:string){
  const file=await safePath(source!,relative);
  const stat=await lstat(file).catch((err:NodeJS.ErrnoException)=>{if(err.code!=='ENOENT')throw err;return null;});
  if(!stat)return;
  if(stat.isDirectory()){
    for(const child of await readdir(file))await visit(relative+'/'+child);
    return;
  }
  if(!stat.isFile() || relative.startsWith('mods/') && !/^mods\/[^/]+\.jar$/i.test(relative))return;
  const sha256=await hashFile(file);
  const blob=path.join(dir,'files',sha256);
  if(await hashFile(blob).catch(()=>null)!==sha256){
    await copyFile(file,blob);
    if(await hashFile(blob)!==sha256)throw new Error('Файл изменился во время подготовки');
  }
  const url=base+'/packs/files/'+sha256;
  files.push({path:relative,sha256,size:stat.size,url,source:url,side:'client',required:true,license:'Private test; owner must verify distribution rights',policy:relative.startsWith('mods/')?'managed':'default'});
}
for(const root of ['mods','resourcepacks','datapacks','shaderpacks','options.txt'])await visit(root);
if(!files.some(f=>f.path.startsWith('mods/')))throw new Error('В профиле отсутствуют mods/*.jar');
const seq=Date.now();
const manifest:Manifest=await profileGraphics(source,{schema:1,version:'test-'+seq,sequence:seq,minecraft:'1.21.1',neoforge:'21.1.256',expires:new Date(seq+90*86400000).toISOString(),files,allowedAddons:[]});
if(archive && archiveUrl){
  const url=trustedUrl(archiveUrl);
  if(new URL(url).hostname==='drive.google.com' && new URL(url).pathname.includes('/view'))throw new Error('Это ссылка на страницу просмотра. Укажите прямую ссылку на байты ZIP или используйте раздачу с ПК.');
  const zip=await open(archive);
  const remaining=new Map(files.map(f=>[f.path,f]));
  try{
    await walkEntries(zip,async entry=>{
      if(entry.fileName.endsWith('/'))return false;
      const f=remaining.get(entry.fileName);
      if(!f || f.size!==entry.uncompressedSize)throw new Error('ZIP не соответствует выбранному профилю: '+entry.fileName);
      const hash=createHash('sha256');
      for await(const chunk of await openEntryReadStream(zip,entry))hash.update(chunk);
      if(hash.digest('hex')!==f.sha256)throw new Error('Файл отличается от профиля: '+f.path);
      remaining.delete(f.path);return false;
    });
    if(remaining.size)throw new Error('В ZIP не хватает файлов профиля.');
  }finally{zip.close();}
  manifest.archive={url,size:(await lstat(archive)).size,sha256:await hashFile(archive)};
}
const payload=Buffer.from(JSON.stringify(manifest));
const envelope={payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};
verifyManifest(JSON.stringify(envelope),publicKey);
const ca=await readFile(path.join(keyDir,'tls-cert.pem'),'utf8');
if (stageOnly) {
 const activeConfig = JSON.parse(await readFile('config/launcher.tester.json','utf8'));
 if (activeConfig.testerPackKey !== publicKey) throw new Error('Ключ не совпадает с ключом текущего лаунчера.');
 await atomicJson(path.join(dir,'current.ready.json'),envelope);
} else {
 await atomicJson('config/launcher.tester.json',{...config,apiUrl:base,apiCA:ca,testerHost:'10.99.52.8',testerPackKey:publicKey});
 await atomicJson(path.join(dir,'current.json'),envelope);
}
console.log('Подготовлен выпуск',manifest.version,'· файлов',files.length,'· МБ',(files.reduce((sum,f)=>sum+f.size,0)/1e6).toFixed(1));
