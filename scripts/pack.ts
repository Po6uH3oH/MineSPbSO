import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile,writeFile,mkdir,lstat } from 'node:fs/promises';
import path from 'node:path';
import { manifestSchema,verifyManifest,hashFile,safePath } from '../src/launcher/files.js';
const [command,folder,metadataFile,keyFile,outFile]=process.argv.slice(2);
if(command==='keygen'){
 if(!folder)throw new Error('pack keygen ПАПКА_КЛЮЧЕЙ');await mkdir(folder,{recursive:true});const k=generateKeyPairSync('ed25519');
 await writeFile(path.join(folder,'release-private.pem'),k.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});await writeFile(path.join(folder,'release-public.pem'),k.publicKey.export({type:'spki',format:'pem'}),{flag:'wx'});console.log('Ключи созданы. Приватный ключ храните только на компьютере издателя.');
}else if(command==='prepare'){
 if(!folder||!metadataFile||!keyFile||!outFile)throw new Error('pack prepare ПАПКА metadata.json private.pem output.json');
 const m=manifestSchema.parse(JSON.parse(await readFile(metadataFile,'utf8')));
 for(const f of m.files){const local=await safePath(path.resolve(folder),f.path);f.size=(await lstat(local)).size;f.sha256=await hashFile(local);}
 const bytes=Buffer.from(JSON.stringify(m));const key=await readFile(keyFile,'utf8');
 const envelope=JSON.stringify({payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')},null,2);
 const {createPublicKey}=await import('node:crypto');verifyManifest(envelope,createPublicKey(key).export({type:'spki',format:'pem'}).toString());
 for(const f of m.files)console.log(`${f.side}\t${f.policy}\t${f.size}\t${f.path}\t${f.sha256}`);
 await writeFile(outFile,envelope,{flag:'wx'});console.log('Подписанный выпуск создан локально. Загрузки/публикации не выполнялись.');
}else{throw new Error('Команды: keygen, prepare');}
