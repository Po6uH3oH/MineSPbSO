import nodemailer from 'nodemailer';
import { database, migrate } from './db.js';
import { createService } from './app.js';
const env=process.env;
if(!env.SERVER_KEY||env.SERVER_KEY.length<32)throw new Error('SERVER_KEY должен содержать минимум 32 символа');
if(env.NODE_ENV==='production'&&(!env.PUBLIC_URL?.startsWith('https://')||!env.SMTP_HOST||env.DATABASE_URL?.startsWith('pglite:')))throw new Error('Для production нужны HTTPS, SMTP, PostgreSQL');
const mail=nodemailer.createTransport({host:env.SMTP_HOST??'127.0.0.1',port:Number(env.SMTP_PORT??1025),secure:env.SMTP_SECURE==='true',requireTLS:!!env.SMTP_USER,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,...(env.SMTP_USER?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}}:{})});
if(env.SMTP_VERIFY_ON_START==='true'){
 try{await mail.verify();}
 catch(error){
  const code=(error as {code?:string}).code;
  throw new Error(code==='EAUTH'?'SMTP отклонил вход. Проверьте логин, пароль приложения типа «Почта» и разрешение паролей приложений.':'Не удалось подключиться к SMTP. Проверьте доступ к серверу и порту, а также TLS.');
 }
 console.log('Вход на SMTP-сервер подтверждён.');
}
const db=await database(env.DATABASE_URL??'pglite:.local/accounts');await migrate(db);
const app=await createService({db,serverKey:env.SERVER_KEY,serverId:env.SERVER_ID??'local',publicUrl:env.PUBLIC_URL??'http://127.0.0.1:3000',sendMail:async(to,subject,text)=>{await mail.sendMail({from:env.SMTP_FROM??'MineSPbSO <no-reply@localhost>',to,subject,text});}});
await app.listen({host:env.HOST??'127.0.0.1',port:Number(env.PORT??3000)});
const cleanup=setInterval(()=>void db.query("DELETE FROM challenges WHERE expires<now()-interval '1 hour'").then(()=>db.query('DELETE FROM limits WHERE expires<now()')).catch(()=>{}),60_000);cleanup.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(cleanup);void app.close().then(()=>db.close());});
console.log('Сервис аккаунтов запущен');
