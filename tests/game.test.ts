import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateArguments } from '@xmcl/core';
import { gameLaunchOptions, memoryBudget } from '../src/launcher/game.js';
import { offlineUuid } from '../src/shared/identity.js';

test('XMCL uses exact account nickname/UUID, bundled Java and a separate game path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'Игра с пробелами '));
  const resourcePath = path.join(root, 'minecraft');
  const version = '1.21.1';
  await mkdir(path.join(resourcePath, 'versions', version), { recursive: true });
  await writeFile(path.join(resourcePath, 'versions', version, `${version}.json`), JSON.stringify({
    id: version, mainClass: 'net.minecraft.client.main.Main', type: 'release', assets: '17', libraries: [],
    arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--gameDir', '${game_directory}', '--accessToken', '${auth_access_token}'] },
  }));
  const installation = { version, resourcePath, javaPath: path.join(root, 'runtime', 'bin', 'java.exe') };
  const profile = { nickname: 'Owner_Nick', uuid: offlineUuid('Owner_Nick') };
  for (const port of [undefined, 25599]) {
    const args = await generateArguments(gameLaunchOptions(root, installation, profile, port, {}, 4));
    const value = (flag: string) => args[args.indexOf(flag) + 1];
    assert.equal(args[0], installation.javaPath);
    assert.equal(value('--username'), profile.nickname);
    assert.equal(value('--uuid'), profile.uuid.replaceAll('-', ''));
    assert.equal(value('--gameDir'), path.join(root, 'game').replaceAll('\\', '/'));
    assert.equal(value('--accessToken'), '0');
    assert.ok(args.includes('-Xmx4096M'));
    assert.equal(args.includes('--quickPlayMultiplayer'), port !== undefined);
    if (port) assert.equal(value('--quickPlayMultiplayer'), `127.0.0.1:${port}`);
    assert.equal(args.includes('--server'), false);
  }
});

test('memory budget keeps reserve and clamps manual heap settings', () => {
  const gib = 1024 ** 3;
  assert.deepEqual(memoryBudget(8 * gib, 6 * gib, 10), { max: 4, recommended: 4, selected: 4, canLaunch: true });
  assert.equal(memoryBudget(8 * gib, 5 * gib, 4).canLaunch, false);
  assert.equal(memoryBudget(6 * gib, 6 * gib, 4).canLaunch, false);
  assert.equal(memoryBudget(32 * gib, 20 * gib, 16).selected, 10);
});
