/**
 * Estado de la app y acciones. Todo se guarda primero en el teléfono
 * (IndexedDB) y después se manda con la cola de pendientes.
 */

import {
  audioType,
  closingNudge,
  emptySession,
  later,
  type ClosingNudge,
  localDate,
  mergeAttendance,
  mergeSessions,
  newId,
  nextDay,
  slugify,
  tasksFromClosing,
  visibleTasks,
  type TaskItem,
  type AccessLevel,
  type CaptureSession,
  type Entry,
  type EntryElement,
  type EntryKind,
  type SectionId,
  type SessionClosing,
  type TeamConfig,
} from '@vortex-wake/shared';
import { ApiClient } from './api-client.ts';
import { LocalDb, type StoredPhoto } from './db.ts';
import { exifDate, isJpeg, resizePhoto } from './image.ts';
import { HttpStatusError, NetworkError, SyncQueue, type FlushResult } from './sync-queue.ts';

const LS_KEY = 'vw.key';
const LS_ME = 'vw.me';
const LS_AUTHORS = 'vw.lastAuthors';
const LS_ACCESS = 'vw.access';
/** Más el id de la persona: lo último que clasificó en este teléfono. */
const LS_RECENT = 'vw.recent.';
/** Más la fecha: "Ahora no" en el recordatorio de cierre de ese día (solo en este teléfono). */
const LS_NUDGE = 'vw.nudge.';

/** Clasificación recordada en el teléfono (solo para proponerla; no se guarda en el servidor). */
export interface Classification {
  robotId?: string;
  subsystem?: string;
  kind?: EntryKind;
  section?: SectionId;
}
export interface Recent {
  last?: Classification;
  /** Robot + subsistema usados, el más reciente primero. */
  targets: { robotId?: string; subsystem?: string }[];
}
export const LS_HOSTED = 'vw.hosted';

export type EntryStatus = 'local' | 'sent' | 'error';

export interface SyncState {
  /** `undefined` mientras no se sabe. */
  online: boolean | undefined;
  pending: number;
  unauthorized: boolean;
  lastError?: string;
  lastContact?: number;
}

export function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
export function lsSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* modo privado: se sigue sin recordar */
  }
}

/**
 * Toma la clave del enlace, la guarda en el teléfono y la quita de la barra de
 * direcciones (para que no quede en capturas de pantalla ni en el historial).
 *
 * Formas aceptadas: `/?k=CLAVE` (servidor local), `/#k=CLAVE` (versión
 * hospedada: lo que va después de `#` no llega al servidor ni a sus registros)
 * y `/#/ruta?k=CLAVE` (por ejemplo `#/escritorio?k=CLAVE`).
 */
export function takeKeyFromUrl(): string | null {
  const url = new URL(location.href);
  let k = url.searchParams.get('k');
  url.searchParams.delete('k');
  const hash = url.hash.slice(1);
  const q = hash.startsWith('k=') ? 0 : hash.indexOf('?') + 1;
  if (q > 0 || hash.startsWith('k=')) {
    const route = q > 0 ? hash.slice(0, q - 1) : '';
    const params = new URLSearchParams(hash.slice(q));
    const fromHash = params.get('k');
    if (fromHash) {
      k = fromHash;
      params.delete('k');
      const rest = params.toString();
      url.hash = route + (rest ? `?${rest}` : '');
    }
  }
  if (k) {
    lsSet(LS_KEY, k);
    history.replaceState(null, '', url.pathname + url.search + (url.hash.length > 1 ? url.hash : ''));
  }
  return lsGet(LS_KEY);
}

