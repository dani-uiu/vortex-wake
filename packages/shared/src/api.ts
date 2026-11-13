/**
 * Contrato HTTP entre la app y el servidor.
 *
 * Hoy lo implementa el servidor local (`packages/dev-server`, archivos en
 * `data/`); después lo implementará un Worker de Cloudflare (D1 + R2) con las
 * mismas rutas, los mismos cuerpos y las mismas reglas de mezcla (que viven
 * aquí, como funciones puras, para que ambos se comporten igual).
 *
 * Reglas:
 * - Acceso con la clave del equipo: encabezado `x-team-key` o, solo para
 *   `GET` de fotos y plantilla (que se piden desde `<img>`), `?k=`.
 * - Todo es idempotente: los ids los genera el cliente. Mandar dos veces la
 *   misma entrada, foto o asistencia no duplica nada.
 * - Entradas: gana la de `updatedAt` más reciente (entrada completa). Si el
 *   servidor tiene una más nueva, responde `applied: false` con la suya.
 * - Asistencia: unión por integrante (se queda la hora de entrada más temprana).
 * - Cierre de sesión: gana el de `updatedAt` más reciente.
 * - Fotos: inmutables; `PUT` de una foto que ya existe responde 200 sin cambiarla.
 * - Notas de voz: igual que las fotos (inmutables), con el tipo en
 *   `content-type` (ver `AUDIO_TYPES`); el `GET` acepta `?k=` (se piden desde `<audio>`).
 *
 * Rutas:
 *
 * | Método y ruta                          | Cuerpo            | Respuesta           |
 * |----------------------------------------|-------------------|---------------------|
 * | GET  /api/state[?date=AAAA-MM-DD]      | —                 | StateResponse       |
 * | PUT  /api/team                         | TeamConfig        | { team }            |
 * | POST /api/team/members                 | AddMemberRequest  | { team }            |
 * | PUT  /api/entries/:id                  | Entry             | PutEntryResponse    |
 * | PUT  /api/photos/:id                   | bytes JPEG        | PutPhotoResponse    |
 * | GET  /api/photos/:id                   | —                 | bytes JPEG          |
 * | PUT  /api/audio/:id                    | bytes de audio    | PutPhotoResponse    |
 * | GET  /api/audio/:id                    | —                 | bytes de audio      |
 * | POST /api/sessions/:date/attendance    | Attendance        | { session }         |
 * | PUT  /api/sessions/:date/closing       | SessionClosing    | { session, applied }|
 * | GET  /api/template                     | —                 | plantilla .pptx     |
 * | GET  /api/qr                           | —                 | QrResponse          |
 * | PUT  /api/tasks/:id                    | TaskItem          | PutTaskResponse     |
 *
 * Pendientes: gana el de `updatedAt` más reciente (como las entradas). Van en
 * `StateResponse.tasks` (todos, también con `?date=`). Con `?date=` también
 * llegan `recentSessions` (para avisar de un cierre que faltó). Los dos campos
 * son opcionales: un servidor viejo no los manda y la app sigue igual.
 *
 * `/api/qr` solo existe en la versión hospedada (Worker); el servidor local
 * tiene su propia página `/qr`.
 *
 * Claves en la versión hospedada: la de captura permite capturar, ver y editar
 * entradas; la de edición, además, editar el equipo, descargar la plantilla
 * (generar la bitácora) y ver el QR. El servidor local tiene una sola clave
 * que permite todo.
 */

import {
  CONTROLLER_SLOTS,
  PORT_SLOTS,
  ENTRY_KINDS,
  ENTRY_MARKS,
  MAX_ROUTE_POINTS,
  TEAM_FORMAT,
  initialsOf,
  slugify,
  type Attendance,
  type CaptureSession,
  type Entry,
  type SessionClosing,
  type TaskItem,
  type TeamConfig,
} from './model.ts';
import { SECTIONS } from './notebook.ts';
import { isValidDate } from './validate.ts';

