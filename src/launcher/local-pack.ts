import {profileGraphics} from './profile-graphics.js';
import {graphicsSelection,applyGraphics} from './graphics.js';
import path from 'node:path';
import { copyFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { hashFile, installPack, safePath, type Manifest } from './files.js';

// A folder explicitly selected by the owner is a local source of executable mods.
// It is never treated as a signed release suitable for public distribution.
export async function importLocalPack(source: string, root: string, status: (text: string) => void, augment:(m:Manifest)=>Promise<Manifest>=async m=>m,enhancedGraphics=false) {
  const files: Manifest['files'] = [];
  async function visit(relative: string) {
    const sourceFile = await safePath(source, relative);
    const stat = await lstat(sourceFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const name of await readdir(sourceFile)) await visit(`${relative}/${name}`);
      return;
    }
    if (!stat.isFile()) throw new Error('Сборка содержит неподдерживаемый файл');
    if (relative.startsWith('mods/') && !/^mods\/[^/]+\.jar$/i.test(relative)) return;
    const sha256 = await hashFile(sourceFile);
    const cache = await safePath(root, `cache/${sha256}`);
    await mkdir(path.dirname(cache), { recursive: true });
    if (await hashFile(cache).catch(() => '') !== sha256) await copyFile(sourceFile, cache);
    if (await hashFile(cache) !== sha256) throw new Error('Исходная сборка изменилась во время копирования. Повторите попытку.');
    files.push({ path: relative, sha256, size: stat.size, url: 'https://local.invalid/owner-import', source: 'https://local.invalid/owner-import', license: 'Local owner import; redistribution not approved', required: true, side: 'client', policy: relative.startsWith('mods/') ? 'managed' : 'default' });
  }
  status('Копируем сборку');
  for (const name of ['mods',  'resourcepacks', 'datapacks', 'shaderpacks', 'options.txt']) await visit(name);
  if (!files.some(file => file.path.startsWith('mods/'))) throw new Error('В выбранной папке нет mods/*.jar');
  const manifest=await augment(await profileGraphics(source,{ schema: 1, version: 'local-owner', sequence: 1, minecraft: '1.21.1', neoforge: '21.1.256', expires: '2099-01-01T00:00:00Z', files, allowedAddons: [] }));
  await installPack(root,manifest,'client',status,graphicsSelection(manifest,enhancedGraphics));
  await applyGraphics(root,manifest,enhancedGraphics);
}
