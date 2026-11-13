/**
 * Pendientes entre sesiones: lo que se escribe en "¿Qué sigue?" del cierre
 * (un renglón = un pendiente) y lo que se agrega a mano. Funciones puras que
 * usan la app (para mostrarlos y crearlos sin conexión) y los servidores
 * (para mezclar).
 */

import type { IsoDate, IsoDateTime, TaskItem } from './model.ts';

/** Renglones de "¿Qué sigue?", sin viñetas ni numeración y sin repetir. */
export function closingLines(whatsNext: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of (whatsNext ?? '').split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, '').trim();
    if (line && !out.some((x) => normalize(x) === normalize(line))) out.push(line);
  }
  return out;
}

function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** FNV-1a de 32 bits en base 36 (estable entre teléfonos y servidores). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Id del pendiente que sale de un renglón del cierre de `date`. */
export function closingTaskId(date: IsoDate, line: string): string {
  return `n-${date}-${hash(normalize(line))}`;
}

/**
 * Pendientes que hay que guardar al guardar el cierre de `date`: los renglones
 * nuevos se crean; los que ya no están (y no se hicieron) se quitan; los que
 * se habían quitado y volvieron, regresan. Lo demás no cambia.
 */
export function tasksFromClosing(
  date: IsoDate,
  whatsNext: string | undefined,
  existing: Iterable<TaskItem>,
  now: IsoDateTime,
  by?: string,
): TaskItem[] {
  const lines = closingLines(whatsNext);
  const byId = new Map<string, TaskItem>();
  for (const t of existing) byId.set(t.id, t);
  const changed: TaskItem[] = [];
  const wanted = new Set<string>();
  for (const line of lines) {
    const id = closingTaskId(date, line);
    wanted.add(id);
    const prev = byId.get(id);
    if (!prev) {
      const t: TaskItem = { id, text: line, fromDate: date, source: 'closing', createdAt: now, updatedAt: now };
      if (by) t.createdBy = by;
      changed.push(t);
    } else if (prev.deleted) {
      const t = { ...prev, updatedAt: later(now, prev.updatedAt) };
      delete t.deleted;
      changed.push(t);
    }
  }
  for (const t of byId.values()) {
    if (t.source === 'closing' && t.fromDate === date && !wanted.has(t.id) && !t.deleted && !t.done) {
      changed.push({ ...t, deleted: true, updatedAt: later(now, t.updatedAt) });
    }
  }
  return changed;
}

/** Una hora estrictamente posterior a `prev` (para que la edición gane). */
export function later(now: IsoDateTime, prev: IsoDateTime): IsoDateTime {
  return now > prev ? now : new Date(Date.parse(prev) + 1).toISOString();
}

/**
 * Pendientes que se ven el día `today`: los de cierres anteriores y los
 * agregados a mano, sin los quitados ni los pospuestos. Los hechos se siguen
 * viendo (tachados) el día en que se marcaron, para saber quién los hizo.
 */
export function visibleTasks(tasks: Iterable<TaskItem>, today: IsoDate, localDateOf: (iso: IsoDateTime) => IsoDate): TaskItem[] {
  return [...tasks]
    .filter((t) => !t.deleted)
    .filter((t) => (t.source === 'closing' ? t.fromDate < today : t.fromDate <= today))
    .filter((t) => !t.snoozedUntil || t.snoozedUntil <= today)
    .filter((t) => !t.done || localDateOf(t.done.at) === today)
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : a.fromDate > b.fromDate ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** Mezcla: gana la versión con `updatedAt` más reciente (como las entradas). */
export function mergeTask(current: TaskItem | undefined, incoming: TaskItem): { applied: boolean; task: TaskItem } {
  if (current && current.updatedAt > incoming.updatedAt) return { applied: false, task: current };
  return { applied: true, task: incoming };
}

/** El día siguiente (`AAAA-MM-DD`). */
export function nextDay(date: IsoDate): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
