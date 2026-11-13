/**
 * Núcleo del generador: plantilla (bytes) + documento (JSON) → bitácora (bytes).
 * No usa `fs`: las imágenes llegan por `loadAsset`, para que corra igual en
 * Node y en el navegador.
 */

import { parseNotebook, replacePageRefs, type ImageRef, type NotebookDocument } from '@vortex-wake/shared';
import { defaultFieldMap, type FieldMap, type FixedPageId } from './field-map.ts';
import { LABELS, formatDate } from './format.ts';
import { readImageInfo } from './images.ts';
import { layoutPage, readModelGeometry, type PageLayout } from './layout.ts';
import { textWidthPt, wrapText } from './measure.ts';
import { CONTENT_TYPES, REL_TYPES, nextRelId, relativeTarget, relsPathFor, resolveTarget, type OpcPackage, type Relationship } from './opc.ts';
import { planNotebook, type ContentPage, type LogicalPage, type NumberGroup, type ResolvedImage } from './plan.ts';
import { SlideEditor, type ImageSink } from './render.ts';
import { EMU_PER_PT, Template, readBox, type TemplateSlide } from './template.ts';
import { NS, children, descendants, parseXml, path, remove, type Element } from './xml.ts';

export type Numbering = 'section' | 'continuous';

export interface GenerateOptions {
  /** `section` (M-1, C-1...) mientras se trabaja; `continuous` (1, 2, 3...) para la entrega. */
  numbering?: Numbering;
  /** Agrega al final las páginas de referencia de la plantilla (rayada, en blanco, cuadrícula). */
  includeReferencePages?: boolean;
  /** Incluye la página de recursos de VEX (por defecto sí). */
  includeResources?: boolean;
  /** Conserva el texto de ayuda gris bajo cada encabezado (por defecto se quita). */
  keepHelpText?: boolean;
  /** Prefijos de la numeración por sección. */
  prefixes?: Partial<Record<NumberGroup, string>>;
  fieldMap?: FieldMap;
}

export const DEFAULT_PREFIXES: Record<NumberGroup, string> = {
  common: 'G',
  organization: 'T',
  mechanics: 'M',
  coding: 'C',
  wiring: 'W',
  strategy: 'S',
  reference: 'R',
};

export type AssetLoader = (src: string) => Uint8Array | Promise<Uint8Array>;

export interface GeneratedPage {
  /** Posición en el archivo generado, desde 1. */
  slide: number;
  kind: LogicalPage['kind'];
  pageId?: string;
  type?: string;
  number?: string;
  title?: string;
  continuation?: boolean;
  /** Diapositiva modelo de la plantilla (posición desde 1). */
  model: number;
}

export interface GenerateResult {
  bytes: Uint8Array;
  pages: GeneratedPage[];
  warnings: string[];
}

interface PhysicalPage {
  logical: LogicalPage;
  model: TemplateSlide;
  group?: NumberGroup;
  continuation?: boolean;
  layout?: PageLayout;
  title?: string;
  tocLines?: TocLine[];
  number?: string;
}

interface TocLine {
  number: string;
  title: string;
  date: string;
  header: boolean;
}

const MAX_CONTINUATIONS = 40;

