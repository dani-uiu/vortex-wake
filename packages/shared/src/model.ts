/**
 * Modelo de datos de la captura: lo que el equipo registra desde el celular.
 *
 * Una sesión es un día de taller (su id es la fecha). Una micro-entrada es un
 * contenedor de elementos (fotos, texto, enlaces, listas, tablas y contador de
 * pruebas) con una clasificación opcional. El armado automático
 * (`assemble.ts`) convierte estas entradas en el documento de páginas que
 * consume el generador (`notebook.ts`).
 *
 * Los ids los genera el cliente (`newId()`), así que mandar dos veces lo mismo
 * no duplica nada.
 */

/** Fecha sin hora, en formato `AAAA-MM-DD`. */
export type IsoDate = string;
/** Fecha y hora en formato ISO 8601. */
export type IsoDateTime = string;

export type SectionId = 'mechanics' | 'coding' | 'wiring' | 'strategy';

// --- Equipo ---------------------------------------------------------------------

export const TEAM_FORMAT = 'vortex-wake/team';

export interface TeamConfig {
  format: typeof TEAM_FORMAT;
  version: 1;
  team: { name: string; number?: string; school?: string };
  /** Si falta, se toma de la primera y la última sesión. */
  season?: { start: IsoDate; end: IsoDate };
  members: TeamMember[];
  robots: Robot[];
  /** Integrantes que firman las páginas automáticas (quienes arman la bitácora). */
  editors?: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  roles?: string[];
  grade?: string;
  /** Si falta, se calculan del nombre. */
  initials?: string;
  /** `false` lo oculta de la lista de entrada sin borrar su historia. */
  active?: boolean;
}

export interface Robot {
  id: string;
  name: string;
  subsystems: string[];
}

// --- Sesiones -------------------------------------------------------------------

export interface Attendance {
  memberId: string;
  checkIn: IsoDateTime;
}

export interface SessionClosing {
  whatWeDid?: string;
  whatFailed?: string;
  whatsNext?: string;
  /** Integrante que lo escribió. */
  by?: string;
  updatedAt: IsoDateTime;
}

export interface CaptureSession {
  /** La fecha es el id: una sesión = un día. */
  date: IsoDate;
  attendance: Attendance[];
  closing?: SessionClosing;
}

// --- Pendientes ----------------------------------------------------------------------

/**
 * Un pendiente entre sesiones. Los que salen de "¿Qué sigue?" del cierre
 * tienen un id que se calcula de la fecha y el texto del renglón
 * (`closingTaskId`), así que dos teléfonos que guardan el mismo cierre no los
 * duplican. Gana la versión con `updatedAt` más reciente, como las entradas.
 */
export interface TaskItem {
  id: string;
  text: string;
  /** Día de la sesión en que se anotó. */
  fromDate: IsoDate;
  /** `closing`: un renglón de "¿Qué sigue?"; `manual`: se agregó a mano. */
  source: 'closing' | 'manual';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy?: string;
  /** Quién lo marcó como hecho y cuándo. */
  done?: { by?: string; at: IsoDateTime };
  /** Pospuesto: no se muestra antes de este día. */
  snoozedUntil?: IsoDate;
  /** Ya no aplica (o se quitó el renglón del cierre). */
  deleted?: boolean;
}

// --- Micro-entradas ----------------------------------------------------------------

/** Tipos de entrada: los tipos de página de la plantilla más "trabajo del día". */
export type EntryKind =
  | 'dailyWork'
  | 'problem'
  | 'brainstorm'
  | 'buildIteration'
  | 'test'
  | 'decision'
  | 'mechanism'
  | 'codeDoc'
  | 'wiringDoc'
  | 'reflection'
  | 'gameAnalysis'
  | 'autonomousPlan'
  /** Un partido de torneo (modo torneo): va a la página de registro del torneo. */
  | 'tournamentLog';

export type EntryMark = 'normal' | 'milestone' | 'printed3d' | 'bugFound' | 'keyDecision' | 'change' | 'inspiration' | 'tournament';

export interface Trial {
  ok: boolean;
  at: IsoDateTime;
  note?: string;
}

/**
 * Anotaciones sobre una foto: se guardan como datos (no se queman en la
 * imagen) para poder editarlas. Las coordenadas son relativas a la imagen
 * (0 a 1; x hacia la derecha, y hacia abajo).
 */
export interface PhotoLabel {
  id: string;
  type: 'label';
  /** "A", "B"… (se asigna sola). */
  letter: string;
  /** Dónde va la letra. */
  x: number;
  y: number;
  /** Punta de la flecha de la etiqueta, si apunta a algo. */
  tx?: number;
  ty?: number;
  /** Qué es. */
  what?: string;
  /** Qué hace. */
  does?: string;
  /** Por qué está ahí. */
  why?: string;
}

