/**
 * Lectura de la plantilla: orden de diapositivas, secciones (según los
 * separadores) y búsqueda de páginas modelo por huella.
 */

import type { Language, PageType } from '@vortex-wake/shared';
import {
  defaultFieldMap,
  fixedPageFingerprint,
  pageTypeFingerprint,
  type FieldMap,
  type Fingerprint,
  type FixedPageId,
  type TemplateSection,
} from './field-map.ts';
import { OpcPackage, REL_TYPES, resolveTarget } from './opc.ts';
import { NS, child, children, descendants, elementChildren, parseXml, path, serializeXml, type Element } from './xml.ts';

export const EMU_PER_PT = 12700;

export interface Box {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface ShapeInfo {
  name: string;
  id: number;
  kind: string;
  placeholder?: { type: string; idx?: number };
  tableColumns?: number;
  tableRows?: number;
  box?: Box;
}

export interface TemplateSlide {
  /** Posición en la plantilla, desde 1. */
  index: number;
  part: string;
  section: TemplateSection;
  divider: boolean;
  shapes: ShapeInfo[];
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export class Template {
  readonly pkg: OpcPackage;
  readonly map: FieldMap;
  readonly slides: TemplateSlide[];

  constructor(bytes: Uint8Array, map: FieldMap = defaultFieldMap) {
    this.pkg = OpcPackage.fromBytes(bytes);
    this.map = map;
    this.slides = readSlides(this.pkg, map);
  }

  /** Diapositiva de una sección cuya huella coincide; `undefined` si no hay. */
  findByFingerprint(fp: Fingerprint, section: TemplateSection): TemplateSlide | undefined {
    return this.slides.find((s) => s.section === section && !s.divider && matchesFingerprint(s, fp));
  }

  modelFor(type: PageType, section: TemplateSection, language: Language = 'en'): TemplateSlide {
    if (this.map.pageTypes[type].base) return this.syntheticModel(type, section, language);
    const fp = pageTypeFingerprint(this.map, type);
    const slide = this.findByFingerprint(fp, section);
    if (!slide) {
      throw new TemplateError(
        `La plantilla no tiene la página modelo "${type}" en la sección "${section}" ` +
          `(se busca una diapositiva con las formas ${fp.shapes.join(', ')}). ` +
          'Revisa el mapa de campos (packages/generator/src/field-map.json) o corre `npm test`.',
      );
    }
    return slide;
  }

  fixedPage(id: FixedPageId): TemplateSlide {
    const fp = fixedPageFingerprint(this.map, id);
    const slide = this.findByFingerprint(fp, 'common');
    if (!slide) {
      throw new TemplateError(
        `La plantilla no tiene la página "${id}" antes del primer separador (formas esperadas: ${fp.shapes.join(', ')}).`,
      );
    }
    return slide;
  }

  dividerFor(section: TemplateSection): TemplateSlide {
    const d = this.slides.find((s) => s.divider && s.section === section);
    if (!d) throw new TemplateError(`La plantilla no tiene el separador de la sección "${section}".`);
    return d;
  }

  sectionSlides(section: TemplateSection): TemplateSlide[] {
    return this.slides.filter((s) => s.section === section);
  }

  /** Páginas modelo armadas por el generador (no están en la lista de la plantilla). */
  readonly synthetic: TemplateSlide[] = [];
  private readonly syntheticCache = new Map<string, TemplateSlide>();

  /** Página de referencia en blanco: solo trae los marcadores del pie. */
  blankReference(): TemplateSlide {
    const blank = this.sectionSlides('reference').find((s) => !s.divider && s.shapes.length > 0 && s.shapes.every((sh) => sh.placeholder));
    if (!blank) throw new TemplateError('La plantilla no tiene la página de referencia en blanco (solo con el pie).');
    return blank;
  }

  /**
   * Arma una página modelo que la plantilla no trae: toma la página de
   * referencia en blanco (con su pie) y le copia la etiqueta de sección, el
   * título y las formas de los campos de la página `donor` de la misma sección.
   * El recuadro ocupa desde el primer encabezado de la página donadora hasta el
   * límite inferior del contenido.
   */
  private syntheticModel(type: PageType, section: TemplateSection, language: Language): TemplateSlide {
    const key = `${type}/${section}/${language}`;
    const cached = this.syntheticCache.get(key);
    if (cached) return cached;
    const mapping = this.map.pageTypes[type];
    const base = mapping.base;
    if (!base) throw new TemplateError(`"${type}" no es una página armada`);
    const blank = this.blankReference();
    const donor = this.modelFor(base.donor, section);
    const doc = parseXml(this.pkg.getText(blank.part));
    const root = doc.documentElement as unknown as Element;
    const donorRoot = parseXml(this.pkg.getText(donor.part)).documentElement as unknown as Element;
    const donorShapes = new Map(shapeElements(donorRoot).map((el) => [shapeName(el), el]));
    const std = this.map.standard;
    const skip = new Set([std.label, std.title, ...std.remove, ...std.keep]);
    const top = Math.min(
      ...shapeElements(donorRoot)
        .filter((el) => !skip.has(shapeName(el)) && !descendants(el, NS.p, 'ph')[0])
        .map((el) => readBox(el)?.y ?? Number.POSITIVE_INFINITY),
    );
    const tree = spTreeOf(root);
    let nextId = 1 + Math.max(1, ...descendants(root, NS.p, 'cNvPr').map((c) => Number(c.getAttribute('id') ?? 0)));
    const copy = (name: string): Element => {
      const src = donorShapes.get(name);
      if (!src) throw new TemplateError(`la página "${base.donor}" de "${section}" no tiene la forma "${name}"`);
      const el = doc.importNode(src, true) as unknown as Element;
      cNvPrOf(el)?.setAttribute('id', String(nextId++));
      tree.appendChild(el);
      return el;
    };
    // Etiqueta: solo la sección ("MECÁNICA · DESARROLLAR" → "MECÁNICA").
    const label = copy(std.label);
    replaceText(label, (t) => t.split(' · ')[0] ?? t);
    const title = copy(std.title);
    replaceText(title, () => base.title[language]);
    const fieldShapes = Object.values(mapping.fields);
    const bottom = this.map.contentBottomPt * EMU_PER_PT;
    for (const f of fieldShapes) {
      const el = copy(f.shape);
      writeBox(el, { y: top, cy: bottom - top });
    }
    const part = `ppt/slides/vw-${type}-${section}-${language}.xml`;
    this.pkg.setText(part, serializeXml(doc));
    this.pkg.writeRels(part, this.pkg.readRels(blank.part).filter((r) => r.type !== REL_TYPES.notesSlide));
    const slide: TemplateSlide = { index: blank.index, part, section, divider: false, shapes: readShapes(root) };
    this.syntheticCache.set(key, slide);
    this.synthetic.push(slide);
    return slide;
  }
}

/** Cambia el texto de una forma dejando un solo renglón con el formato del primero. */
function replaceText(shape: Element, change: (current: string) => string): void {
  const runs = descendants(shape, NS.a, 'r');
  const current = runs.map((r) => descendants(r, NS.a, 't').map((t) => t.textContent ?? '').join('')).join('');
  const first = runs[0];
  const t = first ? descendants(first, NS.a, 't')[0] : undefined;
  if (!first || !t || !t.ownerDocument) return;
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument.createTextNode(change(current)));
  for (const r of runs.slice(1)) r.parentNode?.removeChild(r);
  const paras = descendants(shape, NS.a, 'p');
  for (const p of paras) if (p !== first.parentNode) p.parentNode?.removeChild(p);
}

export function matchesFingerprint(slide: TemplateSlide, fp: Fingerprint): boolean {
  const names = slide.shapes.map((s) => s.name).sort();
  if (names.length !== fp.shapes.length) return false;
  for (let i = 0; i < names.length; i++) if (names[i] !== fp.shapes[i]) return false;
  for (const [name, cols] of Object.entries(fp.tables)) {
    const shape = slide.shapes.find((s) => s.name === name);
    if (!shape || shape.tableColumns !== cols) return false;
  }
  return true;
}

function readSlides(pkg: OpcPackage, map: FieldMap): TemplateSlide[] {
  const pres = pkg.getXml('ppt/presentation.xml');
  const rels = pkg.readRels('ppt/presentation.xml');
  const relById = new Map(rels.map((r) => [r.id, r]));
  const sldIdLst = path(pres.documentElement as unknown as Element, [[NS.p, 'sldIdLst']]);
  if (!sldIdLst) throw new TemplateError('la plantilla no tiene diapositivas');
  const slides: TemplateSlide[] = [];
  let dividerCount = 0;
  let section: TemplateSection = 'common';
  children(sldIdLst, NS.p, 'sldId').forEach((sldId, i) => {
    const rid = sldId.getAttributeNS(NS.r, 'id') ?? '';
    const rel = relById.get(rid);
    if (!rel || rel.type !== REL_TYPES.slide) throw new TemplateError(`relación de diapositiva rota: ${rid}`);
    const part = resolveTarget('ppt/presentation.xml', rel.target);
    const doc = pkg.getXml(part);
    const shapes = readShapes(doc.documentElement as unknown as Element);
    const divider = shapes.length === 1 && shapes[0]?.placeholder?.type === 'title';
    if (divider) {
      const next = map.sectionOrder[dividerCount];
      if (!next) throw new TemplateError(`la plantilla tiene más separadores de sección de los esperados (${map.sectionOrder.length})`);
      section = next;
      dividerCount++;
    }
    slides.push({ index: i + 1, part, section, divider, shapes });
  });
  if (dividerCount !== map.sectionOrder.length) {
    throw new TemplateError(
      `la plantilla tiene ${dividerCount} separadores de sección y el mapa espera ${map.sectionOrder.length} (${map.sectionOrder.join(', ')})`,
    );
  }
  return slides;
}

export function spTreeOf(slideRoot: Element): Element {
  const tree = path(slideRoot, [
    [NS.p, 'cSld'],
    [NS.p, 'spTree'],
  ]);
  if (!tree) throw new TemplateError('diapositiva sin árbol de formas');
  return tree;
}

const SHAPE_KINDS = new Set(['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp']);

export function shapeElements(slideRoot: Element): Element[] {
  return elementChildren(spTreeOf(slideRoot)).filter((e) => e.namespaceURI === NS.p && SHAPE_KINDS.has(e.localName ?? ''));
}

export function cNvPrOf(shape: Element): Element | undefined {
  const nv = elementChildren(shape).find((e) => (e.localName ?? '').startsWith('nv'));
  return nv ? child(nv, NS.p, 'cNvPr') : undefined;
}

export function shapeName(shape: Element): string {
  return cNvPrOf(shape)?.getAttribute('name') ?? '';
}

export function readShapes(slideRoot: Element): ShapeInfo[] {
  return shapeElements(slideRoot).map((el) => {
    const c = cNvPrOf(el);
    const info: ShapeInfo = {
      name: c?.getAttribute('name') ?? '',
      id: Number(c?.getAttribute('id') ?? 0),
      kind: el.localName ?? '',
    };
    const ph = descendants(el, NS.p, 'ph')[0];
    if (ph) {
      const idx = ph.getAttribute('idx');
      info.placeholder = { type: ph.getAttribute('type') || 'body', ...(idx !== null && idx !== '' ? { idx: Number(idx) } : {}) };
    }
    const tbl = descendants(el, NS.a, 'tbl')[0];
    if (tbl) {
      info.tableColumns = descendants(tbl, NS.a, 'gridCol').length;
      info.tableRows = children(tbl, NS.a, 'tr').length;
    }
    const box = readBox(el);
    if (box) info.box = box;
    return info;
  });
}

/** Posición y tamaño (EMU) de una forma, si los declara. */
export function readBox(shape: Element): Box | undefined {
  const xfrm =
    shape.localName === 'graphicFrame'
      ? child(shape, NS.p, 'xfrm')
      : (() => {
          const spPr = child(shape, NS.p, 'spPr') ?? child(shape, NS.p, 'grpSpPr');
          return spPr ? child(spPr, NS.a, 'xfrm') : undefined;
        })();
  if (!xfrm) return undefined;
  const off = child(xfrm, NS.a, 'off');
  const ext = child(xfrm, NS.a, 'ext');
  if (!off || !ext) return undefined;
  return {
    x: Number(off.getAttribute('x')),
    y: Number(off.getAttribute('y')),
    cx: Number(ext.getAttribute('cx')),
    cy: Number(ext.getAttribute('cy')),
  };
}

export function writeBox(shape: Element, box: Partial<Box>): void {
  const xfrm =
    shape.localName === 'graphicFrame'
      ? child(shape, NS.p, 'xfrm')
      : (() => {
          const spPr = child(shape, NS.p, 'spPr');
          return spPr ? child(spPr, NS.a, 'xfrm') : undefined;
        })();
  if (!xfrm) throw new TemplateError(`la forma "${shapeName(shape)}" no tiene posición`);
  const off = child(xfrm, NS.a, 'off');
  const ext = child(xfrm, NS.a, 'ext');
  if (!off || !ext) throw new TemplateError(`la forma "${shapeName(shape)}" no tiene posición`);
  if (box.x !== undefined) off.setAttribute('x', String(Math.round(box.x)));
  if (box.y !== undefined) off.setAttribute('y', String(Math.round(box.y)));
  if (box.cx !== undefined) ext.setAttribute('cx', String(Math.round(box.cx)));
  if (box.cy !== undefined) ext.setAttribute('cy', String(Math.round(box.cy)));
}
