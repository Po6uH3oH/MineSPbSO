import {_electron} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath=path.resolve(process.argv[2]??'release/win-unpacked/MineSPbSO.exe');
const data=await mkdtemp(path.join(os.tmpdir(),'minespbso-package-'));
const app=await _electron.launch({executablePath,cwd:data,args:['--user-data-dir='+data],env:{...process.env,NODE_PATH:'',SMP_TEST_HEADLESS:'1'},timeout:35000});
try{
 assert.ok(await app.evaluate(({app})=>app.isPackaged));
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),data);
 const page=await app.firstWindow();
 await page.locator('#play').waitFor({state:'attached'});
 const state=await page.evaluate(()=>window.smp.call('state'));
 assert.ok(state.ok);assert.equal(typeof state.value.version,'string');
 console.log('Packaged Electron, sandboxed UI and main process ready:',state.value.version);
}finally{await app.close();}

