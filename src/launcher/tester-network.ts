import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Agent } from 'undici';

export function communityFetch(apiUrl:string,ca:string):typeof fetch {
  if(!ca)return fetch;
  const origin=new URL(apiUrl).origin;
  const dispatcher=new Agent({connect:{ca}});
  return (input,init={})=>{
    const url=new URL(input instanceof Request?input.url:input.toString());
    if(url.origin!==origin)return fetch(input,init);
    return fetch(input,{...init,dispatcher,redirect:'error'} as RequestInit);
  };
}

// Only public skin resources are exposed to the game. Account TLS is verified by Electron.
export async function skinEndpoint(apiUrl:string,fetchFile:typeof fetch) {
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='GET'||!/^\/csl\/(?:[A-Za-z0-9_]{3,16}\.json|textures\/[0-9a-f]{64})$/.test(req.url??'')){
      res.writeHead(404).end();return;
    }
    try{
      const remote=await fetchFile(apiUrl+req.url,{signal:AbortSignal.timeout(8000)});
      if(!remote.ok){res.writeHead(remote.status).end();return;}
      const data=Buffer.from(await remote.arrayBuffer());
      if(data.length>128*1024)throw new Error('Размер ответа превышен');
      res.writeHead(200,{'Content-Type':remote.headers.get('content-type')??'application/octet-stream','Cache-Control':remote.headers.get('cache-control')??'no-store'});
      res.end(data);
    }catch{res.writeHead(502).end();}
  });
  await new Promise<void>((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+(server.address() as AddressInfo).port,close:()=>{server.close();server.closeAllConnections();}};
}

