/**
 * Documento de páginas que consume el generador.
 *
 * Es el resultado de "armar páginas": cada página ya tiene su tipo, su sección,
 * su fecha, sus autores y el contenido de cada campo. El generador no inventa
 * contenido; solo lo acomoda en la plantilla, numera y arma las páginas
 * automáticas (tabla de contenido, integrantes, cronología, registro de
 * cambios y créditos).
 *
 * Referencias entre páginas: dentro de cualquier texto se escribe
 * `{{page:ID}}` y el generador lo cambia por el número de esa página con el
 * esquema de numeración activo (por ejemplo `M-4` o `27`).
 */

import type { IsoDate, SectionId } from './model.ts';

export type { IsoDate, SectionId };

export const NOTEBOOK_FORMAT = 'vortex-wake/notebook';
export const NOTEBOOK_VERSION = 1;

export type Language = 'es' | 'en';

export interface NotebookDocument {
  format: typeof NOTEBOOK_FORMAT;
  version: typeof NOTEBOOK_VERSION;
  /** Idioma de la plantilla y de los textos que agrega el generador. */
  language: Language;
  /** Va en el pie de cada página, en el campo "Proyecto". */
  project: string;
  team: { number: string; name: string; school?: string };
  season: { start: IsoDate; end: IsoDate; book?: number; books?: number };
  /** Con foto se usa la portada alterna de la plantilla (la que tiene espacio para foto). */
  cover?: { photo?: ImageRef };
  members: NotebookMember[];
  /** Integrantes que firman las páginas automáticas (quienes arman la bitácora). */
  editors?: string[];
  sessions?: NotebookSession[];
  pages: NotebookPage[];
}

export interface NotebookMember {
  id: string;
  name: string;
  roles: string[];
  /** Grado escolar o años en VEX, tal como se quiera mostrar. */
  grade?: string;
  initials: string;
}

export interface NotebookSession {
  date: IsoDate;
  /** Reunión o evento: "Taller", "Torneo regional"... */
  event: string;
  summary: string;
}

export interface ImageRef {
  /** Ruta del archivo PNG o JPEG, relativa al documento. */
  src: string;
  caption?: string;
}

/** Contenido de un recuadro: texto (párrafos separados por `\n`) y fotos. */
export interface AreaContent {
  text?: string;
  /** Mostrar el texto con letra monoespaciada (pseudocódigo). */
  code?: boolean;
  images?: ImageRef[];
}

export type AreaValue = string | AreaContent;
export type TableValue = string[][];
export type FieldValue = AreaValue | TableValue;

export interface ChangeRecord {
  /** Si falta, se usa la fecha de la página. */
  date?: IsoDate;
  change: string;
  /** Página de la prueba que motivó el cambio. */
  test?: string;
  /** Datos de la prueba que motivó el cambio. */
  evidence?: string;
  result?: string;
}

export interface CreditRecord {
  /** Nombre, autor y enlace de la fuente. */
  source: string;
  used: string;
  changes?: string;
}

export interface NotebookPage {
  id: string;
  type: PageType;
  /** Obligatoria en las páginas de sección. */
  section?: SectionId;
  date: IsoDate;
  /** Ids de integrantes. */
  authors: string[];
  /** Reemplaza el título completo de la página modelo. */
  title?: string;
  /** Reemplaza `[subsystem]` en el título de la página modelo. */
  subsystem?: string;
  /** Hilo de iteraciones (solo construcción). Numera `#__` por orden de fecha. */
  thread?: string;
  /** Número de iteración explícito; si falta, sale del hilo. */
  iteration?: number;
  fields?: Record<string, FieldValue>;
  /** Cambios que van al registro de cambios de la sección. */
  changes?: ChangeRecord[];
  /** Fuentes externas que van al resumen de créditos. */
  credits?: CreditRecord[];
}

export type FieldKind = 'area' | 'table' | 'fixedTable';

export interface FieldSpec {
  kind: FieldKind;
  /**
   * Columnas que llena el documento. En `fixedTable` la primera columna de la
   * plantilla ya trae etiquetas, y el documento llena las demás.
   */
  columns?: number;
  /** Máximo de filas (solo `fixedTable`). */
  maxRows?: number;
  /** Lo llena el generador; el documento no lo puede traer. */
  automatic?: boolean;
}

export type Placement = 'common' | 'organization' | 'section';

export interface PageTypeSpec {
  placement: Placement;
  /** Secciones donde la plantilla trae esta página modelo. */
  sections?: SectionId[];
  fields: Record<string, FieldSpec>;
  /** La página entera la arma el generador; no puede venir en el documento. */
  automatic?: boolean;
  /** El título lleva número de iteración (`#__`). */
  iterated?: boolean;
}

