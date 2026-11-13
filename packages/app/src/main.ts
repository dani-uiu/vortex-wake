/**
 * Arranque y rutas (#/, #/quien, #/entrada/<id>, #/dia/<fecha>, #/cierre, #/escritorio, #/qr).
 *
 * Por HTTP en la red local no hay contexto seguro: no se usan service worker,
 * instalación como PWA ni getUserMedia. La cámara es un <input capture> y todo
 * se guarda en IndexedDB. En la versión hospedada (HTTPS) se registra además
 * un service worker para abrir la app sin conexión (src/pwa.ts).
 */

import './styles.css';
import { App, LS_HOSTED, lsGet, takeKeyFromUrl } from './app.ts';
import { LocalDb } from './db.ts';
import { setupServiceWorker } from './pwa.ts';
import { h, hideToast } from './ui.ts';
import { renderDesktop, renderNeedsEditKey, renderQr } from './views/desktop.ts';
import { renderDay } from './views/days.ts';
import { renderEditor } from './views/editor.ts';
import { renderClosing, renderHome, renderNoKey, renderWho } from './views/home.ts';

setupServiceWorker(lsGet(LS_HOSTED) === '1');

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
  let hosted = app.hosted;
  app.subscribe(() => {
    if (app.hosted !== hosted) setupServiceWorker((hosted = app.hosted));
  });
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
    hideToast(true);
    // Una hoja abierta (por ejemplo, al usar "atrás") no se queda sobre otra pantalla.
    for (const d of document.querySelectorAll<HTMLDialogElement>('dialog.sheet')) d.close();
    const hash = location.hash || '#/';
    const desk = hash.startsWith('#/escritorio') || hash.startsWith('#/qr');
    document.body.classList.toggle('wide', desk);
    if (desk && app.access !== 'edit') {
      renderNeedsEditKey(root);
      return;
    }
    if (hash.startsWith('#/escritorio')) {
      cleanup = renderDesktop(root, app, go);
      return;
    }
    if (hash.startsWith('#/qr')) {
      cleanup = renderQr(root, app);
      return;
    }
    // El cierre de un día pasado se puede llenar desde la computadora sin elegir persona.
    const pastClosing = /^#\/cierre\/(\d{4}-\d{2}-\d{2})(\?desde=(escritorio|dia))?$/.exec(hash);
    if (pastClosing) {
      const date = pastClosing[1] as string;
      const back = pastClosing[3] === 'escritorio' ? '#/escritorio' : pastClosing[3] === 'dia' ? `#/dia/${date}` : '#/';
      cleanup = renderClosing(root, app, go, date, back);
      return;
    }
    if (!app.me && hash !== '#/quien') return go('#/quien');
    const day = /^#\/dia\/(\d{4}-\d{2}-\d{2})$/.exec(hash);
    if (day) {
      cleanup = renderDay(root, app, go, day[1] as string);
      return;
    }
    const m = /^#\/entrada\/(.+)$/.exec(hash);
    if (m) {
      const id = decodeURIComponent(m[1] as string);
      // Una entrada de otro día vuelve a ese día, no al inicio.
      const date = app.entries.get(id)?.sessionDate;
      cleanup = renderEditor(root, app, id, () => go(date && date < app.today ? `#/dia/${date}` : '#/'));
    } else if (hash === '#/quien') cleanup = renderWho(root, app, go);
    else if (hash === '#/cierre') cleanup = renderClosing(root, app, go);
    else cleanup = renderHome(root, app, go);
  };
  addEventListener('hashchange', route);
  route();
  // Si la clave cambia de permiso (por ejemplo, se abrió con la de captura) y se
  // está en la vista de computadora, se vuelve a decidir qué mostrar.
  let access = app.access;
  app.subscribe(() => {
    if (app.access === access) return;
    access = app.access;
    if (/^#\/(escritorio|qr)/.test(location.hash)) route();
  });
}

void boot();
