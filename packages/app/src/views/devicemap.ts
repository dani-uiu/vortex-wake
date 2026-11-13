/**
 * Mapa del Brain (puertos) o del control sobre un dibujo, como la ruta del
 * autónomo sobre el campo: tocar un puerto o botón lo elige y abajo se
 * escribe qué va ahí. Los lugares con algo escrito se ven llenos.
 */

import { CONTROLLER_SLOTS, DEVICE_MAP_LABELS, PORT_SLOTS, slotLabel, type DeviceMapKind } from '@vortex-wake/shared';
import { h, openSheet, setChildren } from '../ui.ts';
import { svgEl } from './marks.ts';

interface Spot {
  slot: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

const W = 1000;

/** Brain V5 visto de frente: 1-10 arriba, 11-20 abajo, 21 a la izquierda y A-H (3 hilos) a la derecha. */
function brainSpots(): Spot[] {
  const spots: Spot[] = [];
  for (let i = 0; i < 10; i++) spots.push({ slot: String(i + 1), x: 110 + i * 72, y: 40, w: 62, h: 62, text: String(i + 1) });
  for (let i = 0; i < 10; i++) spots.push({ slot: String(i + 11), x: 110 + i * 72, y: 518, w: 62, h: 62, text: String(i + 11) });
  spots.push({ slot: '21', x: 30, y: 279, w: 62, h: 62, text: '21' });
  'ABCDEFGH'.split('').forEach((l, i) => spots.push({ slot: l, x: 892, y: 96 + i * 54, w: 72, h: 46, text: l }));
  return spots;
}

/** Control V5: gatillos arriba, dos palancas, flechas a la izquierda y X/A/B/Y a la derecha. */
function controllerSpots(): Spot[] {
  const b = (slot: string, x: number, y: number, w = 76, hh = 56, text = slot): Spot => ({ slot, x, y, w, h: hh, text });
  return [
    b('L2', 150, 20, 120, 50),
    b('L1', 150, 78, 120, 50),
    b('R2', 730, 20, 120, 50),
    b('R1', 730, 78, 120, 50),
    b('axis3', 262, 168, 76, 50, '↕ 3'),
    b('axis4', 382, 248, 76, 50, '↔ 4'),
    b('axis2', 662, 168, 76, 50, '↕ 2'),
    b('axis1', 542, 248, 76, 50, '↔ 1'),
    b('up', 262, 380, 64, 56, '▲'),
    b('down', 262, 500, 64, 56, '▼'),
    b('left', 196, 440, 64, 56, '◀'),
    b('right', 328, 440, 64, 56, '▶'),
    b('X', 668, 380, 64, 56),
    b('A', 734, 440, 64, 56),
    b('B', 668, 500, 64, 56),
    b('Y', 602, 440, 64, 56),
  ];
}

export function spotsFor(kind: DeviceMapKind): Spot[] {
  return kind === 'ports' ? brainSpots() : controllerSpots();
}

export function slotsFor(kind: DeviceMapKind): string[] {
  return kind === 'ports' ? PORT_SLOTS : CONTROLLER_SLOTS.map(([s]) => s);
}

/** El dibujo con los lugares llenos marcados. `onPick` hace que se puedan tocar. */
export function deviceView(kind: DeviceMapKind, slots: Record<string, string>, onPick?: (slot: string) => void): { el: SVGSVGElement; redraw(slots: Record<string, string>, selected?: string): void } {
  const H = 620;
  const svg = svgEl('svg', { class: `device-svg device-${kind}`, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': DEVICE_MAP_LABELS[kind] });
  // Cuerpo (solo de adorno).
  if (kind === 'ports') {
    svg.append(svgEl('rect', { class: 'dm-body', x: 100, y: 110, width: 780, height: 400, rx: 28 }), svgEl('rect', { class: 'dm-screen', x: 300, y: 190, width: 380, height: 240, rx: 12 }));
    const t = svgEl('text', { class: 'dm-brand', x: 490, y: 322, 'text-anchor': 'middle' });
    t.textContent = 'V5';
    svg.append(t);
  } else {
    svg.append(svgEl('rect', { class: 'dm-body', x: 120, y: 140, width: 760, height: 450, rx: 90 }));
    for (const [cx, cy] of [[350, 240], [600, 240]] as const) svg.append(svgEl('circle', { class: 'dm-stick', cx, cy, r: 52 }));
  }
  const spots = spotsFor(kind);
  const nodes = new Map<string, SVGGElement>();
  for (const s of spots) {
    const g = svgEl('g', { class: 'dm-slot', 'data-slot': s.slot });
    const r = svgEl('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: 10 });
    const t = svgEl('text', { x: s.x + s.w / 2, y: s.y + s.h / 2 + 9, 'text-anchor': 'middle' });
    t.textContent = s.text;
    const title = svgEl('title');
    title.textContent = slotLabel(kind, s.slot);
    g.append(title, r, t);
    if (onPick) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', slotLabel(kind, s.slot));
      g.addEventListener('click', () => onPick(s.slot));
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onPick(s.slot);
        }
      });
    }
    nodes.set(s.slot, g);
    svg.append(g);
  }
  const redraw = (sl: Record<string, string>, selected?: string) => {
    for (const [slot, g] of nodes) {
      g.classList.toggle('filled', !!sl[slot]?.trim());
      g.classList.toggle('on', slot === selected);
    }
  };
  redraw(slots);
  return { el: svg, redraw };
}

