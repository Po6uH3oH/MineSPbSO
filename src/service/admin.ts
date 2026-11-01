import { database } from './db.js';
const [action,nickname]=process.argv.slice(2);
if(!['ban','unban','revoke'].includes(action??'')||!nickname)throw new Error('admin ban|unban|revoke Ник');
const db=await database(process.env.DATABASE_URL??'pglite:.local/accounts');
try{await db.transaction(async tx=>{const a=(await tx.query('SELECT id FROM accounts WHERE nickname=$1',[nickname])).rows[0];if(!a)throw new Error('Аккаунт не найден');if(action==='ban'||action==='unban')await tx.query('UPDATE accounts SET banned=$1 WHERE id=$2',[action==='ban',a.id]);if(action!=='unban')await tx.query('DELETE FROM sessions WHERE account_id=$1',[a.id]);});console.log('Изменение сохранено. Уже подключённого игрока при блокировке также отключите в консоли Minecraft.');}finally{await db.close();}

