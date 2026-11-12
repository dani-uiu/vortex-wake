/**
 * Modelo de datos de la captura (borrador de la sección 4 del plan).
 *
 * Estos tipos describen lo que el equipo captura desde el celular. Todavía no
 * los usa ninguna aplicación: el generador consume `NotebookDocument`
 * (ver `notebook.ts`), que es lo que resulta de armar páginas con estas
 * micro-entradas.
 */

/** Fecha sin hora, en formato `AAAA-MM-DD`. */
export type IsoDate = string;
/** Fecha y hora en formato ISO 8601. */
export type IsoDateTime = string;

export type SectionId = 'mechanics' | 'coding' | 'wiring' | 'strategy';

export interface Member {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface Attendance {
  memberId: string;
  checkIn: IsoDateTime;
}

export type SessionStatus = 'draft' | 'reviewed' | 'published';

export interface Session {
  id: string;
  date: IsoDate;
  attendees: Attendance[];
  /** Cierre de tres preguntas al salir del taller. */
  closing?: { whatWeDid?: string; whatFailed?: string; whatsNext?: string };
  status: SessionStatus;
}

export type EntryKind =
  | 'problem'
  | 'brainstorm'
  | 'build'
  | 'test'
  | 'decision'
  | 'mechanism'
  | 'code'
  | 'wiring'
  | 'strategy'
  | 'autonomous'
  | 'reflection'
  | 'dailyWork';

export type EntryMark = 'normal' | 'milestone' | 'printed3d' | 'bugFound' | 'keyDecision' | 'tournament' | 'change' | 'inspiration';

export type DesignStep = 'define' | 'develop' | 'optimize' | 'reflect';

export interface Entry {
  id: string;
  sessionId: string;
  capturedAt: IsoDateTime;
  authorIds: string[];
  kind: EntryKind;
  marks: EntryMark[];
  designStep?: DesignStep;
  section?: SectionId;
  subsystem?: string;
  threadId?: string;
  text?: string;
  /** Traducción opcional al inglés, para torneos fuera de México. */
  translation?: string;
  attachments: Attachment[];
  status: 'pending' | 'classified' | 'used';
  origin: 'live' | 'reconstruction';
}

export type Attachment =
  | { kind: 'photo'; id: string; file: string; caption?: string; takenAt?: IsoDateTime }
  | { kind: 'table'; id: string; header: string[]; rows: string[][] }
  | { kind: 'decisionMatrix'; id: string; criteria: { name: string; weight: number }[]; options: { name: string; scores: number[] }[] }
  | { kind: 'list'; id: string; items: string[] }
  | { kind: 'testResults'; id: string; trials: { ok: boolean; note?: string }[] }
  | { kind: 'commit'; id: string; repo: string; sha: string; message?: string }
  | { kind: 'link'; id: string; url: string; title?: string; inspiration?: boolean }
  | { kind: 'file'; id: string; file: string; name: string };

export interface Thread {
  id: string;
  name: string;
  subsystem?: string;
  open: boolean;
}

export interface Page {
  id: string;
  entryIds: string[];
  layout: string;
  pageNumber?: string;
  /** Se congela al publicar. */
  publishedAt?: IsoDateTime;
}
