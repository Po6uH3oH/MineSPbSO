import { database,migrate } from './db.js';
const db=await database(process.env.DATABASE_URL??'pglite:.local/accounts');try{await migrate(db);console.log('Миграции применены');}finally{await db.close();}
