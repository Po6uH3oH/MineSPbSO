import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {database,migrate} from '../src/service/db.js';
import {createService} from '../src/service/app.js';
import {randomUUID} from 'node:crypto';
import {offlineUuid,digest} from '../src/shared/identity.js';
test('скин: проверка PNG, модель, привязка к аккаунту и immutable URL',async()=>{
 const db=await database('pglite:');await migrate(db);const id=randomUUID(),token='t'.repeat(43);
 await db.query('INSERT INTO accounts(id,email,nickname,game_uuid,password_hash,verified,faction) VALUES($1,$2,$3,$4,$5,true,$6)',[id,'skin@example.test','SkinTest',offlineUuid('SkinTest'),'unused','blue']);
 await db.query("INSERT INTO sessions VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '1 day')",[randomUUID(),id,digest(token),digest('refresh')]);
 const app=await createService({db,serverKey:'s'.repeat(40),serverId:'test',publicUrl:'https://localhost',sendMail:async()=>{}});
 const upload=async(bytes:Buffer,model='default',authorization=true)=>{const boundary='skin-boundary';const data=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="skin"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);return app.inject({method:'POST',url:`/me/skin?model=${model}`,headers:{'content-type':`multipart/form-data; boundary=${boundary}`,...(authorization?{authorization:`Bearer ${token}`}:{})},payload:data});};
 try{
  const png=new PNG({width:64,height:64});png.data.fill(100);const bytes=PNG.sync.write(png);
  assert.equal((await upload(bytes,'slim',false)).statusCode,401);assert.equal((await upload(Buffer.from('not png'))).statusCode,400);
  assert.equal((await upload(PNG.sync.write(new PNG({width:128,height:128})))).statusCode,400);
  assert.equal((await upload(bytes,'slim')).statusCode,200);
  const profile=(await app.inject('/csl/SkinTest.json')).json();assert.ok(profile.textures.slim);const first=profile.textures.slim;
  assert.deepEqual((await app.inject('/csl/OtherUser.json')).json().textures,{});
  png.data.fill(200);assert.equal((await upload(PNG.sync.write(png))).statusCode,200);const second=(await app.inject('/csl/SkinTest.json')).json().textures.default;assert.notEqual(first,second);
  const old=await app.inject(`/csl/textures/${first}`);assert.equal(old.statusCode,200);assert.deepEqual(old.rawPayload,bytes);assert.match(old.headers['cache-control'] as string,/immutable/);
 }finally{await app.close();await db.close();}
});