export class App {
  readonly db: LocalDb;
  readonly api: ApiClient;
  readonly queue: SyncQueue;
  team: TeamConfig | undefined;
  me: string | undefined;
  readonly entries = new Map<string, Entry>();
  readonly sessions = new Map<string, CaptureSession>();
  readonly tasks = new Map<string, TaskItem>();
  pendingKeys = new Map<string, string | undefined>();
  sync: SyncState = { online: undefined, pending: 0, unauthorized: false };
  /** Qué permite la clave de este teléfono (el servidor local no lo dice: permite todo). */
  access: AccessLevel = (lsGet(LS_ACCESS) as AccessLevel | null) ?? 'edit';
  /** Versión hospedada (Worker con HTTPS) o servidor local. */
  hosted = lsGet(LS_HOSTED) === '1';
  /** Vista de computadora: trae todas las sesiones, no solo la de hoy. */
  wide = false;
  private readonly listeners = new Set<() => void>();
  private readonly photoUrls = new Map<string, string>();
  private timer: number | undefined;
  private tickCount = 0;

  constructor(db: LocalDb, key: string) {
    this.db = db;
    this.api = new ApiClient(key);
    this.queue = new SyncQueue(db, this.api);
    this.me = lsGet(LS_ME) ?? undefined;
  }

