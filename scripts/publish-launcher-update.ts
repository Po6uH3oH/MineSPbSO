import {createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {copyFile,mkdir,readFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {hashFile,atomicJson} from '../src/launcher/files.js';
import {installerSchema,verifiedInstaller} from '../src/launcher/launcher-updates.js';

const [file,expected]=process.argv.slice(2);
const version=file && /^MineSPbSO-(\d+\.\d+\.\d+)-Setup\.exe$/.exec(path.basename(file))?.[1];
if(!file||!version||!expected||!/^[\da-f]{64}$/i.test(expected))throw new Error('Укажите установщик MineSPbSO и проверенный SHA-256 выпуска.');
const sha256=await hashFile(file);
if(sha256!==expected.toLowerCase())throw new Error('Файл не соответствует SHA-256 выпуска.');
const key=createPrivateKey(await readFile('.local/tester-keys/pack-private.pem'));
const config=JSON.parse(await readFile('config/launcher.tester.json','utf8'));
const meta=installerSchema.parse({purpose:'MineSPbSO Windows x64 installer v1',version,sha256,size:(await stat(file)).size});
const payload=Buffer.from(JSON.stringify(meta));
const envelope={payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};
verifiedInstaller(envelope,config.testerPackKey);
const dist='.local/tester-distribution',dest=path.join(dist,'files',sha256);
await mkdir(path.dirname(dest),{recursive:true});
await copyFile(file,dest+'.incoming');
if(await hashFile(dest+'.incoming')!==sha256)throw new Error('Ошибка копирования файла.');
await rename(dest+'.incoming',dest);
await atomicJson(path.join(dist,'launcher.json'),envelope);
console.log('Опубликовано в локальном канале обновлений:',version,sha256);

