/**
 * Edición de una micro-entrada: elementos (fotos, texto, enlace, lista,
 * tabla, contador de pruebas) y clasificación con chips grandes. Todo se
 * guarda solo, al instante, en el teléfono.
 */

import {
  ENTRY_KINDS,
  ENTRY_KIND_LABELS,
  ENTRY_MARKS,
  MARK_LABELS,
  SECTION_LABELS,
  type Entry,
  type EntryElement,
  type EntryMark,
  type SectionId,
} from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { autosize, debounce, h, icon, setChildren, timeOf, toast } from '../ui.ts';
import { photoButton, statusPill } from './common.ts';
import { newElement } from './home.ts';

const SECTIONS: SectionId[] = ['mechanics', 'coding', 'wiring', 'strategy'];

export function renderEditor(root: HTMLElement, app: App, id: string, onDone: () => void): () => void {
  const found = app.entries.get(id);
  if (!found) {
    root.replaceChildren(h('div', { class: 'center' }, h('p', { text: 'No se encontró la entrada.' }), h('button', { class: 'btn', type: 'button', onclick: onDone }, 'Volver')));
    return () => {};
  }
  let entry: Entry = structuredClone(found);
  let saving = Promise.resolve();
  const persist = () => {
    const snapshot = structuredClone(entry);
    saving = saving.then(() => app.saveEntry(snapshot).then((s) => void (entry.updatedAt = s.updatedAt)));
  };
  const save = debounce(persist, 350);
  /** Cambios de un toque (chips, contador): se guardan ya. */
  const saveNow = () => {
    save.flush();
    persist();
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') save.flush();
  };
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', save.flush);

  const status = h('span', {});
  const elementsBox = h('div', { class: 'elements' });
  const classBox = h('div', { class: 'classify' });

  const done = () => {
    save.flush();
    void saving.then(onDone);
  };

  const head = h(
    'header',
    { class: 'topbar editor-top' },
    h(
      'div',
      { class: 'topbar-row' },
      h('button', { class: 'back', type: 'button', 'data-testid': 'editor-done', onclick: done }, icon('back'), 'Listo'),
      h('span', { class: 'muted', text: `Entrada de las ${timeOf(entry.createdAt)}` }),
    ),
    status,
  );

  const addBar = h(
    'div',
    { class: 'add-bar' },
    photoButton('Foto', { camera: true, cls: 'chip-btn', testid: 'editor-photo', onFiles: (f) => void addPhotos(f) }),
    photoButton('Galería', { camera: false, cls: 'chip-btn', onFiles: (f) => void addPhotos(f) }),
    ...(['text', 'link', 'list', 'table', 'trials'] as const).map((t) =>
      h(
        'button',
        { class: 'chip-btn', type: 'button', 'data-add': t, onclick: () => addElement(t) },
        icon(t === 'trials' ? 'trials' : t),
        h('span', { text: { text: 'Texto', link: 'Enlace', list: 'Lista', table: 'Tabla', trials: 'Prueba' }[t] }),
      ),
    ),
  );

  const del = h(
    'button',
    {
      class: 'btn danger',
      type: 'button',
      onclick: async () => {
        if (!confirm('¿Borrar esta entrada? Se borra para todo el equipo.')) return;
        save.flush();
        await saving;
        await app.deleteEntry(entry.id);
        toast('Entrada borrada');
        onDone();
      },
    },
    icon('trash'),
    'Borrar entrada',
  );

  root.replaceChildren(
    head,
    h('div', { class: 'editor' }, h('h2', { class: 'section-title', text: 'Contenido' }), elementsBox, addBar, h('h2', { class: 'section-title', text: 'Clasificación (opcional)' }), classBox, h('div', { class: 'editor-end' }, h('button', { class: 'btn primary big', type: 'button', onclick: done }, 'Listo'), del)),
  );

  async function addPhotos(files: File[]) {
    save.flush();
    await saving;
    const saved = await app.addPhotos(files, entry.id);
    if (saved) entry = structuredClone(saved);
    renderElements();
  }

  function addElement(type: Exclude<EntryElement['type'], 'photo'>) {
    entry.elements.push(newElement(type));
    saveNow();
    renderElements();
    const last = elementsBox.lastElementChild?.querySelector<HTMLElement>('textarea, input');
    last?.focus();
  }

  function removeElement(elId: string) {
    entry.elements = entry.elements.filter((x) => x.id !== elId);
    saveNow();
    renderElements();
  }

  function renderStatus() {
    const e = app.entries.get(entry.id);
    status.replaceChildren(e ? statusPill(app, e) : h('span'));
  }

  function renderElements() {
    elementsBox.replaceChildren(...entry.elements.map((el) => elementEditor(el)));
    if (entry.elements.length === 0) elementsBox.append(h('p', { class: 'muted', text: 'Agrega una foto, un texto o una prueba.' }));
  }

  function shell(el: EntryElement, title: string, body: HTMLElement[]): HTMLElement {
    return h(
      'div',
      { class: `el el-${el.type}`, 'data-el': el.type },
      h(
        'div',
        { class: 'el-head' },
        h('span', { class: 'el-title', text: title }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Quitar', onclick: () => confirmRemove(el) }, icon('x')),
      ),
      ...body,
    );
  }

  function confirmRemove(el: EntryElement) {
    const empty =
      (el.type === 'text' && !el.text.trim()) ||
      (el.type === 'link' && !el.url.trim()) ||
      (el.type === 'list' && el.items.length === 0) ||
      (el.type === 'trials' && el.trials.length === 0);
    if (empty || confirm('¿Quitar este elemento?')) removeElement(el.id);
  }

  function textArea(value: string, placeholder: string, onInput: (v: string) => void, testid?: string): HTMLTextAreaElement {
    const t = h('textarea', { rows: '2', placeholder, value, 'data-testid': testid, enterkeyhint: 'enter' });
    t.addEventListener('input', () => {
      onInput(t.value);
      save();
    });
    t.addEventListener('blur', () => save.flush());
    autosize(t);
    return t;
  }

  function elementEditor(el: EntryElement): HTMLElement {
    switch (el.type) {
      case 'photo': {
        const img = h('img', { alt: el.caption ?? 'Foto', class: 'photo' });
        void app.photoUrl(el.photoId).then((u) => (img.src = u));
        const cap = h('input', { type: 'text', placeholder: 'Pie de foto (opcional)', value: el.caption ?? '' });
        cap.addEventListener('input', () => {
          el.caption = cap.value;
          save();
        });
        cap.addEventListener('blur', () => save.flush());
        return shell(el, el.takenAt ? `Foto · ${timeOf(el.takenAt)}` : 'Foto', [img, cap]);
      }
      case 'text':
        return shell(el, 'Texto', [textArea(el.text, '¿Qué hicieron? ¿Qué vieron?', (v) => (el.text = v), 'text-input')]);
      case 'link': {
        const url = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://… (commit, foro, video)', value: el.url, autocomplete: 'off', 'data-testid': 'link-url' });
        const title = h('input', { type: 'text', placeholder: 'De qué es (opcional)', value: el.title ?? '' });
        url.addEventListener('input', () => ((el.url = url.value.trim()), save()));
        title.addEventListener('input', () => ((el.title = title.value), save()));
        url.addEventListener('blur', () => save.flush());
        title.addEventListener('blur', () => save.flush());
        return shell(el, 'Enlace', [url, title]);
      }
      case 'list':
        return shell(el, 'Lista', [
          textArea(el.items.join('\n'), 'Un elemento por renglón', (v) => (el.items = v.split('\n').map((s) => s.trimEnd()).filter((s, i, a) => s || i < a.length - 1))),
        ]);
      case 'table':
        return shell(el, 'Tabla', [tableEditor(el)]);
      case 'trials':
        return shell(el, 'Prueba en vivo', [trialsEditor(el)]);
    }
  }

  function tableEditor(el: Extract<EntryElement, { type: 'table' }>): HTMLElement {
    const box = h('div', { class: 'table-edit' });
    const render = () => {
      const cols = el.header.length;
      const cell = (value: string, onInput: (v: string) => void, header = false) => {
        const i = h('input', { type: 'text', value, class: header ? 'th' : '', placeholder: header ? 'Columna' : '' });
        i.addEventListener('input', () => (onInput(i.value), save()));
        i.addEventListener('blur', () => save.flush());
        return h('td', {}, i);
      };
      const table = h(
        'table',
        {},
        h('thead', {}, h('tr', {}, el.header.map((v, c) => cell(v, (x) => (el.header[c] = x), true)))),
        h('tbody', {}, el.rows.map((r) => h('tr', {}, Array.from({ length: cols }, (_, c) => cell(r[c] ?? '', (x) => (r[c] = x)))))),
      );
      box.replaceChildren(
        h('div', { class: 'table-scroll' }, table),
        h(
          'div',
          { class: 'row wrap' },
          h('button', { class: 'chip-btn', type: 'button', onclick: () => (el.rows.push(Array.from({ length: cols }, () => '')), saveNow(), render()) }, icon('plus'), 'Fila'),
          h('button', { class: 'chip-btn', type: 'button', onclick: () => (el.header.push(''), el.rows.forEach((r) => r.push('')), saveNow(), render()) }, icon('plus'), 'Columna'),
          el.rows.length > 1 ? h('button', { class: 'chip-btn', type: 'button', onclick: () => (el.rows.pop(), saveNow(), render()) }, 'Quitar fila') : null,
        ),
      );
    };
    render();
    return box;
  }

  function trialsEditor(el: Extract<EntryElement, { type: 'trials' }>): HTMLElement {
    const box = h('div', { class: 'trials' });
    const render = () => {
      const ok = el.trials.filter((t) => t.ok).length;
      const add = (v: boolean) => {
        el.trials.push({ ok: v, at: new Date().toISOString() });
        saveNow();
        render();
      };
      setChildren(box,
        h('div', { class: 'score', 'data-testid': 'trials-score', text: el.trials.length > 0 ? `${ok} de ${el.trials.length} aciertos` : 'Toca un botón por cada intento' }),
        h(
          'div',
          { class: 'trial-btns' },
          h('button', { class: 'trial ok', type: 'button', 'data-testid': 'trial-ok', onclick: () => add(true) }, icon('check'), 'Acierto'),
          h('button', { class: 'trial bad', type: 'button', 'data-testid': 'trial-fail', onclick: () => add(false) }, icon('x'), 'Fallo'),
        ),
        el.trials.length > 0
          ? h(
              'ol',
              { class: 'trial-list', reversed: true },
              [...el.trials].reverse().map((t) => {
                const note = h('input', { type: 'text', placeholder: 'Nota (opcional)', value: t.note ?? '' });
                note.addEventListener('input', () => {
                  if (note.value.trim()) t.note = note.value;
                  else delete t.note;
                  save();
                });
                note.addEventListener('blur', () => save.flush());
                return h('li', { class: t.ok ? 'ok' : 'bad' }, h('span', { class: 'res', text: t.ok ? 'Acierto' : 'Fallo' }), note);
              }),
            )
          : null,
        el.trials.length > 0 ? h('button', { class: 'chip-btn', type: 'button', onclick: () => (el.trials.pop(), saveNow(), render()) }, icon('undo'), 'Deshacer el último') : null,
      );
    };
    render();
    return box;
  }

  // --- clasificación ---------------------------------------------------------------

  function chips<T extends string>(label: string, options: { value: T; label: string }[], isOn: (v: T) => boolean, toggle: (v: T) => void, testid: string): HTMLElement {
    return h(
      'div',
      { class: 'chip-group', 'data-testid': testid },
      h('div', { class: 'field-label', text: label }),
      h(
        'div',
        { class: 'chips' },
        options.map((o) =>
          h(
            'button',
            { class: `chip ${isOn(o.value) ? 'on' : ''}`, type: 'button', 'aria-pressed': String(isOn(o.value)), 'data-value': o.value, onclick: () => (toggle(o.value), saveNow(), renderClass()) },
            o.label,
          ),
        ),
      ),
    );
  }

  let showAllPeople = false;
  function renderClass() {
    const team = app.team;
    const present = app.presentIds(entry.sessionDate);
    const people = (team?.members ?? []).filter((m) => m.active !== false);
    const shownPeople = showAllPeople ? people : people.filter((m) => present.includes(m.id) || entry.authorIds.includes(m.id) || m.id === app.me);
    const robots = team?.robots ?? [];
    const robot = robots.find((r) => r.id === entry.robotId);
    const subsystems = robot ? robot.subsystems : [...new Set(robots.flatMap((r) => r.subsystems))];
    if (entry.subsystem && !subsystems.includes(entry.subsystem)) subsystems.push(entry.subsystem);

    const thread = h('input', { type: 'text', placeholder: 'Ej. "intake v2", "falla del brazo"', value: entry.thread ?? '', 'data-testid': 'thread-input', autocomplete: 'off' });
    thread.addEventListener('input', () => {
      const v = thread.value.trim();
      if (v) entry.thread = v;
      else delete entry.thread;
      save();
    });
    thread.addEventListener('blur', () => save.flush());
    const suggestions = app.threads().filter((t) => t !== entry.thread).slice(0, 8);

    setChildren(classBox,
      h(
        'div',
        { class: 'chip-group', 'data-testid': 'authors' },
        h('div', { class: 'field-label', text: 'Autores' }),
        h(
          'div',
          { class: 'chips' },
          shownPeople.map((m) => {
            const on = entry.authorIds.includes(m.id);
            return h(
              'button',
              {
                class: `chip ${on ? 'on' : ''}`,
                type: 'button',
                'aria-pressed': String(on),
                'data-value': m.id,
                onclick: () => {
                  entry.authorIds = on ? entry.authorIds.filter((x) => x !== m.id) : [...entry.authorIds, m.id];
                  app.setLastAuthors(entry.authorIds);
                  saveNow();
                  renderClass();
                },
              },
              m.name,
            );
          }),
          shownPeople.length < people.length || showAllPeople
            ? h('button', { class: 'chip ghost', type: 'button', onclick: () => ((showAllPeople = !showAllPeople), renderClass()) }, showAllPeople ? 'Solo presentes' : 'Más personas…')
            : null,
        ),
      ),
      chips(
        'Sección',
        SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] })),
        (v) => entry.section === v,
        (v) => (entry.section === v ? delete entry.section : (entry.section = v)),
        'section',
      ),
      chips(
        'Tipo de entrada',
        ENTRY_KINDS.map((k) => ({ value: k, label: ENTRY_KIND_LABELS[k] })),
        (v) => entry.kind === v,
        (v) => (entry.kind === v ? delete entry.kind : (entry.kind = v)),
        'kind',
      ),
      robots.length > 0
        ? chips(
            'Robot',
            robots.map((r) => ({ value: r.id, label: r.name })),
            (v) => entry.robotId === v,
            (v) => (entry.robotId === v ? delete entry.robotId : (entry.robotId = v)),
            'robot',
          )
        : null,
      chips(
        'Subsistema',
        subsystems.map((s) => ({ value: s, label: s })),
        (v) => entry.subsystem === v,
        (v) => (entry.subsystem === v ? delete entry.subsystem : (entry.subsystem = v)),
        'subsystem',
      ),
      chips(
        'Marca',
        ENTRY_MARKS.map((m) => ({ value: m, label: MARK_LABELS[m] })),
        (v) => entry.marks.includes(v),
        (v: EntryMark) => (entry.marks = entry.marks.includes(v) ? entry.marks.filter((x) => x !== v) : [...entry.marks, v]),
        'marks',
      ),
      h(
        'div',
        { class: 'chip-group' },
        h('label', { class: 'field-label', text: 'Hilo (la historia a la que pertenece)' }),
        thread,
        suggestions.length > 0
          ? h(
              'div',
              { class: 'chips' },
              suggestions.map((t) => h('button', { class: 'chip ghost', type: 'button', onclick: () => ((entry.thread = t), saveNow(), renderClass()) }, t)),
            )
          : null,
      ),
    );
  }

  renderElements();
  renderClass();
  renderStatus();
  const unsub = app.subscribe(renderStatus);
  return () => {
    save.flush();
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    removeEventListener('pagehide', save.flush);
  };
}
