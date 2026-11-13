/**
 * Armado automático simple: micro-entradas → documento de páginas del generador.
 *
 * La herramienta no redacta: solo acomoda lo que el equipo escribió. Las
 * reglas (documentadas en el README de la app) son:
 *
 * - Una página por grupo de entradas con la misma sección, tipo, robot,
 *   subsistema e hilo. Las de "trabajo del día", las de construcción y las que
 *   no tienen hilo se agrupan además por día (una iteración = un día).
 * - Sin tipo → "trabajo del día". Sin sección → se deduce del tipo (código →
 *   Programación, cableado → Cableado, análisis y autónomo → Estrategia) o va a
 *   Mecánica, con aviso.
 * - Cada tipo de página tiene un campo principal para el texto, uno para las
 *   fotos y, si aplica, uno para la tabla y otro para el contador de pruebas.
 * - Marca "cambio" → registro de cambios (con el texto de la entrada).
 *   Marca "inspiración" → créditos (cada enlace de la entrada es una fuente).
 * - Sesiones y asistencia → cronología; integrantes → su tabla.
 */

import {
  ALLIANCE_LABELS,
  MATCH_RESULT_LABELS,
  initialsOf,
  type MatchElement,
  type RoutePoint,
  type CaptureSession,
  type Entry,
  type EntryElement,
  type EntryKind,
  type IsoDate,
  type PhotoAnnotation,
  type PhotoLabel,
  type SectionId,
  type TeamConfig,
} from './model.ts';
import {
  NOTEBOOK_FORMAT,
  NOTEBOOK_VERSION,
  PAGE_TYPES,
  TEMPLATE_FIELD_IMAGE,
  type AreaContent,
  type ChangeRecord,
  type CreditRecord,
  type FieldValue,
  type ImageMark,
  type ImageRef,
  type Language,
  type NotebookDocument,
  type NotebookPage,
  type PageTypeSpec,
} from './notebook.ts';

export interface AssembleInput {
  team: TeamConfig;
  sessions: CaptureSession[];
  entries: Entry[];
  language?: Language;
  /** Ruta de la imagen en el documento; por defecto `photos/<id>.jpg`. */
  photoSrc?: (photoId: string) => string;
}

export interface AssembleResult {
  document: NotebookDocument;
  /** Avisos en español para quien arma la bitácora. */
  warnings: string[];
  /** Fotos que usa el documento, para cargarlas antes de generar. */
  photoIds: string[];
}

interface FieldPlan {
  text: string;
  photos: string;
  table?: string;
  trials?: string;
  /**
   * Tabla que se llena con las etiquetas de las fotos anotadas (letra, qué es,
   * qué hace, por qué). `mechanism`: 3 columnas ("A: qué es", qué hace, por
   * qué); `wiring`: 4 (letra, qué es, qué hace, por qué). Sin esta tabla, las
   * etiquetas van como renglones en el texto.
   */
  labels?: { field: string; layout: 'mechanism' | 'wiring' };
}

/** Campo de cada tipo de página donde va cada cosa. */
export const FIELD_PLAN: Record<EntryKind, FieldPlan> = {
  dailyWork: { text: 'notes', photos: 'notes' },
  problem: { text: 'problem', photos: 'problem', table: 'criteria' },
  brainstorm: { text: 'context', photos: 'sketches', table: 'ideas' },
  buildIteration: { text: 'changes', photos: 'photos', trials: 'testResults' },
  test: { text: 'analysis', photos: 'analysis', table: 'results', trials: 'results' },
  decision: { text: 'decision', photos: 'evidence', table: 'options' },
  mechanism: { text: 'howItWorks', photos: 'picture', table: 'labels', labels: { field: 'labels', layout: 'mechanism' } },
  codeDoc: { text: 'purpose', photos: 'pseudocode', trials: 'relatedTests' },
  wiringDoc: { text: 'problems', photos: 'diagram', table: 'ports', labels: { field: 'ports', layout: 'wiring' } },
  reflection: { text: 'learned', photos: 'learned' },
  gameAnalysis: { text: 'strategy', photos: 'strategy', table: 'priorities' },
  autonomousPlan: { text: 'rationale', photos: 'path', table: 'steps', trials: 'testResults' },
  tournamentLog: { text: 'notes', photos: 'notes', table: 'matches' },
};

