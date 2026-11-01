import { readdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { parse } from 'smol-toml';
import { hashFile } from '../src/launcher/files.js';
const folder=process.argv[2];if(!folder)throw new Error('audit-mods ПАПКА_С_JAR [отчёт.json]');
const results=[];
for(const name of await readdir(folder)){
 if(!name.endsWith('.jar'))continue;
 const file=path.join(folder,name); try { const zip=new AdmZip(await readFile(file));
 const neo=zip.getEntry('META-INF/neoforge.mods.toml'),forge=zip.getEntry('META-INF/mods.toml'),fabric=zip.getEntry('fabric.mod.json');
 let metadata:unknown=null,error:string|null=null;
 try{metadata=neo?parse(zip.readAsText(neo)):forge?parse(zip.readAsText(forge)):fabric?JSON.parse(zip.readAsText(fabric)):null;}catch{error='Некорректные метаданные';}
 const embedded=zip.getEntries().filter(e=>e.entryName.endsWith('.jar')).map(e=>e.entryName);
 const services=zip.getEntries().filter(e=>e.entryName.startsWith('META-INF/services/')&&!e.isDirectory).map(e=>e.entryName);
 const bootstrap=services.some(s=>s.endsWith('net.neoforged.neoforgespi.locating.IModFileCandidateLocator'));
 results.push({file:name,sha256:await hashFile(file),loader:neo?'neoforge':bootstrap?'neoforge-bootstrap/universal':forge?'forge':fabric?'fabric':'unknown',metadata,embedded,services,error,review:'Нужна проверка зависимостей, стороны, лицензии и тест запуска; наличие TOML не доказывает совместимость.'});
 } catch (e) { results.push({file:name,sha256:await hashFile(file),error:e instanceof Error?e.message:'Ошибка чтения архива',review:'Требуется ручная проверка'}); }
}
await writeFile(process.argv[3]??'mod-audit.json',JSON.stringify(results,null,2));console.log(`Исследовано JAR: ${results.length}. Неразрешённые зависимости и стороны нужно утвердить перед выпуском.`);

