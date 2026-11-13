/**
 * Anotar una foto desde el celular: etiquetas con letra (A, B, C… solas),
 * con o sin flecha, y flechas sueltas. Se mueven arrastrando, se borran con
 * "Borrar" y se deshacen. Abajo, por cada letra: qué es, qué hace y por qué
 * está ahí. Todo se guarda al instante como datos (coordenadas relativas a la
 * foto), sin tocar la imagen.
 */

import { newId, nextLabelLetter, type PhotoAnnotation, type PhotoLabel } from '@vortex-wake/shared';
import { h, icon, openSheet, setChildren, toast } from '../ui.ts';
import { dictationFor } from '../dictation.ts';
import { annotationsToMarks, drawMarks, markRadius, svgEl } from './marks.ts';

export interface AnnotatorOptions {
  src: string;
  annotations: PhotoAnnotation[];
  /** Letras ya usadas en otras fotos de la misma entrada (para no repetir). */
  otherLetters: () => string[];
  /** Entrada de cableado: los textos de cada letra hablan de puertos y cables. */
  wiring?: boolean;
  onChange: (list: PhotoAnnotation[]) => void;
  onClose?: () => void;
}

type Mode = 'label' | 'arrow';
type Drag =
  | { kind: 'create'; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { kind: 'move'; id: string; part: 'body' | 'start' | 'end'; ox: number; oy: number; moved: boolean; before: string };

const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function openAnnotator(opts: AnnotatorOptions): void {
  let list: PhotoAnnotation[] = structuredClone(opts.annotations);
  let mode: Mode = 'label';
  let selected: string | undefined;
  const undo: string[] = [];
  let natural = { w: 1, h: 1 };

  const sheet = openSheet('Anotar foto', 'annotator', () => opts.onClose?.(), undefined, { full: true });
  const img = h('img', { alt: 'Foto a anotar', draggable: 'false' });
  const svg = svgEl('svg', { class: 'ann-svg', 'data-testid': 'annotator-canvas', role: 'img', 'aria-label': 'Foto con etiquetas y flechas' });
  const stage = h('div', { class: 'ann-stage' }, img, svg);
  const hint = h('p', { class: 'muted small ann-hint', role: 'status' });
  const tools = h('div', { class: 'ann-tools' });
  const labelsBox = h('div', { class: 'ann-labels', 'data-testid': 'annotator-labels' });
  sheet.body.append(stage, hint, tools, labelsBox, h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'annotator-done', onclick: () => sheet.close() }, 'Listo'));

  const fit = () => {
    const avail = sheet.body.clientWidth || innerWidth - 32;
    const maxH = Math.max(200, innerHeight * 0.55);
    const s = Math.min(avail / natural.w, maxH / natural.h);
    stage.style.width = `${Math.round(natural.w * s)}px`;
    stage.style.height = `${Math.round(natural.h * s)}px`;
  };
  img.addEventListener('load', () => {
    natural = { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
    fit();
    draw();
  });
  addEventListener('resize', fit);
  img.src = opts.src;

  const commit = (before?: string) => {
    if (before !== undefined) undo.push(before);
    opts.onChange(structuredClone(list));
    draw();
    renderTools();
    renderLabels();
  };
  const snapshot = () => JSON.stringify(list);
  const draw = () => drawMarks(svg, annotationsToMarks(list), natural.w, natural.h, selected);

  // --- puntero -----------------------------------------------------------------------
  const pos = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  /** Distancia en pixeles de la imagen. */
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot((ax - bx) * natural.w, (ay - by) * natural.h);
  const radius = () => markRadius(natural.w, natural.h);
  const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ax = a.x * natural.w, ay = a.y * natural.h, bx = b.x * natural.w, by = b.y * natural.h, px = p.x * natural.w, py = p.y * natural.h;
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
  };

  const hit = (p: { x: number; y: number }): Drag | undefined => {
    const r = radius() * 1.4;
    const sel = list.find((a) => a.id === selected);
    if (sel && sel.tx !== undefined && sel.ty !== undefined && dist(p.x, p.y, sel.tx, sel.ty) < r) return { kind: 'move', id: sel.id, part: 'end', ox: p.x, oy: p.y, moved: false, before: snapshot() };
    if (sel && sel.type === 'arrow' && dist(p.x, p.y, sel.x, sel.y) < r) return { kind: 'move', id: sel.id, part: 'start', ox: p.x, oy: p.y, moved: false, before: snapshot() };
    for (const a of [...list].reverse()) {
      if (a.type === 'label' && dist(p.x, p.y, a.x, a.y) < r) return { kind: 'move', id: a.id, part: 'body', ox: p.x, oy: p.y, moved: false, before: snapshot() };
    }
    for (const a of [...list].reverse()) {
      if (a.type === 'arrow' && segDist(p, a, { x: a.tx, y: a.ty }) < radius() * 0.8) return { kind: 'move', id: a.id, part: 'body', ox: p.x, oy: p.y, moved: false, before: snapshot() };
    }
    return undefined;
  };

  let drag: Drag | undefined;
  let preview: SVGElement | undefined;
  svg.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    const p = pos(ev);
    drag = hit(p) ?? { kind: 'create', sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false };
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const p = pos(ev);
    if (drag.kind === 'create') {
      drag.x = p.x;
      drag.y = p.y;
      if (!drag.moved && dist(drag.sx, drag.sy, p.x, p.y) > radius() * 1.2) drag.moved = true;
      if (drag.moved) {
        preview?.remove();
        preview = svgEl('line', { x1: drag.sx * natural.w, y1: drag.sy * natural.h, x2: p.x * natural.w, y2: p.y * natural.h, stroke: '#c8102e', 'stroke-width': radius() * 0.26, 'stroke-dasharray': `${radius() * 0.6} ${radius() * 0.4}` });
        svg.append(preview);
      }
      return;
    }
    const a = list.find((x) => x.id === (drag as { id: string }).id);
    if (!a) return;
    const dx = p.x - drag.ox;
    const dy = p.y - drag.oy;
    if (!drag.moved && dist(0, 0, dx, dy) < 4) return;
    drag.moved = true;
    drag.ox = p.x;
    drag.oy = p.y;
    if (drag.part === 'end') {
      a.tx = round((a.tx ?? 0) + dx);
      a.ty = round((a.ty ?? 0) + dy);
    } else if (drag.part === 'start') {
      a.x = round(a.x + dx);
      a.y = round(a.y + dy);
    } else {
      a.x = round(a.x + dx);
      a.y = round(a.y + dy);
      if (a.type === 'arrow') {
        a.tx = round(a.tx + dx);
        a.ty = round(a.ty + dy);
      }
    }
    selected = a.id;
    draw();
  });
  const end = () => {
    const d = drag;
    drag = undefined;
    preview?.remove();
    preview = undefined;
    if (!d) return;
    if (d.kind === 'move') {
      if (d.moved) commit(d.before);
      else {
        selected = selected === d.id ? undefined : d.id;
        draw();
        renderTools();
        renderLabels();
      }
      return;
    }
    const before = snapshot();
    if (mode === 'arrow') {
      if (!d.moved) {
        if (selected) {
          selected = undefined;
          draw();
          renderTools();
        } else toast('Arrastra para dibujar una flecha');
        return;
      }
      const a: PhotoAnnotation = { id: newId(), type: 'arrow', x: round(d.sx), y: round(d.sy), tx: round(d.x), ty: round(d.y) };
      list.push(a);
      selected = a.id;
      commit(before);
      return;
    }
    const letter = nextLabelLetter([...opts.otherLetters(), ...list.filter((x): x is PhotoLabel => x.type === 'label').map((x) => x.letter)]);
    const l: PhotoLabel = d.moved
      ? { id: newId(), type: 'label', letter, x: round(d.x), y: round(d.y), tx: round(d.sx), ty: round(d.sy) }
      : { id: newId(), type: 'label', letter, x: round(d.sx), y: round(d.sy) };
    list.push(l);
    selected = l.id;
    commit(before);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // --- herramientas ------------------------------------------------------------------
  function renderTools() {
    const seg = (m: Mode, label: string, ic: Parameters<typeof icon>[0]) =>
      h('button', { class: `seg-btn ${mode === m ? 'on' : ''}`, type: 'button', 'aria-pressed': String(mode === m), 'data-testid': `ann-mode-${m}`, onclick: () => ((mode = m), renderTools()) }, icon(ic, 'icon sm'), label);
    const sel = list.find((a) => a.id === selected);
    setChildren(
      tools,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Herramienta' }, seg('label', 'Etiqueta', 'tag'), seg('arrow', 'Flecha', 'arrow')),
      h(
        'div',
        { class: 'ann-actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Deshacer', 'data-testid': 'ann-undo', disabled: undo.length === 0, onclick: () => {
          const prev = undo.pop();
          if (prev === undefined) return;
          list = JSON.parse(prev) as PhotoAnnotation[];
          if (!list.some((a) => a.id === selected)) selected = undefined;
          commit();
        } }, icon('undo')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': sel ? `Borrar ${sel.type === 'label' ? `la etiqueta ${sel.letter}` : 'la flecha'}` : 'Borrar (elige algo primero)', 'data-testid': 'ann-delete', disabled: !sel, onclick: () => {
          if (!sel) return;
          const before = snapshot();
          list = list.filter((a) => a.id !== sel.id);
          selected = undefined;
          commit(before);
        } }, icon('trash')),
      ),
    );
    hint.textContent = sel
      ? sel.type === 'label'
        ? `Etiqueta ${sel.letter}: arrástrala para moverla${sel.tx !== undefined ? ' o mueve la punta de su flecha' : ''}.`
        : 'Flecha: arrástrala o mueve sus puntas.'
      : mode === 'label'
        ? 'Toca para poner una letra. Para ponerla con flecha, arrastra desde la pieza hacia donde va la letra.'
        : 'Arrastra para dibujar una flecha.';
  }

  // --- textos de cada letra ------------------------------------------------------------
  const fields: [keyof Pick<PhotoLabel, 'what' | 'does' | 'why'>, string][] = opts.wiring
    ? [['what', 'Qué es (dispositivo o puerto)'], ['does', 'Cable o conexión'], ['why', 'Por qué este puerto o ruta']]
    : [['what', 'Qué es'], ['does', 'Qué hace'], ['why', 'Por qué está ahí']];
  let rendered = '';
  function renderLabels() {
    const labels = list.filter((a): a is PhotoLabel => a.type === 'label').sort((a, b) => a.letter.length - b.letter.length || (a.letter < b.letter ? -1 : 1));
    const key = labels.map((l) => l.id).join() + '|' + (selected ?? '');
    if (key === rendered) return;
    rendered = key;
    setChildren(
      labelsBox,
      labels.length === 0 ? h('p', { class: 'muted small', text: 'Cada letra que pongas aparece aquí para escribir qué es, qué hace y por qué está ahí.' }) : null,
      ...labels.map((l) =>
        h(
          'div',
          { class: `ann-label ${l.id === selected ? 'on' : ''}`, 'data-letter': l.letter },
          h('button', { class: 'ann-letter', type: 'button', 'aria-label': `Elegir la etiqueta ${l.letter}`, onclick: () => ((selected = l.id), draw(), renderTools(), renderLabels()) }, l.letter),
          h(
            'div',
            { class: 'ann-fields' },
            ...fields.map(([k, label]) => {
              const input = h('input', { type: 'text', placeholder: label, 'aria-label': `${label} (${l.letter})`, value: l[k] ?? '', 'data-field': k });
              input.addEventListener('input', () => {
                const v = input.value;
                if (v.trim()) l[k] = v;
                else delete l[k];
                opts.onChange(structuredClone(list));
              });
              // Etiqueta visible: el texto de ayuda desaparece al escribir.
              return h('label', { class: 'ann-field' }, h('span', { class: 'ann-field-label', text: label }), dictationFor(input));
            }),
          ),
        ),
      ),
    );
  }

  renderTools();
  renderLabels();
  sheet.body.closest('dialog')?.addEventListener('close', () => removeEventListener('resize', fit));
}
