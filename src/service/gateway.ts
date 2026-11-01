import tls from 'node:tls';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
if(!process.env.TLS_CERT||!process.env.TLS_KEY)throw new Error('TLS_CERT/TLS_KEY обязательны');
const server=tls.createServer({cert:await readFile(process.env.TLS_CERT),key:await readFile(process.env.TLS_KEY),minVersion:'TLSv1.3',handshakeTimeout:10_000},socket=>{
 const upstream=net.connect({host:'127.0.0.1',port:Number(process.env.MINECRAFT_PORT??25565)});
 socket.pipe(upstream);upstream.pipe(socket);
 socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
 socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
});
server.maxConnections=100;
server.listen(Number(process.env.GATEWAY_PORT??25566),process.env.GATEWAY_HOST??'0.0.0.0',()=>console.log('TLS gateway запущен'));