export const API_VERSION = 1;
export const TEAM_KEY_HEADER = 'x-team-key';
export const TEAM_KEY_QUERY = 'k';
/** Tamaño máximo de una foto ya reducida (las del teléfono pesan ~0.3-0.8 MB). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
/** Tamaño máximo de una nota de voz (5 minutos en Opus pesan ~2-3 MB). */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** Duración máxima de una nota de voz (la grabación se detiene sola). */
export const MAX_AUDIO_MS = 5 * 60_000;
/** Tipos de audio aceptados y la extensión con la que se guardan. */
export const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
};
/** `audio/webm;codecs=opus` → `audio/webm`; `undefined` si no es un tipo aceptado. */
export function audioType(contentType: string | null | undefined): string | undefined {
  const t = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return t in AUDIO_TYPES ? t : undefined;
}
/** Tamaño máximo de un cuerpo JSON (una entrada, el equipo, una asistencia o un cierre). */
export const MAX_JSON_BYTES = 1024 * 1024;

/** Qué permite la clave con la que se hizo la petición. */
export type AccessLevel = 'capture' | 'edit';

export interface StateResponse {
  version: typeof API_VERSION;
  team: TeamConfig;
  sessions: CaptureSession[];
  entries: Entry[];
  serverTime: string;
  /** Qué permite la clave usada. Si falta (servidor local), permite todo. */
  access?: AccessLevel;
  /** `true` en la versión hospedada (HTTPS): la app instala su service worker. */
  hosted?: boolean;
  /** Pendientes entre sesiones (todos; son pocos). Los servidores viejos no lo mandan. */
  tasks?: TaskItem[];
  /**
   * Solo con `?date=`: las sesiones de los días anteriores más cercanos (hasta
   * `RECENT_SESSION_DAYS`), para avisar de una sesión que quedó sin cierre.
   */
  recentSessions?: CaptureSession[];
}

/** Cuántos días hacia atrás se mandan en `recentSessions`. */
export const RECENT_SESSION_DAYS = 14;

export interface PutTaskResponse {
  /** `false` si el servidor ya tenía una versión más nueva (se devuelve esa). */
  applied: boolean;
  task: TaskItem;
}

export interface QrResponse {
  /** Enlace de captura (lleva la clave de captura). */
  captureUrl: string;
  /** El QR de ese enlace, como SVG. */
  svg: string;
}

export interface AddMemberRequest {
  id: string;
  name: string;
}

export interface PutEntryResponse {
  /** `false` si el servidor ya tenía una versión más nueva (se devuelve esa). */
  applied: boolean;
  entry: Entry;
}

export interface PutPhotoResponse {
  id: string;
  bytes: number;
  /** `false` si la foto ya existía. */
  created: boolean;
}

export interface ErrorResponse {
  error: string;
}

export const apiPath = {
  state: (date?: string) => (date ? `/api/state?date=${encodeURIComponent(date)}` : '/api/state'),
  team: () => '/api/team',
  members: () => '/api/team/members',
  entry: (id: string) => `/api/entries/${encodeURIComponent(id)}`,
  photo: (id: string) => `/api/photos/${encodeURIComponent(id)}`,
  audio: (id: string) => `/api/audio/${encodeURIComponent(id)}`,
  attendance: (date: string) => `/api/sessions/${date}/attendance`,
  closing: (date: string) => `/api/sessions/${date}/closing`,
  template: () => '/api/template',
  qr: () => '/api/qr',
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
};

/** Fecha `AAAA-MM-DD` de `days` días antes de `date`. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// --- Mezcla -------------------------------------------------------------------

/** Gana la versión con `updatedAt` más reciente; en empate, la que llega (es idempotente). */
export function mergeEntry(current: Entry | undefined, incoming: Entry): PutEntryResponse {
  if (current && current.updatedAt > incoming.updatedAt) return { applied: false, entry: current };
  return { applied: true, entry: incoming };
}

export function emptySession(date: string): CaptureSession {
  return { date, attendance: [] };
}