  get today(): string {
    return localDate();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    this.team = await this.db.getTeam();
    for (const e of await this.db.allEntries()) this.entries.set(e.id, e);
    for (const s of await this.db.allSessions()) this.sessions.set(s.date, s);
    for (const t of await this.db.allTasks()) this.tasks.set(t.id, t);
    await this.refreshPending();
    await this.recoverPhotos();
    addEventListener('online', () => void this.tick(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.tick(true);
    });
    this.timer = window.setInterval(() => void this.tick(false), 4000);
    await this.tick(true);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  // --- sincronización --------------------------------------------------------------

  private async refreshPending(): Promise<void> {
    const ops = await this.db.listOps();
    this.pendingKeys = new Map(ops.map((o) => [o.key, o.lastError]));
    this.sync.pending = ops.length;
    const err = ops.find((o) => o.lastError && o.lastError !== 'sin conexión');
    if (err?.lastError) this.sync.lastError = err.lastError;
    else delete this.sync.lastError;
  }

  /** Revisa conexión (trayendo lo nuevo del servidor) y manda lo pendiente. */
  async tick(force: boolean): Promise<void> {
    this.tickCount++;
    // La vista de computadora trae todas las sesiones: se pide con menos
    // frecuencia (cada ~16 s en vez de ~8 s) para no gastar lecturas de la base.
    if (force || this.tickCount % (this.wide ? 4 : 2) === 0 || this.sync.online !== true) {
      const wasOnline = this.sync.online;
      await this.pull();
      if (this.sync.online && wasOnline !== true) await this.queue.retryNow();
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    let r: FlushResult | undefined;
    try {
      r = await this.queue.flush();
    } catch (e) {
      console.error(e);
    }
    if (r) {
      if (r.unauthorized) this.sync.unauthorized = true;
      if (!r.online) this.sync.online = false;
      else if (r.sent > 0) {
        this.sync.online = true;
        this.sync.lastContact = Date.now();
      }
    }
    await this.refreshPending();
    // Si el servidor devolvió versiones más nuevas, se recargan.
    if (r && r.sent > 0) for (const e of await this.db.allEntries()) this.entries.set(e.id, e);
    this.emit();
  }

  async pull(): Promise<void> {
    try {
      const s = await this.api.state(this.wide ? undefined : this.today);
      this.sync.online = true;
      this.sync.unauthorized = false;
      this.sync.lastContact = Date.now();
      this.access = s.access ?? 'edit';
      this.hosted = s.hosted === true;
      lsSet(LS_ACCESS, this.access);
      lsSet(LS_HOSTED, this.hosted ? '1' : null);
      // Con ?date= también llegan las sesiones de los días anteriores (para el recordatorio de cierre).
      await this.applyServerState(s.team, [...(s.recentSessions ?? []), ...s.sessions], s.entries);
      await this.applyServerTasks(s.tasks ?? []);
    } catch (e) {
      if (e instanceof NetworkError) this.sync.online = false;
      else if (e instanceof HttpStatusError && e.status === 401) {
        this.sync.online = true;
        this.sync.unauthorized = true;
      } else console.error(e);
    }
    this.emit();
  }

  private async applyServerState(team: TeamConfig, sessions: CaptureSession[], entries: Entry[]): Promise<void> {
    // Equipo: el del servidor, más integrantes agregados aquí que aún no se mandan.
    const localOnly = (this.team?.members ?? []).filter((m) => this.pendingKeys.has(`member:${m.id}`) && !team.members.some((x) => x.id === m.id));
    this.team = { ...team, members: [...team.members, ...localOnly] };
    await this.db.setTeam(this.team);
    for (const s of sessions) {
      const local = this.sessions.get(s.date);
      const merged = local ? mergeSessions(local, s) : s;
      this.sessions.set(s.date, merged);
      await this.db.putSession(merged);
    }
    for (const e of entries) {
      const local = this.entries.get(e.id);
      if (this.pendingKeys.has(`entry:${e.id}`)) continue; // lo de aquí todavía no se manda
      if (!local || e.updatedAt > local.updatedAt) {
        this.entries.set(e.id, e);
        await this.db.putEntry(e);
      }
    }
  }

  private async applyServerTasks(tasks: TaskItem[]): Promise<void> {
    for (const t of tasks) {
      if (this.pendingKeys.has(`task:${t.id}`)) continue; // lo de aquí todavía no se manda
      const local = this.tasks.get(t.id);
      if (!local || t.updatedAt > local.updatedAt) {
        this.tasks.set(t.id, t);
        await this.db.putTask(t);
      }
    }
  }

  // --- recordatorio de cierre -----------------------------------------------------------

  /** Sesión que quedó sin cierre (o la de hoy, si ya pasó un rato sin capturas). */
  closingNudge(): ClosingNudge | undefined {
    return closingNudge({
      today: this.today,
      now: Date.now(),
      sessions: this.sessions.values(),
      entries: this.entries.values(),
      dismissed: (d) => lsGet(LS_NUDGE + d) === '1',
    });
  }

  dismissNudge(date: string): void {
    lsSet(LS_NUDGE + date, '1');
    this.emit();
  }

  // --- pendientes ---------------------------------------------------------------------

  /** Pendientes que se ven hoy (de cierres anteriores, a mano, sin pospuestos). */
  visibleTasks(date = this.today): TaskItem[] {
    return visibleTasks(this.tasks.values(), date, (iso) => localDate(new Date(iso)));
  }

  /** Guarda en el teléfono y anota el envío (como las entradas). */
  async saveTask(task: TaskItem, emit = true): Promise<TaskItem> {
    const prev = this.tasks.get(task.id);
    const saved: TaskItem = { ...task, updatedAt: prev ? later(new Date().toISOString(), prev.updatedAt) : task.updatedAt };
    await this.db.putTask(saved);
    this.tasks.set(saved.id, saved);
    await this.queue.enqueue({ kind: 'task', taskId: saved.id });
    this.pendingKeys.set(`task:${saved.id}`, undefined);
    if (emit) {
      this.emit();
      void this.flush();
    }
    return saved;
  }

  async addTask(text: string): Promise<TaskItem> {
    const now = new Date().toISOString();
    const t: TaskItem = { id: `m-${newId()}`, text: text.trim(), fromDate: this.today, source: 'manual', createdAt: now, updatedAt: now };
    if (this.me) t.createdBy = this.me;
    return this.saveTask(t);
  }

  async setTaskDone(id: string, done: boolean): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) return;
    const next = { ...t };
    if (done) next.done = { at: new Date().toISOString(), ...(this.me ? { by: this.me } : {}) };
    else delete next.done;
    await this.saveTask(next);
  }

  /** Pospone hasta la siguiente sesión (cualquier día después de hoy). */
  async snoozeTask(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (t) await this.saveTask({ ...t, snoozedUntil: nextDay(this.today) });
  }

  async dropTask(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (t) await this.saveTask({ ...t, deleted: true });
  }

