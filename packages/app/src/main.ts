/**
 * Arranque y rutas (#/, #/quien, #/entrada/<id>, #/cierre, #/escritorio).
 *
 * Por HTTP en la red local no hay contexto seguro: no se usan service worker,
 * instalación como PWA ni getUserMedia. La cámara es un <input capture> y todo
 * se guarda en IndexedDB. Cuando haya HTTPS se puede registrar un service
 * worker aquí (ver README) sin cambiar lo demás.
 */

import './styles.css';
import { App, takeKeyFromUrl } from './app.ts';
import { LocalDb } from './db.ts';
import { h } from './ui.ts';
import { renderDesktop } from './views/desktop.ts';
import { renderEditor } from './views/editor.ts';
import { renderClosing, renderHome, renderNoKey, renderWho } from './views/home.ts';

const root = document.getElementById('app') as HTMLElement;

async function boot(): Promise<void> {
  const key = takeKeyFromUrl();
  if (!key) return renderNoKey(root);
  let db: LocalDb;
  try {
    db = await LocalDb.open();
  } catch (e) {
    root.replaceChildren(h('div', { class: 'center' }, h('h1', { text: 'No se puede guardar en este teléfono' }), h('p', { text: `El navegador no permite usar el almacenamiento local (${(e as Error).message}). Si estás en una ventana privada o de incógnito, abre el enlace en una ventana normal.` })));
    return;
  }
  const app = new App(db, key);
  (window as unknown as { vwApp: App }).vwApp = app;
  await app.init();

  let cleanup: (() => void) | undefined;
  const go = (hash: string) => {
    if (location.hash === hash) route();
    else location.hash = hash;
  };
  const route = () => {
    cleanup?.();
    cleanup = undefined;
    window.scrollTo(0, 0);
    const hash = location.hash || '#/';
    document.body.classList.toggle('wide', hash.startsWith('#/escritorio'));
    if (hash.startsWith('#/escritorio')) {
      cleanup = renderDesktop(root, app, go);
      return;
    }
    if (!app.me && hash !== '#/quien') return go('#/quien');
    const m = /^#\/entrada\/(.+)$/.exec(hash);
    if (m) cleanup = renderEditor(root, app, decodeURIComponent(m[1] as string), () => go('#/'));
    else if (hash === '#/quien') cleanup = renderWho(root, app, go);
    else if (hash === '#/cierre') cleanup = renderClosing(root, app, go);
    else cleanup = renderHome(root, app, go);
  };
  addEventListener('hashchange', route);
  route();
}

void boot();
