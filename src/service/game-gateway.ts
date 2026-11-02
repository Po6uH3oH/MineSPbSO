import tls from 'node:tls';
import net from 'node:net';

export function createGameGateway(cert:Buffer,key:Buffer,minecraftPort:number) {
 const server=tls.createServer({cert,key,minVersion:'TLSv1.3',handshakeTimeout:8000},socket=>{
   const upstream=net.connect(minecraftPort,'127.0.0.1');
   socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
   socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
   socket.pipe(upstream);upstream.pipe(socket);
 });
 server.maxConnections=100;
 return server;
}

