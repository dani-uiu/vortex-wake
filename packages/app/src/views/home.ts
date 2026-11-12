import { isUnclassified, newId, type EntryElement } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { BUILD_LABEL } from '../pwa.ts';
import { dateLabel, h, icon, setChildren, toast } from '../ui.ts';
import { entryCard, photoButton, syncBadge } from './common.ts';

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
    case 'photo':
      throw new Error('las fotos se agregan con la cámara');
  }
}

export function renderHome(root: HTMLElement, app: App, go: (hash: string) => void): () => void {
  const header = h('header', { class: 'topbar' });
  const list = h('div', { class: 'list', 'data-testid': 'entry-list' });
  const filters = h('div', { class: 'filters', role: 'tablist' });

  const create = async (type: EntryElement['type']) => {
    const e = await app.saveEntry(app.newEntry([newElement(type)]));
    go(`#/entrada/${e.id}`);
  };

  const actions = h(
    'section',
    { class: 'capture' },
    photoButton('Foto', {
      camera: true,
      cls: 'btn-photo',
      testid: 'photo-input',
      onFiles: (files) =>
        void app.addPhotos(files).then(
          () => toast(files.length > 1 ? `${files.length} fotos guardadas` : 'Foto guardada'),
          (e: Error) => toast(`No se pudo guardar: ${e.message}`),
        ),
    }),
    h(
      'div',
      { class: 'quick' },
      photoButton('Galería', {
        camera: false,
        cls: 'btn-quick',
        testid: 'gallery-input',
        onFiles: (files) => void app.addPhotos(files).then(() => toast(`${files.length} foto(s) guardada(s)`)),
      }),
      h('button', { class: 'btn-quick', type: 'button', 'data-testid': 'new-text', onclick: () => void create('text') }, icon('text'), h('span', { text: 'Nota' })),
      h('button', { class: 'btn-quick', type: 'button', 'data-testid': 'new-trials', onclick: () => void create('trials') }, icon('trials'), h('span', { text: 'Prueba' })),
      h('button', { class: 'btn-quick', type: 'button', onclick: () => void create('link') }, icon('link'), h('span', { text: 'Enlace' })),
      h('button', { class: 'btn-quick', type: 'button', onclick: () => void create('list') }, icon('list'), h('span', { text: 'Lista' })),
      h('button', { class: 'btn-quick', type: 'button', onclick: () => void create('table') }, icon('table'), h('span', { text: 'Tabla' })),
    ),
  );

  const footer = h(
    'footer',
    { class: 'home-footer' },
    h('button', { class: 'btn secondary', type: 'button', onclick: () => go('#/cierre') }, 'Cerrar la sesión del día'),
    app.access === 'edit' ? h('a', { class: 'link-muted', href: '#/escritorio' }, 'Vista de computadora') : null,
    h('span', { class: 'muted small', 'data-testid': 'build', text: `Versión ${BUILD_LABEL}` }),
  );

  root.replaceChildren(header, actions, filters, list, footer);

  const render = () => {
    const today = app.today;
    const present = app.presentIds(today);
    header.replaceChildren(
      h(
        'div',
        { class: 'topbar-row' },
        h('div', {}, h('div', { class: 'eyebrow', text: 'Sesión del día' }), h('h1', { class: 'date', text: dateLabel(today) })),
        h(
          'button',
          { class: 'me', type: 'button', 'data-testid': 'me', onclick: () => go('#/quien'), 'aria-label': 'Cambiar de persona' },
          icon('user', 'icon sm'),
          h('span', { text: app.me ? app.memberName(app.me).split(' ')[0] ?? '' : '¿Quién?' }),
        ),
      ),
      h('div', { class: 'present muted', text: present.length > 0 ? `Presentes: ${present.map((id) => app.memberName(id)).join(', ')}` : 'Nadie ha registrado asistencia' }),
      syncBadge(app),
    );

    const all = app.liveEntries(today);
    const todo = all.filter(isUnclassified);
    const mine = all.filter((e) => app.me && (e.authorIds.includes(app.me) || e.capturedBy === app.me));
    const tab = (id: Filter, label: string, n: number) =>
      h('button', { class: `tab ${filter === id ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filter === id), 'data-testid': `filter-${id}`, onclick: () => ((filter = id), render()) }, `${label} (${n})`);
    filters.replaceChildren(tab('all', 'Todas', all.length), tab('todo', 'Sin clasificar', todo.length), tab('mine', 'Mías', mine.length));

    const shown = filter === 'todo' ? todo : filter === 'mine' ? mine : all;
    list.replaceChildren(
      ...(shown.length > 0
        ? shown.map((e) => entryCard(app, e, (id) => go(`#/entrada/${id}`)))
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
    setChildren(root,
      h('header', { class: 'topbar' }, h('div', { class: 'eyebrow', text: 'Vortex Wake' }), h('h1', { text: '¿Quién eres?' }), h('p', { class: 'muted', text: 'Toca tu nombre. Así queda tu asistencia de hoy y este teléfono te recuerda.' })),
      app.team
        ? h(
            'div',
            { class: 'who' },
            members.map((m) =>
              h(
                'button',
                { class: `who-btn ${app.me === m.id ? 'on' : ''}`, type: 'button', 'data-member': m.id, onclick: () => void app.chooseMember(m.id).then(() => go('#/')) },
                m.name,
              ),
            ),
          )
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

export function renderClosing(root: HTMLElement, app: App, go: (hash: string) => void): () => void {
  const c = app.session().closing;
  const q = (label: string, value: string | undefined, testid: string) => {
    const t = h('textarea', { rows: '3', 'data-testid': testid, value: value ?? '' });
    return { t, el: h('label', { class: 'q' }, h('span', { class: 'field-label', text: label }), t) };
  };
  const a = q('¿Qué hicimos hoy?', c?.whatWeDid, 'closing-did');
  const b = q('¿Qué falló?', c?.whatFailed, 'closing-failed');
  const d = q('¿Qué sigue?', c?.whatsNext, 'closing-next');
  const save = async () => {
    await app.saveClosing({ whatWeDid: a.t.value.trim(), whatFailed: b.t.value.trim(), whatsNext: d.t.value.trim() });
    toast('Cierre guardado');
    go('#/');
  };
  root.replaceChildren(
    h('header', { class: 'topbar' }, h('button', { class: 'back', type: 'button', onclick: () => go('#/') }, icon('back'), 'Volver'), h('h1', { text: 'Cierre de la sesión' }), h('p', { class: 'muted', text: 'Opcional. Lo puede llenar cualquiera; se guarda la última versión.' })),
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