const area: FieldSpec = { kind: 'area' };
const table = (columns: number): FieldSpec => ({ kind: 'table', columns });
const fixed = (columns: number, maxRows: number): FieldSpec => ({ kind: 'fixedTable', columns, maxRows });

export const SECTIONS: readonly SectionId[] = ['mechanics', 'coding', 'wiring', 'strategy'];

/** Tipos de página y sus campos. El mapa de campos de la plantilla debe coincidir. */
export const PAGE_TYPES = {
  seasonSummary: {
    placement: 'common',
    fields: { teamAndGoals: area, highlights: table(3), biggestChanges: area, lessons: area },
  },
  codeSummary: {
    placement: 'common',
    fields: { overview: area, programs: table(3), sensors: table(3), algorithms: area, details: area },
  },
  creditSummary: {
    placement: 'common',
    automatic: true,
    fields: { credits: { ...table(4), automatic: true } },
  },
  teamMembers: {
    placement: 'organization',
    fields: { members: { ...table(4), automatic: true }, howWeWork: area, mentors: area, teamPhoto: area },
  },
  seasonTimeline: {
    placement: 'organization',
    automatic: true,
    fields: { timeline: { ...table(4), automatic: true } },
  },
  problem: {
    placement: 'section',
    sections: ['mechanics', 'coding'],
    fields: { challenge: area, problem: area, criteria: table(3), constraints: table(3), nextStep: area },
  },
  brainstorm: {
    placement: 'section',
    sections: ['mechanics', 'coding', 'strategy'],
    fields: { context: area, sketches: area, ideas: table(4), matrix: table(5), chosen: area },
  },
  buildIteration: {
    placement: 'section',
    sections: ['mechanics'],
    iterated: true,
    fields: { origin: area, changes: area, photos: area, testResults: area, nextSteps: area },
  },
  test: {
    placement: 'section',
    sections: ['mechanics', 'coding', 'strategy'],
    fields: { hypothesis: area, setup: fixed(1, 5), results: table(4), analysis: area, conclusion: area },
  },
  decision: {
    placement: 'section',
    sections: ['mechanics', 'coding', 'wiring', 'strategy'],
    fields: { decision: area, options: table(4), evidence: area, process: area, expectations: area },
  },
  mechanism: {
    placement: 'section',
    sections: ['mechanics'],
    fields: { purpose: area, picture: area, labels: table(3), howItWorks: area },
  },
  codeDoc: {
    placement: 'section',
    sections: ['coding'],
    fields: { purpose: area, rationale: area, pseudocode: area, debugging: area, relatedTests: area },
  },
  wiringDoc: {
    placement: 'section',
    sections: ['wiring'],
    fields: { diagram: area, ports: table(4), problems: area },
  },
  changeLog: {
    placement: 'section',
    sections: ['mechanics', 'coding', 'wiring'],
    automatic: true,
    fields: { changes: { ...table(4), automatic: true } },
  },
  reflection: {
    placement: 'section',
    sections: ['mechanics', 'coding', 'wiring', 'strategy'],
    fields: { period: area, worked: area, didNotWork: area, learned: area, planChanges: area, tracker: fixed(2, 3) },
  },
  gameAnalysis: {
    placement: 'section',
    sections: ['strategy'],
    fields: { priorities: table(5), matchPlan: fixed(2, 3), strategy: area, participants: area },
  },
  autonomousPlan: {
    placement: 'section',
    sections: ['strategy'],
    fields: { path: area, steps: table(4), rationale: area, testResults: area },
  },
} as const satisfies Record<string, PageTypeSpec>;

export type PageType = keyof typeof PAGE_TYPES;

export const PAGE_TYPE_IDS = Object.keys(PAGE_TYPES) as PageType[];

export function pageTypeSpec(type: PageType): PageTypeSpec {
  return PAGE_TYPES[type];
}

/** Referencia a otra página dentro de un texto: `{{page:ID}}`. */
export const PAGE_REF_PATTERN = /\{\{page:([A-Za-z0-9_.-]+)\}\}/g;

export function findPageRefs(text: string): string[] {
  return [...text.matchAll(PAGE_REF_PATTERN)].map((m) => m[1] as string);
}

export function replacePageRefs(text: string, resolve: (id: string) => string): string {
  return text.replace(PAGE_REF_PATTERN, (_all, id: string) => resolve(id));
}

export function isAreaContent(value: unknown): value is AreaContent {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normaliza el valor de un recuadro a `AreaContent`. */
export function toAreaContent(value: AreaValue | undefined): AreaContent {
  if (value === undefined) return {};
  if (typeof value === 'string') return { text: value };
  return value;
}
