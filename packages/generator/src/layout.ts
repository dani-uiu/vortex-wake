/**
 * Acomodo del contenido en una página modelo.
 *
 * Estrategia de desborde (simple y explícita):
 *
 * 1. Cada campo es un bloque (encabezado + recuadro o tabla) con la posición
 *    que trae la página modelo. Los bloques que empiezan a la misma altura
 *    forman un renglón (por ejemplo, los dos recuadros de abajo del plan de
 *    autónomo).
 * 2. Se mide el alto de cada bloque en tres medidas: el de la plantilla, el
 *    preferido (todo el contenido con filas de tabla a su alto de plantilla y
 *    fotos de buen tamaño) y el mínimo (filas de tabla compactas, recuadros
 *    vacíos reducidos, fotos con un lado mínimo legible de 60 pt).
 * 3. Si todo cabe a su alto preferido arriba del pie de página, se usa ese:
 *    los bloques que necesitan más crecen y empujan a los de abajo.
 * 4. Si no cabe, primero se quita el espacio vacío de los recuadros y las
 *    filas de relleno de las tablas, después se compactan las filas y las
 *    fotos hasta su mínimo, y al final se reparte el alto de arriba hacia
 *    abajo.
 * 5. Lo que aun así no cabe (líneas de texto, filas de tabla, fotos) pasa a
 *    una página de continuación del mismo tipo, que solo trae los campos que
 *    se desbordaron, apilados desde arriba. La continuación se acomoda con
 *    las mismas reglas, así que puede haber varias.
 *
 * Límites: la medida es aproximada (ver measure.ts) y el texto nunca se
 * achica. Las tablas de filas fijas (primera columna con etiquetas) no se
 * parten. Un renglón no se parte a la mitad de una celda: una celda con más
 * texto del que cabe en una página completa se sale del cuadro.
 */

import { CAPTION_HEIGHT_PT, layoutGrid, type GridLayout } from './images.ts';
import type { FieldMapping, StandardDefaults } from './field-map.ts';
import { lineHeightPt, splitTextByLines, wrapText, type FontSpec } from './measure.ts';
import type { AreaData, FieldData, ResolvedImage, TableData } from './plan.ts';
import { EMU_PER_PT, readBox, shapeElements, shapeName } from './template.ts';
import { NS, child, children, descendants, type Element } from './xml.ts';

