import path from 'node:path';
import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safePath } from './files.js';

export async function importInstalledNeoForge(profile: string, destination: string): Promise<string | undefined> {
  if (path.basename(path.dirname(profile)).toLowerCase() !== 'profiles') return;
  return importNeoForgeCache(path.join(path.dirname(path.dirname(profile)), 'meta'),destination);
}

export async function importNeoForgeCache(meta:string,destination:string):Promise<string|undefined>{
  const id = '1.21.1-21.1.256';
  const source = await readFile(path.join(meta, 'versions', id, `${id}.json`), 'utf8').catch(() => null);
  if (!source) return;
  const version = JSON.parse(source);
  if (version.id !== id || version.mainClass !== 'cpw.mods.bootstraplauncher.BootstrapLauncher') throw new Error('Неверная версия установленного NeoForge');
  for (const key of ['PATCHED', 'MC_EXTRA']) {
    if (!/^\[[^\]]+\]$/.test(version.data?.[key]?.client ?? '')) throw new Error('Кеш NeoForge неполон. Один раз запустите выбранную сборку в Modrinth и повторите попытку.');
  }
  const generated = Object.entries(version.data ?? {}).flatMap(([key, entry]: [string, any]) => {
    const value = entry.client;
    return typeof value === 'string' && value.startsWith('[') && value.endsWith(']')
      ? [{ name: value.slice(1, -1), requiredGenerated: key === 'PATCHED' || key === 'MC_EXTRA' }] : [];
  });
  for (const library of [...version.libraries, ...generated]) {
    const artifact = library.downloads?.artifact;
    const [coordinate, extension = 'jar'] = library.name.split('@');
    const [group, name, release, classifier] = coordinate.split(':');
    const relative = artifact?.path ?? `${group.replaceAll('.', '/')}/${name}/${release}/${name}-${release}${classifier ? '-' + classifier : ''}.${extension}`;
    const from = await safePath(meta, `libraries/${relative}`);
    const to = await safePath(destination, `libraries/${relative}`);
    const bytes = await readFile(from).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!bytes) {
      if (library.requiredGenerated) throw new Error(`В кеше Modrinth отсутствует ${name}. Запустите сборку в Modrinth и повторите попытку.`);
      continue; // Other platforms and unused processor inputs can be absent.
    }
    if (artifact?.sha1 && createHash('sha1').update(bytes).digest('hex') !== artifact.sha1) throw new Error(`Повреждён кеш Modrinth: ${name}`);
    await mkdir(path.dirname(to), { recursive: true });
    await writeFile(to, bytes);
  }
  // Daedalus includes installer inputs that must not appear on the runtime classpath.
  version.libraries = version.libraries.filter((library: any) => library.include_in_classpath !== false);
  const target = path.join(destination, 'versions', id);
  await mkdir(target, { recursive: true });
  await copyFile(path.join(meta, 'versions', id, `${id}.jar`), path.join(target, `${id}.jar`));
  await writeFile(path.join(target, `${id}.json`), JSON.stringify(version));
  return id;
}
