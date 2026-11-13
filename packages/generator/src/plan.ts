/**
 * Plan de la bitácora: qué páginas lógicas van y en qué orden.
 *
 * Orden: portada, comunes (recursos, tabla de contenido, resúmenes),
 * Organización del equipo, y las cuatro secciones, cada una con su separador
 * y sus páginas en orden cronológico. Al final, si se piden, las páginas de
 * referencia de la plantilla.
 */

import {
  PAGE_TYPES,
  SECTIONS,
  toAreaContent,
  type AreaValue,
  type ImageMark,
  type NotebookDocument,
  type NotebookPage,
  type PageType,
  type SectionId,
} from '@vortex-wake/shared';
import type { TemplateSection } from './field-map.ts';
import { formatDate } from './format.ts';
import type { ImageInfo } from './images.ts';
import type { TemplateSlide } from './template.ts';

export type NumberGroup = 'common' | 'organization' | SectionId | 'reference';

export interface ResolvedImage {
  src: string;
  caption?: string;
  bytes: Uint8Array;
  /** Tamaño ya recortado (si hay `crop`). */
  info: ImageInfo;
  /** Flechas y etiquetas que se dibujan encima. */
  marks?: ImageMark[];
  /** Recorte (en pixeles de la imagen completa); PowerPoint lo aplica con `srcRect`. */
  crop?: { x: number; y: number; width: number; height: number; fullWidth: number; fullHeight: number };
}

export interface AreaData {
  kind: 'area';
  text: string;
  code: boolean;
  images: ResolvedImage[];
}

export interface TableData {
  kind: 'table';
  rows: string[][];
  /** La primera columna de la plantilla trae etiquetas fijas. */
  fixed: boolean;
}

export type FieldData = AreaData | TableData;

export interface ContentPage {
  kind: 'content';
  /** Id de la página en el documento; las automáticas usan un id interno. */
  pageId: string;
  type: PageType;
  section: TemplateSection;
  group: NumberGroup;
  date: string;
  authors: string[];
  title?: string;
  subsystem?: string;
  iteration?: number;
  fields: Record<string, FieldData>;
}

export type LogicalPage =
  | { kind: 'cover' }
  | { kind: 'resources' }
  | { kind: 'toc' }
  | { kind: 'divider'; section: TemplateSection }
  | { kind: 'asIs'; slide: TemplateSlide; group: NumberGroup }
  | ContentPage;

export interface PlanOptions {
  includeResources: boolean;
  includeReferencePages: boolean;
  referenceSlides: TemplateSlide[];
}

export type ImageLookup = (src: string) => ResolvedImage;

export function planNotebook(doc: NotebookDocument, images: ImageLookup, opts: PlanOptions): LogicalPage[] {
  const out: LogicalPage[] = [{ kind: 'cover' }];
  if (opts.includeResources) out.push({ kind: 'resources' });
  out.push({ kind: 'toc' });

  const byType = (t: PageType) => doc.pages.filter((p) => p.type === t);
  const toContent = (p: NotebookPage, section: TemplateSection, group: NumberGroup): ContentPage =>
    contentFromPage(p, section, group, images);

  // Comunes: resúmenes en el orden de la plantilla.
  for (const p of sortChrono(byType('seasonSummary'))) out.push(toContent(p, 'common', 'common'));
  for (const p of sortChrono(byType('codeSummary'))) out.push(toContent(p, 'common', 'common'));
  const credits = creditSummaryPage(doc);
  if (credits) out.push(credits);

  // Organización del equipo.
  out.push({ kind: 'divider', section: 'organization' });
  const teamPages = byType('teamMembers');
  if (teamPages.length > 0) {
    for (const p of sortChrono(teamPages)) {
      const c = toContent(p, 'organization', 'organization');
      c.fields.members = { kind: 'table', rows: memberRows(doc), fixed: false };
      out.push(c);
    }
  } else if (doc.members.length > 0) {
    out.push(autoPage(doc, 'teamMembers', 'auto-team-members', 'organization', 'organization', doc.season.start, {
      members: { kind: 'table', rows: memberRows(doc), fixed: false },
    }));
  }
  const timeline = timelinePage(doc);
  if (timeline) out.push(timeline);

  // Las cuatro secciones.
  const iterations = iterationNumbers(doc);
  for (const section of SECTIONS) {
    out.push({ kind: 'divider', section });
    const pages = sortChrono(doc.pages.filter((p) => PAGE_TYPES[p.type].placement === 'section' && p.section === section));
    for (const p of pages) {
      const c = toContent(p, section, section);
      const it = iterations.get(p.id);
      if (it !== undefined) c.iteration = it;
      out.push(c);
    }
    const log = changeLogPage(doc, section);
    if (log) out.push(log);
  }

  if (opts.includeReferencePages) {
    for (const s of opts.referenceSlides) {
      out.push(s.divider ? { kind: 'divider', section: 'reference' } : { kind: 'asIs', slide: s, group: 'reference' });
    }
  }
  return out;
}

/** Orden cronológico estable: por fecha y, si empatan, como vienen en el documento. */
export function sortChrono<T extends { date: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : a.i - b.i))
    .map((x) => x.item);
}

