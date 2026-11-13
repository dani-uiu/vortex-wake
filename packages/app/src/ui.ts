/** Utilidades mínimas de interfaz: crear elementos, íconos SVG y avisos. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'multiple') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  gallery: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
  text: svg('<path d="M5 6h14M5 12h14M5 18h9"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M10 4v16"/>'),
  trials: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  check: svg('<path d="m5 12 5 5L20 7"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  phone: svg('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
  cloud: svg('<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/><path d="m9 13 2 2 4-4"/>'),
  alert: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  qr: svg('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>'),
  more: svg('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  repeat: svg('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  pen: svg('<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>'),
  tag: svg('<circle cx="12" cy="12" r="8"/><path d="M9.5 15.5 12 8.5l2.5 7M10.3 13.3h3.4"/>'),
  arrow: svg('<path d="M5 19 19 5"/><path d="M10 5h9v9"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  brain: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  gamepad: svg('<path d="M7 7h10a5 5 0 0 1 5 5v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a5 5 0 0 1 5-5z"/><path d="M7 10v4M5 12h4"/><circle cx="16" cy="11" r=".8"/><circle cx="18" cy="13" r=".8"/>'),
  eraser: svg('<path d="M8 20h12"/><path d="M4.5 14.5 14 5l5 5-9.5 9.5H9z"/><path d="m9 10 5 5"/>'),
  route: svg('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16.5c3-1 2-6 5-7.5s3.5-.5 3.5-.5"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>'),
  todo: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>'),
  sketch: svg('<path d="M3 17c3-6 5 3 8-3s4-6 7-3"/><path d="M4 21h16"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
};

export function icon(name: keyof typeof ICONS, cls = 'icon'): HTMLSpanElement {
  return h('span', { class: cls, html: ICONS[name] });
}

let toastTimer: number | undefined;
/**
 * Aviso breve abajo. Sin acción no recibe toques (no tapa botones); con
 * acción ("Clasificar") se queda unos segundos más y sí se puede tocar.
 */
export function toast(message: string, action?: { label: string; run: () => void; testid?: string }): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  const hide = () => el?.classList.remove('show', 'has-action');
  setChildren(
    el,
    h('span', { text: message }),
    action ? h('button', { type: 'button', class: 'toast-action', 'data-testid': action.testid, onclick: () => (hide(), action.run()) }, action.label) : null,
  );
  el.classList.toggle('has-action', !!action);
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hide, action ? 6000 : 2600);
}

/** Quita el aviso; con `onlyAction`, solo si es uno con botón (al cambiar de pantalla ya no aplica). */
export function hideToast(onlyAction = false): void {
  const el = document.getElementById('toast');
  if (el && (!onlyAction || el.classList.contains('has-action'))) el.classList.remove('show', 'has-action');
}

export interface Sheet {
  body: HTMLElement;
  close(): void;
}

/** Pantalla ancha (computadora): las hojas se abren como menús anclados al botón que las abrió. */
export const WIDE_QUERY = '(min-width: 900px)';

/**
 * Hoja inferior (un `<dialog>` modal): se cierra con la X, tocando fuera o
 * con Esc. `body` se puede volver a llenar mientras está abierta.
 *
 * Con `anchor` y pantalla ancha se muestra como menú junto a ese botón (abajo
 * o, si no cabe, arriba), en vez de una hoja de celular estirada.
 */
export function openSheet(title: string, testid: string, onClose?: () => void, anchor?: HTMLElement, opts: { full?: boolean } = {}): Sheet {
  hideToast();
  const body = h('div', { class: 'sheet-body' });
  const dlg = h('dialog', { class: opts.full ? 'sheet full' : 'sheet', 'data-testid': testid, 'aria-label': title });
  const pop = !opts.full && !!anchor && matchMedia(WIDE_QUERY).matches;
  let ro: ResizeObserver | undefined;
  if (pop && anchor) {
    dlg.classList.add('popover');
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 340), innerWidth - 32);
      const left = Math.min(Math.max(16, r.left), innerWidth - w - 16);
      const hgt = dlg.offsetHeight;
      let top = r.bottom + 6;
      if (top + hgt > innerHeight - 16) top = Math.max(16, Math.min(r.top - 6 - hgt, innerHeight - 16 - hgt));
      dlg.style.width = `${w}px`;
      dlg.style.left = `${left}px`;
      dlg.style.top = `${top}px`;
    };
    ro = new ResizeObserver(place);
    ro.observe(dlg);
    requestAnimationFrame(place);
  }
  dlg.addEventListener('close', () => ro?.disconnect());
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  // Tocar el fondo (fuera de la hoja) la cierra.
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) close();
  });
  dlg.append(
    h(
      'div',
      { class: 'sheet-inner' },
      h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: close }, icon('x'))),
      body,
    ),
  );
  document.body.append(dlg);
  dlg.showModal();
  return { body, close };
}

export function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Ejecuta `fn` como mucho cada `ms`, y al final con el último valor. */
export function debounce(fn: () => void, ms: number): { (): void; flush(): void } {
  let t: number | undefined;
  const run = () => {
    if (t !== undefined) {
      clearTimeout(t);
      t = undefined;
      fn();
    }
  };
  const d = () => {
    if (t !== undefined) clearTimeout(t);
    t = window.setTimeout(() => {
      t = undefined;
      fn();
    }, ms);
  };
  d.flush = run;
  return d;
}

export function autosize(t: HTMLTextAreaElement): void {
  const fit = () => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  t.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

/** `replaceChildren` que ignora null/false (para hijos opcionales). */
export function setChildren(el: Element, ...children: (Node | string | null | undefined | false)[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}
