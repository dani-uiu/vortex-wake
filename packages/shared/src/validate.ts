/**
 * Validación del documento de páginas. Sin dependencias: revisa a mano la
 * forma del JSON y las reglas que el generador necesita (ids únicos, autores
 * que existen, referencias a páginas que existen, campos válidos por tipo).
 *
 * Los mensajes van en español porque los lee quien arma la bitácora.
 */

import {
  NOTEBOOK_FORMAT,
  NOTEBOOK_VERSION,
  PAGE_TYPES,
  SECTIONS,
  TEMPLATE_FIELD_IMAGE,
  findPageRefs,
  type NotebookDocument,
  type PageType,
  type PageTypeSpec,
} from './notebook.ts';

export interface ValidationIssue {
  /** Ruta dentro del JSON, por ejemplo `pages[3].fields.criteria`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; document: NotebookDocument; issues: [] }
  | { ok: false; issues: ValidationIssue[] };

export class NotebookValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(
      `El documento de la bitácora tiene ${issues.length} problema(s):\n` +
        issues.map((i) => `  - ${i.path || '(raíz)'}: ${i.message}`).join('\n'),
    );
    this.name = 'NotebookValidationError';
    this.issues = issues;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_.-]+$/;
const IMAGE_RE = /\.(png|jpe?g)$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateNotebook(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!isObject(input)) {
    add('', 'el documento debe ser un objeto JSON');
    return { ok: false, issues };
  }
  const doc = input;

  if (doc.format !== NOTEBOOK_FORMAT) add('format', `debe ser "${NOTEBOOK_FORMAT}"`);
  if (doc.version !== NOTEBOOK_VERSION) add('version', `versión no soportada (se espera ${NOTEBOOK_VERSION})`);
  if (doc.language !== 'es' && doc.language !== 'en') add('language', 'debe ser "es" o "en"');
  requireString(doc, 'project', '', add);

  if (!isObject(doc.team)) add('team', 'falta el equipo (número y nombre)');
  else {
    requireString(doc.team, 'number', 'team', add);
    requireString(doc.team, 'name', 'team', add);
    optionalString(doc.team, 'school', 'team', add);
  }

  if (!isObject(doc.season)) add('season', 'falta la temporada (fechas de inicio y fin)');
  else {
    if (!isValidDate(doc.season.start)) add('season.start', 'fecha inválida (formato AAAA-MM-DD)');
    if (!isValidDate(doc.season.end)) add('season.end', 'fecha inválida (formato AAAA-MM-DD)');
    for (const k of ['book', 'books'] as const) {
      const v = doc.season[k];
      if (v !== undefined && (!Number.isInteger(v) || (v as number) < 1)) add(`season.${k}`, 'debe ser un entero positivo');
    }
  }

  if (doc.cover !== undefined) {
    if (!isObject(doc.cover)) add('cover', 'debe ser un objeto { photo }');
    else if (doc.cover.photo !== undefined) {
      validateArea({ images: [doc.cover.photo] }, 'cover.photo', add, () => {});
    }
  }

  // Integrantes
  const memberIds = new Set<string>();
  if (!Array.isArray(doc.members)) add('members', 'falta la lista de integrantes');
  else {
    doc.members.forEach((m, i) => {
      const p = `members[${i}]`;
      if (!isObject(m)) return add(p, 'debe ser un objeto');
      if (typeof m.id !== 'string' || !ID_RE.test(m.id)) add(`${p}.id`, 'id inválido (solo letras, números, ".", "_" y "-")');
      else if (memberIds.has(m.id)) add(`${p}.id`, `id repetido: "${m.id}"`);
      else memberIds.add(m.id);
      requireString(m, 'name', p, add);
      requireString(m, 'initials', p, add);
      optionalString(m, 'grade', p, add);
      if (!Array.isArray(m.roles) || m.roles.some((r) => typeof r !== 'string')) add(`${p}.roles`, 'debe ser una lista de textos');
    });
  }

  if (doc.editors !== undefined) {
    if (!Array.isArray(doc.editors)) add('editors', 'debe ser una lista de ids de integrantes');
    else doc.editors.forEach((e, i) => {
      if (typeof e !== 'string' || !memberIds.has(e)) add(`editors[${i}]`, `integrante desconocido: "${String(e)}"`);
    });
  }

  if (doc.sessions !== undefined) {
    if (!Array.isArray(doc.sessions)) add('sessions', 'debe ser una lista');
    else doc.sessions.forEach((s, i) => {
      const p = `sessions[${i}]`;
      if (!isObject(s)) return add(p, 'debe ser un objeto');
      if (!isValidDate(s.date)) add(`${p}.date`, 'fecha inválida (formato AAAA-MM-DD)');
      requireString(s, 'event', p, add);
      requireString(s, 'summary', p, add, true);
    });
  }

  // Páginas
  const pageIds = new Set<string>();
  const refs: { path: string; id: string }[] = [];
  const collectRefs = (path: string, text: unknown) => {
    if (typeof text === 'string') for (const id of findPageRefs(text)) refs.push({ path, id });
  };

  if (!Array.isArray(doc.pages)) add('pages', 'falta la lista de páginas');
  else {
    doc.pages.forEach((pg) => {
      if (isObject(pg) && typeof pg.id === 'string') {
        if (pageIds.has(pg.id)) return; // se reporta abajo
        pageIds.add(pg.id);
      }
    });
    const seen = new Set<string>();
    doc.pages.forEach((pg, i) => {
      const p = `pages[${i}]`;
      if (!isObject(pg)) return add(p, 'debe ser un objeto');
      if (typeof pg.id !== 'string' || !ID_RE.test(pg.id)) add(`${p}.id`, 'id inválido (solo letras, números, ".", "_" y "-")');
      else if (seen.has(pg.id)) add(`${p}.id`, `id de página repetido: "${pg.id}"`);
      else seen.add(pg.id);

      const type = pg.type as PageType;
      const spec: PageTypeSpec | undefined = typeof type === 'string' ? (PAGE_TYPES as Record<string, PageTypeSpec>)[type] : undefined;
      if (!spec) {
        add(`${p}.type`, `tipo de página desconocido: "${String(pg.type)}". Tipos válidos: ${Object.keys(PAGE_TYPES).join(', ')}`);
        return;
      }
      if (spec.automatic) {
        add(`${p}.type`, `las páginas "${type}" las arma el generador; no se escriben en el documento`);
        return;
      }
      if (spec.placement === 'section') {
        if (typeof pg.section !== 'string' || !(SECTIONS as readonly string[]).includes(pg.section)) {
          add(`${p}.section`, `falta la sección o es inválida (${SECTIONS.join(', ')})`);
        } else if (spec.sections && !spec.sections.includes(pg.section as never)) {
          add(`${p}.section`, `la plantilla no trae "${type}" en la sección "${pg.section}" (sí en: ${spec.sections.join(', ')})`);
        }
      } else if (pg.section !== undefined) {
        add(`${p}.section`, `las páginas "${type}" no van en una sección`);
      }
      if (!isValidDate(pg.date)) add(`${p}.date`, 'fecha inválida (formato AAAA-MM-DD)');
      if (!Array.isArray(pg.authors) || pg.authors.length === 0) add(`${p}.authors`, 'cada página necesita al menos un autor');
      else pg.authors.forEach((a, j) => {
        if (typeof a !== 'string' || !memberIds.has(a)) add(`${p}.authors[${j}]`, `integrante desconocido: "${String(a)}"`);
      });
      optionalString(pg, 'title', p, add);
      optionalString(pg, 'subsystem', p, add);
      optionalString(pg, 'thread', p, add);
      collectRefs(`${p}.title`, pg.title);
      if (pg.iteration !== undefined && (!Number.isInteger(pg.iteration) || (pg.iteration as number) < 1)) {
        add(`${p}.iteration`, 'debe ser un entero positivo');
      }
      if ((pg.thread !== undefined || pg.iteration !== undefined) && !('iterated' in spec && spec.iterated)) {
        add(`${p}.thread`, `solo las páginas de construcción llevan hilo o número de iteración`);
      }

      if (pg.fields !== undefined) {
        if (!isObject(pg.fields)) add(`${p}.fields`, 'debe ser un objeto');
        else for (const [key, value] of Object.entries(pg.fields)) {
          const fp = `${p}.fields.${key}`;
          const fs = spec.fields[key];
          if (!fs) {
            add(fp, `campo desconocido para "${type}". Campos válidos: ${Object.keys(spec.fields).filter((k) => !spec.fields[k]?.automatic).join(', ')}`);
            continue;
          }
          if (fs.automatic) {
            add(fp, 'este campo lo llena el generador');
            continue;
          }
          if (fs.kind === 'area') validateArea(value, fp, add, collectRefs);
          else validateTable(value, fs.columns ?? 1, fs.kind === 'fixedTable' ? fs.maxRows : undefined, fp, add, collectRefs);
        }
      }

      if (pg.changes !== undefined) {
        if (!Array.isArray(pg.changes)) add(`${p}.changes`, 'debe ser una lista');
        else if (spec.placement !== 'section') add(`${p}.changes`, 'solo las páginas de sección alimentan el registro de cambios');
        else if (pg.section === 'strategy') add(`${p}.changes`, 'la plantilla no trae registro de cambios en Estrategia');
        else pg.changes.forEach((c, j) => {
          const cp = `${p}.changes[${j}]`;
          if (!isObject(c)) return add(cp, 'debe ser un objeto');
          if (c.date !== undefined && !isValidDate(c.date)) add(`${cp}.date`, 'fecha inválida (formato AAAA-MM-DD)');
          requireString(c, 'change', cp, add);
          optionalString(c, 'evidence', cp, add);
          optionalString(c, 'result', cp, add);
          if (c.test !== undefined) {
            if (typeof c.test !== 'string') add(`${cp}.test`, 'debe ser el id de una página');
            else refs.push({ path: `${cp}.test`, id: c.test });
          }
          collectRefs(`${cp}.change`, c.change);
          collectRefs(`${cp}.evidence`, c.evidence);
          collectRefs(`${cp}.result`, c.result);
        });
      }

      if (pg.credits !== undefined) {
        if (!Array.isArray(pg.credits)) add(`${p}.credits`, 'debe ser una lista');
        else pg.credits.forEach((c, j) => {
          const cp = `${p}.credits[${j}]`;
          if (!isObject(c)) return add(cp, 'debe ser un objeto');
          requireString(c, 'source', cp, add);
          requireString(c, 'used', cp, add);
          optionalString(c, 'changes', cp, add);
        });
      }
    });
  }

  for (const r of refs) {
    if (!pageIds.has(r.id)) add(r.path, `referencia a una página que no existe: "${r.id}"`);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, document: doc as unknown as NotebookDocument, issues: [] };
}

/** Valida y devuelve el documento tipado, o lanza `NotebookValidationError`. */
export function parseNotebook(input: unknown): NotebookDocument {
  const r = validateNotebook(input);
  if (!r.ok) throw new NotebookValidationError(r.issues);
  return r.document;
}

type Add = (path: string, message: string) => void;

function requireString(o: Record<string, unknown>, key: string, base: string, add: Add, allowEmpty = false) {
  const v = o[key];
  const path = base ? `${base}.${key}` : key;
  if (typeof v !== 'string') add(path, 'falta el texto');
  else if (!allowEmpty && v.trim() === '') add(path, 'no puede estar vacío');
}

function optionalString(o: Record<string, unknown>, key: string, base: string, add: Add) {
  const v = o[key];
  if (v !== undefined && typeof v !== 'string') add(`${base}.${key}`, 'debe ser texto');
}

function validateArea(value: unknown, path: string, add: Add, collectRefs: (p: string, t: unknown) => void) {
  if (typeof value === 'string') {
    collectRefs(path, value);
    return;
  }
  if (!isObject(value)) {
    add(path, 'debe ser texto o un objeto { text, images, code }');
    return;
  }
  for (const k of Object.keys(value)) {
    if (!['text', 'images', 'code'].includes(k)) add(`${path}.${k}`, 'propiedad desconocida (se esperan text, images, code)');
  }
  if (value.text !== undefined && typeof value.text !== 'string') add(`${path}.text`, 'debe ser texto');
  collectRefs(`${path}.text`, value.text);
  if (value.code !== undefined && typeof value.code !== 'boolean') add(`${path}.code`, 'debe ser true o false');
  if (value.images !== undefined) {
    if (!Array.isArray(value.images)) add(`${path}.images`, 'debe ser una lista');
    else value.images.forEach((img, i) => {
      const ip = `${path}.images[${i}]`;
      if (!isObject(img)) return add(ip, 'debe ser un objeto { src, caption }');
      if (typeof img.src !== 'string' || img.src.trim() === '') add(`${ip}.src`, 'falta la ruta de la imagen');
      else if (img.src !== TEMPLATE_FIELD_IMAGE && !IMAGE_RE.test(img.src)) add(`${ip}.src`, 'solo se aceptan imágenes PNG o JPEG');
      optionalString(img, 'caption', ip, add);
      collectRefs(`${ip}.caption`, img.caption);
      if (img.marks !== undefined) validateMarks(img.marks, `${ip}.marks`, add);
    });
  }
}

function validateMarks(value: unknown, path: string, add: Add) {
  if (!Array.isArray(value)) return add(path, 'debe ser una lista');
  const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  value.forEach((m, i) => {
    const mp = `${path}[${i}]`;
    if (!isObject(m)) return add(mp, 'debe ser un objeto { kind, x, y }');
    if (m.kind !== 'label' && m.kind !== 'arrow') add(`${mp}.kind`, 'debe ser "label" o "arrow"');
    if (!unit(m.x) || !unit(m.y)) add(mp, 'x e y deben ser números entre 0 y 1');
    const hasTarget = m.tx !== undefined || m.ty !== undefined;
    if ((m.kind === 'arrow' || hasTarget) && (!unit(m.tx) || !unit(m.ty))) add(mp, 'tx y ty deben ser números entre 0 y 1');
    optionalString(m, 'text', mp, add);
  });
}

function validateTable(
  value: unknown,
  columns: number,
  maxRows: number | undefined,
  path: string,
  add: Add,
  collectRefs: (p: string, t: unknown) => void,
) {
  if (!Array.isArray(value)) {
    add(path, `debe ser una lista de filas (cada fila, una lista de ${columns} texto(s))`);
    return;
  }
  if (maxRows !== undefined && value.length > maxRows) {
    add(path, `esta tabla tiene filas fijas en la plantilla: máximo ${maxRows}`);
  }
  value.forEach((row, i) => {
    const rp = `${path}[${i}]`;
    if (!Array.isArray(row)) return add(rp, 'cada fila debe ser una lista de textos');
    if (row.length > columns) add(rp, `la fila tiene ${row.length} celdas; la tabla tiene ${columns}`);
    row.forEach((cell, j) => {
      if (typeof cell !== 'string') add(`${rp}[${j}]`, 'cada celda debe ser texto');
      else collectRefs(`${rp}[${j}]`, cell);
    });
  });
}
