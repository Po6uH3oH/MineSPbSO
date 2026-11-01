import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { importLocalPack } from '../src/launcher/local-pack.js';

test('local pack copies the requested folders and preserves player settings on repeat', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-pack-'));
  const source = path.join(directory, 'source');
  const root = path.join(directory, 'instance');
  await mkdir(root);
  for (const folder of ['mods', 'config', 'resourcepacks', 'datapacks', 'shaderpacks', 'saves']) {
    await mkdir(path.join(source, folder), { recursive: true });
    await writeFile(path.join(source, folder, folder === 'mods' ? 'example.jar' : 'example.txt'), folder);
  }
  await writeFile(path.join(source, 'options.txt'), 'original');
  await importLocalPack(source, root, () => {});
  assert.ok(!(await readdir(path.join(root, 'game'))).includes('saves'));
  for (const folder of ['config', 'resourcepacks', 'datapacks', 'shaderpacks']) {
    assert.equal(await readFile(path.join(root, 'game', folder, 'example.txt'), 'utf8'), folder);
  }
  await writeFile(path.join(root, 'game', 'options.txt'), 'player settings');
  await importLocalPack(source, root, () => {});
  assert.equal(await readFile(path.join(root, 'game', 'options.txt'), 'utf8'), 'player settings');
});
