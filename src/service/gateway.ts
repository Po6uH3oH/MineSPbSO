import {readFile} from 'node:fs/promises';
import {createGameGateway} from './game-gateway.js';
if(!process.env.TLS_CERT||!process.env.TLS_KEY)throw new Error('TLS_CERT/TLS_KEY обязательны');
const backend=Number(process.env.MINECRAFT_PORT??48906);
const port=Number(process.env.GATEWAY_PORT??48905);
if(backend===port)throw new Error('TLS и Minecraft требуют разные порты.');
const cert=await readFile(process.env.TLS_CERT),key=await readFile(process.env.TLS_KEY);
const hosts=(process.env.GATEWAY_HOST??'0.0.0.0').split(',').map(v=>v.trim());
for(const host of hosts){
 const gateway=createGameGateway(cert,key,backend);
 gateway.listen(port,host,()=>console.log('TLS Minecraft: '+host+':'+port+' → 127.0.0.1:'+backend));
}
