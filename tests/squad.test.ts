import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squadName } from '../src/shared/squad.js';
test('squad display text: Cyrillic, whitespace, empty, bounded and no spoof formatting',()=>{
 assert.equal(squadName('  ССервО  Панда  '),'ССервО Панда');
 assert.equal(squadName(''), '');
 assert.equal(squadName('е\u0308'),'ё');
 assert.equal(squadName('я'.repeat(32)).length,32);
 for(const value of [null,42,{},'я'.repeat(33),'§cАдмин','[Админ]','a\nb','a\tb','a\u202Eb','a\u200Bb','<b>тег</b>','a\\b','a\ud800'])
   assert.throws(()=>squadName(value));
});
