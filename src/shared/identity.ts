import { createHash, randomBytes } from 'node:crypto';
export function nickname(value: string): string {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(value)) throw new Error('Ник: 3–16 латинских букв, цифр или _');
  return value;
}
export function offlineUuid(name: string): string {
  nickname(name);
  const b = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  b[6] = (b[6]! & 15) | 48; b[8] = (b[8]! & 63) | 128;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