export async function generateNotebook(params: {
  template: Uint8Array;
  document: unknown;
  loadAsset: AssetLoader;
  options?: GenerateOptions;
}): Promise<GenerateResult> {
  const opts = params.options ?? {};
  const map = opts.fieldMap ?? defaultFieldMap;
  const doc = parseNotebook(params.document);
  const template = new Template(params.template, map);
  const warnings: string[] = [];
  const lang = doc.language;

  // 1. Imágenes: se cargan todas antes de acomodar.
  const images = await loadImages(doc, params.loadAsset);
  const lookup = (src: string): ResolvedImage => {
    const img = images.get(src);
    if (!img) throw new Error(`imagen no cargada: ${src}`);
    return img;
  };

  // 2. Páginas lógicas.
  const logical = planNotebook(doc, lookup, {
    includeResources: opts.includeResources ?? true,
    includeReferencePages: opts.includeReferencePages ?? false,
    referenceSlides: template.sectionSlides('reference'),
  });

  // 3. Páginas físicas (con continuaciones).
  const style = map.standard;
  const bottomLimit = map.contentBottomPt;
  const physical: PhysicalPage[] = [];
  const titleCache = new Map<string, string>();
  for (const lp of logical) {
    switch (lp.kind) {
      case 'cover':
        physical.push({ logical: lp, model: template.fixedPage(doc.cover?.photo ? 'coverPhoto' : 'cover') });
        break;
      case 'resources':
        physical.push({ logical: lp, model: template.fixedPage('resources'), group: 'common' });
        break;
      case 'toc':
        physical.push({ logical: lp, model: template.fixedPage('tableOfContents'), group: 'common' });
        break;
      case 'divider':
        physical.push({ logical: lp, model: template.dividerFor(lp.section) });
        break;
      case 'asIs':
        physical.push({ logical: lp, model: lp.slide, group: lp.group });
        break;
      case 'content': {
        const model = template.modelFor(lp.type, lp.section, lang);
        const mapping = map.pageTypes[lp.type];
        const slideDoc = template.pkg.getXml(model.part);
        const geom = readModelGeometry(slideDoc.documentElement as unknown as Element, mapping.fields, bottomLimit);
        // Por parte, no por posición: las páginas armadas (trabajo del día, torneo) comparten la página en blanco.
        if (!titleCache.has(model.part)) titleCache.set(model.part, readTitle(slideDoc.documentElement as unknown as Element, map));
        const title = buildTitle(titleCache.get(model.part) ?? '', lp);
        let fields = lp.fields;
        let continuation = false;
        for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
          const layout = layoutPage(geom, fields, style, continuation);
          physical.push({
            logical: lp,
            model,
            group: lp.group,
            continuation,
            layout,
            title: continuation ? `${title} ${LABELS[lang].continuedShort}` : title,
          });
          if (!layout.overflow) break;
          if (i === MAX_CONTINUATIONS) {
            warnings.push(`La página "${lp.pageId}" necesitó más de ${MAX_CONTINUATIONS} continuaciones; se cortó el resto.`);
            break;
          }
          if (i === 0) warnings.push(`La página "${lp.pageId}" no cupo en una página: se agregó una continuación (${Object.keys(layout.overflow).join(', ')}).`);
          fields = layout.overflow;
          continuation = true;
        }
        break;
      }
    }
  }

  // 4. Tabla de contenido: cuántas páginas ocupa (no depende de los números).
  const tocMap = map.fixedPages.tableOfContents.toc;
  if (!tocMap) throw new Error('el mapa de campos no describe la tabla de contenido');
  const tocEntries = physical.filter((p) => isTocEntry(p));
  const tocPageCount = Math.max(1, Math.ceil(tocEntries.length / tocMap.linesPerPage));
  const tocIndex = physical.findIndex((p) => p.logical.kind === 'toc');
  const tocTemplate = physical[tocIndex] as PhysicalPage;
  const tocPages: PhysicalPage[] = Array.from({ length: tocPageCount }, (_, i) => ({ ...tocTemplate, continuation: i > 0 }));
  physical.splice(tocIndex, 1, ...tocPages);

  // 5. Numeración.
  const prefixes = { ...DEFAULT_PREFIXES, ...(opts.prefixes ?? {}) };
  const numbering = opts.numbering ?? 'section';
  const counters = new Map<string, number>();
  const numberById = new Map<string, string>();
  for (const p of physical) {
    if (!p.group) continue;
    const key = numbering === 'continuous' ? '*' : p.group;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    p.number = numbering === 'continuous' ? String(n) : `${prefixes[p.group]}-${n}`;
    if (p.logical.kind === 'content' && !p.continuation && !numberById.has(p.logical.pageId)) {
      numberById.set(p.logical.pageId, p.number);
    }
  }
  const resolveRefs = (text: string) =>
    replacePageRefs(text, (id) => {
      const n = numberById.get(id);
      if (n === undefined) {
        warnings.push(`Referencia a la página "${id}", que no quedó en la bitácora.`);
        return '?';
      }
      return n;
    });

  // 6. Líneas de la tabla de contenido.
  const lines: TocLine[] = tocEntries.map((p) => tocLine(p, template, lang, resolveRefs));
  tocPages.forEach((tp, i) => {
    tp.tocLines = lines.slice(i * tocMap.linesPerPage, (i + 1) * tocMap.linesPerPage);
  });

  // 7. Diapositivas.
  const out = template.pkg;
  const mediaNames = new Map<string, string>();
  let mediaCounter = 0;
  const slideParts: { part: string; page: PhysicalPage }[] = [];
  // Se guardan las diapositivas modelo y se quitan del paquete: la salida solo
  // trae las copias, numeradas desde slide1.xml.
  const models = new Map<string, { xml: string; rels: Relationship[] }>();
  for (const s of [...template.slides, ...template.synthetic]) {
    models.set(s.part, { xml: out.getText(s.part), rels: out.readRels(s.part) });
    out.delete(s.part);
    out.delete(relsPathFor(s.part));
  }
  const generated: GeneratedPage[] = [];

  physical.forEach((page, i) => {
    const part = `ppt/slides/slide${i + 1}.xml`;
    const model = models.get(page.model.part);
    if (!model) throw new Error(`falta la diapositiva modelo ${page.model.part}`);
    const modelRels = model.rels.filter((r) => r.type !== REL_TYPES.notesSlide);
    const rels: Relationship[] = modelRels.map((r) => ({
      ...r,
      target: r.external ? r.target : relativeTarget(part, resolveTarget(page.model.part, r.target)),
    }));
    const sink: ImageSink = {
      embed(img) {
        let media = mediaNames.get(img.src);
        if (!media) {
          mediaCounter++;
          const ext = img.info.format === 'png' ? 'png' : 'jpeg';
          media = `ppt/media/vw-image${mediaCounter}.${ext}`;
          while (out.has(media)) media = `ppt/media/vw-image${++mediaCounter}.${ext}`;
          out.parts.set(media, img.bytes);
          mediaNames.set(img.src, media);
        }
        const target = relativeTarget(part, media);
        const existing = rels.find((r) => r.type === REL_TYPES.image && r.target === target);
        if (existing) return existing.id;
        const id = nextRelId(rels);
        rels.push({ id, type: REL_TYPES.image, target, external: false });
        return id;
      },
    };
    const editor = new SlideEditor(parseXml(model.xml), lang);
    renderPage(editor, page, doc, map, opts, sink, resolveRefs, lookup);
    editor.setCreationId(1000000 + i);
    out.setXml(part, editor.doc);
    out.writeRels(part, rels);
    out.ensureOverride(part, CONTENT_TYPES.slide);
    slideParts.push({ part, page });
    const g: GeneratedPage = { slide: i + 1, kind: page.logical.kind, model: page.model.index };
    if (page.logical.kind === 'content') {
      g.pageId = page.logical.pageId;
      g.type = page.logical.type;
    }
    if (page.number) g.number = page.number;
    if (page.title) g.title = resolveRefs(page.title);
    if (page.continuation) g.continuation = true;
    generated.push(g);
  });
  if (mediaNames.size > 0) {
    out.ensureDefault('png', CONTENT_TYPES.png);
    out.ensureDefault('jpeg', CONTENT_TYPES.jpeg);
  }

  // 8. Lista de diapositivas de la presentación: solo las generadas.
  writeSlideList(out, slideParts.map((s) => s.part));
  out.collectGarbage();
  updateAppProperties(out, slideParts.length);

  return { bytes: out.toBytes(), pages: generated, warnings: [...new Set(warnings)] };
}

