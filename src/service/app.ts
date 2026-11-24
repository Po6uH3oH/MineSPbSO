import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import argon2 from 'argon2';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { squadName } from '../shared/squad.js';
import type { DB } from './db.js';
import { digest, secret, offlineUuid } from '../shared/identity.js';

export interface ServiceConfig {
 db: DB; serverKey: string; serverId: string; publicUrl: string;
 sendMail: (email:string, subject:string, text:string)=>Promise<void>;
}
const credentials=z.object({email:z.email().max(254).transform(v=>v.trim().toLowerCase()),password:z.string().min(8).max(128)});
const proof=z.object({challenge:z.string().min(32).max(100),ticket:z.string().min(32).max(100)});
const error=(statusCode:number,message:string)=>Object.assign(new Error(message),{statusCode});
const publicAccount=(a:any)=>({id:a.id,nickname:a.nickname,uuid:a.game_uuid,verified:a.verified,skinModel:a.skin_model,skinHash:a.skin_hash,squadName:a.squad_name??''});
export async function createService(c:ServiceConfig) {
 const app=Fastify({logger:false,bodyLimit:128*1024,trustProxy:false});
 await app.register(rateLimit,{max:100,timeWindow:'1 minute'});
 await app.register(multipart,{limits:{files:1,fileSize:64*1024,fields:1}});
 const dummy=await argon2.hash(secret(),{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
 app.setErrorHandler((e,_q,r)=>{const x=e as any; r.code(x instanceof z.ZodError?400:x.statusCode??500).send({error:x instanceof z.ZodError?'Проверьте введённые данные':(x.statusCode&&x.statusCode<500?x.message:'Ошибка сервиса. Повторите попытку позже.')});});
 async function limited(key:string,max:number,seconds:number) {
  const {rows}=await c.db.query(`INSERT INTO limits(key,count,expires) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN limits.expires<now() THEN 1 ELSE limits.count+1 END, expires=CASE WHEN limits.expires<now() THEN excluded.expires ELSE limits.expires END RETURNING count`,[key,seconds]);
  if(rows[0].count>max)throw error(429,'Слишком много попыток. Попробуйте позже.');
 }
 async function account(q:FastifyRequest,verified=false) {
  const h=q.headers.authorization;
  if(!h?.startsWith('Bearer '))throw error(401,'Войдите в аккаунт');
  const {rows}=await c.db.query(`SELECT a.*,s.id AS session_id FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.access_hash=$1 AND s.access_expires>now() AND s.expires>now() AND NOT a.banned`,[digest(h.slice(7))]);
  if(!rows[0])throw error(401,'Сессия завершена. Войдите снова');
  if(verified&&!rows[0].verified)throw error(403,'Подтвердите почту');
  if(verified&&rows[0].pending)throw error(403,'Ожидайте допуска владельца сервера.');
  return rows[0];
 }
 function server(q:FastifyRequest) {
  const b=Buffer.from(q.headers.authorization??''); const expected=Buffer.from(`Bearer ${c.serverKey}`);
  if(b.length!==expected.length||!timingSafeEqual(b,expected))throw error(401,'Сервер не авторизован');
 }
 async function session(id:string,hash:string) {
  const access=secret(),refresh=secret();
  await c.db.transaction(async tx=>{
   if(!(await tx.query('SELECT id FROM accounts WHERE id=$1 AND password_hash=$2 AND NOT banned FOR SHARE',[id,hash])).rows.length)throw error(401,'Войдите снова');
   await tx.query(`INSERT INTO sessions VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')`,[randomUUID(),id,digest(access),digest(refresh)]);
  });
  return {access,refresh};
 }
 async function mailToken(id:string,email:string,purpose:'verify'|'reset') {
  await limited(`mail:${id}`,3,900);
  const token=secret();
  await c.db.query(`INSERT INTO email_tokens VALUES($1,$2,$3,now()+interval '30 minutes')`,[digest(token),id,purpose]);
  await c.sendMail(email,purpose==='verify'?'Подтверждение почты MineSPbSO':'Восстановление пароля MineSPbSO',`Введите этот одноразовый код в лаунчере (действует 30 минут):\n\n${token}\n\nЕсли вы не отправляли запрос, проигнорируйте письмо.`);
 }
 app.get('/health',async()=>{await c.db.query('SELECT 1');return {ok:true};});
 app.post('/auth/register',async q=>{
  const v=credentials.extend({nickname:z.string().regex(/^[A-Za-z0-9_]{3,16}$/)}).parse(q.body);
  await limited(`register:${q.ip}`,5,3600);
  const closed=()=>error(403,'Регистрация временно закрыта владельцем.');
  if((await c.db.query('SELECT mode FROM registration_policy WHERE id=1')).rows[0].mode==='closed')throw closed();
  const id=randomUUID(), hash=await argon2.hash(v.password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
  try {await c.db.transaction(async tx=>{
   const policy=(await tx.query('SELECT mode FROM registration_policy WHERE id=1 FOR SHARE')).rows[0].mode;
   if(policy==='closed')throw closed();
   await tx.query('INSERT INTO reserved_nicks VALUES(lower($1))',[v.nickname]);
   await tx.query('INSERT INTO accounts(id,email,nickname,game_uuid,password_hash,pending) VALUES($1,$2,$3,$4,$5,$6)',[id,v.email,v.nickname,offlineUuid(v.nickname),hash,policy==='review']);
  });}
  catch(e:any){if(e.code==='23505')throw error(409,'Почта или ник уже используются');throw e;}
  await mailToken(id,v.email,'verify'); return {ok:true};
 });
 app.post('/auth/login',async q=>{
  const v=credentials.parse(q.body);await limited(`login:${digest(v.email)}`,10,900);
  const a=(await c.db.query('SELECT * FROM accounts WHERE email=$1',[v.email])).rows[0];
  const valid=await argon2.verify(a?.password_hash??dummy,v.password);
  if(!valid||!a||a.banned)throw error(401,'Неверная почта или пароль, либо аккаунт заблокирован');
  if(a.pending&&a.verified)throw error(403,'Почта подтверждена. Ожидайте допуска владельца сервера.');
  return {...await session(a.id,a.password_hash),account:publicAccount(a)};
 });
 app.post('/auth/refresh',async q=>{
  const v=z.object({refresh:z.string().max(100)}).parse(q.body),access=secret(),refresh=secret();
  const {rows}=await c.db.query(`UPDATE sessions SET access_hash=$1,refresh_hash=$2,access_expires=now()+interval '15 minutes' WHERE refresh_hash=$3 AND expires>now() AND account_id IN (SELECT id FROM accounts WHERE NOT banned) RETURNING account_id`,[digest(access),digest(refresh),digest(v.refresh)]);
  if(!rows[0])throw error(401,'Войдите снова');return {access,refresh};
 });
 app.post('/auth/logout',async q=>{const a=await account(q);await c.db.query('DELETE FROM sessions WHERE id=$1',[a.session_id]);return {ok:true};});
 app.post('/auth/revoke-all',async q=>{const a=await account(q);await c.db.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);return {ok:true};});
 app.post('/auth/resend',async q=>{const a=await account(q);if(!a.verified)await mailToken(a.id,a.email,'verify');return {ok:true};});
 app.post('/auth/forgot',async q=>{const {email}=z.object({email:z.email().transform(s=>s.toLowerCase())}).parse(q.body);await limited(`forgot:${q.ip}`,5,900);const a=(await c.db.query('SELECT id,email FROM accounts WHERE email=$1',[email])).rows[0];if(a)await mailToken(a.id,a.email,'reset');return {ok:true};});
 async function useEmail(token:string,purpose:string,fn:(tx:DB,id:string)=>Promise<void>) {
  await c.db.transaction(async tx=>{const {rows}=await tx.query('DELETE FROM email_tokens WHERE hash=$1 AND purpose=$2 AND expires>now() RETURNING account_id',[digest(token),purpose]);if(!rows[0])throw error(400,'Код недействителен или истёк');await fn(tx,rows[0].account_id);});
 }
 app.post('/auth/verify',async q=>{const {token}=z.object({token:z.string().max(100)}).parse(q.body);await useEmail(token,'verify',async(tx,id)=>{await tx.query('UPDATE accounts SET verified=true WHERE id=$1',[id]);});return {ok:true};});
 app.post('/auth/reset',async q=>{const v=z.object({token:z.string().max(100),password:z.string().min(8).max(128)}).parse(q.body);const h=await argon2.hash(v.password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});await useEmail(v.token,'reset',async(tx,id)=>{await tx.query('UPDATE accounts SET password_hash=$1 WHERE id=$2',[h,id]);await tx.query('DELETE FROM sessions WHERE account_id=$1',[id]);await tx.query('DELETE FROM email_tokens WHERE account_id=$1 AND purpose=$2',[id,'reset']);});return {ok:true};});
 app.get('/me',async q=>publicAccount(await account(q)));
 app.post('/me/profile',async q=>{
  const a=await account(q,true);
  const v=z.object({squadName:z.string().max(128)}).strict().parse(q.body);
  let name:string;try{name=squadName(v.squadName);}catch(e){throw error(400,(e as Error).message);}
  await limited('profile:'+a.id,10,60);
  const {rows}=await c.db.query('UPDATE accounts SET squad_name=$1 WHERE id=$2 AND NOT banned RETURNING *',[name,a.id]);
  if(!rows[0])throw error(403,'Аккаунт недоступен');
  return publicAccount(rows[0]);
 });
 app.post('/me/skin',async q=>{
  const a=await account(q,true);const file=await q.file();if(!file)throw error(400,'Выберите PNG');const bytes=await file.toBuffer();if(file.file.truncated)throw error(413,'Скин больше 64 КБ');
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(16)!==64||![32,64].includes(bytes.readUInt32BE(20)))throw error(400,'Требуется PNG 64×64 или 64×32');
  let png;try{png=PNG.sync.read(bytes,{checkCRC:true});}catch{throw error(400,'Повреждённый PNG');}
  const model=z.enum(['default','slim']).parse((q.query as any).model??'default');if(model==='slim'&&png.height===32)throw error(400,'Модель slim требует 64×64');
  const clean=PNG.sync.write(png);await c.db.transaction(async tx=>{await tx.query('INSERT INTO skin_blobs(hash,png) VALUES($1,$2) ON CONFLICT DO NOTHING',[digest(clean),clean]);await tx.query('UPDATE accounts SET skin=$1,skin_hash=$2,skin_model=$3 WHERE id=$4',[clean,digest(clean),model,a.id]);});return {ok:true};
 });
 app.get('/skins/:name',async(q,r)=>{const {name}=q.params as any;const a=(await c.db.query('SELECT skin,skin_hash FROM accounts WHERE nickname=$1 AND verified AND NOT pending AND NOT banned',[name])).rows[0];if(!a?.skin)return r.code(404).send();r.header('Content-Type','image/png').header('Cache-Control','public,max-age=60').header('ETag',`"${a.skin_hash}"`);return Buffer.from(a.skin);});
 app.get('/csl/:name.json',async(q,r)=>{const {name}=q.params as any;const a=(await c.db.query('SELECT skin_hash,skin_model FROM accounts WHERE nickname=$1 AND verified AND NOT pending AND NOT banned',[name])).rows[0];r.header('Cache-Control','no-store');return {username:name,textures:a?.skin_hash?{[a.skin_model]:a.skin_hash}:{}};});
 app.get('/csl/textures/:hash',async(q,r)=>{const {hash}=q.params as any;if(!/^[a-f0-9]{64}$/.test(hash))return r.code(404).send();const a=(await c.db.query('SELECT png FROM skin_blobs WHERE hash=$1',[hash])).rows[0];if(!a)return r.code(404).send();return r.header('Content-Type','image/png').header('Cache-Control','public,max-age=31536000,immutable').send(Buffer.from(a.png));});
 app.post('/server/whitelist',async q=>{
  server(q);
  const {rows}=await c.db.query('SELECT nickname AS name,game_uuid AS uuid FROM accounts WHERE verified AND NOT pending AND NOT banned ORDER BY nickname_key');
  return {players:rows};
 });
 app.post('/server/challenge',async q=>{server(q);const v=z.object({nickname:z.string().regex(/^[A-Za-z0-9_]{3,16}$/),uuid:z.uuid()}).parse(q.body);if(offlineUuid(v.nickname)!==v.uuid)throw error(403,'Неверный UUID');const allowed=await c.db.query('SELECT id FROM accounts WHERE nickname=$1 AND game_uuid=$2 AND verified AND NOT pending AND NOT banned',[v.nickname,v.uuid]);if(!allowed.rows.length)throw error(403,'Аккаунт не допущен');const id=secret();await c.db.query(`INSERT INTO challenges(id,server_id,nickname,game_uuid,expires) VALUES($1,$2,$3,$4,now()+interval '60 seconds')`,[id,c.serverId,v.nickname,v.uuid]);return {challenge:id};});
 app.post('/join/ticket',async q=>{const a=await account(q,true);const {challenge}=z.object({challenge:z.string().min(32).max(100)}).parse(q.body);const ticket=secret();const {rows}=await c.db.query(`UPDATE challenges SET ticket_hash=$1,account_id=$2,ticket_session_id=$7 WHERE id=$3 AND nickname=$4 AND game_uuid=$5 AND server_id=$6 AND expires>now() AND ticket_hash IS NULL AND NOT consumed RETURNING id`,[digest(ticket),a.id,challenge,a.nickname,a.game_uuid,c.serverId,a.session_id]);if(!rows[0])throw error(403,'Подключение не соответствует аккаунту или истекло');return {ticket};});
 app.post('/server/consume',async q=>{server(q);const v=proof.extend({nickname:z.string(),uuid:z.uuid()}).parse(q.body);const {rows}=await c.db.query(`UPDATE challenges c SET consumed=true WHERE id=$1 AND ticket_hash=$2 AND nickname=$3 AND game_uuid=$4 AND server_id=$5 AND expires>now() AND NOT consumed AND account_id IN (SELECT id FROM accounts WHERE verified AND NOT pending AND NOT banned) AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=c.ticket_session_id AND s.account_id=c.account_id AND s.expires>now()) RETURNING account_id`,[v.challenge,digest(v.ticket),v.nickname,v.uuid,c.serverId]);if(!rows[0])throw error(403,'Проверка подключения отклонена');const a=(await c.db.query('SELECT * FROM accounts WHERE id=$1',[rows[0].account_id])).rows[0];return publicAccount(a);});
 return app;
}