export interface PhotoArrow {
  id: string;
  type: 'arrow';
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export type PhotoAnnotation = PhotoLabel | PhotoArrow;

export type EntryElement =
  | {
      id: string;
      type: 'photo';
      photoId: string;
      caption?: string;
      takenAt?: IsoDateTime;
      /** Flechas y etiquetas (opcional; las entradas viejas no lo traen). */
      annotations?: PhotoAnnotation[];
      /** Boceto dibujado en la app (no una foto de cámara). */
      sketch?: boolean;
    }
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'link'; url: string; title?: string }
  | { id: string; type: 'list'; items: string[] }
  | { id: string; type: 'table'; header: string[]; rows: string[][] }
  | { id: string; type: 'trials'; trials: Trial[] }
  | MatchElement;

/** Secciones con registro de cambios (a donde puede ir lo que "se ajustó"). */
export type ChangeSection = 'mechanics' | 'coding' | 'wiring';

/** Un partido de torneo, rápido de llenar entre partidos. Todo es opcional salvo el nombre. */
export interface MatchElement {
  id: string;
  type: 'match';
  /** Número o nombre del partido: "Q12", "Semifinal 2-1". */
  match: string;
  alliance?: 'red' | 'blue';
  partner?: string;
  opponents?: string;
  ourScore?: string;
  theirScore?: string;
  result?: 'win' | 'loss' | 'tie';
  failed?: string;
  adjusted?: string;
  /** Si lo que se ajustó va al registro de cambios, de qué sección. */
  adjustedSection?: ChangeSection;
}

export const MATCH_RESULT_LABELS: Record<NonNullable<MatchElement['result']>, string> = { win: 'Ganamos', loss: 'Perdimos', tie: 'Empate' };
export const ALLIANCE_LABELS: Record<NonNullable<MatchElement['alliance']>, string> = { red: 'Roja', blue: 'Azul' };

export type ElementType = EntryElement['type'];

export interface Entry {
  id: string;
  /** Día de la sesión (fecha local del teléfono al capturar). */
  sessionDate: IsoDate;
  createdAt: IsoDateTime;
  /** Gana la versión más reciente cuando dos teléfonos editan la misma entrada. */
  updatedAt: IsoDateTime;
  /** Quien tenía abierta la app al capturar (autor de respaldo). */
  capturedBy?: string;
  authorIds: string[];
  robotId?: string;
  subsystem?: string;
  section?: SectionId;
  kind?: EntryKind;
  marks: EntryMark[];
  /** Hilo: la historia a la que pertenece ("intake v2"). */
  thread?: string;
  elements: EntryElement[];
  /** Borrado lógico, para que el borrado también se sincronice. */
  deleted?: boolean;
}

/** Una entrada está "sin clasificar" si le falta la sección o el tipo. */
export function isUnclassified(e: Entry): boolean {
  return !e.section || !e.kind;
}

// --- Etiquetas de la interfaz (español de México) ------------------------------------

export const SECTION_LABELS: Record<SectionId, string> = {
  mechanics: 'Mecánica',
  coding: 'Programación',
  wiring: 'Cableado',
  strategy: 'Estrategia',
};

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  dailyWork: 'Trabajo del día',
  problem: 'Problema y criterios',
  brainstorm: 'Lluvia de ideas',
  buildIteration: 'Construcción',
  test: 'Prueba',
  decision: 'Decisión',
  mechanism: 'Mecanismo',
  codeDoc: 'Código',
  wiringDoc: 'Cableado',
  reflection: 'Reflexión',
  gameAnalysis: 'Análisis del juego',
  autonomousPlan: 'Autónomo',
  tournamentLog: 'Partido de torneo',
};

export const ENTRY_KINDS = Object.keys(ENTRY_KIND_LABELS) as EntryKind[];

export const MARK_LABELS: Record<EntryMark, string> = {
  normal: 'Día normal',
  milestone: 'Hito',
  printed3d: 'Pieza 3D',
  bugFound: 'Error descubierto',
  keyDecision: 'Decisión clave',
  change: 'Cambio',
  inspiration: 'Inspiración',
  tournament: 'Torneo',
};

export const ENTRY_MARKS = Object.keys(MARK_LABELS) as EntryMark[];

// --- Utilidades --------------------------------------------------------------------

/** Letras de etiqueta en orden: A…Z, luego AA, AB… */
export function labelLetter(i: number): string {
  const A = 65;
  return i < 26 ? String.fromCharCode(A + i) : String.fromCharCode(A + Math.floor(i / 26) - 1) + String.fromCharCode(A + (i % 26));
}

/** La primera letra que no está usada. */
export function nextLabelLetter(used: Iterable<string>): string {
  const set = new Set(used);
  for (let i = 0; ; i++) if (!set.has(labelLetter(i))) return labelLetter(i);
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Id aleatorio de 20 caracteres. Usa `crypto.getRandomValues`, que sí existe
 * en páginas servidas por HTTP en la red local (`crypto.randomUUID` no).
 */
export function newId(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % 36];
  return out;
}

/** Fecha local `AAAA-MM-DD` (no UTC: una sesión es un día del taller). */
export function localDate(d: Date = new Date()): IsoDate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Iniciales a partir del nombre: "Ana María Ruiz" → "AMR". */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Id legible a partir de un nombre: "Ana Ruiz" → "ana-ruiz". */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'x';
}