// --- Imágenes -----------------------------------------------------------------

function collectImageRefs(doc: NotebookDocument): ImageRef[] {
  const refs: ImageRef[] = [];
  if (doc.cover?.photo) refs.push(doc.cover.photo);
  for (const p of doc.pages) {
    for (const v of Object.values(p.fields ?? {})) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) refs.push(...(v.images ?? []));
    }
  }
  return refs;
}

async function loadImages(doc: NotebookDocument, load: AssetLoader): Promise<Map<string, ResolvedImage>> {
  const out = new Map<string, ResolvedImage>();
  for (const ref of collectImageRefs(doc)) {
    if (out.has(ref.src)) continue;
    let bytes: Uint8Array;
    try {
      bytes = await load(ref.src);
    } catch (e) {
      throw new Error(`no se pudo leer la imagen "${ref.src}": ${(e as Error).message}`);
    }
    let info;
    try {
      info = readImageInfo(bytes);
    } catch (e) {
      throw new Error(`la imagen "${ref.src}" no es válida: ${(e as Error).message}`);
    }
    out.set(ref.src, { src: ref.src, bytes, info });
  }
  return out;
}

// --- Títulos ----------------------------------------------------------------------

function readTitle(root: Element, map: FieldMap): string {
  const editorShapes = descendants(root, NS.p, 'cNvPr').find((c) => c.getAttribute('name') === map.standard.title);
  const sp = editorShapes?.parentNode?.parentNode as Element | undefined;
  if (!sp) return '';
  return descendants(sp, NS.a, 'p')
    .map((p) => descendants(p, NS.a, 't').map((t) => t.textContent ?? '').join(''))
    .join(' ')
    .trim();
}

