import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const pkg=JSON.parse(await readFile('package.json','utf8'));
const file=process.argv[2]??`release/MineSPbSO-${pkg.version}-Setup.exe`;
const builderRequire=createRequire(import.meta.resolve('electron-builder'));
const appRequire=createRequire(builderRequire.resolve('app-builder-lib'));
const {extractFile,listPackage}=appRequire('@electron/asar');
const resources=path.join(path.dirname(file),'win-unpacked','resources');
const asar=path.join(resources,'app.asar');
const assets = ['aurora.jpg','mountains.jpg','FONT-LICENSES.txt','Classic-Console-Neue-Regular.ttf','minecraft-ten-font-cyrillic.ttf'].map(name => 'assets/' + name);
const expected = [...assets,'community-gate-0.2.0.jar','icon.png','index.html','main.cjs','package.json','preload.cjs','renderer.js','style.css'];
assert.deepEqual(listPackage(asar).map(p=>p.slice(1).split(path.sep).join('/')).sort(),['assets',...expected].sort());
for(const name of expected){
 const packed=extractFile(asar,name);
 assert.ok(packed.equals(await readFile(`dist/app/${name}`)),`Packaged ${name} differs from build`);
}
assert.equal(JSON.parse(extractFile(asar,'package.json').toString()).version,pkg.version);
assert.ok((await readFile(path.join(resources,'launcher-config.json'))).equals(await readFile('dist/launcher-config.json')),'Packaged configuration differs from public example');
const bytes=await readFile(file),hash=createHash('sha256').update(bytes).digest('hex');
await writeFile(file+'.sha256',`${hash}  ${file.split(/[\\/]/).at(-1)}\n`);console.log({file,size:bytes.length,sha256:hash,packagedFilesVerified:true});
