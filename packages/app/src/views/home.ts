import { isUnclassified, newId, type EntryElement } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { BUILD_LABEL } from '../pwa.ts';
import { dateLabel, h, icon, openSheet, setChildren, toast } from '../ui.ts';
import { entryCard, photoButton, syncBadge } from './common.ts';
import { openSketch } from './sketch.ts';
import { openAddTask, tasksBlock } from './tasks.ts';

type Filter = 'all' | 'todo' | 'mine';
let filter: Filter = 'all';

export function newElement(type: EntryElement['type']): EntryElement {
  const id = newId();
  switch (type) {
    case 'text':
      return { id, type, text: '' };
    case 'link':
      return { id, type, url: '' };
    case 'list':
      return { id, type, items: [] };
    case 'table':
      return { id, type, header: ['', '', ''], rows: [['', '', '']] };
    case 'trials':
      return { id, type, trials: [] };
    case 'match':
      return { id, type, match: '' };
    case 'photo':
      throw new Error('las fotos se agregan con la cámara');
  }
}

/** Entrada nueva de un partido de torneo (Estrategia · Registro de torneo, marca "Torneo"). */
export async function newMatch(app: App): Promise<string> {
  const e = app.newEntry([newElement('match')]);
  e.kind = 'tournamentLog';
  e.section = 'strategy';
  e.marks = ['tournament'];
  return (await app.saveEntry(e)).id;
}

