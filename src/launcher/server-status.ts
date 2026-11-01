import { connect, isIP } from 'node:net';
import { z } from 'zod';

export function serverTargets(value: string) {
  const host = value.trim().toLowerCase();
  if (host !== 'localhost' && !isIP(host)) throw new Error('Введите только IP без порта или localhost.');
  const address = isIP(host) === 6 ? '[' + host + ']' : host;
  return {host, game: (host === 'localhost' ? '127.0.0.1' : address) + ':48905', map: 'http://' + address + ':8100/'};
}

function varInt(value: number) {
  const bytes = [];
  do {
    const part = value & 127;
    value >>>= 7;
    bytes.push(value ? part | 128 : part);
  } while (value);
  return Buffer.from(bytes);
}
function readVarInt(data: Buffer, offset: number) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset === data.length) return;
    const byte = data[offset++]!;
    value += (byte & 127) * 2 ** (7 * i);
    if (!(byte & 128)) return {value, offset};
  }
  throw new Error('Неверный ответ сервера');
}

export async function queryServer(host: string, port = 48905) {
  const result = z.object({
    version: z.object({name: z.string().max(200)}),
    players: z.object({online: z.number().int().nonnegative(), max: z.number().int().nonnegative()}).optional(),
  });
  return new Promise<z.infer<typeof result>>((resolve, reject) => {
    const socket = connect(port, host);
    const timeout = setTimeout(() => socket.destroy(new Error('Сервер не ответил')), 3500);
    let buffer = Buffer.alloc(0);
    socket.on('connect', () => {
      const name = Buffer.from(host);
      const portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      const handshake = Buffer.concat([Buffer.of(0), varInt(767), varInt(name.length), name, portBytes, Buffer.of(1)]);
      socket.write(Buffer.concat([varInt(handshake.length), handshake, Buffer.of(1, 0)]));
    });
    socket.on('data', chunk => {
      try {
        if (buffer.length + chunk.length > 1024 * 1024) throw new Error('Слишком большой ответ сервера');
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        const frame = readVarInt(buffer, 0);
        if (!frame || buffer.length < frame.offset + frame.value) return;
        const size = readVarInt(buffer, frame.offset + 1);
        if (buffer[frame.offset] !== 0 || !size || size.offset + size.value !== frame.offset + frame.value) throw new Error('Неверный пакет статуса');
        resolve(result.parse(JSON.parse(buffer.toString('utf8', size.offset, size.offset + size.value))));
        socket.destroy();
      } catch (error) { socket.destroy(error as Error); }
    });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timeout); reject(new Error('Сервер закрыл соединение')); });
  });
}
