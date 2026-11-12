/**
 * Genera una clave nueva para el equipo (24 caracteres, ~120 bits al azar:
 * imposible de adivinar). Sin letras que se confundan (l, o, 0, 1).
 *
 *   npm run nube:clave
 */

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 símbolos: sin sesgo con % 32

export function newKey(length = 24): string {
  return [...randomBytes(length)].map((b) => ALPHABET[b % 32]).join('');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(newKey());
}