function contentFromPage(p: NotebookPage, section: TemplateSection, group: NumberGroup, images: ImageLookup): ContentPage {
  const spec = PAGE_TYPES[p.type];
  const fields: Record<string, FieldData> = {};
  for (const [key, fs] of Object.entries(spec.fields)) {
    const value = p.fields?.[key];
    if (fs.kind === 'area') {
      const a = toAreaContent(value as AreaValue | undefined);
      fields[key] = {
        kind: 'area',
        text: a.text ?? '',
        code: a.code ?? false,
        images: (a.images ?? []).map((img) => ({
          ...images(img.src),
          ...(img.caption ? { caption: img.caption } : {}),
          ...(img.marks && img.marks.length > 0 ? { marks: img.marks } : {}),
        })),
      };
    } else {
      fields[key] = { kind: 'table', rows: (value as string[][] | undefined) ?? [], fixed: fs.kind === 'fixedTable' };
    }
  }
  const c: ContentPage = {
    kind: 'content',
    pageId: p.id,
    type: p.type,
    section,
    group,
    date: p.date,
    authors: p.authors,
    fields,
  };
  if (p.title !== undefined) c.title = p.title;
  if (p.subsystem !== undefined) c.subsystem = p.subsystem;
  if (p.iteration !== undefined) c.iteration = p.iteration;
  return c;
}

function autoPage(
  doc: NotebookDocument,
  type: PageType,
  pageId: string,
  section: TemplateSection,
  group: NumberGroup,
  date: string,
  fields: Record<string, FieldData>,
  authors?: string[],
): ContentPage {
  const spec = PAGE_TYPES[type];
  const all: Record<string, FieldData> = {};
  for (const [key, fs] of Object.entries(spec.fields)) {
    all[key] = fields[key] ?? (fs.kind === 'area' ? { kind: 'area', text: '', code: false, images: [] } : { kind: 'table', rows: [], fixed: fs.kind === 'fixedTable' });
  }
  return { kind: 'content', pageId, type, section, group, date, authors: authors ?? doc.editors ?? [], fields: all };
}

function memberRows(doc: NotebookDocument): string[][] {
  return doc.members.map((m) => [m.name, m.roles.join(', '), m.grade ?? '', m.initials]);
}

/** Cronología: una fila por sesión, con las páginas fechadas ese día. */
function timelinePage(doc: NotebookDocument): ContentPage | undefined {
  const sessions = sortChrono(doc.sessions ?? []);
  if (sessions.length === 0) return undefined;
  const rows = sessions.map((s) => {
    const pages = doc.pages.filter((p) => p.date === s.date).map((p) => `{{page:${p.id}}}`);
    return [formatDate(s.date, doc.language), s.event, s.summary, pages.join(', ')];
  });
  const last = sessions[sessions.length - 1] as { date: string };
  return autoPage(doc, 'seasonTimeline', 'auto-season-timeline', 'organization', 'organization', last.date, {
    timeline: { kind: 'table', rows, fixed: false },
  });
}

/** Registro de cambios de una sección, a partir de `changes` de sus páginas. */
function changeLogPage(doc: NotebookDocument, section: SectionId): ContentPage | undefined {
  if (!(PAGE_TYPES.changeLog.sections as readonly string[]).includes(section)) return undefined;
  const records: { date: string; row: string[]; authors: string[] }[] = [];
  for (const p of doc.pages) {
    if (p.section !== section || !p.changes) continue;
    for (const c of p.changes) {
      const date = c.date ?? p.date;
      const why = [c.test ? `{{page:${c.test}}}` : '', c.evidence ?? ''].filter((s) => s !== '').join(': ');
      records.push({ date, row: [formatDate(date, doc.language), c.change, why, c.result ?? ''], authors: p.authors });
    }
  }
  if (records.length === 0) return undefined;
  const sorted = sortChrono(records);
  const last = sorted[sorted.length - 1] as { date: string };
  const authors = doc.editors ?? [...new Set(sorted.flatMap((r) => r.authors))];
  return autoPage(doc, 'changeLog', `auto-change-log-${section}`, section, section, last.date, {
    changes: { kind: 'table', rows: sorted.map((r) => r.row), fixed: false },
  }, authors);
}

/** Resumen de créditos: una fila por fuente, con las páginas donde se usó. */
function creditSummaryPage(doc: NotebookDocument): ContentPage | undefined {
  const bySource = new Map<string, { used: string[]; pages: string[]; changes: string[] }>();
  let lastDate = '';
  for (const p of sortChrono(doc.pages)) {
    for (const c of p.credits ?? []) {
      const entry = bySource.get(c.source) ?? { used: [], pages: [], changes: [] };
      if (!entry.used.includes(c.used)) entry.used.push(c.used);
      if (!entry.pages.includes(p.id)) entry.pages.push(p.id);
      if (c.changes && !entry.changes.includes(c.changes)) entry.changes.push(c.changes);
      bySource.set(c.source, entry);
      if (p.date > lastDate) lastDate = p.date;
    }
  }
  if (bySource.size === 0) return undefined;
  const rows = [...bySource.entries()].map(([source, e]) => [
    source,
    e.used.join('; '),
    e.pages.map((id) => `{{page:${id}}}`).join(', '),
    e.changes.join('; '),
  ]);
  return autoPage(doc, 'creditSummary', 'auto-credit-summary', 'common', 'common', lastDate, {
    credits: { kind: 'table', rows, fixed: false },
  });
}

/** Número de iteración de cada página de construcción, por hilo y fecha. */
export function iterationNumbers(doc: NotebookDocument): Map<string, number> {
  const out = new Map<string, number>();
  const threads = new Map<string, NotebookPage[]>();
  for (const p of doc.pages) {
    if (!('iterated' in PAGE_TYPES[p.type])) continue;
    if (p.iteration !== undefined) out.set(p.id, p.iteration);
    if (p.thread) threads.set(p.thread, [...(threads.get(p.thread) ?? []), p]);
  }
  for (const pages of threads.values()) {
    sortChrono(pages).forEach((p, i) => {
      if (p.iteration === undefined) out.set(p.id, i + 1);
    });
  }
  return out;
}