export function renderHome(root: HTMLElement, app: App, go: (hash: string) => void): () => void {
  const header = h('header', { class: 'topbar home-top' });
  const list = h('div', { class: 'list', 'data-testid': 'entry-list' });
  const filters = h('div', { class: 'filters', role: 'tablist', 'aria-label': 'Filtrar entradas' });

  const create = async (type: EntryElement['type']) => {
    const e = await app.saveEntry(app.newEntry([newElement(type)]));
    go(`#/entrada/${e.id}`);
  };
  /** Foto primero: queda guardada; el aviso ofrece clasificarla ya. */
  const savePhotos = (files: File[]) =>
    void app.addPhotos(files).then(
      (saved) =>
        toast(files.length > 1 ? `${files.length} fotos guardadas` : 'Foto guardada', saved ? { label: 'Clasificar', testid: 'toast-classify', run: () => go(`#/entrada/${saved.id}`) } : undefined),
      (e: Error) => toast(`No se pudo guardar: ${e.message}`),
    );

  const openMore = () => {
    const sheet = openSheet('Agregar otra cosa', 'sheet-more');
    const item = (testid: string, ic: Parameters<typeof icon>[0], label: string, type: EntryElement['type']) =>
      h('button', { class: 'sheet-item', type: 'button', 'data-testid': testid, onclick: () => (sheet.close(), void create(type)) }, icon(ic), h('span', { text: label }));
    sheet.body.append(
      h(
        'div',
        { class: 'sheet-list' },
        photoButton('Fotos de la galería', { camera: false, cls: 'sheet-item', testid: 'gallery-input', onFiles: (files) => (sheet.close(), savePhotos(files)) }),
        h('button', { class: 'sheet-item', type: 'button', 'data-testid': 'new-sketch', onclick: () => (sheet.close(), openSketch((file) => app.addPhotos([file], undefined, { sketch: true, kind: 'brainstorm' }).then((saved) => toast('Boceto guardado', saved ? { label: 'Abrir', testid: 'toast-open-sketch', run: () => go(`#/entrada/${saved.id}`) } : undefined)))) }, icon('sketch'), h('span', { text: 'Boceto con el dedo' })),
        item('new-trials', 'trials', 'Prueba (aciertos y fallos)', 'trials'),
        item('new-link', 'link', 'Enlace', 'link'),
        item('new-list', 'list', 'Lista', 'list'),
        item('new-table', 'table', 'Tabla', 'table'),
        h('button', { class: 'sheet-item', type: 'button', 'data-testid': 'new-match', onclick: () => (sheet.close(), void newMatch(app).then((id) => go(`#/entrada/${id}`))) }, icon('trophy'), h('span', { text: 'Partido de torneo' })),
        h('button', { class: 'sheet-item', type: 'button', 'data-testid': 'new-task', onclick: () => (sheet.close(), openAddTask(app)) }, icon('todo'), h('span', { text: 'Pendiente para otra sesión' })),
      ),
    );
  };

  const actions = h(
    'section',
    { class: 'capture', 'aria-label': 'Capturar' },
    photoButton('Foto', { camera: true, cls: 'btn-photo', testid: 'photo-input', onFiles: savePhotos }),
    h(
      'div',
      { class: 'quick' },
      h('button', { class: 'btn-quick', type: 'button', 'data-testid': 'new-text', onclick: () => void create('text') }, icon('text'), h('span', { text: 'Nota' })),
      h('button', { class: 'btn-quick', type: 'button', 'data-testid': 'more-actions', 'aria-haspopup': 'dialog', onclick: openMore }, icon('more'), h('span', { text: 'Más' })),
    ),
  );

  const footer = h(
    'footer',
    { class: 'home-footer' },
    h('button', { class: 'btn secondary', type: 'button', onclick: () => go('#/cierre') }, 'Cerrar la sesión del día'),
    app.access === 'edit' ? h('a', { class: 'link-muted', href: '#/escritorio' }, 'Vista de computadora') : null,
    h('span', { class: 'muted small', 'data-testid': 'build', text: `Versión ${BUILD_LABEL}` }),
  );

  const banner = h('div', { class: 'sync-slot' });
  const tasksSlot = h('div', { class: 'tasks-slot' });
  const nudgeSlot = h('div', { class: 'nudge-slot' });
  root.replaceChildren(header, banner, nudgeSlot, actions, tasksSlot, h('h2', { class: 'section-title', text: 'Hoy' }), filters, list, footer);

  const render = () => {
    const today = app.today;
    const present = app.presentIds(today);
    const sync = syncBadge(app, true);
    const quiet = sync.classList.contains('sync-quiet');
    setChildren(header,
      h(
        'div',
        { class: 'topbar-row' },
        h('h1', { class: 'date', text: dateLabel(today) }),
        h(
          'button',
          { class: 'me', type: 'button', 'data-testid': 'me', onclick: () => go('#/quien'), 'aria-label': 'Cambiar de persona' },
          icon('user', 'icon sm'),
          h('span', { text: app.me ? app.memberName(app.me).split(' ')[0] ?? '' : '¿Quién?' }),
        ),
      ),
      h(
        'div',
        { class: 'meta-row' },
        h('span', { class: 'present muted', text: present.length > 0 ? `Presentes: ${present.map((id) => app.memberName(id).split(' ')[0]).join(', ')}` : 'Nadie ha registrado asistencia' }),
        quiet ? sync : null,
      ),
    );
    setChildren(banner, quiet ? null : sync);
    const nudge = app.closingNudge();
    setChildren(
      nudgeSlot,
      nudge
        ? h(
            'div',
            { class: 'nudge', role: 'status', 'data-testid': 'closing-nudge', 'data-date': nudge.date },
            icon('clock', 'icon sm'),
            h('span', { class: 'nudge-text', text: nudge.today ? 'Falta el cierre de hoy.' : `La sesión del ${weekday(nudge.date)} quedó sin cierre.` }),
            h('button', { class: 'nudge-go', type: 'button', 'data-testid': 'closing-nudge-go', onclick: () => go(nudge.today ? '#/cierre' : `#/cierre/${nudge.date}`) }, 'Llenar'),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ahora no', 'data-testid': 'closing-nudge-dismiss', onclick: () => app.dismissNudge(nudge.date) }, icon('x', 'icon sm')),
          )
        : null,
    );
    // Se conserva el foco en el pendiente que se acaba de marcar (teclado y lector de pantalla).
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-task]')?.dataset.task;
    setChildren(tasksSlot, tasksBlock(app));
    if (focused) tasksSlot.querySelector<HTMLElement>(`[data-task="${CSS.escape(focused)}"] .task-check`)?.focus();

    const all = app.liveEntries(today);
    const todo = all.filter(isUnclassified);
    const mine = all.filter((e) => app.me && (e.authorIds.includes(app.me) || e.capturedBy === app.me));
    const tab = (id: Filter, label: string, n: number) =>
      h('button', { class: `tab ${filter === id ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filter === id), 'data-testid': `filter-${id}`, onclick: () => ((filter = id), render()) }, label, h('span', { class: 'n', text: String(n) }));
    filters.replaceChildren(tab('all', 'Todas', all.length), tab('todo', 'Sin clasificar', todo.length), tab('mine', 'Mías', mine.length));
    filters.hidden = all.length === 0;

    const shown = filter === 'todo' ? todo : filter === 'mine' ? mine : all;
    list.replaceChildren(
      ...(shown.length > 0
        ? shown.map((e) => entryCard(app, e, (id) => go(`#/entrada/${id}`), 'phone'))
        : [h('p', { class: 'empty muted', text: filter === 'all' ? 'Todavía no hay nada hoy. Toma una foto: con un toque queda guardada.' : 'Nada por aquí.' })]),
    );
  };
  render();
  return app.subscribe(render);
}

