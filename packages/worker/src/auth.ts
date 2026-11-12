/**
 * Las dos claves del equipo (secretos del Worker, nunca en el repositorio):
 *
 * - CAPTURE_KEY (va en el QR): capturar, ver y editar entradas.
 * - EDIT_KEY: además, vista de computadora (equipo, plantilla para generar la
 *   bitácora, página del QR).
 *
 * La comparación es en tiempo constante: se compara el SHA-256 de la clave
 * recibida contra el de cada clave, siempre las dos, byte por byte sin salir
 * antes. Así el tiempo de respuesta no dice cuántos caracteres coinciden ni
 * cuál de las dos claves se usó.
 */

import type { AccessLevel } from '@vortex-wake/shared';

/** Claves más cortas se rechazan al arrancar: con 16+ caracteres aleatorios no se pueden adivinar. */
export const MIN_KEY_LENGTH = 16;

export interface KeyEnv {
  CAPTURE_KEY?: string;
  EDIT_KEY?: string;
}

/** Mensaje para quien publica (en la consola de wrangler), nunca para el teléfono. */
export function keysProblem(env: KeyEnv): string | undefined {
  const c = env.CAPTURE_KEY ?? '';
  const e = env.EDIT_KEY ?? '';
  if (c.length < MIN_KEY_LENGTH || e.length < MIN_KEY_LENGTH) {
    return `faltan los secretos CAPTURE_KEY y EDIT_KEY (o miden menos de ${MIN_KEY_LENGTH} caracteres)`;
  }
  if (c === e) return 'CAPTURE_KEY y EDIT_KEY deben ser distintas';
  return undefined;
}

const enc = new TextEncoder();

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Qué permite la clave recibida, o `null` si no es ninguna de las dos. */
export async function accessFor(given: string | null, env: KeyEnv): Promise<AccessLevel | null> {
  if (keysProblem(env)) return null;
  const g = await sha256(given ?? '');
  const isEdit = sameBytes(g, await sha256(env.EDIT_KEY as string));
  const isCapture = sameBytes(g, await sha256(env.CAPTURE_KEY as string));
  if (!given) return null;
  return isEdit ? 'edit' : isCapture ? 'capture' : null;
}
