import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {importLocalPack} from '../src/launcher/local-pack.js';
import {installPack,hashFile,verifyManifest,type Manifest} from '../src/launcher/files.js';
import {graphicsSelection} from '../src/launcher/graphics.js';
import {generateKeyPairSync,sign} from 'node:crypto';

async function fixture(){
 await mkdir('.local',{recursive:true});
 return mkdtemp(path.resolve('.local/graphics-test-'));
}
test('graphics switching removes optional and superseded jars, preserving keybindings and user distance',async()=>{
 const dir=await fixture(),source=path.join(dir,'source'),root=path.join(dir,'instance');
 await mkdir(path.join(source,'mods'),{recursive:true});
 await writeFile(path.join(source,'mods/base.jar'),'base');
 await writeFile(path.join(source,'mods/visual-v1.jar'),'visual');
 await writeFile(path.join(source,'options.txt'),'key_key.forward:key.keyboard.w\nrenderDistance:20\n');
 const profile=async(name:string)=>writeFile(path.join(source,'launcher-graphics.json'),JSON.stringify({mods:[name],basicDistance:6,enhancedDistance:12}));
 await profile('mods/visual-v1.jar');
 const apply=(enabled:boolean)=>importLocalPack(source,root,()=>{},async m=>m,enabled);
 await apply(false);
 assert.deepEqual(await readdir(path.join(root,'game/mods')),['base.jar']);
 const options=path.join(root,'game/options.txt');
 assert.match(await readFile(options,'utf8'),/renderDistance:6/);
 await apply(true);assert.equal((await readdir(path.join(root,'game/mods'))).length,2);
 assert.match(await readFile(options,'utf8'),/renderDistance:12/);
 await writeFile(options,'key_key.forward:key.keyboard.z\nrenderDistance:9\n');
 await apply(true);assert.match(await readFile(options,'utf8'),/renderDistance:9/);
 await apply(false);assert.deepEqual(await readdir(path.join(root,'game/mods')),['base.jar']);
 assert.match(await readFile(options,'utf8'),/key.keyboard.z/);
 await rename(path.join(source,'mods/visual-v1.jar'),path.join(source,'mods/visual-v2.jar'));
 await profile('mods/visual-v2.jar');await apply(true);
 assert.deepEqual((await readdir(path.join(root,'game/mods'))).sort(),['base.jar','visual-v2.jar']);
 await apply(false);await apply(true);
 assert.deepEqual((await readdir(path.join(root,'game/mods'))).sort(),['base.jar','visual-v2.jar']);
});
test('base installation never downloads graphics; switch downloads only additions and removes old versions',async()=>{
 const root=await fixture();const blobs=new Map<string,Buffer>();
 const files:Manifest['files']=[];
 for(const [name,required] of [['base.jar',true],['visual.jar',false]] as const){
  const bytes=Buffer.from(name);const file=path.join(root,name);await writeFile(file,bytes);
  const sha256=await hashFile(file),url='https://example.org/'+name;blobs.set(url,bytes);
  files.push({path:'mods/'+name,required,sha256,url,size:bytes.length,source:url,license:'test',side:'client',policy:'managed'});
 }
 const m:Manifest={schema:1,version:'test',sequence:1,minecraft:'1.21.1',neoforge:'21.1.256',expires:'2099-01-01T00:00:00Z',files,allowedAddons:[],graphics:{mods:['mods/visual.jar'],basicDistance:6,enhancedDistance:12}};
 const calls:string[]=[];
 const fetchFile=(async(url:any)=>{calls.push(String(url));return new Response(new Uint8Array(blobs.get(String(url))!));}) as typeof fetch;
 const run=(enabled:boolean)=>installPack(root,m,'client',()=>{},graphicsSelection(m,enabled),()=>{},fetchFile);
 await run(false);assert.deepEqual(calls,['https://example.org/base.jar']);
 await run(true);assert.deepEqual(calls,['https://example.org/base.jar','https://example.org/visual.jar']);
 await run(false);await run(true);assert.equal(calls.length,2);
 const keys=generateKeyPairSync('ed25519');
 const envelope=(value:Manifest)=>{const bytes=Buffer.from(JSON.stringify(value));return JSON.stringify({payload:bytes.toString('base64'),signature:sign(null,bytes,keys.privateKey).toString('base64')});};
 const key=keys.publicKey.export({type:'spki',format:'pem'}).toString();
 assert.ok(verifyManifest(envelope(m),key).graphics);
 for(const bad of ['mods/missing.jar','mods/base.jar']){
  assert.throws(()=>verifyManifest(envelope({...m,graphics:{...m.graphics!,mods:[bad]}}),key));
 }
});
