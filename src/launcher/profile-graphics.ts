import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {graphicsSchema, safeRelative, type Manifest} from './files.js';

export async function profileGraphics(source:string, manifest:Manifest):Promise<Manifest> {
 const raw = await readFile(path.join(source,'launcher-graphics.json'),'utf8').catch((error:NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return null;
  throw error;
 });
 if (raw === null) return manifest;
 let document:unknown;
 try { document = JSON.parse(raw.replace(/^\uFEFF/,'')); }
 catch { throw new Error('Проверьте launcher-graphics.json: пути в списке должны быть в двойных кавычках.'); }
 const profile = graphicsSchema.strict().parse(document);
 const shaders = profile.mods.filter(name => /^shaderpacks\//i.test(name));
 const candidates = new Set([...shaders, ...(profile.shaderPack ? [profile.shaderPack] : [])]);
 if (candidates.size > 1) throw new Error('Выберите один активный ZIP в поле shaderPack.');
 const shaderPack = [...candidates][0];
 const graphics = graphicsSchema.parse({...profile, mods:profile.mods.filter(name => !shaders.includes(name)), shaderPack});
 if (new Set(graphics.mods).size !== graphics.mods.length) throw new Error('Дубли модов в launcher-graphics.json');
 for (const name of graphics.mods) {
  const file = manifest.files.find(file => file.path === name);
  if (!file || file.side !== 'client' || !/^mods\/[^/]+\.jar$/i.test(name) || /community-gate/i.test(name))
   throw new Error('Проверьте клиентский графический мод '+name);
 }
 if (shaderPack) {
  safeRelative(shaderPack);
  if (!manifest.files.some(file => file.path === shaderPack && file.side === 'client' && file.policy === 'default'))
   throw new Error('Не найден клиентский шейдерпак '+shaderPack);
 }
 return {...manifest, graphics, files:manifest.files.map(file => {
  const optional = graphics.mods.includes(file.path) || (shaderPack && file.path.startsWith('shaderpacks/'));
  return optional ? {...file,required:false} : file;
 })};
}
