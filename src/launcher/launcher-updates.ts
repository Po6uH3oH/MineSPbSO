import {verify} from 'node:crypto';
import {z} from 'zod';

export const releases='https://github.com/Po6uH3oH/MineSPbSO/releases';
const numericVersion=z.string().regex(/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/);
export function newer(a:string,b:string){
 const left=numericVersion.parse(a).split('.').map(Number),right=numericVersion.parse(b).split('.').map(Number);
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]!>right[i]!;
 return false;
}
export const installerSchema=z.object({purpose:z.literal('MineSPbSO Windows x64 installer v1'),version:numericVersion,
 size:z.number().int().positive().max(512*1024**2),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
export function verifiedInstaller(raw:unknown,key:string){
 const {payload,signature}=z.object({payload:z.string().max(4096),signature:z.string().max(128)}).parse(raw);
 const bytes=Buffer.from(payload,'base64');
 if(!verify(null,bytes,key,Buffer.from(signature,'base64')))throw new Error('Подпись обновления лаунчера недействительна.');
 return installerSchema.parse(JSON.parse(bytes.toString('utf8')));
}

