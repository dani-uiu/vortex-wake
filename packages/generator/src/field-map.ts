/**
 * Mapa de campos: qué forma de la diapositiva modelo corresponde a cada campo
 * del documento. Los datos viven en `field-map.json`; aquí están los tipos y
 * las funciones que derivan la "huella" de cada página modelo.
 */

import type { PageType } from '@vortex-wake/shared';
import raw from './field-map.json' with { type: 'json' };

export type TemplateSection = 'common' | 'organization' | 'mechanics' | 'coding' | 'wiring' | 'strategy' | 'reference';

export interface PlaceholderRef {
  type: string;
  idx?: number;
}

export interface FieldMapping {
  heading?: string;
  shape: string;
}

export interface StandardDefaults {
  label: string;
  title: string;
  remove: string[];
  keep: string[];
  areaFontSizePt: number;
  areaColor: string;
  cellFontSizePt: number;
  cellColor: string;
}

export interface PageTypeMapping {
  /** `common`, `organization` o `any` (cualquiera de las cuatro secciones). */
  section: 'common' | 'organization' | 'any';
  /** Columnas de cada tabla de la página modelo (parte de la huella). */
  tables: Record<string, number>;
  /** Formas que se dejan como están. */
  keep?: string[];
  /** Formas cuyo texto se borra (instrucciones). */
  clear?: string[];
  fields: Record<string, FieldMapping>;
}

export interface TocMapping {
  shape: string;
  firstLineTopPt: number;
  lineSpacingPt: number;
  linesPerPage: number;
  fontSizePt: number;
  titleTabPt: number;
  dateTabPt: number;
}

export interface FixedPageMapping {
  section: 'common';
  shapes: string[];
  remove: string[];
  text: Record<string, string>;
  photo?: string;
  toc?: TocMapping;
}

export type FixedPageId = 'cover' | 'coverPhoto' | 'resources' | 'tableOfContents';

export interface FieldMap {
  version: number;
  sectionOrder: TemplateSection[];
  contentBottomPt: number;
  footer: { project: PlaceholderRef; name: PlaceholderRef; date: PlaceholderRef; page: PlaceholderRef };
  standard: StandardDefaults;
  pageTypes: Record<PageType, PageTypeMapping>;
  fixedPages: Record<FixedPageId, FixedPageMapping>;
}

export const defaultFieldMap = raw as unknown as FieldMap;

export interface Fingerprint {
  /** Conjunto exacto de nombres de formas de la diapositiva modelo. */
  shapes: string[];
  /** Columnas de cada tabla. */
  tables: Record<string, number>;
}

/** Huella de una página modelo estándar: todas las formas que el mapa menciona. */
export function pageTypeFingerprint(map: FieldMap, type: PageType): Fingerprint {
  const m = map.pageTypes[type];
  const names = new Set<string>([map.standard.label, map.standard.title, ...map.standard.remove, ...map.standard.keep]);
  for (const n of m.keep ?? []) names.add(n);
  for (const n of m.clear ?? []) names.add(n);
  for (const f of Object.values(m.fields)) {
    names.add(f.shape);
    if (f.heading) names.add(f.heading);
  }
  return { shapes: [...names].sort(), tables: m.tables };
}

export function fixedPageFingerprint(map: FieldMap, id: FixedPageId): Fingerprint {
  return { shapes: [...map.fixedPages[id].shapes].sort(), tables: {} };
}