export interface BoxPt {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface AreaGeom {
  kind: 'area';
  box: BoxPt;
  insets: Insets;
}

export interface TableGeom {
  kind: 'table';
  box: BoxPt;
  colWidths: number[];
  headerHeight: number;
  /** Alto de cada fila de datos de la plantilla. */
  rowHeights: number[];
  margins: Insets;
  /** Etiquetas de la primera columna (tablas de filas fijas). */
  labels: string[];
  /** Textos del encabezado, para medir su alto. */
  headerLabels: string[];
}

export interface BlockGeom {
  key: string;
  heading?: BoxPt;
  content: AreaGeom | TableGeom;
}

export interface ModelGeom {
  blocks: BlockGeom[];
  bottomLimit: number;
}

export const MIN_IMAGE_SIDE_PT = 60;
const TEXT_IMAGE_GAP_PT = 4;
const ROW_GAP_PT = 8;

const emuToPt = (v: number) => v / EMU_PER_PT;

function boxPt(el: Element): BoxPt {
  const b = readBox(el);
  if (!b) throw new Error(`la forma "${shapeName(el)}" no tiene posición en la plantilla`);
  return { x: emuToPt(b.x), y: emuToPt(b.y), w: emuToPt(b.cx), h: emuToPt(b.cy) };
}

function attrPt(el: Element | undefined, name: string, defEmu: number): number {
  const v = el?.getAttribute(name);
  return emuToPt(v !== null && v !== undefined && v !== '' ? Number(v) : defEmu);
}

/** Lee la geometría de los bloques de una página modelo. */
export function readModelGeometry(slideRoot: Element, fields: Record<string, FieldMapping>, bottomLimit: number): ModelGeom {
  const byName = new Map(shapeElements(slideRoot).map((el) => [shapeName(el), el]));
  const blocks: BlockGeom[] = [];
  for (const [key, f] of Object.entries(fields)) {
    const el = byName.get(f.shape);
    if (!el) throw new Error(`la página modelo no tiene la forma "${f.shape}" (campo ${key})`);
    const headingEl = f.heading ? byName.get(f.heading) : undefined;
    if (f.heading && !headingEl) throw new Error(`la página modelo no tiene la forma "${f.heading}" (encabezado de ${key})`);
    const tbl = descendants(el, NS.a, 'tbl')[0];
    let content: AreaGeom | TableGeom;
    if (tbl) {
      const cols = descendants(tbl, NS.a, 'gridCol').map((c) => emuToPt(Number(c.getAttribute('w'))));
      const trs = children(tbl, NS.a, 'tr');
      const heights = trs.map((tr) => emuToPt(Number(tr.getAttribute('h'))));
      const firstDataCell = trs[1] ? children(trs[1], NS.a, 'tc')[0] : undefined;
      const tcPr = firstDataCell ? child(firstDataCell, NS.a, 'tcPr') : undefined;
      content = {
        kind: 'table',
        box: boxPt(el),
        colWidths: cols,
        headerHeight: heights[0] ?? 20,
        rowHeights: heights.slice(1),
        margins: {
          l: attrPt(tcPr, 'marL', 91440),
          r: attrPt(tcPr, 'marR', 91440),
          t: attrPt(tcPr, 'marT', 45720),
          b: attrPt(tcPr, 'marB', 45720),
        },
        labels: trs.slice(1).map((tr) => cellText(children(tr, NS.a, 'tc')[0])),
        headerLabels: trs[0] ? children(trs[0], NS.a, 'tc').map((tc) => cellText(tc)) : [],
      };
    } else {
      const bodyPr = descendants(el, NS.a, 'bodyPr')[0];
      content = {
        kind: 'area',
        box: boxPt(el),
        insets: {
          l: attrPt(bodyPr, 'lIns', 91440),
          r: attrPt(bodyPr, 'rIns', 91440),
          t: attrPt(bodyPr, 'tIns', 45720),
          b: attrPt(bodyPr, 'bIns', 45720),
        },
      };
    }
    const block: BlockGeom = { key, content };
    if (headingEl) block.heading = boxPt(headingEl);
    blocks.push(block);
  }
  return { blocks, bottomLimit };
}

function cellText(tc: Element | undefined): string {
  if (!tc) return '';
  return descendants(tc, NS.a, 'p')
    .map((p) => descendants(p, NS.a, 't').map((t) => t.textContent ?? '').join(''))
    .join('\n');
}

// --- Medida con referencias ---------------------------------------------

/**
 * Las referencias `{{page:ID}}` se miden como si fueran "W-000" (el número
 * más ancho razonable) para que la decisión de desborde no dependa de la
 * numeración. Se cambian por un carácter de uso privado al medir y se
 * regresan al partir el texto.
 */
function encodeRefs(text: string): { encoded: string; decode: (s: string) => string } {
  const tokens: string[] = [];
  const encoded = text.replace(/\{\{page:[A-Za-z0-9_.-]+\}\}/g, (t) => {
    tokens.push(t);
    return String.fromCharCode(0xe000 + tokens.length - 1);
  });
  const decode = (s: string) => s.replace(/[-]/g, (ch) => tokens[ch.charCodeAt(0) - 0xe000] ?? '');
  return { encoded, decode };
}

export function areaFont(style: StandardDefaults, code: boolean): FontSpec {
  return code ? { sizePt: style.areaFontSizePt - 1, mono: true } : { sizePt: style.areaFontSizePt };
}

export function cellFont(style: StandardDefaults): FontSpec {
  return { sizePt: style.cellFontSizePt };
}

function countLines(text: string, widthPt: number, font: FontSpec): number {
  if (text === '') return 0;
  return wrapText(encodeRefs(text).encoded, widthPt, font).length;
}


// --- Medidas de cada bloque ------------------------------------------------

/** Alto del contenido de un bloque (sin el encabezado), en varias medidas. */
export interface Sizes {
  natural: number;
  preferred: number;
  /** Alto del contenido sin el piso de la plantilla (para quitar espacio vacío). */
  content: number;
  minimum: number;
}

/** Alto preferido de una rejilla de fotos cuando hay espacio. */
const PREFERRED_IMAGE_HEIGHT_PT = 170;
/** Alto mínimo de un recuadro de texto cuando hay que hacer espacio. */
const MIN_AREA_HEIGHT_PT = 30;
/** Las zonas de fotos no se encogen por debajo de esto (si la plantilla las trae más grandes). */
const MIN_PHOTO_ZONE_PT = 120;

export interface AreaPlacement {
  text: string;
  code: boolean;
  images: ResolvedImage[];
  /** Rejilla de fotos relativa a la esquina del recuadro (en puntos). */
  grid?: GridLayout;
  gridOrigin?: { x: number; y: number };
}

function innerWidth(g: AreaGeom): number {
  return g.box.w - g.insets.l - g.insets.r;
}

function aspects(images: ResolvedImage[]): number[] {
  return images.map((i) => (i.info.height > 0 ? i.info.width / i.info.height : 1));
}

function captions(images: ResolvedImage[]): boolean[] {
  return images.map((i) => !!i.caption);
}

/** Alto mínimo de la rejilla para que todas las fotos tengan un lado legible. */
function minGridHeight(images: ResolvedImage[], width: number): number {
  for (let h = 40; h <= 2000; h += 6) {
    if (layoutGrid(aspects(images), captions(images), width, h).minSide >= MIN_IMAGE_SIDE_PT) return h;
  }
  return 2000;
}

export function areaSizes(g: AreaGeom, data: AreaData, style: StandardDefaults): Sizes {
  const font = areaFont(style, data.code);
  const textH = countLines(data.text, innerWidth(g), font) * lineHeightPt(font);
  const base = g.insets.t + g.insets.b + textH;
  const natural = g.box.h;
  if (data.images.length === 0) {
    return { natural, preferred: Math.max(natural, base), content: base, minimum: Math.max(base, MIN_AREA_HEIGHT_PT) };
  }
  const gap = textH > 0 ? TEXT_IMAGE_GAP_PT : 0;
  const minGrid = minGridHeight(data.images, innerWidth(g));
  const minNeed = base + gap + minGrid;
  const prefNeed = base + gap + Math.max(minGrid, PREFERRED_IMAGE_HEIGHT_PT);
  return {
    natural,
    preferred: Math.max(natural, prefNeed),
    content: prefNeed,
    minimum: Math.max(minNeed, Math.min(natural, base + gap + MIN_PHOTO_ZONE_PT)),
  };
}

export function areaFit(
  g: AreaGeom,
  data: AreaData,
  height: number,
  style: StandardDefaults,
  force: boolean,
): { placed: AreaPlacement; rest: AreaData | null } {
  const font = areaFont(style, data.code);
  const lh = lineHeightPt(font);
  const width = innerWidth(g);
  const inner = height - g.insets.t - g.insets.b;
  const { encoded, decode } = encodeRefs(data.text);
  const totalLines = data.text === '' ? 0 : wrapText(encoded, width, font).length;
  const maxLines = Math.max(0, Math.floor((inner + 0.01) / lh));

  if (totalLines > maxLines) {
    const take = force && maxLines === 0 ? 1 : maxLines;
    const split = splitTextByLines(encoded, width, font, take);
    return {
      placed: { text: decode(split.fitted), code: data.code, images: [] },
      rest: { kind: 'area', text: decode(split.rest), code: data.code, images: data.images },
    };
  }

  const textH = totalLines * lh;
  const placed: AreaPlacement = { text: data.text, code: data.code, images: [] };
  if (data.images.length === 0) return { placed, rest: null };

  const gap = textH > 0 ? TEXT_IMAGE_GAP_PT : 0;
  const avail = inner - textH - gap;
  let k = data.images.length;
  let grid: GridLayout | undefined;
  while (k > 0) {
    const imgs = data.images.slice(0, k);
    if (avail > 0) {
      const gl = layoutGrid(aspects(imgs), captions(imgs), width, avail);
      if (gl.minSide >= MIN_IMAGE_SIDE_PT) {
        grid = gl;
        break;
      }
    }
    k--;
  }
  if (!grid && force) {
    k = 1;
    grid = layoutGrid(aspects(data.images.slice(0, 1)), captions(data.images.slice(0, 1)), width, Math.max(avail, MIN_IMAGE_SIDE_PT));
  }
  if (grid) {
    placed.images = data.images.slice(0, k);
    placed.grid = grid;
    placed.gridOrigin = { x: g.insets.l, y: g.insets.t + textH + gap };
  }
  const restImages = data.images.slice(k);
  return { placed, rest: restImages.length > 0 ? { kind: 'area', text: '', code: data.code, images: restImages } : null };
}

// --- Tablas ----------------------------------------------------------------

export interface TablePlacement {
  /** Filas de datos (todas las columnas, ya con etiquetas si es de filas fijas). */
  rows: string[][];
  rowHeights: number[];
  headerHeight: number;
  fixed: boolean;
}

/** Alto de una fila según el texto de sus celdas; nunca menos que `floor`. */
function rowHeight(cells: string[], g: TableGeom, floor: number, font: FontSpec): number {
  let maxLines = 1;
  cells.forEach((c, i) => {
    const w = (g.colWidths[i] ?? 50) - g.margins.l - g.margins.r;
    maxLines = Math.max(maxLines, countLines(c, w, font));
  });
  return Math.max(floor, maxLines * lineHeightPt(font) + g.margins.t + g.margins.b + 2);
}

function fullRows(g: TableGeom, data: TableData): string[][] {
  if (!data.fixed) return data.rows.map((r) => g.colWidths.map((_, i) => r[i] ?? ''));
  return g.labels.map((label, i) => [label, ...g.colWidths.slice(1).map((_, j) => data.rows[i]?.[j] ?? '')]);
}

function nominalRowHeight(g: TableGeom, i: number): number {
  return g.rowHeights[Math.min(i, g.rowHeights.length - 1)] ?? 22;
}

interface TableMetrics {
  rows: string[][];
  header: number;
  nominal: number[];
  compact: number[];
}

function tableMetrics(g: TableGeom, data: TableData, style: StandardDefaults): TableMetrics {
  const font = cellFont(style);
  const rows = fullRows(g, data);
  return {
    rows,
    // El encabezado puede ocupar dos renglones (por ejemplo "Robot / code version").
    header: rowHeight(g.headerLabels, g, g.headerHeight, { ...font, bold: true }),
    nominal: rows.map((r, i) => rowHeight(r, g, nominalRowHeight(g, i), font)),
    compact: rows.map((r) => rowHeight(r, g, 0, font)),
  };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function tableSizes(g: TableGeom, data: TableData, style: StandardDefaults, pad: boolean): Sizes {
  const m = tableMetrics(g, data, style);
  let padding = 0;
  if (pad && !data.fixed) for (let i = m.rows.length; i < g.rowHeights.length; i++) padding += nominalRowHeight(g, i);
  const content = m.header + sum(m.nominal);
  const natural = g.box.h;
  return {
    natural,
    preferred: Math.max(pad ? natural : 0, content + padding),
    content,
    minimum: m.header + sum(m.compact),
  };
}

export function tableFit(
  g: TableGeom,
  data: TableData,
  height: number,
  style: StandardDefaults,
  pad: boolean,
  force: boolean,
): { placed: TablePlacement; rest: TableData | null } {
  const m = tableMetrics(g, data, style);
  const fits = (heights: number[]) => {
    let used = m.header;
    let n = 0;
    while (n < heights.length && used + (heights[n] as number) <= height + 0.01) {
      used += heights[n] as number;
      n++;
    }
    return { n, used };
  };
  // Primero con el alto de la plantilla; si no caben todas, filas compactas.
  let heights = m.nominal;
  let r = fits(heights);
  if (r.n < m.rows.length) {
    const c = fits(m.compact);
    if (c.n === m.rows.length) {
      // Caben todas compactas: se reparten las filas entre el alto compacto y
      // el de la plantilla, para usar el espacio disponible.
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 20; i++) {
        const s = (lo + hi) / 2;
        const hs = m.rows.map((_, j) => Math.max(m.compact[j] as number, (m.nominal[j] as number) * s));
        if (m.header + sum(hs) <= height + 0.01) lo = s;
        else hi = s;
      }
      heights = m.rows.map((_, j) => Math.max(m.compact[j] as number, (m.nominal[j] as number) * lo));
      r = fits(heights);
    } else if (c.n > r.n || data.fixed) {
      heights = m.compact;
      r = c;
    }
  }
  if (data.fixed) {
    // Las filas fijas no se parten: van todas, compactas si hace falta.
    return { placed: { rows: m.rows, rowHeights: heights, headerHeight: m.header, fixed: true }, rest: null };
  }
  let { n, used } = r;
  if (n === 0 && m.rows.length > 0 && force) {
    n = 1;
    used += heights[0] as number;
  }
  const placedRows = m.rows.slice(0, n);
  const placedHeights = heights.slice(0, n);
  if (n === m.rows.length && pad) {
    for (let i = n; i < g.rowHeights.length; i++) {
      const h = nominalRowHeight(g, i);
      if (used + h > height + 0.01) break;
      placedRows.push(g.colWidths.map(() => ''));
      placedHeights.push(h);
      used += h;
    }
  }
  const restRows = data.rows.slice(n);
  return {
    placed: { rows: placedRows, rowHeights: placedHeights, headerHeight: m.header, fixed: false },
    rest: restRows.length > 0 ? { kind: 'table', rows: restRows, fixed: false } : null,
  };
}

// --- Página completa -------------------------------------------------------

export interface BlockPlacement {
  key: string;
  headingBox?: BoxPt;
  box: BoxPt;
  area?: AreaPlacement;
  table?: TablePlacement;
}

export interface PageLayout {
  placements: BlockPlacement[];
  overflow: Record<string, FieldData> | null;
}

function blockTop(b: BlockGeom): number {
  return Math.min(b.heading?.y ?? Infinity, b.content.box.y);
}

function emptyData(b: BlockGeom): FieldData {
  return b.content.kind === 'area' ? { kind: 'area', text: '', code: false, images: [] } : { kind: 'table', rows: [], fixed: false };
}

interface RowPlan {
  blocks: BlockGeom[];
  top: number;
  /** Distancia del inicio del renglón al inicio del contenido de cada bloque. */
  offsets: number[];
  natural: number;
  preferred: number;
  content: number;
  minimum: number;
  gapAfter: number;
}

/**
 * Acomoda los campos `fields` en la página modelo. En una continuación solo
 * se usan los bloques de esos campos, apilados desde arriba.
 *
 * Si las fotos de un recuadro no alcanzan a entrar, se vuelve a acomodar la
 * página sin ellas (el recuadro ya no reserva su espacio y lo aprovechan los
 * demás) y las fotos pasan completas a la continuación.
 */
export function layoutPage(
  geom: ModelGeom,
  fields: Record<string, FieldData>,
  style: StandardDefaults,
  continuation: boolean,
): PageLayout {
  const deferred = new Map<string, ResolvedImage[]>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const current: Record<string, FieldData> = {};
    for (const [k, v] of Object.entries(fields)) {
      current[k] = v.kind === 'area' && deferred.has(k) ? { ...v, images: [] } : v;
    }
    const res = layoutOnce(geom, current, style, continuation);
    let changed = false;
    for (const p of res.placements) {
      const data = current[p.key];
      if (!p.area || !data || data.kind !== 'area' || data.images.length === 0) continue;
      if (p.area.images.length === 0 && !(continuation && Object.keys(current).length === 1)) {
        deferred.set(p.key, data.images);
        changed = true;
      }
    }
    if (changed) continue;
    if (deferred.size === 0) return res;
    const overflow: Record<string, FieldData> = { ...(res.overflow ?? {}) };
    for (const [k, imgs] of deferred) {
      const prev = overflow[k];
      const base = fields[k] as AreaData;
      overflow[k] = {
        kind: 'area',
        text: prev && prev.kind === 'area' ? prev.text : '',
        code: base.code,
        images: [...imgs, ...(prev && prev.kind === 'area' ? prev.images : [])],
      };
    }
    return { placements: res.placements, overflow };
  }
  return layoutOnce(geom, fields, style, continuation);
}