  entryStatus(e: Entry): EntryStatus {
    const keys = [`entry:${e.id}`, ...e.elements.flatMap((el) => (el.type === 'photo' ? [`photo:${el.photoId}`] : el.type === 'audio' ? [`audio:${el.audioId}`] : []))];
    let pending = false;
    for (const k of keys) {
      if (!this.pendingKeys.has(k)) continue;
      pending = true;
      const err = this.pendingKeys.get(k);
      if (err && err !== 'sin conexión') return 'error';
    }
    return pending ? 'local' : 'sent';
  }

  // --- integrantes y asistencia ------------------------------------------------------

  memberName(id: string): string {
    return this.team?.members.find((m) => m.id === id)?.name ?? id;
  }

  session(date = this.today): CaptureSession {
    return this.sessions.get(date) ?? emptySession(date);
  }

  presentIds(date = this.today): string[] {
    return this.session(date).attendance.map((a) => a.memberId);
  }

  async chooseMember(id: string): Promise<void> {
    this.me = id;
    lsSet(LS_ME, id);
    const date = this.today;
    const attendance = { memberId: id, checkIn: new Date().toISOString() };
    const merged = mergeAttendance(this.session(date), attendance);
    this.sessions.set(date, merged);
    await this.db.putSession(merged);
    if (!this.lastAuthors().includes(id)) this.setLastAuthors([id]);
    await this.queue.enqueue({ kind: 'attendance', date, attendance });
    this.emit();
    void this.flush();
  }