/**
 * Título de la página a partir del de la página modelo, sin depender del
 * idioma: `[...]` se cambia por el subsistema y `#__` por el número de
 * iteración. Si la página modelo no trae `[...]` (por ejemplo "Problema...:
 * diseño del robot"), el subsistema reemplaza lo que va después de ": ".
 */
export function buildTitle(templateTitle: string, page: ContentPage): string {
  if (page.title) return page.title;
  let t = templateTitle;
  if (/\[[^\]]*\]/.test(t)) {
    t = page.subsystem ? t.replace(/\[[^\]]*\]/, page.subsystem) : t.replace(/\s*:?\s*\[[^\]]*\]/, '');
  } else if (page.subsystem) {
    const i = t.lastIndexOf(': ');
    t = i >= 0 ? `${t.slice(0, i + 2)}${page.subsystem}` : `${t}: ${page.subsystem}`;
  }
  if (/#_+/.test(t)) t = page.iteration !== undefined ? t.replace(/#_+/, `#${page.iteration}`) : t.replace(/\s*#_+/, '');
  return t.replace(/\s+:/, ':').trim();
}

// --- Tabla de contenido ------------------------------------------------------------

function isTocEntry(p: PhysicalPage): boolean {
  if (p.continuation) return false;
  const k = p.logical.kind;
  // Las páginas de referencia (rayada, en blanco...) no tienen título: basta con su separador.
  return k === 'content' || k === 'divider' || k === 'resources';
}

function tocLine(p: PhysicalPage, template: Template, lang: 'es' | 'en', resolve: (s: string) => string): TocLine {
  const lp = p.logical;
  if (lp.kind === 'divider') {
    return { number: '', title: dividerTitle(template, p.model), date: '', header: true };
  }
  if (lp.kind === 'content') {
    return { number: p.number ?? '', title: resolve(p.title ?? ''), date: formatDate(lp.date, lang), header: false };
  }
  return { number: p.number ?? '', title: slideTitleText(template, p.model), date: '', header: false };
}

function dividerTitle(template: Template, slide: TemplateSlide): string {
  return slideTitleText(template, slide);
}