/** Unión por integrante; se conserva la hora de entrada más temprana. */
export function mergeAttendance(session: CaptureSession, a: Attendance): CaptureSession {
  const existing = session.attendance.find((x) => x.memberId === a.memberId);
  if (existing && existing.checkIn <= a.checkIn) return session;
  const attendance = session.attendance.filter((x) => x.memberId !== a.memberId);
  attendance.push({ memberId: a.memberId, checkIn: a.checkIn });
  attendance.sort((x, y) => (x.checkIn < y.checkIn ? -1 : x.checkIn > y.checkIn ? 1 : 0));
  return { ...session, attendance };
}

export function mergeClosing(session: CaptureSession, closing: SessionClosing): { session: CaptureSession; applied: boolean } {
  if (session.closing && session.closing.updatedAt > closing.updatedAt) return { session, applied: false };
  return { session: { ...session, closing }, applied: true };
}

/** Une dos sesiones del mismo día (por ejemplo, la local y la del servidor). */
export function mergeSessions(a: CaptureSession, b: CaptureSession): CaptureSession {
  let out = a;
  for (const att of b.attendance) out = mergeAttendance(out, att);
  if (b.closing) out = mergeClosing(out, b.closing).session;
  return out;
}

/**
 * Alta de un integrante desde la app ("¿No estás en la lista?"). Si el id ya
 * existe no cambia nada (es idempotente). Devuelve un mensaje de error o el
 * equipo resultante.
 */
export function addMemberToTeam(team: TeamConfig, body: unknown): { team: TeamConfig; changed: boolean } | { error: string } {
  const b = isObj(body) ? body : {};
  const name = isStr(b.name) ? b.name.trim() : '';
  if (!name) return { error: 'falta el nombre' };
  if (name.length > MAX_NAME_LENGTH) return { error: 'el nombre es demasiado largo' };
  const id = isStr(b.id) && ID_PATTERN.test(b.id) ? b.id : slugify(name).slice(0, 64);
  if (team.members.some((m) => m.id === id)) return { team, changed: false };
  return { team: { ...team, members: [...team.members, { id, name, initials: initialsOf(name), roles: [] }] }, changed: true };
}

