/**
 * Edición de una micro-entrada: elementos (fotos, texto, enlace, lista,
 * tabla, contador de pruebas) y clasificación. Todo se guarda solo, al
 * instante, en el teléfono.
 *
 * En el celular la clasificación son pocas filas de resumen ("¿De qué es?",
 * "¿Qué fue?", "¿Quién?", "Es un hito") que abren hojas inferiores, más
 * "Más detalles" plegado con sección, tipo exacto, marcas e hilo. En la vista
 * de computadora (`full`) se ve completa, con todos los chips.
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
import type { Classification } from '../app.ts';
import { WHAT_OPTIONS, applyWhat, exactLabel, setTarget, targetLabel, whatOf } from '../classify.ts';
import { autosize, debounce, h, icon, openSheet, setChildren, timeOf, toast } from '../ui.ts';
import { photoButton, statusPill } from './common.ts';
import { newElement } from './home.ts';

const SECTIONS: SectionId[] = ['mechanics', 'coding', 'wiring', 'strategy'];

export interface EditorOptions {
  /**
   * Vista de computadora: clasificación completa a la vista (todos los chips),
   * como antes. En el celular (por omisión) se usan filas de resumen y hojas.
   */
  full?: boolean;
}

export function renderEditor(root: HTMLElement, app: App, id: string, onDone: () => void, opts: EditorOptions = {}): () => void {
  const full = opts.full === true;
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

  const status = h('span', { class: 'editor-status' });
  const elementsBox = h('div', { class: 'elements' });
  const classBox = h('div', { class: full ? 'classify' : 'classify simple', 'data-testid': 'classify' });

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
      full
        ? h('span', { class: 'muted', text: `Entrada de las ${timeOf(entry.createdAt)}` })
        : h('span', { class: 'editor-meta' }, h('span', { class: 'muted', text: timeOf(entry.createdAt) }), status),
    ),
    full ? status : null,
  );

  const addKinds = [
    ['text', 'Texto'],
    ['list', 'Lista'],
    ['trials', 'Prueba (aciertos y fallos)'],
    ['link', 'Enlace'],
    ['table', 'Tabla'],
  ] as const;

  // Computadora: la barra de siempre. Celular: un solo botón "Agregar" que abre una hoja.
  const addBar = full
    ? h(
        'div',
        { class: 'add-bar' },
        photoButton('Foto', { camera: true, cls: 'chip-btn', testid: 'editor-photo', onFiles: (f) => void addPhotos(f) }),
        photoButton('Galería', { camera: false, cls: 'chip-btn', onFiles: (f) => void addPhotos(f) }),
        ...(['text', 'link', 'list', 'table', 'trials'] as const).map((t) =>
          h(
            'button',
            { class: 'chip-btn', type: 'button', 'data-add': t, onclick: () => addElement(t) },
            icon(t),
            h('span', { text: { text: 'Texto', link: 'Enlace', list: 'Lista', table: 'Tabla', trials: 'Prueba' }[t] }),
          ),
        ),
      )
    : h('button', { class: 'add-btn', type: 'button', 'data-testid': 'editor-add', 'aria-haspopup': 'dialog', onclick: () => openAdd() }, icon('plus'), h('span', { text: 'Agregar foto, texto…' }));

  function openAdd() {
    const sheet = openSheet('Agregar', 'sheet-add');
    sheet.body.append(
      h(
        'div',
        { class: 'sheet-list' },
        photoButton('Tomar foto', { camera: true, cls: 'sheet-item', testid: 'editor-photo', onFiles: (f) => (sheet.close(), void addPhotos(f)) }),
        photoButton('Fotos de la galería', { camera: false, cls: 'sheet-item', onFiles: (f) => (sheet.close(), void addPhotos(f)) }),
        ...addKinds.map(([t, label]) =>
          h('button', { class: 'sheet-item', type: 'button', 'data-add': t, onclick: () => (sheet.close(), addElement(t)) }, icon(t), h('span', { text: label })),
        ),
      ),
    );
  }

  const del = h(
    'button',
    {
      class: full ? 'btn danger' : 'btn-text danger',
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
    h(
      'div',
      { class: full ? 'editor' : 'editor simple' },
      full ? h('h2', { class: 'section-title', text: 'Contenido' }) : null,
      elementsBox,
      addBar,
      h('h2', { class: 'section-title', text: full ? 'Clasificación (opcional)' : 'Clasificar (opcional)' }),
      classBox,
      h('div', { class: 'editor-end' }, h('button', { class: 'btn primary big', type: 'button', onclick: done }, 'Listo'), del),
    ),
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
    if (entry.elements.length === 0) elementsBox.append(h('p', { class: 'muted', text: 'Vacía. Agrega una foto, un texto o una prueba.' }));
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

  /** Cambio de clasificación: se guarda ya, se recuerda en el teléfono y se vuelve a pintar. */
  const changed = () => {
    saveNow();
    if (!full) app.rememberClassification(entry);
    renderClass();
  };

  function chips<T extends string>(label: string, options: { value: T; label: string }[], isOn: (v: T) => boolean, toggle: (v: T) => void, testid: string): HTMLElement {
    return h(
      'div',
      { class: 'chip-group', 'data-testid': testid, role: 'group', 'aria-label': label },
      h('div', { class: 'field-label', text: label }),
      h(
        'div',
        { class: 'chips' },
        options.map((o) =>
          h(
            'button',
            { class: `chip ${isOn(o.value) ? 'on' : ''}`, type: 'button', 'aria-pressed': String(isOn(o.value)), 'data-value': o.value, onclick: () => (toggle(o.value), changed()) },
            o.label,
          ),
        ),
      ),
    );
  }

  const sectionChips = () =>
    chips(
      'Sección',
      SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] })),
      (v) => entry.section === v,
      (v) => (entry.section === v ? delete entry.section : (entry.section = v)),
      'section',
    );
  const kindChips = (label: string) =>
    chips(
      label,
      ENTRY_KINDS.map((k) => ({ value: k, label: ENTRY_KIND_LABELS[k] })),
      (v) => entry.kind === v,
      (v) => (entry.kind === v ? delete entry.kind : (entry.kind = v)),
      'kind',
    );
  const markChips = (label: string) =>
    chips(
      label,
      ENTRY_MARKS.map((m) => ({ value: m, label: MARK_LABELS[m] })),
      (v) => entry.marks.includes(v),
      (v: EntryMark) => (entry.marks = entry.marks.includes(v) ? entry.marks.filter((x) => x !== v) : [...entry.marks, v]),
      'marks',
    );

  function threadField(label: string): HTMLElement {
    const inputId = `thread-${entry.id}`;
    const thread = h('input', { type: 'text', id: inputId, placeholder: 'Ej. "intake v2", "falla del brazo"', value: entry.thread ?? '', 'data-testid': 'thread-input', autocomplete: 'off' });
    thread.addEventListener('input', () => {
      const v = thread.value.trim();
      if (v) entry.thread = v;
      else delete entry.thread;
      save();
    });
    thread.addEventListener('blur', () => save.flush());
    const suggestions = app.threads().filter((t) => t !== entry.thread).slice(0, full ? 8 : 4);
    return h(
      'div',
      { class: 'chip-group' },
      h('label', { class: 'field-label', for: inputId, text: label }),
      thread,
      suggestions.length > 0
        ? h(
            'div',
            { class: 'chips' },
            suggestions.map((t) => h('button', { class: 'chip ghost', type: 'button', onclick: () => ((entry.thread = t), changed()) }, t)),
          )
        : null,
    );
  }

  let showAllPeople = false;
  const people = () => (app.team?.members ?? []).filter((m) => m.active !== false);
  const shownPeople = () => {
    const present = app.presentIds(entry.sessionDate);
    return showAllPeople ? people() : people().filter((m) => present.includes(m.id) || entry.authorIds.includes(m.id) || m.id === app.me);
  };
  const toggleAuthor = (id: string) => {
    entry.authorIds = entry.authorIds.includes(id) ? entry.authorIds.filter((x) => x !== id) : [...entry.authorIds, id];
    app.setLastAuthors(entry.authorIds);
    saveNow();
  };

  function renderClass() {
    if (full) renderFullClass();
    else renderSimpleClass();
  }

  /** Computadora: todo a la vista, como antes. */
  function renderFullClass() {
    const robots = app.team?.robots ?? [];
    const robot = robots.find((r) => r.id === entry.robotId);
    const subsystems = robot ? [...robot.subsystems] : [...new Set(robots.flatMap((r) => r.subsystems))];
    if (entry.subsystem && !subsystems.includes(entry.subsystem)) subsystems.push(entry.subsystem);
    const shown = shownPeople();
    setChildren(
      classBox,
      h(
        'div',
        { class: 'chip-group', 'data-testid': 'authors' },
        h('div', { class: 'field-label', text: 'Autores' }),
        h(
          'div',
          { class: 'chips' },
          shown.map((m) => {
            const on = entry.authorIds.includes(m.id);
            return h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-value': m.id, onclick: () => (toggleAuthor(m.id), renderClass()) }, m.name);
          }),
          shown.length < people().length || showAllPeople
            ? h('button', { class: 'chip ghost', type: 'button', onclick: () => ((showAllPeople = !showAllPeople), renderClass()) }, showAllPeople ? 'Solo presentes' : 'Más personas…')
            : null,
        ),
      ),
      sectionChips(),
      kindChips('Tipo de entrada'),
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
      markChips('Marca'),
      threadField('Hilo (la historia a la que pertenece)'),
    );
  }

  // --- celular: filas de resumen y hojas ------------------------------------------

  let detailsOpen = false;

  /** Una fila: etiqueta, valor actual (o "Elegir") y una línea fina opcional. */
  function summaryRow(label: string, value: string, sub: string, onClick: () => void, testid: string, trailing?: string): HTMLElement {
    return h(
      'button',
      { class: 'sum-row', type: 'button', 'data-testid': testid, 'aria-haspopup': 'dialog', onclick: onClick },
      h(
        'span',
        { class: 'sum-text' },
        h('span', { class: 'sum-label', text: label }),
        h('span', { class: value ? 'sum-value' : 'sum-value unset', text: value || 'Elegir' }),
        sub ? h('span', { class: 'sum-sub', text: sub }) : null,
      ),
      trailing ? h('span', { class: 'sum-trailing', text: trailing }) : icon('chevron', 'icon chev'),
    );
  }

  function renderSimpleClass() {
    const robots = app.team?.robots ?? [];
    const last = app.recent().last;
    const lastValid = last && (!last.robotId || robots.some((r) => r.id === last.robotId)) ? last : undefined;
    const blank = !entry.robotId && !entry.subsystem && !entry.kind;
    const lastText = lastValid ? [targetLabel(robots, lastValid.robotId, lastValid.subsystem), whatOf(lastValid.kind)?.label].filter(Boolean).join(' · ') : '';

    const target = targetLabel(robots, entry.robotId, entry.subsystem);
    const what = whatOf(entry.kind);
    const authors = entry.authorIds.map((id) => app.memberName(id).split(' ')[0]).join(', ');
    const milestone = entry.marks.includes('milestone');
    const extraMarks = entry.marks.filter((m) => m !== 'milestone' && m !== 'normal').map((m) => MARK_LABELS[m]);
    const detailsSummary = [entry.section ? SECTION_LABELS[entry.section] : '', entry.kind ? ENTRY_KIND_LABELS[entry.kind] : '', ...extraMarks, entry.thread ? `Hilo: ${entry.thread}` : '']
      .filter(Boolean)
      .join(' · ');

    const details = h(
      'details',
      { class: 'more', 'data-testid': 'more-details', open: detailsOpen },
      h('summary', {}, h('span', { class: 'sum-text' }, h('span', { class: 'more-title', text: 'Más detalles' }), h('span', { class: 'sum-sub', text: detailsSummary || 'Sección, tipo exacto, marcas e hilo' }))),
      h('div', { class: 'more-body' }, sectionChips(), kindChips('Tipo exacto'), markChips('Marcas'), threadField('Hilo (la historia a la que pertenece)')),
    );
    details.addEventListener('toggle', () => (detailsOpen = details.open));

    setChildren(
      classBox,
      blank && lastValid && lastText
        ? h(
            'button',
            { class: 'same-btn', type: 'button', 'data-testid': 'same-as-before', onclick: () => applyLast(lastValid) },
            icon('repeat'),
            h('span', { class: 'sum-text' }, h('span', { class: 'same-title', text: 'Igual que la anterior' }), h('span', { class: 'sum-sub', text: lastText })),
          )
        : null,
      h(
        'div',
        { class: 'sum-list' },
        robots.length > 0 ? summaryRow('¿De qué es?', target, '', openTarget, 'class-target') : null,
        summaryRow('¿Qué fue?', what ? what.label : '', what || entry.section ? exactLabel(entry) : '', openWhat, 'class-what'),
        summaryRow('¿Quién?', authors, '', openAuthors, 'class-authors', '+ alguien más'),
        h(
          'button',
          {
            class: 'sum-row switch-row',
            type: 'button',
            role: 'switch',
            'aria-checked': String(milestone),
            'data-testid': 'milestone',
            onclick: () => ((entry.marks = milestone ? entry.marks.filter((m) => m !== 'milestone') : [...entry.marks, 'milestone']), changed()),
          },
          h('span', { class: 'sum-text' }, h('span', { class: 'sum-value', text: 'Es un hito' }), h('span', { class: 'sum-sub', text: 'Un logro o algo que por fin funcionó' })),
          h('span', { class: 'switch', 'aria-hidden': 'true' }),
        ),
      ),
      details,
    );
  }

  function applyLast(c: Classification) {
    setTarget(entry, app.team?.robots ?? [], c.robotId, c.subsystem);
    if (c.kind) entry.kind = c.kind;
    if (c.section) entry.section = c.section;
    changed();
  }

  function openTarget() {
    const robots = app.team?.robots ?? [];
    const sheet = openSheet('¿De qué es?', 'sheet-target');
    const pick = (robotId?: string, subsystem?: string) => {
      setTarget(entry, robots, robotId, subsystem);
      sheet.close();
      changed();
      // Siguiente paso natural: si falta, se pregunta qué fue.
      if ((robotId || subsystem) && !entry.kind) openWhat();
    };
    const opt = (robotId: string | undefined, subsystem: string | undefined, label: string) => {
      const on = (entry.robotId ?? '') === (robotId ?? '') && (entry.subsystem ?? '') === (subsystem ?? '');
      return h(
        'button',
        { class: `opt ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-value': `${robotId ?? ''}|${subsystem ?? ''}`, onclick: () => pick(robotId, subsystem) },
        on ? icon('check', 'icon sm') : null,
        label,
      );
    };
    const recentTargets = app
      .recent()
      .targets.filter((t) => (!t.robotId || robots.some((r) => r.id === t.robotId)) && (t.robotId || t.subsystem))
      .slice(0, 4);
    const known = robots.some((r) => r.id === entry.robotId && (!entry.subsystem || r.subsystems.includes(entry.subsystem)));
    sheet.body.append(
      ...[
        recentTargets.length > 0
          ? h('div', { class: 'opt-group', 'data-group': 'recent' }, h('h3', { text: 'Recientes' }), h('div', { class: 'opts' }, recentTargets.map((t) => opt(t.robotId, t.subsystem, targetLabel(robots, t.robotId, t.subsystem)))))
          : null,
        // Si la entrada trae algo que ya no está en el equipo, se muestra igual.
        !known && (entry.robotId || entry.subsystem)
          ? h('div', { class: 'opt-group' }, h('h3', { text: 'Actual' }), h('div', { class: 'opts' }, opt(entry.robotId, entry.subsystem, targetLabel(robots, entry.robotId, entry.subsystem))))
          : null,
        ...robots.map((r) =>
          h('div', { class: 'opt-group', 'data-robot': r.id }, h('h3', { text: r.name }), h('div', { class: 'opts' }, ...r.subsystems.map((sub) => opt(r.id, sub, sub)), opt(r.id, undefined, 'Todo el robot'))),
        ),
        entry.robotId || entry.subsystem ? h('button', { class: 'btn-text', type: 'button', 'data-value': 'none', onclick: () => pick() }, 'Quitar') : null,
      ].filter((x): x is NonNullable<typeof x> => x !== null),
    );
  }

  function openWhat() {
    const sheet = openSheet('¿Qué fue?', 'sheet-what');
    const current = whatOf(entry.kind);
    sheet.body.append(
      ...[
        h(
          'div',
          { class: 'sheet-list' },
          WHAT_OPTIONS.map((o) =>
            h(
              'button',
              {
                class: `sheet-item ${current?.id === o.id ? 'on' : ''}`,
                type: 'button',
                'aria-pressed': String(current?.id === o.id),
                'data-value': o.id,
                onclick: () => {
                  applyWhat(entry, o);
                  sheet.close();
                  changed();
                },
              },
              h('span', { text: o.label }),
              current?.id === o.id ? icon('check') : null,
            ),
          ),
        ),
        entry.kind || entry.section
          ? h('button', { class: 'btn-text', type: 'button', 'data-value': 'none', onclick: () => (delete entry.kind, delete entry.section, sheet.close(), changed()) }, 'Quitar')
          : null,
      ].filter((x): x is NonNullable<typeof x> => x !== null),
    );
  }

  function openAuthors() {
    const sheet = openSheet('¿Quién lo hizo?', 'sheet-authors', () => renderClass());
    const fill = () => {
      const shown = shownPeople();
      setChildren(
        sheet.body,
        h(
          'div',
          { class: 'sheet-list', 'data-testid': 'authors' },
          shown.map((m) => {
            const on = entry.authorIds.includes(m.id);
            return h(
              'button',
              { class: `sheet-item ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-value': m.id, onclick: () => (toggleAuthor(m.id), fill()) },
              h('span', { text: m.name }),
              on ? icon('check') : null,
            );
          }),
        ),
        shown.length < people().length || showAllPeople
          ? h('button', { class: 'btn-text', type: 'button', onclick: () => ((showAllPeople = !showAllPeople), fill()) }, showAllPeople ? 'Solo quienes vinieron hoy' : 'Ver a todo el equipo')
          : null,
        h('button', { class: 'btn primary big', type: 'button', onclick: () => sheet.close() }, 'Listo'),
      );
    };
    fill();
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
