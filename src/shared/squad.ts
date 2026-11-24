// Plain display text, never a role, permission, nation ID or command.
export function squadName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || /[\p{C}§<>\[\]\\]/u.test(value))
    throw new Error('Название отряда содержит недопустимые символы');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (name.length > 32) throw new Error('Название отряда: не более 32 символов');
  return name;
}