  async addMember(name: string): Promise<string> {
    const clean = name.trim();
    let id = slugify(clean);
    const team = this.team;
    if (!team) throw new Error('todavía no se carga el equipo');
    const existing = team.members.find((m) => m.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    while (team.members.some((m) => m.id === id)) id = `${slugify(clean)}-${newId().slice(0, 4)}`;
    this.team = { ...team, members: [...team.members, { id, name: clean, roles: [] }] };
    await this.db.setTeam(this.team);
    await this.queue.enqueue({ kind: 'member', memberId: id, name: clean });
    void this.flush();
    return id;
  }

  /** Lo último que esta persona clasificó en este teléfono (para proponerlo). */
  recent(): Recent {
    if (!this.me) return { targets: [] };
    try {
      const v = JSON.parse(lsGet(LS_RECENT + this.me) ?? 'null') as Partial<Recent> | null;
      if (v && typeof v === 'object' && Array.isArray(v.targets)) return { targets: v.targets.filter((t) => t && typeof t === 'object'), ...(v.last && typeof v.last === 'object' ? { last: v.last } : {}) };
    } catch {
      /* dato viejo o dañado: se empieza de cero */
    }
    return { targets: [] };
  }

  rememberClassification(e: Entry): void {
    if (!this.me) return;
    const c: Classification = {};
    if (e.robotId) c.robotId = e.robotId;
    if (e.subsystem) c.subsystem = e.subsystem;
    if (e.kind) c.kind = e.kind;
    if (e.section) c.section = e.section;
    if (Object.keys(c).length === 0) return;
    const r = this.recent();
    r.last = c;
    if (c.robotId || c.subsystem) {
      const t: Recent['targets'][number] = {};
      if (c.robotId) t.robotId = c.robotId;
      if (c.subsystem) t.subsystem = c.subsystem;
      r.targets = [t, ...r.targets.filter((x) => x.robotId !== t.robotId || x.subsystem !== t.subsystem)].slice(0, 6);
    }
    lsSet(LS_RECENT + this.me, JSON.stringify(r));
  }

  lastAuthors(): string[] {
    try {
      const v = JSON.parse(lsGet(LS_AUTHORS) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
  setLastAuthors(ids: string[]): void {
    lsSet(LS_AUTHORS, JSON.stringify(ids));
  }

  // --- entradas ----------------------------------------------------------------------

  newEntry(elements: EntryElement[] = []): Entry {
    const now = new Date().toISOString();
    const authors = this.lastAuthors();
    const e: Entry = {
      id: newId(),
      sessionDate: this.today,
      createdAt: now,
      updatedAt: now,
      // Por defecto, quien tiene el teléfono; "+ alguien más" agrega a otros.
      authorIds: this.me ? [this.me] : authors,
      marks: [],
      elements,
    };
    if (this.me) e.capturedBy = this.me;
    return e;
  }

  /** Guarda en el teléfono (al instante) y anota el envío. */
  async saveEntry(entry: Entry): Promise<Entry> {
    const prev = this.entries.get(entry.id);
    let updatedAt = new Date().toISOString();
    if (prev && updatedAt <= prev.updatedAt) updatedAt = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
    const saved: Entry = structuredClone({ ...entry, updatedAt });
    await this.db.putEntry(saved);
    this.entries.set(saved.id, saved);
    await this.queue.enqueue({ kind: 'entry', entryId: saved.id });
    this.pendingKeys.set(`entry:${saved.id}`, undefined);
    this.emit();
    void this.flush();
    return saved;
  }

  async deleteEntry(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (e) await this.saveEntry({ ...e, deleted: true });
  }

  liveEntries(date?: string): Entry[] {
    return [...this.entries.values()]
      .filter((e) => !e.deleted && (!date || e.sessionDate === date))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  threads(): string[] {
    const seen = new Map<string, string>();
    for (const e of this.entries.values()) if (e.thread && !e.deleted) {
      const prev = seen.get(e.thread);
      if (!prev || e.updatedAt > prev) seen.set(e.thread, e.updatedAt);
    }
    return [...seen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([t]) => t);
  }

  // --- fotos -------------------------------------------------------------------------

  /**
   * Foto primero: guarda el original en el teléfono y la entrada (nueva o
   * existente) en ese mismo momento; después reduce la foto en segundo plano.
   */
  async addPhotos(files: File[], entryId?: string, opts: { sketch?: boolean; kind?: EntryKind } = {}): Promise<Entry | undefined> {
    if (files.length === 0) return undefined;
    let entry = entryId ? this.entries.get(entryId) : undefined;
    entry = entry ? structuredClone(entry) : this.newEntry();
    if (opts.kind && !entry.kind) entry.kind = opts.kind;
    const toProcess: StoredPhoto[] = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const id = newId();
      const takenAt = exifDate(new Uint8Array(bytes)) ?? new Date(file.lastModified || Date.now()).toISOString();
      const photo: StoredPhoto = { id, entryId: entry.id, bytes, type: file.type || 'image/jpeg', processed: false, takenAt };
      await this.db.putPhoto(photo);
      // El envío se anota antes de guardar la entrada: si la pestaña se cierra
      // aquí, al abrir se recupera la entrada a partir de la foto.
      await this.queue.enqueue({ kind: 'photo', photoId: id });
      this.pendingKeys.set(`photo:${id}`, undefined);
      entry.elements.push({ id: newId(), type: 'photo', photoId: id, takenAt, ...(opts.sketch ? { sketch: true } : {}) });
      toProcess.push(photo);
    }
    const saved = await this.saveEntry(entry);
    void this.processPhotos(toProcess);
    return saved;
  }

  private async processPhotos(photos: StoredPhoto[]): Promise<void> {
    for (const p of photos) {
      let done: StoredPhoto;
      try {
        const r = await resizePhoto(p.bytes, p.type);
        done = { ...p, bytes: r.bytes, type: 'image/jpeg', processed: true, width: r.width, height: r.height };
      } catch (e) {
        // Si el navegador no puede leerla pero ya es JPEG, se manda como está.
        done = { ...p, processed: true, error: isJpeg(p.bytes) ? undefined : (e as Error).message };
        if (!done.error) delete done.error;
      }
      await this.db.putPhoto(done);
      const old = this.photoUrls.get(p.id);
      if (old) {
        URL.revokeObjectURL(old);
        this.photoUrls.delete(p.id);
      }
    }
    this.emit();
    void this.flush();
  }

  /** Al abrir: fotos que quedaron sin reducir, o sin entrada si se cerró la pestaña a la mitad. */
  private async recoverPhotos(): Promise<void> {
    const photos = await this.db.allPhotos();
    const pending = photos.filter((p) => !p.processed);
    for (const p of photos) {
      const e = this.entries.get(p.entryId);
      if (e) continue;
      const entry = this.newEntry([{ id: newId(), type: 'photo', photoId: p.id, ...(p.takenAt ? { takenAt: p.takenAt } : {}) }]);
      entry.id = p.entryId;
      await this.saveEntry(entry);
      await this.queue.enqueue({ kind: 'photo', photoId: p.id });
    }
    if (pending.length > 0) void this.processPhotos(pending);
  }

  /** URL para mostrar una foto: la del teléfono si está, si no la del servidor. */
  async photoUrl(id: string): Promise<string> {
    const cached = this.photoUrls.get(id);
    if (cached) return cached;
    const p = await this.db.getPhoto(id);
    if (!p) return this.api.photoUrl(id);
    const url = URL.createObjectURL(new Blob([p.bytes], { type: p.type }));
    this.photoUrls.set(id, url);
    return url;
  }

  async photoBytes(id: string): Promise<Uint8Array> {
    const p = await this.db.getPhoto(id);
    if (p?.processed && isJpeg(p.bytes)) return new Uint8Array(p.bytes);
    return this.api.photo(id);
  }

  // --- notas de voz ------------------------------------------------------------------

  /**
   * Guarda una nota de voz en el teléfono y la agrega a la entrada (después
   * del elemento `afterId`, si se da). Como las fotos: primero el audio y su
   * envío, después la entrada.
   */
  async addAudio(entryId: string, blob: Blob, durationMs: number, afterId?: string): Promise<Entry | undefined> {
    const found = this.entries.get(entryId);
    if (!found) return undefined;
    const entry = structuredClone(found);
    const mime = audioType(blob.type) ?? 'audio/webm';
    const id = newId();
    await this.db.putAudio({ id, entryId, bytes: await blob.arrayBuffer(), mime });
    await this.queue.enqueue({ kind: 'audio', audioId: id });
    this.pendingKeys.set(`audio:${id}`, undefined);
    const el: EntryElement = { id: newId(), type: 'audio', audioId: id, mime, durationMs: Math.round(durationMs), recordedAt: new Date().toISOString() };
    const at = afterId ? entry.elements.findIndex((x) => x.id === afterId) : -1;
    if (at >= 0) entry.elements.splice(at + 1, 0, el);
    else entry.elements.push(el);
    return this.saveEntry(entry);
  }

  /** URL para escuchar una nota de voz: la del teléfono si está, si no la del servidor. */
  async audioUrl(id: string): Promise<string> {
    const cached = this.photoUrls.get(`audio:${id}`);
    if (cached) return cached;
    const a = await this.db.getStoredAudio(id);
    if (!a) return this.api.audioUrl(id);
    const url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }));
    this.photoUrls.set(`audio:${id}`, url);
    return url;
  }

  // --- cierre ------------------------------------------------------------------------

  async saveClosing(c: Omit<SessionClosing, 'updatedAt' | 'by'>, date = this.today): Promise<void> {
    const closing: SessionClosing = { ...c, updatedAt: new Date().toISOString() };
    if (this.me) closing.by = this.me;
    const s = { ...this.session(date), closing };
    this.sessions.set(date, s);
    await this.db.putSession(s);
    await this.queue.enqueue({ kind: 'closing', date });
    // Cada renglón de "¿Qué sigue?" es un pendiente para la siguiente sesión.
    for (const t of tasksFromClosing(date, closing.whatsNext, this.tasks.values(), closing.updatedAt, this.me)) await this.saveTask(t, false);
    this.emit();
    void this.flush();
  }
}