/** Texto del título de una diapositiva (marcador de título o primera forma con texto). */
function slideTitleText(template: Template, slide: TemplateSlide): string {
  const root = template.pkg.getXml(slide.part).documentElement as unknown as Element;
  for (const ph of descendants(root, NS.p, 'ph')) {
    if (ph.getAttribute('type') !== 'title') continue;
    const sp = ph.parentNode?.parentNode?.parentNode as Element | undefined;
    if (!sp) continue;
    const text = descendants(sp, NS.a, 't').map((t) => t.textContent ?? '').join('').trim();
    if (text) return text;
  }
  return '';
}

// --- Render de cada página ------------------------------------------------------------

function renderPage(
  editor: SlideEditor,
  page: PhysicalPage,
  doc: NotebookDocument,
  map: FieldMap,
  opts: GenerateOptions,
  sink: ImageSink,
  resolve: (s: string) => string,
  lookup: (src: string) => ResolvedImage,
): void {
  const lp = page.logical;
  const lang = doc.language;
  switch (lp.kind) {
    case 'cover':
      renderCover(editor, doc, map, doc.cover?.photo ? 'coverPhoto' : 'cover', sink, lookup);
      return;
    case 'resources':
    case 'divider':
      return;
    case 'toc': {
      const toc = map.fixedPages.tableOfContents.toc;
      if (!toc) return;
      editor.writeToc(editor.requireShape(toc.shape), toc, page.tocLines ?? []);
      return;
    }
    case 'asIs':
      setFooter(editor, map, { project: doc.project, name: '', date: '', page: page.number ?? '' });
      return;
    case 'content':
      break;
  }

  const mapping = map.pageTypes[lp.type];
  const std = map.standard;
  for (const name of std.remove) editor.removeShape(name);
  for (const name of mapping.clear ?? []) {
    const el = editor.shape(name);
    if (el) editor.clearText(el);
  }

  const placed = new Set(page.layout?.placements.map((p) => p.key) ?? []);
  // En una continuación se quitan los bloques que no siguen.
  for (const [key, f] of Object.entries(mapping.fields)) {
    if (placed.has(key)) continue;
    editor.removeShape(f.shape);
    if (f.heading) editor.removeShape(f.heading);
  }

  // Título, ensanchado hasta el borde del contenido.
  const titleShape = editor.shape(std.title);
  if (titleShape) {
    const title = resolve(page.title ?? '');
    editor.setShapeText(titleShape, title);
    const right = Math.max(0, ...(page.layout?.placements ?? []).map((p) => p.box.x + p.box.w));
    if (right > 0) editor.widen(titleShape, right);
    shrinkLongTitle(titleShape, title, right);
  }

  for (const placement of page.layout?.placements ?? []) {
    const f = mapping.fields[placement.key];
    if (!f) continue;
    const resolved = { ...placement };
    if (placement.area) resolved.area = { ...placement.area, text: resolve(placement.area.text) };
    if (placement.table) resolved.table = { ...placement.table, rows: placement.table.rows.map((r) => r.map(resolve)) };
    if (f.heading && !opts.keepHelpText) {
      const h = editor.shape(f.heading);
      if (h) editor.keepFirstParagraph(h);
    }
    editor.placeBlock(resolved, f, std, sink);
  }

  setFooter(editor, map, {
    project: doc.project,
    name: authorsLabel(doc, lp.authors),
    date: formatDate(lp.date, lang),
    page: page.number ?? '',
  });
}

function shrinkLongTitle(shape: Element, title: string, rightPt: number): void {
  // El título tiene 3 renglones de 20 pt antes de chocar con el primer encabezado.
  const box = readBox(shape);
  const x = box ? box.x / EMU_PER_PT : 43.2;
  const width = rightPt > 0 ? rightPt - x : (box?.cx ?? 4526280) / EMU_PER_PT;
  for (const size of [20, 18, 16, 14]) {
    if (wrapText(title, width, { sizePt: size, bold: true }).length <= 3 || size === 14) {
      if (size !== 20) for (const r of descendants(shape, NS.a, 'rPr')) r.setAttribute('sz', String(size * 100));
      return;
    }
  }
}

