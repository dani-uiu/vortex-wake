/** Utilidades HTTP del Worker: respuestas, límites de tamaño y cabeceras de seguridad. */

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Política de contenido de la app: solo código y estilos propios (nada en
 * línea ni de otros dominios). `blob:` y `data:` en imágenes: fotos del
 * teléfono, el QR y el ícono.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Cabeceras para todas las respuestas (app, API y fotos). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('x-robots-tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  h.set('referrer-policy', 'no-referrer');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('strict-transport-security', 'max-age=31536000');
  h.set('cross-origin-opener-policy', 'same-origin');
  h.set('cross-origin-resource-policy', 'same-origin');
  h.set('permissions-policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  h.set('content-security-policy', CONTENT_SECURITY_POLICY);
  return out;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Lee el cuerpo sin pasar de `max` bytes: primero revisa `content-length` y
 * después cuenta lo que va llegando (por si no viene o miente).
 */
export async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) throw new HttpError(413, 'demasiado grande');
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, 'demasiado grande');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export async function readJson(req: Request, max: number): Promise<unknown> {
  const bytes = await readBody(req, max);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}