/** Las fotos se guardan ya reducidas en el teléfono y siempre son JPEG. */
export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// --- Validación de lo que llega al servidor -----------------------------------------

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_NAME_LENGTH = 120;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Fecha y hora ISO en UTC, como las de `Date.toISOString()` (se comparan como texto). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function isIsoDateTime(v: unknown): v is string {
  return isStr(v) && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
}
const optStr = (v: unknown) => v === undefined || isStr(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Devuelve un mensaje de error (en español) o `undefined` si la entrada es válida. */
export function checkEntry(v: unknown): string | undefined {
  if (!isObj(v)) return 'la entrada debe ser un objeto';
  if (!isStr(v.id) || !ID_PATTERN.test(v.id)) return 'id de entrada inválido';
  if (!isValidDate(v.sessionDate)) return 'sessionDate inválida';
  if (!isIsoDateTime(v.createdAt) || !isIsoDateTime(v.updatedAt)) return 'createdAt y updatedAt deben ser fechas ISO en UTC';
  if (!isStrArr(v.authorIds)) return 'authorIds debe ser una lista de ids';
  if (!optStr(v.capturedBy) || !optStr(v.robotId) || !optStr(v.subsystem) || !optStr(v.thread)) return 'campos de texto inválidos';
  if (v.section !== undefined && !(SECTIONS as readonly unknown[]).includes(v.section)) return 'sección inválida';
  if (v.kind !== undefined && !(ENTRY_KINDS as readonly unknown[]).includes(v.kind)) return 'tipo de entrada inválido';
  if (!Array.isArray(v.marks) || !v.marks.every((m) => (ENTRY_MARKS as readonly unknown[]).includes(m))) return 'marcas inválidas';
  if (v.deleted !== undefined && typeof v.deleted !== 'boolean') return 'deleted debe ser true o false';
  if (!Array.isArray(v.elements)) return 'elements debe ser una lista';
  for (const el of v.elements) {
    const msg = checkElement(el);
    if (msg) return msg;
  }
  return undefined;
}

function checkElement(el: unknown): string | undefined {
  if (!isObj(el) || !isStr(el.id)) return 'elemento inválido';
  switch (el.type) {
    case 'photo':
      if (!(isStr(el.photoId) && ID_PATTERN.test(el.photoId) && optStr(el.caption) && optStr(el.takenAt))) return 'foto inválida';
      if (el.sketch !== undefined && typeof el.sketch !== 'boolean') return 'foto inválida';
      return el.annotations === undefined ? undefined : checkAnnotations(el.annotations);
    case 'text':
      return isStr(el.text) ? undefined : 'texto inválido';
    case 'audio':
      if (!(isStr(el.audioId) && ID_PATTERN.test(el.audioId) && isStr(el.mime) && audioType(el.mime) === el.mime)) return 'nota de voz inválida';
      if (el.durationMs !== undefined && !(typeof el.durationMs === 'number' && Number.isFinite(el.durationMs) && el.durationMs >= 0)) return 'nota de voz inválida';
      return optStr(el.recordedAt) && optNote(el.caption) ? undefined : 'nota de voz inválida';
    case 'link':
      return isStr(el.url) && optStr(el.title) ? undefined : 'enlace inválido';
    case 'list':
      return isStrArr(el.items) ? undefined : 'lista inválida';
    case 'table':
      return isStrArr(el.header) && Array.isArray(el.rows) && el.rows.every(isStrArr) ? undefined : 'tabla inválida';
    case 'trials':
      return Array.isArray(el.trials) && el.trials.every((t) => isObj(t) && typeof t.ok === 'boolean' && isStr(t.at) && optStr(t.note))
        ? undefined
        : 'contador de pruebas inválido';
    case 'route':
      if (!Array.isArray(el.points) || el.points.length > MAX_ROUTE_POINTS) return 'ruta inválida';
      for (const p of el.points) {
        if (!isObj(p) || !isStr(p.id) || !isUnit(p.x) || !isUnit(p.y) || !optNote(p.action) || !optNote(p.expected) || !optNote(p.points)) return 'punto de ruta inválido';
      }
      return undefined;
    case 'devicemap': {
      if (el.kind !== 'ports' && el.kind !== 'controller') return 'mapa inválido';
      if (!isObj(el.slots)) return 'mapa inválido';
      const valid = el.kind === 'ports' ? PORT_SLOTS : CONTROLLER_SLOTS.map(([s]) => s);
      for (const [k, v] of Object.entries(el.slots)) if (!valid.includes(k) || !isStr(v) || v.length > MAX_NAME_LENGTH) return 'mapa inválido';
      return undefined;
    }
    case 'match': {
      const texts = [el.partner, el.opponents, el.ourScore, el.theirScore, el.failed, el.adjusted];
      if (!isStr(el.match) || el.match.length > MAX_NAME_LENGTH || !texts.every(optNote)) return 'partido inválido';
      if (el.alliance !== undefined && el.alliance !== 'red' && el.alliance !== 'blue') return 'alianza inválida';
      if (el.result !== undefined && !['win', 'loss', 'tie'].includes(el.result as string)) return 'resultado inválido';
      if (el.adjustedSection !== undefined && !['mechanics', 'coding', 'wiring'].includes(el.adjustedSection as string)) return 'sección del ajuste inválida';
      return undefined;
    }
    default:
      return `tipo de elemento desconocido: ${String(el.type)}`;
  }
}

export const MAX_ANNOTATIONS = 60;
const MAX_NOTE_LENGTH = 2000;

/** Número entre 0 y 1 (coordenada relativa a la imagen). */
export const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const optNote = (v: unknown) => v === undefined || (isStr(v) && v.length <= MAX_NOTE_LENGTH);

export function checkAnnotations(list: unknown): string | undefined {
  if (!Array.isArray(list) || list.length > MAX_ANNOTATIONS) return 'anotaciones inválidas';
  for (const a of list) {
    if (!isObj(a) || !isStr(a.id) || !isUnit(a.x) || !isUnit(a.y)) return 'anotación inválida';
    if (a.type === 'arrow') {
      if (!isUnit(a.tx) || !isUnit(a.ty)) return 'flecha inválida';
    } else if (a.type === 'label') {
      if (!isStr(a.letter) || a.letter.length < 1 || a.letter.length > 3) return 'etiqueta inválida';
      if ((a.tx !== undefined || a.ty !== undefined) && !(isUnit(a.tx) && isUnit(a.ty))) return 'etiqueta inválida';
      if (!optNote(a.what) || !optNote(a.does) || !optNote(a.why)) return 'etiqueta inválida';
    } else return 'anotación inválida';
  }
  return undefined;
}

export function checkAttendance(v: unknown): string | undefined {
  if (!isObj(v) || !isStr(v.memberId) || !ID_PATTERN.test(v.memberId) || !isIsoDateTime(v.checkIn)) return 'asistencia inválida';
  return undefined;
}

export function checkClosing(v: unknown): string | undefined {
  if (!isObj(v) || !isIsoDateTime(v.updatedAt)) return 'cierre inválido';
  if (!optStr(v.whatWeDid) || !optStr(v.whatFailed) || !optStr(v.whatsNext) || !optStr(v.by)) return 'cierre inválido';
  return undefined;
}

export const MAX_TASK_LENGTH = 500;

export function checkTask(v: unknown): string | undefined {
  if (!isObj(v) || !isStr(v.id) || !ID_PATTERN.test(v.id)) return 'pendiente inválido';
  if (!isStr(v.text) || v.text.trim() === '' || v.text.length > MAX_TASK_LENGTH) return 'el pendiente necesita un texto (máximo 500 caracteres)';
  if (!isValidDate(v.fromDate)) return 'fromDate inválida';
  if (v.source !== 'closing' && v.source !== 'manual') return 'source debe ser "closing" o "manual"';
  if (!isIsoDateTime(v.createdAt) || !isIsoDateTime(v.updatedAt)) return 'createdAt y updatedAt deben ser fechas ISO en UTC';
  if (!optStr(v.createdBy)) return 'pendiente inválido';
  if (v.done !== undefined && !(isObj(v.done) && isIsoDateTime(v.done.at) && optStr(v.done.by))) return 'done inválido';
  if (v.snoozedUntil !== undefined && !isValidDate(v.snoozedUntil)) return 'snoozedUntil inválida';
  if (v.deleted !== undefined && typeof v.deleted !== 'boolean') return 'deleted debe ser true o false';
  return undefined;
}

export function checkTeam(v: unknown): string | undefined {
  if (!isObj(v) || v.format !== TEAM_FORMAT) return `el equipo debe tener "format": "${TEAM_FORMAT}"`;
  if (!isObj(v.team) || !isStr(v.team.name)) return 'falta team.name';
  if (!Array.isArray(v.members)) return 'falta la lista de integrantes';
  const ids = new Set<string>();
  for (const m of v.members) {
    if (!isObj(m) || !isStr(m.id) || !ID_PATTERN.test(m.id) || !isStr(m.name) || m.name.trim() === '' || m.name.length > MAX_NAME_LENGTH) return 'integrante inválido';
    if (ids.has(m.id)) return `id de integrante repetido: ${m.id}`;
    ids.add(m.id);
  }
  if (!Array.isArray(v.robots)) return 'falta la lista de robots';
  for (const r of v.robots) {
    if (!isObj(r) || !isStr(r.id) || !isStr(r.name) || !isStrArr(r.subsystems)) return 'robot inválido';
    for (const k of ['ports', 'controller'] as const) {
      const hist = r[k];
      if (hist === undefined) continue;
      if (!Array.isArray(hist) || hist.length > 200) return `historial de ${k} inválido`;
      for (const v of hist) {
        if (!isObj(v) || !isValidDate(v.date) || !isIsoDateTime(v.savedAt) || !optStr(v.by) || !isObj(v.slots)) return `versión de ${k} inválida`;
        if (!Object.values(v.slots).every((s) => isStr(s) && s.length <= MAX_NAME_LENGTH)) return `versión de ${k} inválida`;
      }
    }
  }
  return undefined;
}