function layoutOnce(
  geom: ModelGeom,
  fields: Record<string, FieldData>,
  style: StandardDefaults,
  continuation: boolean,
): PageLayout {
  const all = [...geom.blocks].sort((a, b) => blockTop(a) - blockTop(b));
  const firstTop = all.length > 0 ? blockTop(all[0] as BlockGeom) : 0;
  const blocks = continuation ? all.filter((b) => fields[b.key] !== undefined) : all;
  const pad = !continuation;
  const alone = continuation && blocks.length === 1;

  // Renglones: bloques que empiezan a la misma altura.
  const groups: BlockGeom[][] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(blockTop(last[0] as BlockGeom) - blockTop(b)) < 3) last.push(b);
    else groups.push([b]);
  }

  const rows: RowPlan[] = groups.map((group, gi) => {
    const top = Math.min(...group.map(blockTop));
    const offsets = group.map((b) => b.content.box.y - top);
    let natural = 0;
    let preferred = 0;
    let content = 0;
    let minimum = 0;
    group.forEach((b, i) => {
      const data = fields[b.key] ?? emptyData(b);
      const s =
        b.content.kind === 'area' && data.kind === 'area'
          ? areaSizes(b.content, data, style)
          : b.content.kind === 'table' && data.kind === 'table'
            ? tableSizes(b.content, data, style, pad)
            : { natural: b.content.box.h, preferred: b.content.box.h, content: b.content.box.h, minimum: b.content.box.h };
      const off = offsets[i] as number;
      natural = Math.max(natural, off + s.natural);
      preferred = Math.max(preferred, off + s.preferred);
      content = Math.max(content, off + s.content);
      minimum = Math.max(minimum, off + s.minimum);
    });
    const next = groups[gi + 1];
    const gapAfter = continuation || !next ? ROW_GAP_PT : Math.max(0, Math.min(...next.map(blockTop)) - (top + natural));
    return { blocks: group, top, offsets, natural, preferred, content, minimum, gapAfter };
  });

  // Alto disponible para el contenido de todos los renglones.
  const gaps = sum(rows.slice(0, -1).map((r) => r.gapAfter));
  const avail = geom.bottomLimit - firstTop - gaps;
  const heights = rows.map((r) => r.preferred);
  let excess = sum(heights) - avail;
  // 1. Quitar espacio vacío (recuadros más grandes que su texto, filas de relleno).
  for (let i = rows.length - 1; i >= 0 && excess > 0; i--) {
    const r = rows[i] as RowPlan;
    const floor = Math.max(r.minimum, Math.min(r.content, heights[i] as number));
    const cut = Math.min(excess, (heights[i] as number) - floor);
    if (cut > 0) {
      heights[i] = (heights[i] as number) - cut;
      excess -= cut;
    }
  }
  // 2. Compactar hasta el mínimo.
  for (let i = rows.length - 1; i >= 0 && excess > 0; i--) {
    const r = rows[i] as RowPlan;
    const cut = Math.min(excess, (heights[i] as number) - r.minimum);
    if (cut > 0) {
      heights[i] = (heights[i] as number) - cut;
      excess -= cut;
    }
  }
  // 3. Repartir de arriba hacia abajo; lo que no quepa se desborda.
  if (excess > 0) {
    let remaining = avail;
    rows.forEach((_r, i) => {
      const floorRest = sum(rows.slice(i + 1).map((x) => Math.min(x.minimum, x.natural)));
      const h = Math.max(0, Math.min(heights[i] as number, remaining - floorRest));
      heights[i] = h;
      remaining -= h;
    });
  }

  const placements: BlockPlacement[] = [];
  const overflow: Record<string, FieldData> = {};
  let y = firstTop;
  rows.forEach((r, ri) => {
    const rowH = heights[ri] as number;
    const shift = y - r.top;
    r.blocks.forEach((b, bi) => {
      const data = fields[b.key] ?? emptyData(b);
      const contentH = Math.max(0, rowH - (r.offsets[bi] as number));
      const box: BoxPt = { ...b.content.box, y: b.content.box.y + shift, h: contentH };
      const placement: BlockPlacement = { key: b.key, box };
      if (b.heading) placement.headingBox = { ...b.heading, y: b.heading.y + shift };
      if (b.content.kind === 'area' && data.kind === 'area') {
        const res = areaFit(b.content, data, contentH, style, alone);
        placement.area = res.placed;
        if (res.rest) overflow[b.key] = res.rest;
      } else if (b.content.kind === 'table' && data.kind === 'table') {
        const res = tableFit(b.content, data, contentH, style, pad, alone);
        placement.table = res.placed;
        box.h = res.placed.headerHeight + sum(res.placed.rowHeights);
        if (res.rest) overflow[b.key] = res.rest;
      }
      placements.push(placement);
    });
    y += rowH + r.gapAfter;
  });

  return { placements, overflow: Object.keys(overflow).length > 0 ? overflow : null };
}

export { CAPTION_HEIGHT_PT };