function setFooter(editor: SlideEditor, map: FieldMap, values: { project: string; name: string; date: string; page: string }): void {
  editor.setPlaceholderText(map.footer.project, values.project, FOOTER_FONT_PT);
  editor.setPlaceholderText(map.footer.name, values.name, FOOTER_FONT_PT);
  editor.setPlaceholderText(map.footer.date, values.date, FOOTER_FONT_PT);
  editor.setPlaceholderText(map.footer.page, values.page, FOOTER_FONT_PT);
}

const FOOTER_FONT_PT = 11;
/** Ancho del campo "Nombre" del pie (después de la etiqueta). */
const FOOTER_NAME_WIDTH_PT = 235;

/** Nombres de los autores; si no caben en el pie, sus iniciales. */
export function authorsLabel(doc: NotebookDocument, ids: string[]): string {
  const members = ids.map((id) => doc.members.find((m) => m.id === id)).filter((m) => m !== undefined);
  const names = members.map((m) => m.name).join(', ');
  if (textWidthPt(names, { sizePt: FOOTER_FONT_PT }) <= FOOTER_NAME_WIDTH_PT) return names;
  return members.map((m) => m.initials).join(', ');
}

function renderCover(
  editor: SlideEditor,
  doc: NotebookDocument,
  map: FieldMap,
  id: FixedPageId,
  sink: ImageSink,
  lookup: (src: string) => ResolvedImage,
): void {
  const fp = map.fixedPages[id];
  for (const name of fp.remove) editor.removeShape(name);
  const values: Record<string, string> = {
    teamNumber: doc.team.number,
    teamName: doc.team.name,
    school: doc.team.school ?? '',
    startDate: formatDate(doc.season.start, doc.language),
    endDate: formatDate(doc.season.end, doc.language),
    book: String(doc.season.book ?? 1),
    books: String(doc.season.books ?? 1),
  };
  for (const [key, shapeName] of Object.entries(fp.text)) {
    const el = editor.shape(shapeName);
    if (el) editor.setShapeText(el, values[key] ?? '');
  }
  if (fp.photo && doc.cover?.photo) {
    const el = editor.shape(fp.photo);
    if (el) editor.replaceWithPhoto(el, { ...lookup(doc.cover.photo.src) }, sink);
  }
}

// --- Paquete --------------------------------------------------------------------

function writeSlideList(pkg: OpcPackage, parts: string[]): void {
  const presName = 'ppt/presentation.xml';
  const pres = pkg.getXml(presName);
  const root = pres.documentElement as unknown as Element;
  const lst = path(root, [[NS.p, 'sldIdLst']]);
  if (!lst) throw new Error('presentation.xml sin lista de diapositivas');
  const rels = pkg.readRels(presName).filter((r) => r.type !== REL_TYPES.slide);
  for (const c of children(lst, NS.p, 'sldId')) remove(c);
  let id = 256;
  for (const part of parts) {
    const rid = nextRelId(rels);
    rels.push({ id: rid, type: REL_TYPES.slide, target: relativeTarget(presName, part), external: false });
    const el = pres.createElementNS(NS.p, 'p:sldId') as unknown as Element;
    el.setAttribute('id', String(id++));
    el.setAttributeNS(NS.r, 'r:id', rid);
    lst.appendChild(el);
  }
  pkg.setXml(presName, pres);
  pkg.writeRels(presName, rels);
}

function updateAppProperties(pkg: OpcPackage, slides: number): void {
  const name = 'docProps/app.xml';
  if (!pkg.has(name)) return;
  // Se deja una versión mínima: PowerPoint recalcula el resto al guardar.
  pkg.setText(
    name,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      `<Application>Microsoft Office PowerPoint</Application><Slides>${slides}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides></Properties>`,
  );
}
