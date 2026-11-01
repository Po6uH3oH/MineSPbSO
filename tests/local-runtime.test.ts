import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { importInstalledNeoForge } from '../src/launcher/local-runtime.js';

const id = '1.21.1-21.1.256';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'Кеш Modrinth '));
  const profile = path.join(root, 'profiles', 'Test pack');
  const destination = path.join(root, 'instance');
  const put = async (relative: string, bytes: string) => {
    const target = path.join(root, 'meta', relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  };
  const version = {
    id, mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    data: { PATCHED: { client: '[test:patched:1:client]' }, MC_EXTRA: { client: '[test:extra:1]' } },
    libraries: [
      { name: 'test:runtime:1', downloads: { artifact: { path: 'test/runtime/1/runtime-1.jar', sha1: createHash('sha1').update('runtime').digest('hex') } } },
      { name: 'test:installer:1', include_in_classpath: false },
      { name: 'test:other-platform:1' },
    ],
  };
  await put(`versions/${id}/${id}.json`, JSON.stringify(version));
  await put(`versions/${id}/${id}.jar`, 'client');
  await put('libraries/test/patched/1/patched-1-client.jar', 'patched');
  await put('libraries/test/extra/1/extra-1.jar', 'extra');
  await put('libraries/test/runtime/1/runtime-1.jar', 'runtime');
  await put('libraries/test/installer/1/installer-1.jar', 'installer');
  return { root, profile, destination, put };
}

test('Modrinth import includes processor output and excludes installer-only classpath entries', async () => {
  const f = await fixture();
  assert.equal(await importInstalledNeoForge(f.profile, f.destination), id);
  assert.equal(await readFile(path.join(f.destination, 'libraries/test/patched/1/patched-1-client.jar'), 'utf8'), 'patched');
  const version = JSON.parse(await readFile(path.join(f.destination, `versions/${id}/${id}.json`), 'utf8'));
  assert.equal(version.libraries.some((l: any) => l.name === 'test:installer:1'), false);
  const original = JSON.parse(await readFile(path.join(f.root, `meta/versions/${id}/${id}.json`), 'utf8'));
  assert.equal(original.libraries.some((l: any) => l.name === 'test:installer:1'), true);
});

test('Modrinth import refuses corrupt libraries and missing patched Minecraft', async () => {
  const f = await fixture();
  await f.put('libraries/test/runtime/1/runtime-1.jar', 'corrupt');
  await assert.rejects(importInstalledNeoForge(f.profile, f.destination), /Повреждён кеш/);
  await f.put('libraries/test/runtime/1/runtime-1.jar', 'runtime');
  await unlink(path.join(f.root, 'meta/libraries/test/patched/1/patched-1-client.jar'));
  await assert.rejects(importInstalledNeoForge(f.profile, f.destination), /отсутствует patched/);
});
