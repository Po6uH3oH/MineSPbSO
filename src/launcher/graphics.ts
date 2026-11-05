import path from 'node:path';
import {copyFile,readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {parse as parseToml} from 'smol-toml';
import {atomicJson,safePath,type Manifest} from './files.js';

export function graphicsSelection(manifest:Manifest, enhanced:boolean) {
 if (!enhanced || !manifest.graphics) return [];
 const {mods,shaderPack} = manifest.graphics;
 if (!shaderPack) return mods;
 const selected = [...mods,shaderPack];
 const preset = shaderPack + '.txt';
 if (manifest.files.some(file => file.path === preset)) selected.push(preset);
 return selected;
}

async function editGameFile(root:string, relative:string, edit:(original:string)=>string) {
 const file = await safePath(root,'game/'+relative);
 const original = await readFile(file,'utf8').catch((error:NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return '';
  throw error;
 });
 const next = edit(original);
 if (next === original) return;
 await mkdir(path.dirname(file),{recursive:true});
 if (original) {
  const backup = await safePath(root,'game/'+relative+'.before-graphics');
  await copyFile(file,backup,1).catch((error:NodeJS.ErrnoException) => {
   if (error.code !== 'EEXIST') throw error;
  });
 }
 const temporary = await safePath(root,'game/'+relative+'.graphics.tmp');
 await writeFile(temporary,next);
 await rename(temporary,file);
}

function setProperty(text:string,key:string,value:string,separator:string) {
 const eol = text.includes('\r\n') ? '\r\n' : '\n';
 const lines = text.split(/\r?\n/);
 const matcher = new RegExp('^\\s*'+key+'\\s*'+separator);
 const line = key+separator+value;
 let found = false;
 const updated = lines.map(existing => {
  if (!matcher.test(existing)) return existing;
  found = true;
  return line;
 });
 if (!found) {
  if (updated.at(-1) === '') updated.pop();
  updated.push(line,'');
 }
 return updated.join(eol);
}

// Change only the radius in the quality table. Keep other tables, comments and custom settings.
export function setLodRadius(text:string,radius:number) {
 const section = 'client.advanced.graphics.quality';
 const key = 'lodChunkRenderDistanceRadius';
 const source = text || '_version = 5\n';
 if ((parseToml(source) as any).client?.advanced?.graphics?.quality?.[key] === radius) return source;
 const eol = source.includes('\r\n') ? '\r\n' : '\n';
 const lines = source.split(/\r?\n/);
 const index = lines.findIndex(line => line.trim().split('#')[0]?.trim() === '['+section+']');
 if (index < 0) return source.trimEnd()+eol+eol+'['+section+']'+eol+key+' = '+radius+eol;
 let end = index+1;
 while (end < lines.length && !/^\s*\[/.test(lines[end]!)) {
  const match = /^(\s*lodChunkRenderDistanceRadius\s*=\s*)\d+([ \t]*(?:#.*)?)$/.exec(lines[end]!);
  if (match) {
   lines[end] = match[1]+String(radius)+match[2];
   return lines.join(eol);
  }
  end++;
 }
 lines.splice(index+1,0,'\t'+key+' = '+radius);
 return lines.join(eol);
}

export async function applyGraphics(root:string,manifest:Manifest,enhanced:boolean) {
 const graphics = manifest.graphics;
 const profile = enhanced ? 'enhanced' : 'basic';
 const stateFile = path.join(root,'graphics-profile.json');
 const previous = JSON.parse(await readFile(stateFile,'utf8').catch(()=>'null'));
 if (graphics && previous?.profile !== profile) {
  const distance = enhanced ? graphics.enhancedDistance : graphics.basicDistance;
  await editGameFile(root,'options.txt',text => setProperty(text,'renderDistance',String(distance),':'));
 }
 // Older signed packs may predate graphics metadata. A single bundled ZIP is unambiguous.
 const bundled = manifest.files.filter(file => /^shaderpacks\/[^/]+\.zip$/i.test(file.path));
 const shader = graphics?.shaderPack ?? (bundled.length === 1 ? bundled[0]?.path : undefined);
 const iris = manifest.files.some(file => /^mods\/iris[-_].*\.jar$/i.test(file.path));
 if (iris && (!enhanced || shader)) {
  await editGameFile(root,'config/iris.properties',text => {
   const toggled = setProperty(text,'enableShaders',String(enhanced),'=');
   return enhanced && shader ? setProperty(toggled,'shaderPack',path.posix.basename(shader),'=') : toggled;
  });
 }
 const hasDistantHorizons = manifest.files.some(file => /^mods\/DistantHorizons[-_].*\.jar$/i.test(file.path));
 if (hasDistantHorizons) {
  const radius = enhanced ? graphics?.enhancedLodRadius ?? 48 : graphics?.basicLodRadius ?? 16;
  await editGameFile(root,'config/DistantHorizons.toml',text => setLodRadius(text,radius));
 }
 if (graphics && previous?.profile !== profile) await atomicJson(stateFile,{profile});
}