const INFERRED_SECTION: Partial<Record<EntryKind, SectionId>> = {
  buildIteration: 'mechanics',
  mechanism: 'mechanics',
  codeDoc: 'coding',
  wiringDoc: 'wiring',
  gameAnalysis: 'strategy',
  autonomousPlan: 'strategy',
  tournamentLog: 'strategy',
};

const SECTION_ORDER: SectionId[] = ['mechanics', 'coding', 'wiring', 'strategy'];

interface Group {
  key: string;
  section: SectionId;
  kind: EntryKind;
  robotId?: string;
  subsystem?: string;
  thread?: string;
  entries: Entry[];
}

export function assembleNotebook(input: AssembleInput): AssembleResult {
  const { team } = input;
  const language = input.language ?? 'es';
  const photoSrc = input.photoSrc ?? ((id: string) => `photos/${id}.jpg`);
  const warnings: string[] = [];
  const photoIds = new Set<string>();

  const memberIds = new Set(team.members.map((m) => m.id));
  const nameOf = (id: string) => team.members.find((m) => m.id === id)?.name ?? id;
  const robotName = (id?: string) => (id ? team.robots.find((r) => r.id === id)?.name : undefined);
  const fallbackAuthor = team.editors?.find((e) => memberIds.has(e)) ?? team.members[0]?.id;

  const entries = input.entries
    .filter((e) => !e.deleted && e.elements.length > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  // 1. Agrupar.
  const groups = new Map<string, Group>();
  let noSection = 0;
  let wrongSection = 0;
  for (const e of entries) {
    let kind: EntryKind = e.kind ?? 'dailyWork';
    let section = e.section ?? INFERRED_SECTION[kind];
    if (!section) {
      section = 'mechanics';
      noSection++;
    }
    const spec: PageTypeSpec = PAGE_TYPES[kind];
    if (spec.sections && !spec.sections.includes(section)) {
      wrongSection++;
      kind = 'dailyWork';
    }
    const byDay = kind === 'dailyWork' || kind === 'buildIteration' || !e.thread;
    const key = [section, kind, e.robotId ?? '', e.subsystem ?? '', e.thread ?? '', byDay ? e.sessionDate : ''].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { key, section, kind, entries: [] };
      if (e.robotId) g.robotId = e.robotId;
      if (e.subsystem) g.subsystem = e.subsystem;
      if (e.thread) g.thread = e.thread;
      groups.set(key, g);
    }
    g.entries.push(e);
  }
  if (noSection > 0) warnings.push(`${noSection} entrada(s) sin sección quedaron en Mecánica.`);
  if (wrongSection > 0) warnings.push(`${wrongSection} entrada(s) tienen un tipo que la plantilla no trae en su sección; quedaron como "trabajo del día".`);

  // 2. Páginas.
  const pages: NotebookPage[] = [];
  const counters = new Map<string, number>();
  const ordered = [...groups.values()].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    if (s !== 0) return s;
    const da = a.entries[0]?.createdAt ?? '';
    const db = b.entries[0]?.createdAt ?? '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  for (const g of ordered) {
    const plan = FIELD_PLAN[g.kind];
    const spec: PageTypeSpec = PAGE_TYPES[g.kind];
    const n = (counters.get(`${g.section}-${g.kind}`) ?? 0) + 1;
    counters.set(`${g.section}-${g.kind}`, n);
    const first = g.entries[0] as Entry;

    const authors: string[] = [];
    for (const e of g.entries) {
      const ids = e.authorIds.filter((a) => memberIds.has(a));
      if (ids.length === 0 && e.capturedBy && memberIds.has(e.capturedBy)) ids.push(e.capturedBy);
      for (const id of ids) if (!authors.includes(id)) authors.push(id);
    }
    if (authors.length === 0) {
      if (!fallbackAuthor) {
        warnings.push('No hay integrantes en el equipo: no se puede armar la bitácora.');
        break;
      }
      authors.push(fallbackAuthor);
      warnings.push(`Una página de ${first.sessionDate} no tiene autor; se firmó con ${nameOf(fallbackAuthor)}.`);
    }

    const texts: string[] = [];
    const images: ImageRef[] = [];
    const tableRows: string[][] = [];
    const trialRows: string[][] = [];
    const trialTexts: string[] = [];
    const tableColumns = plan.table ? columnsOf(spec, plan.table) : 0;
    let trialNumber = 0;
    const labelItems: { label: PhotoLabel; photo: number }[] = [];
    const matchChanges: (ChangeRecord & { date: IsoDate })[] = [];
    const routeRows: string[][] = [];
    for (const e of g.entries) {
      const parts: string[] = [];
      for (const el of e.elements) {
        switch (el.type) {
          case 'photo': {
            photoIds.add(el.photoId);
            const ref: ImageRef = { src: photoSrc(el.photoId) };
            if (el.caption) ref.caption = el.caption;
            const marks = annotationMarks(el.annotations);
            if (marks.length > 0) ref.marks = marks;
            images.push(ref);
            for (const a of el.annotations ?? []) {
              if (a.type === 'label') labelItems.push({ label: a, photo: images.length });
            }
            break;
          }
          case 'table':
            if (plan.table && !(plan.trials === plan.table && hasTrials(g))) {
              for (const r of el.rows) tableRows.push(fitRow(r, tableColumns));
            } else parts.push(tableText(el));
            break;
          case 'route': {
            if (el.points.length === 0) break;
            images.push({ src: TEMPLATE_FIELD_IMAGE, marks: routeMarks(el.points) });
            const rows = el.points.map((p, i) => [String(i + 1), p.action?.trim() ?? '', p.expected?.trim() ?? '', p.points?.trim() ?? '']);
            if (plan.table === 'steps') routeRows.push(...rows);
            else parts.push(rows.map((r) => r.filter((c) => c).join('. ')).join('\n'));
            break;
          }
          case 'match': {
            const row = matchRow(el);
            if (plan.table === 'matches') tableRows.push(row);
            else parts.push(row.filter((c) => c).join(' · '));
            if (el.adjusted?.trim() && el.adjustedSection) {
              matchChanges.push({ section: el.adjustedSection, change: el.adjusted.trim(), evidence: [el.match.trim() ? `Partido ${el.match.trim()}` : '', row[2] ?? '', el.failed?.trim() ?? ''].filter((s) => s).join(' · '), date: e.sessionDate });
            }
            break;
          }
          case 'trials': {
            if (el.trials.length === 0) break;
            if (plan.trials && plan.trials === plan.table) {
              for (const t of el.trials) trialRows.push([String(++trialNumber), t.ok ? 'Acierto' : 'Fallo', t.note ?? '', '']);
            } else {
              const lines = trialsText(el.trials);
              if (plan.trials) trialTexts.push(lines);
              else parts.push(lines);
            }
            break;
          }
          default: {
            const t = elementText(el);
            if (t) parts.push(t);
          }
        }
      }
      if (parts.length > 0) texts.push(parts.join('\n'));
    }

    // Etiquetas de las fotos anotadas → tabla de etiquetas (o texto).
    // Pasos de la ruta (en orden) → tabla de pasos del plan de autónomo, antes de las tablas capturadas.
    if (routeRows.length > 0) tableRows.unshift(...routeRows);
    const labelRows = labelTableRows(labelItems, plan.labels?.layout);
    if (plan.labels) tableRows.unshift(...labelRows);
    else if (labelRows.length > 0) texts.push(labelRows.map((r) => r.filter((c) => c.trim()).join(' · ')).join('\n'));

    const fields: Record<string, FieldValue> = {};
    const area = (key: string): AreaContent => {
      const v = fields[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
      const a: AreaContent = {};
      fields[key] = a;
      return a;
    };
    if (texts.length > 0) area(plan.text).text = texts.join('\n\n');
    if (images.length > 0) area(plan.photos).images = images;
    if (plan.table && tableRows.length > 0) fields[plan.table] = tableRows;
    if (plan.trials && trialRows.length > 0) fields[plan.trials] = trialRows;
    if (plan.trials && trialTexts.length > 0) {
      const a = area(plan.trials);
      a.text = [a.text, ...trialTexts].filter((s) => s).join('\n\n');
    }

    const page: NotebookPage = {
      id: `${g.section}-${g.kind}-${n}`,
      type: g.kind,
      section: g.section,
      date: first.sessionDate,
      authors,
      fields,
    };
    const subsystem = [g.subsystem, robotName(g.robotId)].filter((s): s is string => !!s);
    if (subsystem.length > 0) page.subsystem = subsystem.length === 2 ? `${subsystem[0]} (${subsystem[1]})` : (subsystem[0] as string);
    if (g.thread && 'iterated' in spec && spec.iterated) page.thread = g.thread;

    // Marcas que alimentan páginas automáticas.
    const changes: ChangeRecord[] = [];
    const credits: CreditRecord[] = [];
    for (const e of g.entries) {
      const text = e.elements
        .filter((el): el is Extract<EntryElement, { type: 'text' }> => el.type === 'text')
        .map((el) => el.text.trim())
        .filter((t) => t)
        .join(' ');
      if (e.marks.includes('change')) {
        if (g.section === 'strategy') warnings.push(`Un cambio de Estrategia (${e.sessionDate}) no va al registro de cambios: la plantilla no lo trae en esa sección.`);
        else if (!text) warnings.push(`Una entrada marcada como cambio (${e.sessionDate}) no tiene texto; no se agregó al registro de cambios.`);
        else changes.push(e.sessionDate === first.sessionDate ? { change: text } : { date: e.sessionDate, change: text });
      }
      if (e.marks.includes('inspiration')) {
        const links = e.elements.filter((el): el is Extract<EntryElement, { type: 'link' }> => el.type === 'link' && el.url.trim() !== '');
        if (links.length === 0) warnings.push(`Una entrada marcada como inspiración (${e.sessionDate}) no tiene enlace; no se agregó a los créditos.`);
        for (const l of links) {
          credits.push({ source: l.title?.trim() ? `${l.title.trim()} (${l.url.trim()})` : l.url.trim(), used: text || '—' });
        }
      }
    }
    // Lo que "se ajustó" en un partido va al registro de cambios de su sección, con el partido como evidencia.
    for (const c of matchChanges) {
      const rec: ChangeRecord = { section: c.section as SectionId, change: c.change, test: page.id };
      if (c.evidence) rec.evidence = c.evidence;
      if (c.date !== first.sessionDate) rec.date = c.date;
      changes.push(rec);
    }
    if (changes.length > 0) page.changes = changes;
    if (credits.length > 0) page.credits = credits;
    pages.push(page);
  }

  // 3. Sesiones (cronología) con asistencia.
  const dates = new Set<IsoDate>([...input.sessions.map((s) => s.date), ...entries.map((e) => e.sessionDate)]);
  const sortedDates = [...dates].sort();
  const sessions = sortedDates.map((date) => {
    const s = input.sessions.find((x) => x.date === date);
    const names = (s?.attendance ?? []).map((a) => nameOf(a.memberId));
    return {
      date,
      event: names.length > 0 ? `Taller (${names.join(', ')})` : 'Taller',
      summary: s?.closing?.whatWeDid?.trim() ?? '',
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const season = team.season ?? { start: sortedDates[0] ?? today, end: sortedDates[sortedDates.length - 1] ?? today };
  if (!team.team.number) warnings.push('Falta el número del equipo (team.json → team.number).');

  const document: NotebookDocument = {
    format: NOTEBOOK_FORMAT,
    version: NOTEBOOK_VERSION,
    language,
    project: team.team.number ? `${team.team.name} · ${team.team.number}` : team.team.name,
    team: { number: team.team.number || '—', name: team.team.name, ...(team.team.school ? { school: team.team.school } : {}) },
    season,
    members: team.members.map((m) => ({
      id: m.id,
      name: m.name,
      roles: m.roles ?? [],
      ...(m.grade ? { grade: m.grade } : {}),
      initials: m.initials || initialsOf(m.name) || m.id,
    })),
    sessions,
    pages,
  };
  const editors = team.editors?.filter((e) => memberIds.has(e));
  if (editors && editors.length > 0) document.editors = editors;
  return { document, warnings, photoIds: [...photoIds] };

  function hasTrials(g: Group): boolean {
    return g.entries.some((e) => e.elements.some((el) => el.type === 'trials' && el.trials.length > 0));
  }
}

/** Fila de la tabla de partidos: partido, alianza (aliado y rivales), marcador, qué falló, qué ajustamos. */
export function matchRow(m: MatchElement): string[] {
  const alliance = [m.alliance ? ALLIANCE_LABELS[m.alliance] : '', m.partner?.trim() ? `con ${m.partner.trim()}` : '', m.opponents?.trim() ? `vs ${m.opponents.trim()}` : '']
    .filter((s) => s)
    .join(' ');
  const score = [m.ourScore?.trim() || m.theirScore?.trim() ? `${m.ourScore?.trim() || '?'}-${m.theirScore?.trim() || '?'}` : '', m.result ? MATCH_RESULT_LABELS[m.result] : ''].filter((s) => s).join(' · ');
  return [m.match.trim(), alliance, score, m.failed?.trim() ?? '', m.adjusted?.trim() ?? ''];
}

/** Ruta → marcas: una flecha de cada punto al siguiente y un círculo numerado en cada punto. */
export function routeMarks(points: RoutePoint[]): ImageMark[] {
  const out: ImageMark[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as RoutePoint;
    const b = points[i + 1] as RoutePoint;
    out.push({ kind: 'arrow', x: a.x, y: a.y, tx: b.x, ty: b.y });
  }
  points.forEach((p, i) => out.push({ kind: 'label', text: String(i + 1), x: p.x, y: p.y }));
  return out;
}

/** Anotaciones de la foto → marcas que el generador dibuja como formas. */
export function annotationMarks(list: PhotoAnnotation[] | undefined): ImageMark[] {
  const out: ImageMark[] = [];
  for (const a of list ?? []) {
    if (a.type === 'arrow') out.push({ kind: 'arrow', x: a.x, y: a.y, tx: a.tx, ty: a.ty });
    else {
      const m: ImageMark = { kind: 'label', text: a.letter, x: a.x, y: a.y };
      if (a.tx !== undefined && a.ty !== undefined) {
        m.tx = a.tx;
        m.ty = a.ty;
      }
      out.push(m);
    }
  }
  return out;
}

/**
 * Filas de la tabla de etiquetas, en orden de foto y de letra. Si una letra se
 * repite en dos fotos de la misma página, se aclara de qué foto es.
 */
export function labelTableRows(items: { label: PhotoLabel; photo: number }[], layout: 'mechanism' | 'wiring' = 'wiring'): string[][] {
  const photosOf = new Map<string, Set<number>>();
  for (const { label, photo } of items) photosOf.set(label.letter, (photosOf.get(label.letter) ?? new Set()).add(photo));
  const sorted = [...items].sort((a, b) => a.photo - b.photo || a.label.letter.length - b.label.letter.length || (a.label.letter < b.label.letter ? -1 : a.label.letter > b.label.letter ? 1 : 0));
  return sorted.map(({ label, photo }) => {
    const letter = (photosOf.get(label.letter)?.size ?? 0) > 1 ? `${label.letter} (foto ${photo})` : label.letter;
    const what = label.what?.trim() ?? '';
    const does = label.does?.trim() ?? '';
    const why = label.why?.trim() ?? '';
    return layout === 'mechanism' ? [what ? `${letter}: ${what}` : letter, does, why] : [letter, what, does, why];
  });
}

function columnsOf(spec: PageTypeSpec, field: string): number {
  return spec.fields[field]?.columns ?? 1;
}

/** Ajusta una fila al número de columnas sin perder texto: lo que sobra se junta en la última. */
function fitRow(row: string[], columns: number): string[] {
  if (row.length <= columns) return row;
  return [...row.slice(0, columns - 1), row.slice(columns - 1).filter((c) => c).join(' · ')];
}

function elementText(el: EntryElement): string {
  switch (el.type) {
    case 'text':
      return el.text.trim();
    case 'link':
      return el.title?.trim() ? `${el.title.trim()}: ${el.url.trim()}` : el.url.trim();
    case 'list':
      return el.items.filter((i) => i.trim()).map((i) => `• ${i.trim()}`).join('\n');
    default:
      return '';
  }
}

function tableText(el: Extract<EntryElement, { type: 'table' }>): string {
  const rows = [el.header, ...el.rows].filter((r) => r.some((c) => c.trim()));
  return rows.map((r) => r.join(' | ')).join('\n');
}

function trialsText(trials: { ok: boolean; note?: string }[]): string {
  const ok = trials.filter((t) => t.ok).length;
  const lines = [`Aciertos: ${ok} de ${trials.length}`];
  trials.forEach((t, i) => {
    if (t.note?.trim()) lines.push(`${i + 1}. ${t.ok ? 'Acierto' : 'Fallo'}: ${t.note.trim()}`);
  });
  return lines.join('\n');
}
