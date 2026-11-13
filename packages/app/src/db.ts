/**
 * Almacén del teléfono en IndexedDB (funciona en HTTP sin contexto seguro).
 *
 * - entries:  micro-entradas (clave id)
 * - photos:   fotos (bytes como ArrayBuffer, no Blob: más compatible con Safari)
 * - outbox:   cola de pendientes (sync-queue.ts)
 * - sessions: sesiones del día (asistencia y cierre)
 * - kv:       equipo y otros datos sueltos
 *
 * Cada escritura es su propia transacción y se espera a que termine
 * (`oncomplete`) antes de dar por guardado algo.
 */

import type { CaptureSession, Entry, SessionClosing, TaskItem, TeamConfig } from '@vortex-wake/shared';
import type { OutboxOp, QueueStore } from './sync-queue.ts';

export interface StoredPhoto {
  id: string;
  entryId: string;
  /** Original mientras `processed` es false; JPEG reducido después. */
  bytes: ArrayBuffer;
  type: string;
  processed: boolean;
  takenAt?: string;
  width?: number;
  height?: number;
  /** No se pudo reducir (formato que el navegador no lee). */
  error?: string;
}

type StoreName = 'entries' | 'photos' | 'outbox' | 'sessions' | 'kv';

const DB_NAME = 'vortex-wake';
const DB_VERSION = 1;

export class LocalDb implements QueueStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(): Promise<LocalDb> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' }).createIndex('sessionDate', 'sessionDate');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'date' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(new LocalDb(req.result));
      req.onerror = () => reject(req.error ?? new Error('no se pudo abrir IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB bloqueada: cierra otras pestañas de la app'));
    });
  }

  private tx<T>(name: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      t.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
      t.onerror = () => reject(t.error ?? new Error('error de IndexedDB'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB canceló la escritura (¿sin espacio?)'));
    });
  }

  private get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.tx<T | undefined>(name, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  }
  private all<T>(name: StoreName): Promise<T[]> {
    return this.tx<T[]>(name, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  }
  private put(name: StoreName, value: unknown): Promise<void> {
    return this.tx<void>(name, 'readwrite', (s) => {
      s.put(value);
    });
  }
  private del(name: StoreName, key: IDBValidKey): Promise<void> {
    return this.tx<void>(name, 'readwrite', (s) => {
      s.delete(key);
    });
  }

  // --- entradas
  getEntry(id: string) {
    return this.get<Entry>('entries', id);
  }
  allEntries() {
    return this.all<Entry>('entries');
  }
  putEntry(e: Entry) {
    return this.put('entries', e);
  }
  acceptServerEntry(e: Entry) {
    return this.putEntry(e);
  }

  // --- fotos
  getPhoto(id: string) {
    return this.get<StoredPhoto>('photos', id);
  }
  putPhoto(p: StoredPhoto) {
    return this.put('photos', p);
  }
  allPhotos() {
    return this.all<StoredPhoto>('photos');
  }
  async getPhotoBytes(id: string): Promise<Uint8Array | undefined | null> {
    const p = await this.getPhoto(id);
    if (!p) return null;
    return p.processed ? new Uint8Array(p.bytes) : undefined;
  }

  // --- cola
  listOps() {
    return this.all<OutboxOp>('outbox');
  }
  getOp(key: string) {
    return this.get<OutboxOp>('outbox', key);
  }
  putOp(op: OutboxOp) {
    return this.put('outbox', op);
  }
  deleteOpIfRev(key: string, rev: number): Promise<void> {
    return this.tx<void>('outbox', 'readwrite', (s) => {
      const r = s.get(key);
      r.onsuccess = () => {
        const op = r.result as OutboxOp | undefined;
        if (op && op.rev === rev) s.delete(key);
      };
    });
  }

  // --- sesiones
  getSession(date: string) {
    return this.get<CaptureSession>('sessions', date);
  }
  allSessions() {
    return this.all<CaptureSession>('sessions');
  }
  putSession(s: CaptureSession) {
    return this.put('sessions', s);
  }
  async getClosing(date: string): Promise<SessionClosing | undefined> {
    return (await this.getSession(date))?.closing;
  }

  // --- datos sueltos
  async getKv<T>(k: string): Promise<T | undefined> {
    return (await this.get<{ k: string; v: T }>('kv', k))?.v;
  }
  setKv(k: string, v: unknown) {
    return this.put('kv', { k, v });
  }
  getTeam() {
    return this.getKv<TeamConfig>('team');
  }
  setTeam(t: TeamConfig) {
    return this.setKv('team', t);
  }

  // --- pendientes: en `kv` con la clave `task:<id>` (así no cambia la versión
  // de IndexedDB, que bloquearía si hay otra pestaña abierta con la app vieja).
  getTask(id: string) {
    return this.getKv<TaskItem>(`task:${id}`);
  }
  putTask(t: TaskItem) {
    return this.setKv(`task:${t.id}`, t);
  }
  acceptServerTask(t: TaskItem) {
    return this.putTask(t);
  }
  async allTasks(): Promise<TaskItem[]> {
    const rows = await this.all<{ k: string; v: unknown }>('kv');
    return rows.filter((r) => r.k.startsWith('task:')).map((r) => r.v as TaskItem);
  }

  deleteEntryLocal(id: string) {
    return this.del('entries', id);
  }
}
