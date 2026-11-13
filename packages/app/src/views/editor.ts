/**
 * Edición de una micro-entrada: elementos (fotos, texto, enlace, lista,
 * tabla, contador de pruebas) y clasificación. Todo se guarda solo, al
 * instante, en el teléfono.
 *
 * La clasificación son pocas filas de resumen ("¿De qué es?", "¿Qué fue?",
 * "¿Quién?", "Es un hito") que abren hojas, más "Más detalles" con sección,
 * tipo exacto, marcas e hilo.
 *
 * - Celular (por omisión): hojas inferiores, "Más detalles" plegado y
 *   "Igual que la anterior".
 * - Computadora (`desk`): las hojas son menús anclados, "Más detalles" va
 *   abierto y compacto, "Cambio" se ve junto a "Es un hito", y el encabezado
 *   trae anterior/siguiente para revisar entradas seguidas.
 */

import {
  ENTRY_KINDS,
  ENTRY_KIND_LABELS,
  ENTRY_MARKS,
  MARK_LABELS,
  PAGE_TYPES,
  SECTION_LABELS,
  type Entry,
  type EntryElement,
  type EntryMark,
  type MatchElement,
  type SectionId,
} from '@vortex-wake/shared';
import type { App } from '../app.ts';
import type { Classification } from '../app.ts';
import { WHAT_OPTIONS, applyWhat, exactLabel, setTarget, targetLabel, whatOf } from '../classify.ts';
import { autosize, debounce, h, icon, openSheet, setChildren, timeOf, toast } from '../ui.ts';
import { openAnnotator } from './annotate.ts';
import { openSketch } from './sketch.ts';
import { photoButton, statusPill } from './common.ts';
import { newElement, newMatch } from './home.ts';
import { dictationFor } from '../dictation.ts';
import { annotationsToMarks, markedImage } from './marks.ts';

const SECTIONS: SectionId[] = ['mechanics', 'coding', 'wiring', 'strategy'];

export interface EditorOptions {
  /** Vista de computadora (ver arriba). */
  desk?: boolean;
  /** Anterior/siguiente en la lista que se está revisando (solo computadora). */
  nav?: { prev?: () => void; next?: () => void; label?: string };
}

