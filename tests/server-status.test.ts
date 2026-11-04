import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {queryServer} from '../src/launcher/server-status.js';
function vint(n:number){const out=[];do{const byte=n&127;n>>>=7;out.push(n?byte|128:byte);}while(n);return Buffer.from(out);}
test('server status exposes the optional player sample without requiring a full roster',async()=>{
 for(const sample of [undefined,[{name:'Player_One',id:'ignored-id'},{name:'Player_Two'}]]){
  const value={version:{name:'1.21.1'},players:{online:4,max:20,...(sample?{sample}:{})}};
  const json=Buffer.from(JSON.stringify(value)),body=Buffer.concat([Buffer.of(0),vint(json.length),json]);
  const server=createServer(socket=>socket.once('data',()=>socket.end(Buffer.concat([vint(body.length),body]))));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const result=await queryServer('127.0.0.1',(server.address() as {port:number}).port);assert.equal(result.players?.online,4);assert.deepEqual(result.players?.sample,sample?.map(({name})=>({name})));}
  finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 }
});
