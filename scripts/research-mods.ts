import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const projects:Record<string,{slug:string,version:string}>={ftbteams:{slug:'ftb-teams',version:'2101.1.11'},ftbchunks:{slug:'ftb-chunks',version:'2101.1.22'},ftbquests:{slug:'ftb-quests',version:'2101.1.36'},ftblibrary:{slug:'ftb-library',version:'2101.1.37'},voicechat:{slug:'simple-voice-chat',version:'1.21.1-2.6.27'},xercapaint:{slug:'joy-of-painting',version:'1.21.1-2.0.1'},immersive_melodies:{slug:'immersive-melodies',version:'0.8.2+1.21.1'},etched:{slug:'etched',version:'5.1.0'},emotecraft:{slug:'emotecraft',version:'2.4.12'},customskinloader:{slug:'customskinloader',version:'15.1'},lmft:{slug:'load-my-fucking-tags',version:'1.1.1+1.21.9'},nochatrestrictions:{slug:'no-chat-restrictions',version:'1.21.11-v1.0.3'},betterend:{slug:'betterend',version:'21.0.39'},betternether:{slug:'betternether',version:'21.0.30'},sodium:{slug:'sodium',version:'0.8.13+mc1.21.1'},iris:{slug:'iris',version:'1.8.14-beta.1+mc1.21.1'}};
const headers={'User-Agent':'CommunitySMP-research/0.1.0 (local compatibility audit)'};
async function json(url:string){const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json() as Promise<any>;}
await mkdir('.local/candidate-mods',{recursive:true});const results:any[]=[];
for(const [id,spec] of Object.entries(projects)){
 try{
  const p=await json(`https://api.modrinth.com/v2/project/${spec.slug}`);
  const versions=await json(`https://api.modrinth.com/v2/project/${p.id}/version?game_versions=%5B%221.21.1%22%5D&loaders=%5B%22neoforge%22%5D`) as any[];
  const version=versions.find(v=>v.version_number===spec.version)||versions.find(v=>v.version_number.includes(spec.version));
  const info:any={id,requested:spec.version,slug:spec.slug,projectId:p.id,license:p.license,clientSide:p.client_side,serverSide:p.server_side,source:p.source_url,selected:version??null,candidateVersions:versions.slice(0,6).map(v=>v.version_number),status:version?'Catalogue matches Minecraft/loader; inspect JAR dependencies next':'Exact requested release not identified in filtered catalogue; NOT proof of incompatibility'};
  if(version){const file=version.files.find((f:any)=>f.primary)??version.files[0];const r=await fetch(file.url,{headers,signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error(`Download ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());if(createHash('sha512').update(bytes).digest('hex')!==file.hashes.sha512)throw new Error('SHA512 mismatch');if(path.basename(file.filename)!==file.filename)throw new Error('Unsafe filename');await writeFile(path.join('.local/candidate-mods',file.filename),bytes);info.downloaded=file.filename;info.sha256=createHash('sha256').update(bytes).digest('hex');}
  results.push(info);
 }catch(e:any){results.push({id,...spec,status:'unresolved',error:e.message});}
 console.log(`${id}: ${results.at(-1)?.status}`);
 await writeFile('docs/research/modrinth-candidates.json',JSON.stringify(results,null,2));
}
const log=await readFile('docs/research/mods-original.txt','utf8');const inventory=log.split(/\r?\n/).map(line=>line.match(/^\s+(.+?)\s+(\S+)\s+\(([^)]+)\)$/)).filter(Boolean).map(m=>({name:m![1],version:m![2],id:m![3],status:'not-approved',evidence:results.find(r=>r.id===m![3])?.status??'Only supplied log; exact JAR, dependencies, side and redistribution remain unverified'}));
await writeFile('docs/research/mod-inventory.json',JSON.stringify(inventory,null,2));console.log(`Inventory: ${inventory.length}; no complete modpack declared compatible.`);
