/**
 * Service worker e instalación (solo en la versión hospedada, con HTTPS).
 *
 * Quién decide es el servidor: el Worker responde `hosted: true` en
 * /api/state y la app lo recuerda para la siguiente vez que abra (aunque sea
 * sin conexión). Con el servidor local por HTTP no hay `hosted`, así que no se
 * registra nada y, si quedó alguno registrado, se quita.
 *
 * Actualizaciones: el service worker nuevo toma el control en cuanto se
 * instala (ver service-worker.js). Si la app estaba abierta, aparece un aviso
 * "Hay una versión nueva" con un botón para recargar, y se recarga sola la
 * próxima vez que se vuelve a la pestaña (al salir, lo escrito ya se guardó).
 */

import { h } from './ui.ts';

const CHECK_EVERY_MS = 30 * 60_000;

declare const __VW_BUILD__: string;
export const BUILD_LABEL: string = typeof __VW_BUILD__ === 'string' ? __VW_BUILD__ : 'desarrollo';

let started = false;
let updateReady = false;

/** Se llama al arrancar (con lo recordado) y cada vez que el servidor dice si está hospedado. */
export function setupServiceWorker(hosted: boolean): void {
  if (!('serviceWorker' in navigator)) return;
  if (!hosted || !window.isSecureContext) {
    void navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister())));
    return;
  }
  if (started) return;
  started = true;
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // La primera instalación también cambia el controlador; eso no es una versión nueva.
    if (controlled) showUpdate();
    controlled = true;
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((reg) => {
      const check = () => void reg.update().catch(() => undefined);
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (updateReady) location.reload();
        else check();
      });
    })
    .catch((e: unknown) => console.warn('No se pudo registrar el service worker', e));
}

function showUpdate(): void {
  updateReady = true;
  if (document.getElementById('update-banner')) return;
  document.body.append(
    h(
      'div',
      { id: 'update-banner', class: 'update-banner', role: 'status', 'data-testid': 'update-banner' },
      h('span', { text: 'Hay una versión nueva de la app.' }),
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'update-reload', onclick: () => location.reload() }, 'Actualizar'),
    ),
  );
}
