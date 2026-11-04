import {z} from 'zod';

export const gamePreferencesSchema=z.object({
 autoJoin:z.boolean().default(true),
 autoLogin:z.boolean().default(true),
 fullscreen:z.boolean().default(false),
 width:z.number().int().min(640).max(7680).default(1280),
 height:z.number().int().min(360).max(4320).default(720),
 jvmArgs:z.string().max(2048).default(''),
});
export type GamePreferences=z.infer<typeof gamePreferencesSchema>;

// Each argument is passed directly to Java, never through a shell.
export function parseJvmArgs(value:string):string[]{
 const args:string[]=[];let token='',quote='';
 for(const c of value.trim()){
  if(c==='"'||c==="'"){if(!quote)quote=c;else if(quote===c)quote='';else token+=c;}
  else if(/\s/.test(c)&&!quote){if(token){args.push(token);token='';}}
  else token+=c;
 }
 if(quote)throw new Error('Закройте кавычки в аргументах JVM.');
 if(token)args.push(token);
 for(const arg of args){
  if(!/^-(?:D[^=\s]+(?:=.*)?|XX:[^\s]+|X[^\s]+|ea|da)$/.test(arg)||/^-X(?:mx|ms)/i.test(arg))
   throw new Error('Используйте параметры -D, -XX или -X. Память задаётся ползунком, а не через -Xmx/-Xms.');
 }
 return args;
}
