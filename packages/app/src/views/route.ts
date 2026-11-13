/**
 * Ruta del autónomo sobre el mapa del campo (el de la plantilla, recortado
 * igual que en la bitácora): tocar agrega el siguiente punto, arrastrar lo
 * mueve, y cada punto es un paso con su acción, resultado esperado y puntos.
 */

import { FIELD_IMAGE, newId, routeMarks, type RoutePoint } from '@vortex-wake/shared';
import { dictationFor } from '../dictation.ts';
import { h, icon, openSheet, setChildren, toast } from '../ui.ts';
import { drawMarks, markRadius, svgEl, type DrawMark } from './marks.ts';

const VB = 1000;
const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function routeDrawMarks(points: RoutePoint[]): DrawMark[] {
  const ids = points.map((p) => p.id);
  return routeMarks(points).map((m, i) => ({ ...m, id: m.kind === 'label' ? (ids[Number(m.text) - 1] ?? `l${i}`) : `a${i}` }));
}

/** El campo recortado (CSS) con la ruta encima. */
export function fieldView(points: RoutePoint[], selected?: string): { el: HTMLElement; svg: SVGSVGElement; redraw(points: RoutePoint[], selected?: string): void } {
  const img = h('img', { src: 'field.png', alt: 'Mapa del campo', draggable: 'false' });
  const c = FIELD_IMAGE.crop;
  // Recorte con CSSOM (la política de contenido no permite atributos style).
  img.style.width = `${(FIELD_IMAGE.width / c.width) * 100}%`;
  img.style.left = `${(-c.x / c.width) * 100}%`;
  img.style.top = `${(-c.y / c.width) * 100}%`;
  const svg = svgEl('svg', { class: 'field-svg', viewBox: `0 0 ${VB} ${VB}`, 'aria-hidden': 'true' });
  const el = h('div', { class: 'field-crop' }, img, svg);
  const redraw = (pts: RoutePoint[], sel?: string) => drawMarks(svg, routeDrawMarks(pts), VB, VB, sel);
  redraw(points, selected);
  return { el, svg, redraw };
}

export function openRouteEditor(opts: { points: RoutePoint[]; onChange(points: RoutePoint[]): void; onClose(): void }): void {
  let points: RoutePoint[] = structuredClone(opts.points);
  let selected: string | undefined;
  const undo: string[] = [];
  const sheet = openSheet('Ruta del autónomo', 'route-editor', opts.onClose, undefined, { full: true });
  const view = fieldView(points);
  view.svg.setAttribute('data-testid', 'route-canvas');
  view.el.classList.add('editing');
  const hint = h('p', { class: 'muted small ann-hint', role: 'status' });
  const tools = h('div', { class: 'ann-tools' });
  const steps = h('ol', { class: 'route-steps', 'data-testid': 'route-steps' });
  sheet.body.append(view.el, hint, tools, steps, h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'route-done', onclick: () => sheet.close() }, 'Listo'));

  const changed = (before?: string) => {
    if (before !== undefined) undo.push(before);
    opts.onChange(structuredClone(points));
    view.redraw(points, selected);
    renderTools();
    renderSteps();
  };

  const pos = (ev: PointerEvent) => {
    const r = view.svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  };
  let drag: { id?: string; sx: number; sy: number; moved: boolean; before: string } | undefined;
  view.svg.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    view.svg.setPointerCapture(ev.pointerId);
    const p = pos(ev);
    const r = (markRadius(VB, VB) * 1.5) / VB;
    const hit = [...points].reverse().find((q) => Math.hypot(q.x - p.x, q.y - p.y) < r);
    drag = { ...(hit ? { id: hit.id } : {}), sx: p.x, sy: p.y, moved: false, before: JSON.stringify(points) };
  });
  view.svg.addEventListener('pointermove', (ev) => {
    if (!drag?.id) return;
    const p = pos(ev);
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 0.01) return;
    drag.moved = true;
    const q = points.find((x) => x.id === drag?.id);
    if (!q) return;
    q.x = round(p.x);
    q.y = round(p.y);
    selected = q.id;
    view.redraw(points, selected);
  });
  const end = (ev: PointerEvent) => {
    const d = drag;
    drag = undefined;
    if (!d) return;
    if (d.id) {
      if (d.moved) changed(d.before);
      else {
        selected = selected === d.id ? undefined : d.id;
        view.redraw(points, selected);
        renderTools();
        renderSteps();
      }
      return;
    }
    if (points.length >= 40) {
      toast('La ruta ya tiene 40 pasos');
      return;
    }
    const p = pos(ev);
    const np: RoutePoint = { id: newId(), x: round(p.x), y: round(p.y) };
    points.push(np);
    selected = np.id;
    changed(d.before);
  };
  view.svg.addEventListener('pointerup', end);
  view.svg.addEventListener('pointercancel', () => (drag = undefined));

  function renderTools() {
    const sel = points.findIndex((p) => p.id === selected);
    hint.textContent = sel >= 0 ? `Paso ${sel + 1}: arrástralo para moverlo.` : points.length === 0 ? 'Toca el campo donde arranca el robot (paso 1).' : `Toca para agregar el paso ${points.length + 1}. Arrastra un punto para moverlo.`;
    setChildren(
      tools,
      h('span', { class: 'muted small', text: `${points.length} paso(s)` }),
      h(
        'div',
        { class: 'ann-actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Deshacer', 'data-testid': 'route-undo', disabled: undo.length === 0, onclick: () => {
          const prev = undo.pop();
          if (prev === undefined) return;
          points = JSON.parse(prev) as RoutePoint[];
          if (!points.some((p) => p.id === selected)) selected = undefined;
          changed();
        } }, icon('undo')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': sel >= 0 ? `Borrar el paso ${sel + 1}` : 'Borrar (elige un punto primero)', 'data-testid': 'route-delete', disabled: sel < 0, onclick: () => {
          const before = JSON.stringify(points);
          points = points.filter((p) => p.id !== selected);
          selected = undefined;
          changed(before);
        } }, icon('trash')),
      ),
    );
  }

  let rendered = '';
  function renderSteps() {
    const key = points.map((p) => p.id).join() + '|' + (selected ?? '');
    if (key === rendered) return;
    rendered = key;
    const field = (p: RoutePoint, k: 'action' | 'expected' | 'points', label: string, placeholder: string) => {
      const i = h('input', { type: 'text', value: p[k] ?? '', placeholder, 'aria-label': `${label} (paso)`, 'data-field': k, ...(k === 'points' ? { inputmode: 'numeric' } : {}) });
      i.addEventListener('input', () => {
        if (i.value.trim()) p[k] = i.value;
        else delete p[k];
        opts.onChange(structuredClone(points));
      });
      return h('label', { class: `ann-field ${k === 'points' ? 'pts' : ''}` }, h('span', { class: 'ann-field-label', text: label }), k === 'points' ? i : dictationFor(i));
    };
    setChildren(
      steps,
      ...points.map((p, n) =>
        h(
          'li',
          { class: `ann-label ${p.id === selected ? 'on' : ''}`, 'data-step': String(n + 1) },
          h('button', { class: 'ann-letter', type: 'button', 'aria-label': `Elegir el paso ${n + 1}`, onclick: () => ((selected = p.id), view.redraw(points, selected), renderTools(), renderSteps()) }, String(n + 1)),
          h('div', { class: 'ann-fields' }, field(p, 'action', 'Acción', 'Qué hace el robot'), field(p, 'expected', 'Resultado esperado', 'Qué debe pasar'), field(p, 'points', 'Puntos', '0')),
        ),
      ),
    );
  }
  renderTools();
  renderSteps();
}