export function openDeviceMapEditor(opts: {
  kind: DeviceMapKind;
  slots: Record<string, string>;
  onChange(slots: Record<string, string>): void;
  onClose(): void;
}): void {
  const kind = opts.kind;
  const slots: Record<string, string> = { ...opts.slots };
  let selected: string | undefined;
  const sheet = openSheet(DEVICE_MAP_LABELS[kind], 'devicemap-editor', opts.onClose, undefined, { full: true });
  const hint = h('p', { class: 'muted small ann-hint', role: 'status' });
  const list = h('ol', { class: 'dm-list', 'data-testid': 'devicemap-list' });
  const inputs = new Map<string, HTMLInputElement>();
  const view = deviceView(kind, slots, (slot) => pick(slot, true));
  view.el.setAttribute('data-testid', 'devicemap-canvas');

  const changed = () => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(slots)) if (v.trim()) clean[k] = v;
    opts.onChange(clean);
    view.redraw(slots, selected);
    renderHint();
  };
  // Campo del lugar elegido, justo debajo del dibujo: tocar y escribir sin perder el dibujo de vista.
  const curLabel = h('span', { class: 'dm-row-label' });
  const cur = h('input', { type: 'text', maxlength: '120', placeholder: kind === 'ports' ? 'Motor, sensor…' : 'Qué hace', 'data-testid': 'devicemap-current', enterkeyhint: 'done' });
  const curRow = h('label', { class: 'dm-row dm-current', hidden: true }, curLabel, cur);
  cur.addEventListener('input', () => {
    if (!selected) return;
    slots[selected] = cur.value;
    const i = inputs.get(selected);
    if (i) i.value = cur.value;
    changed();
  });
  cur.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') cur.blur();
  });
  function pick(slot: string, focus: boolean) {
    selected = slot;
    view.redraw(slots, selected);
    for (const [s, i] of inputs) i.closest('li')?.classList.toggle('on', s === slot);
    renderHint();
    curRow.hidden = false;
    curLabel.textContent = slotLabel(kind, slot);
    cur.value = slots[slot] ?? '';
    if (focus) cur.focus({ preventScroll: true });
  }
  function renderHint() {
    const n = Object.values(slots).filter((v) => v.trim()).length;
    hint.textContent = selected
      ? `${slotLabel(kind, selected)}: escribe abajo qué va ahí.`
      : `Toca un ${kind === 'ports' ? 'puerto' : 'botón o palanca'} para escribir qué va ahí. ${n} con algo escrito.`;
  }
  setChildren(
    list,
    ...slotsFor(kind).map((slot) => {
      const i = h('input', { type: 'text', value: slots[slot] ?? '', placeholder: kind === 'ports' ? 'Motor, sensor…' : 'Qué hace', maxlength: '120', 'data-slot': slot, 'aria-label': slotLabel(kind, slot) });
      i.addEventListener('focus', () => pick(slot, false));
      i.addEventListener('input', () => {
        slots[slot] = i.value;
        if (selected === slot) cur.value = i.value;
        changed();
      });
      inputs.set(slot, i);
      return h('li', { class: 'dm-row' }, h('span', { class: 'dm-row-label', text: slotLabel(kind, slot) }), i);
    }),
  );
  renderHint();
  sheet.body.append(h('div', { class: 'device-wrap editing' }, view.el), hint, curRow, h('h3', { class: 'section-title', text: 'Todos' }), list, h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'devicemap-done', onclick: () => sheet.close() }, 'Listo'));
}
