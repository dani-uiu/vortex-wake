/**
 * Dibujo de flechas y etiquetas sobre una imagen (SVG encima de la foto).
 * Lo usan las fotos anotadas (listas, editor y anotador) y la ruta del
 * autónomo sobre el mapa del campo. Las coordenadas son relativas a la
 * imagen (0 a 1), igual que en los datos y en el generador.
 */

import type { PhotoAnnotation } from '@vortex-wake/shared';
import { h } from '../ui.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
export const MARK_RED = '#c8102e';

export interface DrawMark {
  id: string;
  kind: 'label' | 'arrow';
  text?: string;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function annotationsToMarks(list: PhotoAnnotation[] | undefined): DrawMark[] {
  return (list ?? []).map((a) =>
    a.type === 'arrow'
      ? { id: a.id, kind: 'arrow', x: a.x, y: a.y, tx: a.tx, ty: a.ty }
      : { id: a.id, kind: 'label', text: a.letter, x: a.x, y: a.y, ...(a.tx !== undefined && a.ty !== undefined ? { tx: a.tx, ty: a.ty } : {}) },
  );
}

/** Radio de los círculos, en pixeles de la imagen (como en la bitácora: ~8 % del lado menor). */
export function markRadius(w: number, h: number): number {
  return Math.min(w, h) * 0.042;
}

/**
 * Dibuja las marcas en `svg` (viewBox = tamaño natural de la imagen).
 * `selected` resalta una y muestra sus puntas para moverlas.
 */
export function drawMarks(svg: SVGSVGElement, marks: DrawMark[], w: number, hgt: number, selected?: string): void {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  const r = markRadius(w, hgt);
  const sw = r * 0.26;
  const P = (fx: number, fy: number) => ({ x: fx * w, y: fy * hgt });
  const clampC = (p: { x: number; y: number }) => ({ x: Math.min(w - r, Math.max(r, p.x)), y: Math.min(hgt - r, Math.max(r, p.y)) });
  const arrow = (a: { x: number; y: number }, b: { x: number; y: number }, sel: boolean) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 2) return;
    const ux = (b.x - a.x) / d;
    const uy = (b.y - a.y) / d;
    const head = Math.min(r * 1.1, d * 0.5);
    const bx = b.x - ux * head * 0.8;
    const by = b.y - uy * head * 0.8;
    const line = `M${a.x} ${a.y}L${bx} ${by}`;
    const tip = `${b.x},${b.y} ${b.x - ux * head - uy * head * 0.55},${b.y - uy * head + ux * head * 0.55} ${b.x - ux * head + uy * head * 0.55},${b.y - uy * head - ux * head * 0.55}`;
    // Halo blanco para que se vea sobre fotos oscuras.
    svg.append(svgEl('path', { d: line, stroke: '#fff', 'stroke-width': sw * 2.2, 'stroke-linecap': 'round', fill: 'none', opacity: 0.85 }));
    svg.append(svgEl('polygon', { points: tip, fill: '#fff', stroke: '#fff', 'stroke-width': sw * 1.2, 'stroke-linejoin': 'round', opacity: 0.85 }));
    svg.append(svgEl('path', { d: line, stroke: MARK_RED, 'stroke-width': sw, 'stroke-linecap': 'round', fill: 'none', ...(sel ? { 'stroke-dasharray': `${sw * 3} ${sw * 2}` } : {}) }));
    svg.append(svgEl('polygon', { points: tip, fill: MARK_RED }));
  };
  const handle = (p: { x: number; y: number }) => svg.append(svgEl('circle', { cx: p.x, cy: p.y, r: r * 0.55, fill: 'rgba(200,16,46,.25)', stroke: MARK_RED, 'stroke-width': sw * 0.6 }));

  // Primero las flechas, después las letras (encima).
  for (const m of marks) {
    if (m.tx === undefined || m.ty === undefined) continue;
    const sel = m.id === selected;
    if (m.kind === 'arrow') arrow(P(m.x, m.y), P(m.tx, m.ty), sel);
    else {
      const c = clampC(P(m.x, m.y));
      const t = P(m.tx, m.ty);
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d > r) arrow({ x: c.x + ((t.x - c.x) / d) * r, y: c.y + ((t.y - c.y) / d) * r }, t, sel);
    }
  }
  for (const m of marks) {
    if (m.kind !== 'label') continue;
    const c = clampC(P(m.x, m.y));
    const sel = m.id === selected;
    if (sel) svg.append(svgEl('circle', { cx: c.x, cy: c.y, r: r * 1.45, fill: 'none', stroke: MARK_RED, 'stroke-width': sw * 0.7, 'stroke-dasharray': `${sw * 2} ${sw * 1.5}` }));
    svg.append(svgEl('circle', { cx: c.x, cy: c.y, r, fill: '#fff', stroke: MARK_RED, 'stroke-width': sw * 0.8 }));
    const text = m.text ?? '';
    const t = svgEl('text', {
      x: c.x,
      y: c.y,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': r * (text.length > 1 ? 0.95 : 1.2),
      'font-weight': 800,
      'font-family': 'system-ui, sans-serif',
      fill: MARK_RED,
    });
    t.textContent = text;
    svg.append(t);
  }
  const s = marks.find((m) => m.id === selected);
  if (s && s.tx !== undefined && s.ty !== undefined) {
    handle(P(s.tx, s.ty));
    if (s.kind === 'arrow') handle(P(s.x, s.y));
  }
}

/**
 * Imagen con sus marcas encima, para listas y editor. `fit` imita
 * `object-fit` de la imagen (`cover` en miniaturas, `contain` en el editor).
 */
export function markedImage(src: Promise<string> | string, marks: DrawMark[], opts: { cls?: string; fit?: 'cover' | 'contain'; alt?: string } = {}): HTMLElement {
  const img = h('img', { alt: opts.alt ?? '', decoding: 'async', class: opts.cls });
  const wrap = h('div', { class: `marked ${opts.fit === 'cover' ? 'fit-cover' : 'fit-contain'}` }, img);
  if (marks.length > 0) {
    const svg = svgEl('svg', { class: 'marks-layer', 'aria-hidden': 'true', preserveAspectRatio: opts.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet' });
    wrap.append(svg);
    wrap.dataset.marks = String(marks.length);
    img.addEventListener('load', () => drawMarks(svg, marks, img.naturalWidth || 1, img.naturalHeight || 1));
  }
  void Promise.resolve(src).then((u) => (img.src = u));
  return wrap;
}
