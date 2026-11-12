/**
 * Cola de pendientes ("outbox"): todo lo que se captura se guarda primero en
 * el teléfono y aquí se anota qué falta mandar al servidor.
 *
 * - Una operación por cosa (`entry:<id>`, `photo:<id>`...): si una entrada se
 *   edita cinco veces sin señal, se manda una sola vez con su última versión.
 * - Cada operación lleva `rev`. Si la entrada cambia mientras se está mandando,
 *   la operación no se borra al terminar (su `rev` ya es otro) y se vuelve a
 *   mandar.
 * - Nada se borra de la cola si el servidor no respondió que sí. Un error de
 *   red detiene la ronda y se reintenta pronto; un error del servidor se
 *   reintenta con espera creciente y queda visible (`lastError`).
 * - Las fotos van antes que las entradas que las usan.
 *
 * No depende del navegador: el almacén y el transporte se inyectan (IndexedDB
 * y fetch en la app; versiones en memoria en las pruebas).
 */

import type { Attendance, Entry, PutEntryResponse, SessionClosing } from '@vortex-wake/shared';

export type OpPayload =
  | { kind: 'photo'; photoId: string }
  | { kind: 'member'; memberId: string; name: string }
  | { kind: 'attendance'; date: string; attendance: Attendance }
  | { kind: 'entry'; entryId: string }
  | { kind: 'closing'; date: string };

