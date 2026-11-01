import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export interface DB {
 query(sql: string, values?: any[]): Promise<{rows: Record<string, any>[]} >;
 transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
 close(): Promise<void>;
}
export async function database(url: string): Promise<DB> {
 if (url.startsWith('pglite:')) {
  const p = new PGlite(url.slice(7) || undefined);
  const wrap = (q: any): DB => ({query:(s,v)=>q.query(s,v), transaction:fn=>q.transaction((t:any)=>fn(wrap(t))), close:()=>p.close()});
  return wrap(p);
 }
 const pool = new pg.Pool({ connectionString:url, max:10 });
 return { query:(s,v)=>pool.query(s,v), close:()=>pool.end(), transaction: async fn=>{
  const c=await pool.connect();
  try { await c.query('BEGIN'); const r=await fn({query:(s,v)=>c.query(s,v),transaction:()=>{throw new Error('Nested transaction');},close:async()=>{}}); await c.query('COMMIT'); return r; }
  catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
 }};
}
export async function migrate(db: DB) {
 const sql=await readFile(new URL('./001-init.sql',import.meta.url),'utf8');
 await db.transaction(async tx=>{for(const statement of sql.split(';').filter(s=>s.trim())) await tx.query(statement);});
}
