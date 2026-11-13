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
  /**
   * La plantilla no trae esta página: se arma sobre la página de referencia en
   * blanco, copiando la etiqueta de sección, el título y las formas de los
   * campos de la página `donor` de la misma sección.
   */
  base?: {
    donor: PageType;
    title: { es: string; en: string };
    /**
     * Varios campos apilados (con su encabezado, que se reescribe): cada uno
     * ocupa `share` del alto disponible. Sin `stack`, un solo recuadro ocupa
     * todo el alto.
     */
    stack?: { field: string; share: number; heading: { es: string; en: string } }[];
    /** Encabezado de cada tabla, reescrito. */
    tableHeaders?: Record<string, { es: string[]; en: string[] }>;
    /** Ancho de cada columna (puntos). */
    columnWidthsPt?: Record<string, number[]>;
  };
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

export interface RobotMapMapping {
  section: TemplateSection;
  /** Huella: todas las formas de la página. */
  shapes: string[];
  /** Lugar (puerto, botón) → forma. */
  slots: Record<string, string>;
  footer: { project: string; name: string; date: string; page: string };
  titleBox: { x: number; y: number; w: number; h: number };
  title: { es: string; en: string };
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
  /** Páginas del mapa de puertos del Brain y del mapa del control (Cableado). */
  robotMaps?: Record<'ports' | 'controller', RobotMapMapping>;
  /** Imágenes que se toman de la plantilla (el mapa del campo). */
  templateImages?: { field?: { section: TemplateSection; shapes: string[] } };
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
