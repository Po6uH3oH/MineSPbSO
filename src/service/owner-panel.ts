import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import {z} from 'zod';
import type {DB} from './db.js';

const escape=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const digest=(s:string)=>createHash('sha256').update(s).digest();

export async function ownerPanel(db:DB,password:string){
 if(password.length<20)throw new Error('Задайте отдельный ADMIN_PANEL_PASSWORD длиной от 20 символов.');
 const panel=Fastify({logger:false,bodyLimit:4096});
 await panel.register(rateLimit,{max:90,timeWindow:'1 minute'});
 const expected=digest('Basic '+Buffer.from('owner:'+password).toString('base64'));
 const csrf=randomBytes(32).toString('hex');
 panel.addHook('onRequest',async(q,r)=>{
  r.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(!['127.0.0.1:3011','localhost:3011'].includes(q.headers.host??''))return r.code(403).send('Откройте панель через localhost:3011.');
  if(!timingSafeEqual(expected,digest(q.headers.authorization??'')))return r.header('WWW-Authenticate','Basic realm="MineSPbSO owner", charset="UTF-8"').code(401).send('Нужен вход владельца.');
 });
 panel.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string'},(_q,body,done)=>done(null,Object.fromEntries(new URLSearchParams(String(body)))));
 const field='<input type="hidden" name="csrf" value="'+csrf+'">';
 panel.get('/',async(q,r)=>{
  const page=z.coerce.number().int().min(1).max(100000).catch(1).parse((q.query as any).page);
  const rows=(await db.query('SELECT nickname,email,verified,banned,pending,created_at FROM accounts ORDER BY created_at DESC,id LIMIT 51 OFFSET $1',[(page-1)*50])).rows;
  const mode=(await db.query('SELECT mode FROM registration_policy WHERE id=1')).rows[0].mode;
  const modes={open:'Свободная регистрация',review:'Допуск новых игроков вручную',closed:'Закрыть регистрацию'};
  return r.type('text/html;charset=utf-8').send(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>MineSPbSO · Аккаунты</title>
  <style>body{font:16px system-ui;max-width:72rem;margin:2rem auto;padding:0 1rem}td,th{padding:.5rem;text-align:left;border-bottom:1px solid #aaa}form{margin:1rem 0}label,input,select,button{margin:.3rem}</style>
  <h1>Аккаунты MineSPbSO</h1><table><tr><th>Ник<th>Почта<th>Подтверждена<th>Допуск<th>Создан (UTC)</tr>
  ${rows.slice(0,50).map(a=>'<tr>'+[a.nickname,a.email,a.verified?'Да':'Нет',a.banned?'Заблокирован':a.pending?'Ждёт одобрения':'Разрешён',new Date(a.created_at).toISOString().slice(0,16)].map(v=>'<td>'+escape(v)+'</td>').join('')+'</tr>').join('')}</table>
  ${page>1?'<a href="?page='+(page-1)+'">Назад</a>':''} ${rows.length>50?'<a href="?page='+(page+1)+'">Далее</a>':''}
  <h2>Регистрация</h2><form method="post" action="/policy">${field}<select name="mode">${Object.entries(modes).map(([k,v])=>'<option value="'+k+'" '+(mode===k?'selected':'')+'>'+v+'</option>').join('')}</select><button>Сохранить режим</button></form>
  <h2>Управление аккаунтом</h2><form method="post" action="/account">${field}<label>Точный ник <input name="nickname" required maxlength="16"></label><select name="action"><option value="approve">Одобрить</option><option value="password">Заменить пароль</option><option value="delete">Удалить аккаунт</option></select>
  <label>Новый пароль (при замене) <input type="password" autocomplete="new-password" name="password" maxlength="128"></label>
  <label>Для удаления повторите ник <input name="confirm"></label><button>Применить</button></form>
  <p>Удаление окончательное. Ник остаётся зарезервированным для защиты игрового прогресса.</p></html>`);
 });
 panel.addHook('preHandler',async(q,r)=>{
  if(q.method==='POST'&&(q.body as any)?.csrf!==csrf)return r.code(403).send('Откройте страницу панели заново.');
 });
 panel.post('/policy',async(q,r)=>{
  const mode=z.enum(['open','review','closed']).safeParse((q.body as any)?.mode);
  if(!mode.success)return r.code(400).send('Неизвестный режим.');
  await db.query('UPDATE registration_policy SET mode=$1 WHERE id=1',[mode.data]);
  return r.redirect('/',303);
 });
 panel.post('/account',async(q,r)=>{
  const result=z.object({nickname:z.string().regex(/^[A-Za-z0-9_]{3,16}$/),action:z.enum(['approve','password','delete']),password:z.string().max(128).default(''),confirm:z.string().default('')}).safeParse(q.body);
  if(!result.success)return r.code(400).send('Проверьте ник и действие.');
  const {nickname,action,password,confirm}=result.data;
  if(action==='delete'&&confirm!==nickname)return r.code(400).send('Повторите точный ник для удаления.');
  if(action==='password'&&password.length<8)return r.code(400).send('Нужно минимум 8 символов.');
  const hash=action==='password'?await argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1}):null;
  const found=await db.transaction(async tx=>{
   const a=(await tx.query('SELECT id FROM accounts WHERE nickname=$1 FOR UPDATE',[nickname])).rows[0];
   if(!a)return false;
   if(action==='approve')await tx.query('UPDATE accounts SET pending=false WHERE id=$1',[a.id]);
   else{
    await tx.query('DELETE FROM challenges WHERE account_id=$1',[a.id]);
    await tx.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);
    await tx.query(action==='delete'?'DELETE FROM email_tokens WHERE account_id=$1':"DELETE FROM email_tokens WHERE account_id=$1 AND purpose='reset'",[a.id]);
    if(action==='delete')await tx.query('DELETE FROM accounts WHERE id=$1',[a.id]);
    else await tx.query('UPDATE accounts SET password_hash=$2 WHERE id=$1',[a.id,hash]);
   }
   return true;
  });
  return found?r.redirect('/',303):r.code(404).send('Аккаунт с таким написанием ника не найден.');
 });
 return panel;
}
