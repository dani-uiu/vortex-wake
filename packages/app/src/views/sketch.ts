/**
 * Boceto rápido con el dedo (lluvias de ideas): trazo, borrador, deshacer,
 * tres colores y dos grosores. Se guarda como imagen JPEG en la entrada (por
 * el mismo camino que las fotos, así que funciona sin conexión).
 */

import { h, icon, openSheet, setChildren } from '../ui.ts';

const W = 1200;
const H = 900;
const COLORS: [string, string][] = [
  ['#121417', 'Negro'],
  ['#c8102e', 'Rojo'],
  ['#1f5fbf', 'Azul'],
];
const WIDTHS: [number, string][] = [
  [8, 'Fino'],
  [22, 'Grueso'],
];

interface Stroke {
  color: string;
  width: number;
  erase: boolean;
  points: [number, number][];
}

export function openSketch(onSave: (file: File) => Promise<void> | void): void {
  const strokes: Stroke[] = [];
  let color = COLORS[0]?.[0] ?? '#000';
  let width = WIDTHS[0]?.[0] ?? 5;
  let erase = false;
  let dirty = false;

  const sheet = openSheet('Boceto', 'sketch', undefined, undefined, { full: true });
  const canvas = h('canvas', { class: 'sketch-canvas', width: String(W), height: String(H), 'data-testid': 'sketch-canvas', 'aria-label': 'Lienzo para dibujar con el dedo' });
  const ctx = canvas.getContext('2d');
  const tools = h('div', { class: 'sketch-tools' });
  const save = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'sketch-save' }, 'Guardar boceto');
  sheet.body.append(canvas, tools, save);

  const redraw = () => {
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (const s of strokes) paint(s);
  };
  const paint = (s: Stroke, from = 0) => {
    if (!ctx || s.points.length === 0) return;
    ctx.strokeStyle = s.erase ? '#ffffff' : s.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = s.erase ? s.width * 3 : s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pts = s.points;
    if (pts.length === 1) {
      const [x, y] = pts[0] as [number, number];
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    const start = pts[Math.max(0, from - 1)] as [number, number];
    ctx.moveTo(start[0], start[1]);
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const p = pts[i] as [number, number];
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  };
  redraw();

  const pos = (ev: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((ev.clientX - r.left) / r.width) * W), Math.round(((ev.clientY - r.top) / r.height) * H)];
  };
  let current: Stroke | undefined;
  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    current = { color, width, erase, points: [pos(ev)] };
    strokes.push(current);
    dirty = true;
    paint(current);
    renderTools();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!current) return;
    const n = current.points.length;
    for (const e of ev.getCoalescedEvents?.() ?? [ev]) current.points.push(pos(e));
    paint(current, n);
  });
  const end = () => (current = undefined);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function renderTools() {
    const sw = (on: boolean, label: string, testid: string, onclick: () => void, ...content: (Node | string)[]) =>
      h('button', { class: `sketch-btn ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), 'aria-label': label, title: label, 'data-testid': testid, onclick: () => (onclick(), renderTools()) }, ...content);
    setChildren(
      tools,
      h(
        'div',
        { class: 'sketch-row', role: 'group', 'aria-label': 'Color' },
        // Sin atributos style (la política de contenido de la versión hospedada no los permite): clases.
        ...COLORS.map(([c, name], i) => sw(!erase && color === c, name, `sketch-color-${name.toLowerCase()}`, () => ((color = c), (erase = false)), h('span', { class: `swatch c${i}` }))),
        sw(erase, 'Borrador', 'sketch-eraser', () => (erase = true), icon('eraser')),
      ),
      h(
        'div',
        { class: 'sketch-row', role: 'group', 'aria-label': 'Grosor' },
        ...WIDTHS.map(([w, name], i) => sw(width === w, name, `sketch-width-${name.toLowerCase()}`, () => (width = w), h('span', { class: `dot w${i}` }))),
        h('button', { class: 'sketch-btn', type: 'button', 'aria-label': 'Deshacer', title: 'Deshacer', 'data-testid': 'sketch-undo', disabled: strokes.length === 0, onclick: () => (strokes.pop(), redraw(), renderTools()) }, icon('undo')),
      ),
    );
  }
  renderTools();

  save.addEventListener('click', () => {
    if (!dirty || strokes.length === 0) {
      sheet.close();
      return;
    }
    save.disabled = true;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          save.disabled = false;
          return;
        }
        const file = new File([blob], `boceto-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
        void Promise.resolve(onSave(file)).then(() => sheet.close());
      },
      'image/jpeg',
      0.9,
    );
  });
}
