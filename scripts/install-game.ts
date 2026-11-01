import { installGame } from '../src/launcher/game.js';
import { acquireLock } from '../src/launcher/files.js';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'.local/Проверка игры с пробелами');const unlock=await acquireLock(root);try{console.log(await installGame(root));}finally{await unlock();}
