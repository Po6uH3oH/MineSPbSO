import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,migrate} from '../src/service/db.js';
import {ownerPanel} from '../src/service/owner-panel.js';
import {createService} from '../src/service/app.js';

test('owner panel gates mutations, approves registration, resets sessions and reserves deleted nicks',async()=>{
 const db=await database('pglite:');await migrate(db);
 const pass='a long separate test secret';const panel=await ownerPanel(db,pass);
 const headers={host:'localhost:3011',authorization:'Basic '+Buffer.from('owner:'+pass).toString('base64')};
 let token='';
 const service=await createService({db,serverId:'test',serverKey:'game-test',publicUrl:'',sendMail:async(_to,_s,body)=>{token=body.split('\n\n')[1];}});
 const api=(url:string,payload:object)=>service.inject({method:'POST',url,payload});
 const owner=(url:string,payload:object)=>panel.inject({method:'POST',url,headers,payload});
 try{
  assert.equal((await panel.inject({url:'/',headers:{host:'localhost:3011'}})).statusCode,401);
  const index=await panel.inject({url:'/',headers});
  const csrf=index.body.match(/name="csrf" value="([a-f0-9]+)"/)![1];
  assert.equal((await owner('/policy',{mode:'closed'})).statusCode,403);
  const policy=(mode:string)=>owner('/policy',{csrf,mode});
  const account={email:'owner-test@example.org',nickname:'Player_One',password:'First password!'};
  await policy('closed');assert.equal((await api('/auth/register',account)).statusCode,403);
  await policy('review');assert.equal((await api('/auth/register',account)).statusCode,200);
  await api('/auth/verify',{token});assert.equal((await api('/auth/login',account)).statusCode,403);
  const manage=(action:string,other={})=>owner('/account',{csrf,nickname:account.nickname,action,...other});
  assert.equal((await manage('approve')).statusCode,303);
  const old=await api('/auth/login',account);assert.equal(old.statusCode,200);
  assert.equal((await manage('password',{password:'Replacement password'})).statusCode,303);
  assert.equal((await api('/auth/refresh',{refresh:old.json().refresh})).statusCode,401);
  assert.equal((await api('/auth/login',account)).statusCode,401);
  assert.equal((await api('/auth/login',{...account,password:'Replacement password'})).statusCode,200);
  assert.equal((await manage('delete')).statusCode,400);
  assert.equal((await manage('delete',{confirm:account.nickname})).statusCode,303);
  await policy('open');assert.equal((await api('/auth/register',{...account,nickname:'player_one'})).statusCode,409);
  assert.equal((await db.query('SELECT id FROM accounts')).rows.length,0);
 }finally{await service.close();await panel.close();await db.close();}
});
