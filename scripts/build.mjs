import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist/app',{recursive:true});
await build({entryPoints:['src/launcher/main.ts'],outfile:'dist/app/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron']});
await build({entryPoints:['src/launcher/preload.ts'],outfile:'dist/app/preload.cjs',bundle:true,platform:'node',format:'cjs',external:['electron']});
await build({entryPoints:['src/launcher/renderer.ts'],outfile:'dist/app/renderer.js',bundle:true,platform:'browser',target:'chrome130'});
for(const file of ['index.html','style.css'])await copyFile(`src/launcher/${file}`,`dist/app/${file}`);
const {readFile,writeFile}=await import('node:fs/promises');
const pkg=JSON.parse(await readFile('package.json','utf8'));
await writeFile('dist/app/package.json',JSON.stringify({name:pkg.name,version:pkg.version,main:'main.cjs',description:'Лаунчер частного SMP-сообщества',author:'MineSPbSO',license:'MIT'},null,2));
try { await copyFile('config/launcher.tester.json','dist/launcher-config.json'); }
catch(error){ if(error.code!=='ENOENT')throw error; await copyFile('config/launcher.example.json','dist/launcher-config.json'); }
