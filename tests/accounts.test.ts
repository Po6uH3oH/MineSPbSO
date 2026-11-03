import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database,migrate } from '../src/service/db.js';
import { createService } from '../src/service/app.js';
import { offlineUuid } from '../src/shared/identity.js';

test('аккаунты, UUID, одноразовые коды, сессии и билеты: реальный SQL',async()=>{
 const db=await database('pglite:');await migrate(db);const mail:string[]=[];
 const serverKey='a'.repeat(40);const app=await createService({db,serverKey,serverId:'test',publicUrl:'http://127.0.0.1:3000',sendMail:async(_e,_s,t)=>{mail.push(t);}});
 const call=async(url:string,body:any,token?:string)=>{const r=await app.inject({method:'POST',url,payload:body,headers:token?{authorization:`Bearer ${token}`}:{}});return {status:r.statusCode,...r.json()};};
 const code=()=>mail.at(-1)!.split('\n\n')[1];
 try{
  assert.equal((await call('/auth/register',{email:'test@example.org',nickname:'Player_One',password:'12345678'})).status,200);
  assert.equal((await call('/auth/register',{email:'other@example.org',nickname:'player_one',password:'12345678'})).status,409);
  assert.equal((await call('/server/whitelist',{})).status,401);
  assert.deepEqual((await call('/server/whitelist',{},serverKey)).players,[]);
  const verify=code();let login=await call('/auth/login',{email:'test@example.org',password:'12345678'});const original=login.account.uuid;
  assert.equal(original,offlineUuid('Player_One'));
  assert.equal((await call('/auth/verify',{token:verify})).status,200);
  assert.equal((await call('/auth/verify',{token:verify})).status,400);
  const challenge=async(name='Player_One')=>call('/server/challenge',{nickname:name,uuid:offlineUuid(name)},serverKey);
  assert.equal((await call('/server/challenge',{nickname:'Player_One',uuid:original})).status,401);
  assert.equal((await challenge('Imposter')).status,403);
  assert.deepEqual((await call('/server/whitelist',{},serverKey)).players,[{name:'Player_One',uuid:original}]);
  await call('/auth/register',{email:'other@example.org',nickname:'DifferentNick',password:'another strong password'});
  await call('/auth/verify',{token:code()});
  const stranger=await call('/auth/login',{email:'other@example.org',password:'another strong password'});
  assert.equal((await call('/join/ticket',{challenge:(await challenge()).challenge},stranger.access)).status,403);
  const ch=(await challenge()).challenge;
  assert.equal((await call('/server/consume',{challenge:ch,ticket:'x'.repeat(43),nickname:'Player_One',uuid:original},serverKey)).status,403);
  const t=await call('/join/ticket',{challenge:ch},login.access);assert.equal(t.status,200);
  const body={challenge:ch,ticket:t.ticket,nickname:'Player_One',uuid:original};
  assert.equal((await call('/server/consume',{...body,challenge:(await challenge()).challenge},serverKey)).status,403);
  assert.equal((await call('/server/consume',{challenge:ch,nickname:'Player_One',uuid:original},serverKey)).status,400);
  const race=await Promise.all([call('/server/consume',body,serverKey),call('/server/consume',body,serverKey)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,403]);
  assert.equal((await call('/join/ticket',{challenge:ch},login.access)).status,403);
  const expired=(await challenge()).challenge;await db.query("UPDATE challenges SET expires=now()-interval '1 second' WHERE id=$1",[expired]);
  assert.equal((await call('/join/ticket',{challenge:expired},login.access)).status,403);
  const revokedChallenge=(await challenge('DifferentNick')).challenge;
  const revokedTicket=await call('/join/ticket',{challenge:revokedChallenge},stranger.access);
  assert.equal(revokedTicket.status,200);
  await call('/auth/logout',{},stranger.access);
  assert.equal((await call('/server/consume',{challenge:revokedChallenge,ticket:revokedTicket.ticket,nickname:'DifferentNick',uuid:offlineUuid('DifferentNick')},serverKey)).status,403);
  const next=await call('/auth/refresh',{refresh:login.refresh});assert.equal(next.status,200);assert.equal((await call('/auth/refresh',{refresh:login.refresh})).status,401);
  await call('/auth/forgot',{email:'test@example.org'});const reset=code();assert.equal((await call('/auth/reset',{token:reset,password:'new strong password'})).status,200);
  assert.equal((await call('/auth/reset',{token:reset,password:'new strong password'})).status,400);
  assert.equal((await call('/auth/refresh',{refresh:next.refresh})).status,401);
  login=await call('/auth/login',{email:'test@example.org',password:'new strong password'});assert.equal(login.account.uuid,original);assert.ok(!('faction' in login.account));
  const banChallenge=(await challenge()).challenge;const banTicket=await call('/join/ticket',{challenge:banChallenge},login.access);
  await db.query('UPDATE accounts SET banned=true');
  assert.equal((await call('/server/consume',{challenge:banChallenge,ticket:banTicket.ticket,nickname:'Player_One',uuid:original},serverKey)).status,403);
  assert.equal((await call('/auth/refresh',{refresh:login.refresh})).status,401);
  assert.deepEqual((await call('/server/whitelist',{},serverKey)).players,[]);
 }finally{await app.close();await db.close();}
});

test('UUID учитывает точный регистр и соответствует Java offline алгоритму',()=>{
 assert.equal(offlineUuid('Notch'),'b50ad385-829d-3141-a216-7e7d7539ba7f');
 assert.notEqual(offlineUuid('Notch'),offlineUuid('notch'));
 assert.throws(()=>offlineUuid('../bad'));
});

test('login throttles repeated attempts',async()=>{const db=await database('pglite:');await migrate(db);const app=await createService({db,serverKey:'test',serverId:'test',publicUrl:'',sendMail:async()=>{}});try{for(let i=0;i<11;i++){const r=await app.inject({method:'POST',url:'/auth/login',payload:{email:'missing@example.org',password:'12345678'}});assert.equal(r.statusCode,i===10?429:401);}}finally{await app.close();await db.close();}});
