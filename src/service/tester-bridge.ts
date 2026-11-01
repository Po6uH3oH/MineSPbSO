import https from 'node:https';
import http from 'node:http';
import { readFile, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export async function createTesterBridge(keys:string, distribution:string, apiPort=3000) {
  const tls = {key:await readFile(path.join(keys,'tls-private.pem')),cert:await readFile(path.join(keys,'tls-cert.pem'))};
  return https.createServer(tls, async(req,res)=>{
    try {
      const url=new URL(req.url??'/','http://localhost');
      const blob=/^\/packs\/files\/([a-f0-9]{64})$/.exec(url.pathname);
      if (url.pathname.startsWith('/packs/')){
        if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
        const file=blob?path.join(distribution,'files',blob[1]!):url.pathname==='/packs/current.json'?path.join(distribution,'current.json'):undefined;
        const stat=file && await lstat(file).catch(()=>null);
        if(!stat || !stat.isFile()){res.writeHead(404).end();return;}
        const range=req.headers.range;
        const match=range?.match(/^bytes=(\d+)-$/);
        let start=0;
        if(range){
          start=match?Number(match[1]):-1;
          if(!Number.isSafeInteger(start)||start<0||start>=stat.size){res.writeHead(416).end();return;}
          res.setHeader('Content-Range',`bytes ${start}-${stat.size-1}/${stat.size}`);
        }
        res.writeHead(range?206:200,{'Content-Length':stat.size-start,'Accept-Ranges':'bytes','Content-Type':blob?'application/octet-stream':'application/json','Cache-Control':blob?'public,max-age=31536000,immutable':'no-store'});
        if(req.method==='HEAD'||stat.size===0){res.end();return;}
        const stream=createReadStream(file!,{start});
        res.on('close',()=>stream.destroy());
        stream.on('error',()=>res.destroy()).pipe(res);
        return;
      }
      if(!/^\/(?:health|me(?:\/skin)?|auth\/(?:login|register|verify|resend|refresh|forgot|reset|logout|revoke-all)|csl\/(?:[A-Za-z0-9_]{3,16}\.json|textures\/[a-f0-9]{64}))$/.test(url.pathname)){res.writeHead(404).end();return;}
      const upstream=http.request({hostname:'127.0.0.1',port:apiPort,path:url.pathname+url.search,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+apiPort}},reply=>{
        res.writeHead(reply.statusCode??502,reply.headers);reply.on('error',()=>res.destroy()).pipe(res);
      });
      upstream.setTimeout(30000,()=>upstream.destroy());
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Запустите сервис аккаунтов на компьютере владельца.'}));});
      res.on('close',()=>upstream.destroy());
      req.pipe(upstream);
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
}