export function renderWho(root: HTMLElement, app: App, go: (hash: string) => void): () => void {
  const render = () => {
    const members = (app.team?.members ?? []).filter((m) => m.active !== false);
    const input = h('input', { type: 'text', placeholder: 'Nombre y apellido', autocomplete: 'off', 'data-testid': 'new-member' });
    const add = async () => {
      const name = input.value.trim();
      if (!name) return;
      const id = await app.addMember(name);
      await app.chooseMember(id);
      go('#/');
    };
    const sorted = [...members].sort((x, y) => x.name.localeCompare(y.name, 'es'));
    const select = h(
      'select',
      { class: 'who-select', 'data-testid': 'who-select', 'aria-label': 'Tu nombre' },
      h('option', { value: '', text: 'Elige tu nombre…' }),
      sorted.map((m) => h('option', { value: m.id, text: m.name })),
    );
    select.value = app.me && sorted.some((m) => m.id === app.me) ? app.me : '';
    const enter = h('button', { class: 'btn primary big', type: 'submit', 'data-testid': 'who-enter' }, 'Entrar');
    enter.disabled = select.value === '';
    select.addEventListener('change', () => { enter.disabled = select.value === ''; });
    const choose = (ev: Event) => {
      ev.preventDefault();
      if (select.value) void app.chooseMember(select.value).then(() => go('#/'));
    };
    setChildren(root,
      h('header', { class: 'topbar' }, h('div', { class: 'eyebrow', text: 'Vortex Wake' }), h('h1', { text: '¿Quién eres?' }), h('p', { class: 'muted', text: 'Elige tu nombre. Así queda tu asistencia de hoy y este teléfono te recuerda.' })),
      app.team
        ? h('form', { class: 'who', onsubmit: choose }, select, enter)
        : h('p', { class: 'muted', text: app.sync.online === false ? (app.hosted ? 'No hay conexión. Revisa la señal o el wifi del teléfono.' : 'No se pudo conectar con la laptop del taller. Revisa que estés en la misma red wifi.') : 'Cargando el equipo…' }),
      app.team
        ? h(
            'form',
            { class: 'add-member', onsubmit: (ev: Event) => (ev.preventDefault(), void add()) },
            h('label', { class: 'field-label', text: '¿No estás en la lista?' }),
            h('div', { class: 'row' }, input, h('button', { class: 'btn', type: 'submit' }, 'Agregar')),
          )
        : null,
    );
  };
  render();
  return app.subscribe(() => {
    if (!root.contains(document.activeElement) || document.activeElement === document.body) render();
  });
}

/** "martes" o, si fue hace más de 6 días, "martes 3 de noviembre". */
export function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
  const days = (Date.now() - dt.getTime()) / 86_400_000;
  return dt.toLocaleDateString('es-MX', days > 6 ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long' });
}

export function renderClosing(root: HTMLElement, app: App, go: (hash: string) => void, date = app.today, back = '#/'): () => void {
  const isToday = date === app.today;
  const c = app.session(date).closing;
  const q = (label: string, value: string | undefined, testid: string) => {
    const t = h('textarea', { rows: '3', 'data-testid': testid, value: value ?? '' });
    return { t, el: h('label', { class: 'q' }, h('span', { class: 'field-label', text: label }), t) };
  };
  const a = q(isToday ? '¿Qué hicimos hoy?' : '¿Qué hicimos?', c?.whatWeDid, 'closing-did');
  const b = q('¿Qué falló?', c?.whatFailed, 'closing-failed');
  const d = q('¿Qué sigue? (un pendiente por renglón)', c?.whatsNext, 'closing-next');
  const save = async () => {
    await app.saveClosing({ whatWeDid: a.t.value.trim(), whatFailed: b.t.value.trim(), whatsNext: d.t.value.trim() }, date);
    toast('Cierre guardado');
    go(back);
  };
  root.replaceChildren(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'back', type: 'button', onclick: () => go(back) }, icon('back'), 'Volver'),
      h('h1', { text: isToday ? 'Cierre de la sesión' : `Cierre del ${dateLabel(date)}` }),
      h('p', { class: 'muted', text: 'Lo puede llenar cualquiera; se guarda la última versión. Cada renglón de "¿Qué sigue?" aparece como pendiente en la siguiente sesión.' }),
    ),
    h('div', { class: 'stack' }, a.el, b.el, d.el, h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'closing-save', onclick: () => void save() }, 'Guardar cierre')),
  );
  return () => {};
}

export function renderNoKey(root: HTMLElement): void {
  root.replaceChildren(
    h(
      'div',
      { class: 'center' },
      h('h1', { text: 'Vortex Wake' }),
      h('p', { text: 'Para capturar, escanea el código QR del taller con la cámara del celular.' }),
      h('p', { class: 'muted', text: 'El QR trae la clave del equipo. Si ya lo escaneaste y ves esto, vuelve a escanearlo.' }),
    ),
  );
}