export function renderEditor(root: HTMLElement, app: App, id: string, onDone: () => void, opts: EditorOptions = {}): () => void {
  const desk = opts.desk === true;
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
  const classBox = h('div', { class: desk ? 'classify simple is-desk' : 'classify simple', 'data-testid': 'classify' });

  const done = () => {
    save.flush();
    void saving.then(onDone);
  };
  /** Cambiar de entrada sin cerrar el panel: primero se termina de guardar. */
  const navTo = (fn: () => void) => () => {
    save.flush();
    void saving.then(fn);
  };

  const nav = opts.nav;
  const head = h(
    'header',
    { class: 'topbar editor-top' },
    h(
      'div',
      { class: 'topbar-row' },
      h('button', { class: 'back', type: 'button', 'data-testid': 'editor-done', onclick: done, title: desk ? 'Cerrar (Esc)' : undefined }, icon('back'), 'Listo'),
      h('span', { class: 'editor-meta' }, h('span', { class: 'muted', text: desk ? dayTime(entry) : timeOf(entry.createdAt) }), status),
      nav
        ? h(
            'span',
            { class: 'editor-nav' },
            nav.label ? h('span', { class: 'muted small', 'data-testid': 'editor-position', text: nav.label }) : null,
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Entrada anterior', title: 'Anterior (K)', 'data-testid': 'editor-prev', disabled: !nav.prev, onclick: nav.prev ? navTo(nav.prev) : undefined }, icon('up')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Entrada siguiente', title: 'Siguiente (J)', 'data-testid': 'editor-next', disabled: !nav.next, onclick: nav.next ? navTo(nav.next) : undefined }, icon('down')),
          )
        : null,
    ),
  );

  const addKinds = [
    ['text', 'Texto'],
    ['list', 'Lista'],
    ['trials', 'Prueba (aciertos y fallos)'],
    ['link', 'Enlace'],
    ['table', 'Tabla'],
  ] as const;

  const addBar = h('button', { class: 'add-btn', type: 'button', 'data-testid': 'editor-add', 'aria-haspopup': 'dialog', onclick: () => openAdd() }, icon('plus'), h('span', { text: 'Agregar foto, texto…' }));

  function openAdd() {
    const sheet = openSheet('Agregar', 'sheet-add', undefined, addBar);
    sheet.body.append(
      h(
        'div',
        { class: 'sheet-list' },
        photoButton(desk ? 'Foto (cámara)' : 'Tomar foto', { camera: true, cls: 'sheet-item', testid: 'editor-photo', onFiles: (f) => (sheet.close(), void addPhotos(f)) }),
        photoButton(desk ? 'Fotos de la computadora' : 'Fotos de la galería', { camera: false, cls: 'sheet-item', onFiles: (f) => (sheet.close(), void addPhotos(f)) }),
        h('button', { class: 'sheet-item', type: 'button', 'data-add': 'sketch', onclick: () => (sheet.close(), openSketch((file) => addPhotos([file], true))) }, icon('sketch'), h('span', { text: 'Boceto con el dedo' })),
        ...addKinds.map(([t, label]) =>
          h('button', { class: 'sheet-item', type: 'button', 'data-add': t, onclick: () => (sheet.close(), addElement(t)) }, icon(t), h('span', { text: label })),
        ),
      ),
    );
  }

  const del = h(
    'button',
    {
      class: 'btn-text danger',
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
      { class: desk ? 'editor simple is-desk' : 'editor simple' },
      elementsBox,
      addBar,
      h('h2', { class: 'section-title', text: desk ? 'Clasificación' : 'Clasificar (opcional)' }),
      classBox,
      h(
        'div',
        { class: 'editor-end' },
        desk && nav?.next
          ? h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'editor-save-next', onclick: navTo(nav.next) }, 'Listo, siguiente', icon('down'))
          : h('button', { class: 'btn primary big', type: 'button', onclick: done }, 'Listo'),
        // Modo torneo: el siguiente partido sin pasar por el inicio.
        !desk && entry.elements.some((x) => x.type === 'match')
          ? h('button', { class: 'btn secondary', type: 'button', 'data-testid': 'next-match', onclick: () => {
              save.flush();
              void saving.then(() => newMatch(app)).then((nid) => (location.hash = `#/entrada/${nid}`));
            } }, icon('trophy'), 'Otro partido')
          : null,
        del,
      ),
    ),
  );

  async function addPhotos(files: File[], sketch = false) {
    save.flush();
    await saving;
    const saved = await app.addPhotos(files, entry.id, { sketch });
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
      (el.type === 'trials' && el.trials.length === 0) ||
      (el.type === 'match' && !el.match.trim() && !el.failed && !el.adjusted);
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
        const pic = markedImage(app.photoUrl(el.photoId), annotationsToMarks(el.annotations), { cls: 'photo', fit: 'contain', alt: el.caption ?? 'Foto' });
        const cap = h('input', { type: 'text', placeholder: 'Pie de foto (opcional)', value: el.caption ?? '' });
        cap.addEventListener('input', () => {
          el.caption = cap.value;
          save();
        });
        cap.addEventListener('blur', () => save.flush());
        const n = el.annotations?.filter((a) => a.type === 'label').length ?? 0;
        const annotate = h(
          'button',
          { class: 'chip-btn', type: 'button', 'data-testid': 'annotate-photo', onclick: () => void openPhotoAnnotator(el) },
          icon('pen'),
          el.annotations && el.annotations.length > 0 ? `Editar etiquetas${n > 0 ? ` (${n})` : ''}` : 'Etiquetas y flechas',
        );
        const title = el.sketch ? 'Boceto' : el.takenAt ? `Foto · ${timeOf(el.takenAt)}` : 'Foto';
        return shell(el, title, [pic, h('div', { class: 'row wrap' }, annotate), cap]);
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
      case 'match':
        return shell(el, 'Partido de torneo', [matchEditor(el)]);
    }
  }

  /** Partido: todo en una pantalla, para llenarlo entre partidos. */
  function matchEditor(el: MatchElement): HTMLElement {
    const box = h('div', { class: 'match' });
    const text = (key: 'match' | 'partner' | 'opponents' | 'ourScore' | 'theirScore', placeholder: string, label: string, numeric = false) => {
      const i = h('input', { type: 'text', value: el[key] ?? '', placeholder, 'aria-label': label, 'data-field': key, autocomplete: 'off', ...(numeric ? { inputmode: 'numeric' } : {}) });
      i.addEventListener('input', () => {
        const v = i.value;
        if (key === 'match') el.match = v;
        else if (v.trim()) el[key] = v;
        else delete el[key];
        if ((key === 'ourScore' || key === 'theirScore') && !resultTouched) autoResult();
        save();
      });
      i.addEventListener('blur', () => save.flush());
      return i;
    };
    let resultTouched = el.result !== undefined;
    const autoResult = () => {
      const a = Number(el.ourScore);
      const b = Number(el.theirScore);
      if (el.ourScore?.trim() && el.theirScore?.trim() && Number.isFinite(a) && Number.isFinite(b)) el.result = a > b ? 'win' : a < b ? 'loss' : 'tie';
      renderSegs();
    };
    const long = (key: 'failed' | 'adjusted', placeholder: string, label: string) =>
      h('label', { class: 'q' }, h('span', { class: 'field-label', text: label }), dictationFor(textArea(el[key] ?? '', placeholder, (v) => {
        if (v.trim()) el[key] = v;
        else delete el[key];
        if (key === 'adjusted') renderSegs();
      }, `match-${key}`)));
    const segs = h('div', { class: 'stack-tight' });
    const seg = <T extends string>(label: string, options: [T, string][], current: T | undefined, set: (v: T | undefined) => void, testid: string) =>
      h(
        'div',
        { class: 'seg match-seg', role: 'group', 'aria-label': label, 'data-testid': testid },
        options.map(([v, l]) =>
          h('button', { class: `seg-btn ${current === v ? 'on' : ''}`, type: 'button', 'aria-pressed': String(current === v), 'data-value': v, onclick: () => (set(current === v ? undefined : v), saveNow(), renderSegs()) }, l),
        ),
      );
    function renderSegs() {
      setChildren(
        segs,
        h('span', { class: 'field-label', text: 'Resultado' }),
        seg('Resultado', [['win', 'Ganamos'], ['loss', 'Perdimos'], ['tie', 'Empate']], el.result, (v) => {
          resultTouched = true;
          if (v) el.result = v;
          else delete el.result;
        }, 'match-result'),
      );
      setChildren(
        changeBox,
        el.adjusted?.trim()
          ? h(
              'div',
              { class: 'stack-tight' },
              h('span', { class: 'field-label', text: '¿Va al registro de cambios?' }),
              seg('Registro de cambios', [['mechanics', 'Mecánica'], ['coding', 'Programación'], ['wiring', 'Cableado']], el.adjustedSection, (v) => {
                if (v) el.adjustedSection = v;
                else delete el.adjustedSection;
              }, 'match-change'),
            )
          : null,
      );
    }
    const changeBox = h('div');
    renderSegs();
    box.append(
      h('div', { class: 'match-row' }, h('label', { class: 'q grow' }, h('span', { class: 'field-label', text: 'Partido' }), text('match', 'Q12, Semifinal 2…', 'Número o nombre del partido'))),
      h(
        'div',
        { class: 'stack-tight' },
        h('span', { class: 'field-label', text: 'Alianza' }),
        seg('Alianza', [['red', 'Roja'], ['blue', 'Azul']], el.alliance, (v) => {
          if (v) el.alliance = v;
          else delete el.alliance;
        }, 'match-alliance'),
      ),
      h(
        'div',
        { class: 'match-row' },
        h('label', { class: 'q' }, h('span', { class: 'field-label', text: 'Aliado' }), text('partner', 'Equipo', 'Equipo aliado')),
        h('label', { class: 'q' }, h('span', { class: 'field-label', text: 'Rivales' }), text('opponents', 'Equipos', 'Equipos rivales')),
      ),
      h(
        'div',
        { class: 'stack-tight' },
        h('span', { class: 'field-label', text: 'Marcador (nosotros – ellos)' }),
        h('div', { class: 'match-row score' }, text('ourScore', 'Nosotros', 'Puntos de nuestra alianza', true), h('span', { class: 'muted', text: '–' }), text('theirScore', 'Ellos', 'Puntos de la otra alianza', true)),
      ),
      segs,
      long('failed', '¿Qué falló en este partido?', 'Qué falló'),
      long('adjusted', '¿Qué ajustamos antes del siguiente?', 'Qué ajustamos'),
      changeBox,
    );
    // El selector de alianza también se repinta con renderSegs (solo el de resultado y cambios cambian con el texto).
    box.querySelectorAll<HTMLElement>('[data-testid=match-alliance] .seg-btn').forEach((b) =>
      b.addEventListener('click', () => {
        for (const x of box.querySelectorAll<HTMLElement>('[data-testid=match-alliance] .seg-btn')) {
          const on = x.dataset.value === el.alliance;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', String(on));
        }
      }),
    );
    return box;
  }

  async function openPhotoAnnotator(el: Extract<EntryElement, { type: 'photo' }>) {
    const src = await app.photoUrl(el.photoId);
    const otherLetters = () =>
      entry.elements.flatMap((x) => (x.type === 'photo' && x.id !== el.id ? (x.annotations ?? []).flatMap((a) => (a.type === 'label' ? [a.letter] : [])) : []));
    openAnnotator({
      src,
      annotations: el.annotations ?? [],
      otherLetters,
      wiring: entry.kind === 'wiringDoc',
      onChange: (list) => {
        const target = entry.elements.find((x) => x.id === el.id);
        if (!target || target.type !== 'photo') return;
        if (list.length > 0) target.annotations = list;
        else delete target.annotations;
        save();
      },
      onClose: () => {
        save.flush();
        renderElements();
      },
    });
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

  /** Cambio de clasificación: se guarda ya, se recuerda (solo en el teléfono) y se vuelve a pintar. */
  const changed = () => {
    saveNow();
    if (!desk) app.rememberClassification(entry);
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

  const toggleSection = (v: SectionId) => (entry.section === v ? delete entry.section : (entry.section = v));
  const toggleKind = (v: (typeof ENTRY_KINDS)[number]) => (entry.kind === v ? delete entry.kind : (entry.kind = v));
  const toggleMark = (v: EntryMark) => (entry.marks = entry.marks.includes(v) ? entry.marks.filter((x) => x !== v) : [...entry.marks, v]);

  const sectionChips = () =>
    chips(
      'Sección',
      SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] })),
      (v) => entry.section === v,
      toggleSection,
      'section',
    );
  const kindChips = (label: string) =>
    chips(
      label,
      ENTRY_KINDS.map((k) => ({ value: k, label: ENTRY_KIND_LABELS[k] })),
      (v) => entry.kind === v,
      toggleKind,
      'kind',
    );
  const markChips = (label: string) =>
    chips(
      label,
      ENTRY_MARKS.map((m) => ({ value: m, label: MARK_LABELS[m] })),
      (v) => entry.marks.includes(v),
      toggleMark,
      'marks',
    );

  function threadInput(): HTMLInputElement {
    const thread = h('input', { type: 'text', id: `thread-${entry.id}`, placeholder: 'Ej. "intake v2", "falla del brazo"', value: entry.thread ?? '', 'data-testid': 'thread-input', autocomplete: 'off' });
    thread.addEventListener('input', () => {
      const v = thread.value.trim();
      if (v) entry.thread = v;
      else delete entry.thread;
      save();
    });
    thread.addEventListener('blur', () => save.flush());
    return thread;
  }

  function threadField(label: string): HTMLElement {
    const thread = threadInput();
    const suggestions = app.threads().filter((t) => t !== entry.thread).slice(0, 4);
    return h(
      'div',
      { class: 'chip-group' },
      h('label', { class: 'field-label', for: thread.id, text: label }),
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

  /**
   * Computadora: "Más detalles" compacto en dos columnas. Sección en un
   * selector de cuatro, tipo exacto en una lista desplegable (avisa si la
   * plantilla no lo trae en esa sección), las marcas que no están arriba como
   * botones chicos y el hilo con sugerencias.
   */
  function deskDetails(): HTMLElement {
    const sectionSeg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Sección', 'data-testid': 'section' },
      SECTIONS.map((s) =>
        h('button', { class: `seg-btn ${entry.section === s ? 'on' : ''}`, type: 'button', 'aria-pressed': String(entry.section === s), 'data-value': s, onclick: () => (toggleSection(s), changed()) }, SECTION_LABELS[s]),
      ),
    );
    const kindSel = h(
      'select',
      { id: `kind-${entry.id}`, class: 'compact', 'data-testid': 'kind-select' },
      h('option', { value: '', text: 'Sin tipo (trabajo del día)' }),
      ENTRY_KINDS.map((k) => {
        const allowed: readonly SectionId[] | undefined = PAGE_TYPES[k].sections;
        const off = entry.section && allowed && !allowed.includes(entry.section);
        return h('option', { value: k, text: off ? `${ENTRY_KIND_LABELS[k]} (no va en ${SECTION_LABELS[entry.section as SectionId]})` : ENTRY_KIND_LABELS[k] });
      }),
    );
    kindSel.value = entry.kind ?? '';
    kindSel.addEventListener('change', () => {
      const v = kindSel.value as (typeof ENTRY_KINDS)[number] | '';
      if (v) entry.kind = v;
      else delete entry.kind;
      changed();
    });
    const allowed: readonly SectionId[] | undefined = entry.kind ? PAGE_TYPES[entry.kind].sections : undefined;
    const mismatch = entry.kind && entry.section && allowed && !allowed.includes(entry.section);
    const otherMarks = ENTRY_MARKS.filter((m) => m !== 'milestone' && m !== 'change');
    const thread = threadInput();
    const listId = `threads-${entry.id}`;
    thread.setAttribute('list', listId);
    const row = (label: string, forId: string | undefined, control: HTMLElement) =>
      h('div', { class: 'form-row' }, forId ? h('label', { class: 'form-label', for: forId, text: label }) : h('span', { class: 'form-label', text: label }), control);
    return h(
      'div',
      { class: 'form-grid' },
      row('Sección', undefined, sectionSeg),
      row('Tipo exacto', kindSel.id, h('div', { class: 'stack-tight' }, kindSel, mismatch ? h('p', { class: 'warn-text small', 'data-testid': 'kind-warning', text: `La plantilla no trae «${ENTRY_KIND_LABELS[entry.kind!]}» en ${SECTION_LABELS[entry.section!]}: al generar quedará como trabajo del día.` }) : null)),
      row(
        'Otras marcas',
        undefined,
        h(
          'div',
          { class: 'chips small', 'data-testid': 'marks', role: 'group', 'aria-label': 'Otras marcas' },
          otherMarks.map((m) => {
            const on = entry.marks.includes(m);
            return h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'data-value': m, onclick: () => (toggleMark(m), changed()) }, MARK_LABELS[m]);
          }),
        ),
      ),
      row('Hilo', thread.id, h('div', {}, thread, h('datalist', { id: listId }, app.threads().filter((t) => t !== entry.thread).slice(0, 20).map((t) => h('option', { value: t }))))),
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
    if (!desk) app.setLastAuthors(entry.authorIds);
    saveNow();
  };

  /** "Más detalles": plegado en el celular, abierto en la computadora. */
  let detailsOpen = desk;

  /** Una fila: etiqueta, valor actual (o "Elegir") y una línea fina opcional. */
  function summaryRow(label: string, value: string, sub: string, onClick: (ev: Event) => void, testid: string, trailing?: string): HTMLElement {
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

  function markSwitch(mark: EntryMark, title: string, sub: string, testid: string): HTMLElement {
    const on = entry.marks.includes(mark);
    return h(
      'button',
      { class: 'sum-row switch-row', type: 'button', role: 'switch', 'aria-checked': String(on), 'data-testid': testid, onclick: () => (toggleMark(mark), changed()) },
      h('span', { class: 'sum-text' }, h('span', { class: 'sum-value', text: title }), h('span', { class: 'sum-sub', text: sub })),
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
    );
  }

  /** El botón que abrió la hoja, para anclar el menú en la computadora. */
  const anchorOf = (ev: Event) => (ev.currentTarget instanceof HTMLElement ? ev.currentTarget : undefined);

  function renderClass() {
    const robots = app.team?.robots ?? [];
    const last = desk ? undefined : app.recent().last;
    const lastValid = last && (!last.robotId || robots.some((r) => r.id === last.robotId)) ? last : undefined;
    const blank = !entry.robotId && !entry.subsystem && !entry.kind;
    const lastText = lastValid ? [targetLabel(robots, lastValid.robotId, lastValid.subsystem), whatOf(lastValid.kind)?.label].filter(Boolean).join(' · ') : '';

    const target = targetLabel(robots, entry.robotId, entry.subsystem);
    const what = whatOf(entry.kind);
    const authors = entry.authorIds.map((id) => (desk ? app.memberName(id) : app.memberName(id).split(' ')[0])).join(', ');
    const hiddenMarks = desk ? ['milestone', 'change', 'normal'] : ['milestone', 'normal'];
    const extraMarks = entry.marks.filter((m) => !hiddenMarks.includes(m)).map((m) => MARK_LABELS[m]);
    const detailsSummary = [entry.section ? SECTION_LABELS[entry.section] : '', entry.kind ? ENTRY_KIND_LABELS[entry.kind] : '', ...extraMarks, entry.thread ? `Hilo: ${entry.thread}` : '']
      .filter(Boolean)
      .join(' · ');

    const details = h(
      'details',
      { class: desk ? 'more is-desk' : 'more', 'data-testid': 'more-details', open: detailsOpen },
      h('summary', {}, h('span', { class: 'sum-text' }, h('span', { class: 'more-title', text: 'Más detalles' }), h('span', { class: 'sum-sub', text: detailsSummary || 'Sección, tipo exacto, marcas e hilo' }))),
      desk ? h('div', { class: 'more-body' }, deskDetails()) : h('div', { class: 'more-body' }, sectionChips(), kindChips('Tipo exacto'), markChips('Marcas'), threadField('Hilo (la historia a la que pertenece)')),
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
        robots.length > 0 || target ? summaryRow('¿De qué es?', target, '', (ev) => openTarget(anchorOf(ev)), 'class-target') : null,
        summaryRow('¿Qué fue?', what ? what.label : '', what || entry.section ? exactLabel(entry) : '', (ev) => openWhat(anchorOf(ev)), 'class-what'),
        summaryRow('¿Quién?', authors, '', (ev) => openAuthors(anchorOf(ev)), 'class-authors', '+ alguien más'),
      ),
      h(
        'div',
        { class: desk ? 'sum-list switches' : 'sum-list' },
        markSwitch('milestone', 'Es un hito', 'Un logro o algo que por fin funcionó', 'milestone'),
        desk ? markSwitch('change', 'Cambio', 'Va al registro de cambios', 'mark-change') : null,
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

  function openTarget(anchor?: HTMLElement) {
    const robots = app.team?.robots ?? [];
    const sheet = openSheet('¿De qué es?', 'sheet-target', undefined, anchor);
    const pick = (robotId?: string, subsystem?: string) => {
      setTarget(entry, robots, robotId, subsystem);
      sheet.close();
      changed();
      // Celular: siguiente paso natural, si falta, se pregunta qué fue.
      if (!desk && (robotId || subsystem) && !entry.kind) openWhat();
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
    const recentTargets = desk
      ? []
      : app
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

  function openWhat(anchor?: HTMLElement) {
    const sheet = openSheet('¿Qué fue?', 'sheet-what', undefined, anchor);
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
              // En la computadora se ve a qué página de la bitácora va.
              desk ? h('span', { class: 'item-hint', text: `${ENTRY_KIND_LABELS[o.kind]} · ${SECTION_LABELS[o.sections[0] as SectionId]}` }) : null,
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

  function openAuthors(anchor?: HTMLElement) {
    const sheet = openSheet('¿Quién lo hizo?', 'sheet-authors', () => renderClass(), anchor);
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
          ? h('button', { class: 'btn-text', type: 'button', onclick: () => ((showAllPeople = !showAllPeople), fill()) }, showAllPeople ? 'Solo quienes vinieron ese día' : 'Ver a todo el equipo')
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

/** "jue 12 nov · 06:25 p.m." (en la computadora se revisan varios días). */
function dayTime(e: Entry): string {
  const d = new Date(e.createdAt);
  return `${d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })} · ${timeOf(e.createdAt)}`;
}
