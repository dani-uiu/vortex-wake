/**
 * Lectura de la plantilla: orden de diapositivas, secciones (según los
 * separadores) y búsqueda de páginas modelo por huella.
 */

import type { PageType } from '@vortex-wake/shared';
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
import { NS, child, children, descendants, elementChildren, path, type Element } from './xml.ts';

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

  modelFor(type: PageType, section: TemplateSection): TemplateSlide {
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
