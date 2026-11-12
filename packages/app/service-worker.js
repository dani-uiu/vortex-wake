/*
 * Service worker de Vortex Wake (solo en la versión hospedada, con HTTPS).
 *
 * Plantilla: al compilar, vite.config.ts reemplaza __VW_VERSION__ (huella de
 * todos los archivos) y __VW_PRECACHE__ (lista de archivos) y lo escribe como
 * dist/sw.js.
 *
 * Estrategia:
 * - Al instalarse guarda en caché la app completa de esta versión (index.html,
 *   assets/ con hash, manifiesto e íconos) y toma el control de inmediato.
 * - Abrir la app (navegación): primero la red, para que una versión nueva
 *   llegue en cuanto se publica; si no hay red (o tarda más de unos
 *   segundos), el index.html guardado. Así se puede abrir sin conexión.
 * - assets/: primero la caché (sus nombres llevan hash: nunca cambian).
 * - /api/ (entradas, fotos, plantilla) nunca pasa por aquí: lo del equipo vive
 *   en IndexedDB y en el servidor, no en esta caché.
 * - Al activarse una versión nueva se borran las cachés de versiones viejas.
 */

const VERSION = '__VW_VERSION__';
const PRECACHE = __VW_PRECACHE__;
const CACHE = `vw-app-${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('vw-app-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'vw-version' && event.source) event.source.postMessage({ type: 'vw-version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') event.respondWith(navigation(req));
    return;
  }
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) event.respondWith(cacheFirst(req));
});

async function navigation(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match('/');
  const network = fetch(req, { cache: 'no-store' });
  if (!cached) return network;
  try {
    const res = await Promise.race([network, new Promise((_, reject) => setTimeout(() => reject(new Error('lento')), NAVIGATION_TIMEOUT_MS))]);
    if (res.ok) return res;
    return cached;
  } catch {
    return cached;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && new URL(req.url).pathname.startsWith('/assets/')) await cache.put(req, res.clone());
  return res;
}