export type OutboxOp = OpPayload & {
  key: string;
  rev: number;
  /** Orden de llegada. */
  seq: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

export interface QueueStore {
  listOps(): Promise<OutboxOp[]>;
  getOp(key: string): Promise<OutboxOp | undefined>;
  putOp(op: OutboxOp): Promise<void>;
  /** Borra la operación solo si su `rev` sigue siendo el mismo. */
  deleteOpIfRev(key: string, rev: number): Promise<void>;
  getEntry(id: string): Promise<Entry | undefined>;
  /** El servidor tenía una versión más nueva: se guarda en el teléfono. */
  acceptServerEntry(entry: Entry): Promise<void>;
  /** Bytes JPEG ya reducidos; `undefined` si la foto todavía se está procesando. */
  /** `undefined`: todavía se está procesando; `null`: no está en este aparato (no hay nada que mandar). */
  getPhotoBytes(id: string): Promise<Uint8Array | undefined | null>;
  getClosing(date: string): Promise<SessionClosing | undefined>;
}

export class HttpStatusError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Errores de red (sin conexión, servidor apagado): `fetch` lanza TypeError. */
export class NetworkError extends Error {}

export interface Transport {
  putEntry(entry: Entry): Promise<PutEntryResponse>;
  putPhoto(id: string, bytes: Uint8Array): Promise<void>;
  attend(date: string, a: Attendance): Promise<void>;
  closing(date: string, c: SessionClosing): Promise<void>;
  addMember(id: string, name: string): Promise<void>;
}

export function opKey(p: OpPayload): string {
  switch (p.kind) {
    case 'photo':
      return `photo:${p.photoId}`;
    case 'member':
      return `member:${p.memberId}`;
    case 'attendance':
      return `attendance:${p.date}:${p.attendance.memberId}`;
    case 'entry':
      return `entry:${p.entryId}`;
    case 'closing':
      return `closing:${p.date}`;
  }
}

const ORDER: Record<OpPayload['kind'], number> = { photo: 0, member: 1, attendance: 2, entry: 3, closing: 4 };

export const RETRY_NETWORK_MS = 3000;
export const RETRY_MAX_MS = 5 * 60_000;

export function backoff(attempts: number): number {
  return Math.min(RETRY_MAX_MS, 2000 * 2 ** Math.max(0, attempts - 1));
}

export interface FlushResult {
  sent: number;
  failed: number;
  pending: number;
  /** `false` si no se pudo hablar con el servidor. */
  online: boolean;
  /** La clave del equipo fue rechazada. */
  unauthorized: boolean;
}

export class SyncQueue {
  private running: Promise<FlushResult> | undefined;
  private again = false;
  private readonly store: QueueStore;
  private readonly transport: Transport;
  private readonly now: () => number;

  constructor(store: QueueStore, transport: Transport, now: () => number = Date.now) {
    this.store = store;
    this.transport = transport;
    this.now = now;
  }

  /** Anota (o actualiza) una operación pendiente. */
  async enqueue(p: OpPayload): Promise<void> {
    const key = opKey(p);
    const prev = await this.store.getOp(key);
    const op: OutboxOp = {
      ...p,
      key,
      rev: (prev?.rev ?? 0) + 1,
      seq: prev?.seq ?? this.now() * 1000 + Math.floor(Math.random() * 1000),
      attempts: 0,
      nextAttemptAt: 0,
    };
    await this.store.putOp(op);
  }

  /** Hace que todo lo pendiente se intente ya (por ejemplo, al volver la señal). */
  async retryNow(): Promise<void> {
    for (const op of await this.store.listOps()) {
      if (op.nextAttemptAt > this.now()) await this.store.putOp({ ...op, nextAttemptAt: 0 });
    }
  }

  /** Manda lo pendiente. Si ya hay una ronda en curso, se encadena otra al terminar. */
  flush(): Promise<FlushResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let result: FlushResult;
      do {
        this.again = false;
        result = await this.round();
      } while (this.again && result.online && !result.unauthorized);
      return result;
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async round(): Promise<FlushResult> {
    const ops = (await this.store.listOps()).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.seq - b.seq);
    let sent = 0;
    let failed = 0;
    let online = true;
    let unauthorized = false;
    for (const op of ops) {
      if (op.nextAttemptAt > this.now()) continue;
      try {
        const done = await this.send(op);
        if (!done) continue; // todavía no está lista (foto procesándose)
        await this.store.deleteOpIfRev(op.key, op.rev);
        sent++;
      } catch (e) {
        const current = (await this.store.getOp(op.key)) ?? op;
        if (e instanceof NetworkError) {
          online = false;
          await this.store.putOp({ ...current, nextAttemptAt: this.now() + RETRY_NETWORK_MS, lastError: 'sin conexión' });
          break;
        }
        const status = e instanceof HttpStatusError ? e.status : 0;
        const attempts = current.attempts + 1;
        await this.store.putOp({ ...current, attempts, nextAttemptAt: this.now() + backoff(attempts), lastError: (e as Error).message });
        failed++;
        if (status === 401) {
          unauthorized = true;
          break;
        }
      }
    }
    const pending = (await this.store.listOps()).length;
    return { sent, failed, pending, online, unauthorized };
  }

  /** `true` si se mandó; `false` si todavía no se puede (no cuenta como intento). */
  private async send(op: OutboxOp): Promise<boolean> {
    switch (op.kind) {
      case 'photo': {
        const bytes = await this.store.getPhotoBytes(op.photoId);
        if (bytes === null) return true; // no está aquí: nada que mandar
        if (!bytes) return false;
        await this.transport.putPhoto(op.photoId, bytes);
        return true;
      }
      case 'member':
        await this.transport.addMember(op.memberId, op.name);
        return true;
      case 'attendance':
        await this.transport.attend(op.date, op.attendance);
        return true;
      case 'entry': {
        const entry = await this.store.getEntry(op.entryId);
        if (!entry) return true; // ya no existe en el teléfono: nada que mandar
        const r = await this.transport.putEntry(entry);
        if (!r.applied && r.entry.updatedAt > entry.updatedAt) await this.store.acceptServerEntry(r.entry);
        return true;
      }
      case 'closing': {
        const c = await this.store.getClosing(op.date);
        if (!c) return true;
        await this.transport.closing(op.date, c);
        return true;
      }
    }
  }
}

/** Almacén en memoria (pruebas y respaldo si IndexedDB no está disponible). */
export class MemoryQueueStore implements QueueStore {
  readonly ops = new Map<string, OutboxOp>();
  readonly entries = new Map<string, Entry>();
  readonly photos = new Map<string, Uint8Array | undefined | null>();
  readonly closings = new Map<string, SessionClosing>();

  async listOps() {
    return [...this.ops.values()].map((o) => ({ ...o }));
  }
  async getOp(key: string) {
    const o = this.ops.get(key);
    return o ? { ...o } : undefined;
  }
  async putOp(op: OutboxOp) {
    this.ops.set(op.key, { ...op });
  }
  async deleteOpIfRev(key: string, rev: number) {
    if (this.ops.get(key)?.rev === rev) this.ops.delete(key);
  }
  async getEntry(id: string) {
    return this.entries.get(id);
  }
  async acceptServerEntry(e: Entry) {
    this.entries.set(e.id, e);
  }
  async getPhotoBytes(id: string) {
    return this.photos.get(id);
  }
  async getClosing(date: string) {
    return this.closings.get(date);
  }
}
