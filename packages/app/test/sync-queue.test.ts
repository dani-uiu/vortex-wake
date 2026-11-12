import { describe, expect, it } from 'vitest';
import { mergeEntry, type Attendance, type Entry, type PutEntryResponse, type SessionClosing } from '@vortex-wake/shared';
import { HttpStatusError, MemoryQueueStore, NetworkError, SyncQueue, type Transport } from '../src/sync-queue.ts';

/** Servidor falso: guarda lo recibido y se puede "desconectar". */
class FakeServer implements Transport {
  online = true;
  failNext: number | undefined;
  entries = new Map<string, Entry>();
  photos = new Map<string, Uint8Array>();
  attendance: Attendance[] = [];
  closings: SessionClosing[] = [];
  calls: string[] = [];
  onPutEntry: (() => Promise<void>) | undefined;

  private check(what: string) {
    if (!this.online) throw new NetworkError('sin red');
    if (this.failNext) {
      const s = this.failNext;
      this.failNext = undefined;
      throw new HttpStatusError(s, `error ${s}`);
    }
    this.calls.push(what);
  }
  async putEntry(e: Entry): Promise<PutEntryResponse> {
    this.check(`entry:${e.id}`);
    if (this.onPutEntry) await this.onPutEntry();
    const r = mergeEntry(this.entries.get(e.id), structuredClone(e));
    if (r.applied) this.entries.set(e.id, r.entry);
    return r;
  }
  async putPhoto(id: string, bytes: Uint8Array) {
    this.check(`photo:${id}`);
    this.photos.set(id, bytes);
  }
  async attend(_date: string, a: Attendance) {
    this.check(`attendance:${a.memberId}`);
    this.attendance.push(a);
  }
  async closing(_date: string, c: SessionClosing) {
    this.check('closing');
    this.closings.push(c);
  }
  async addMember(id: string) {
    this.check(`member:${id}`);
  }
}

function entry(id: string, updatedAt = '2026-11-12T10:00:00Z', over: Partial<Entry> = {}): Entry {
  return { id, sessionDate: '2026-11-12', createdAt: updatedAt, updatedAt, authorIds: ['a'], marks: [], elements: [], ...over };
}

function setup() {
  let now = 1_000_000;
  const store = new MemoryQueueStore();
  const server = new FakeServer();
  const queue = new SyncQueue(store, server, () => now);
  return { store, server, queue, advance: (ms: number) => (now += ms) };
}

describe('cola de sincronización', () => {
  it('sin conexión no se pierde nada; al volver se manda todo, fotos primero', async () => {
    const { store, server, queue, advance } = setup();
    server.online = false;
    store.entries.set('e1', entry('e1', undefined, { elements: [{ id: 'p', type: 'photo', photoId: 'f1' }] }));
    store.photos.set('f1', new Uint8Array([0xff, 0xd8]));
    await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    await queue.enqueue({ kind: 'photo', photoId: 'f1' });
    await queue.enqueue({ kind: 'attendance', date: '2026-11-12', attendance: { memberId: 'a', checkIn: 't' } });
    const r1 = await queue.flush();
    expect(r1).toMatchObject({ online: false, sent: 0, pending: 3 });
    expect(server.entries.size).toBe(0);

    server.online = true;
    // Al volver la señal, la app fuerza el reintento de inmediato.
    await queue.retryNow();
    const r2 = await queue.flush();
    expect(r2).toMatchObject({ online: true, sent: 3, pending: 0 });
    expect(server.calls).toEqual(['photo:f1', 'attendance:a', 'entry:e1']);
    advance(1);
  });

  it('varias ediciones sin señal se mandan una sola vez, con la última versión', async () => {
    const { store, server, queue } = setup();
    for (let i = 0; i < 5; i++) {
      store.entries.set('e1', entry('e1', `2026-11-12T10:00:0${i}Z`, { thread: `v${i}` }));
      await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    }
    await queue.flush();
    expect(server.calls).toEqual(['entry:e1']);
    expect(server.entries.get('e1')?.thread).toBe('v4');
  });

  it('si la entrada cambia mientras se manda, se vuelve a mandar', async () => {
    const { store, server, queue } = setup();
    store.entries.set('e1', entry('e1', '2026-11-12T10:00:00Z'));
    await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    let edited = false;
    server.onPutEntry = async () => {
      if (edited) return;
      edited = true;
      store.entries.set('e1', entry('e1', '2026-11-12T10:00:05Z', { thread: 'nuevo' }));
      await queue.enqueue({ kind: 'entry', entryId: 'e1' });
      void queue.flush();
    };
    await queue.flush();
    await queue.flush();
    expect(server.entries.get('e1')?.thread).toBe('nuevo');
    expect(store.ops.size).toBe(0);
  });

  it('la foto que todavía se procesa no bloquea ni gasta intentos', async () => {
    const { store, server, queue } = setup();
    store.photos.set('f1', undefined);
    store.entries.set('e1', entry('e1'));
    await queue.enqueue({ kind: 'photo', photoId: 'f1' });
    await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    expect(await queue.flush()).toMatchObject({ sent: 1, pending: 1 });
    expect(store.ops.get('photo:f1')?.attempts).toBe(0);
    store.photos.set('f1', new Uint8Array([0xff, 0xd8]));
    expect(await queue.flush()).toMatchObject({ sent: 1, pending: 0 });
    expect(server.photos.has('f1')).toBe(true);
  });

  it('un error del servidor se reintenta con espera y queda visible; un 401 detiene la ronda', async () => {
    const { store, server, queue, advance } = setup();
    store.entries.set('e1', entry('e1'));
    store.entries.set('e2', entry('e2'));
    await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    await queue.enqueue({ kind: 'entry', entryId: 'e2' });
    server.failNext = 500;
    const r = await queue.flush();
    expect(r).toMatchObject({ sent: 1, failed: 1, pending: 1 });
    const op = [...store.ops.values()][0];
    expect(op?.lastError).toBe('error 500');
    expect(op?.attempts).toBe(1);
    expect((await queue.flush()).sent).toBe(0);
    advance(60_000);
    expect(await queue.flush()).toMatchObject({ sent: 1, pending: 0 });

    store.entries.set('e3', entry('e3'));
    await queue.enqueue({ kind: 'entry', entryId: 'e3' });
    server.failNext = 401;
    expect(await queue.flush()).toMatchObject({ unauthorized: true, pending: 1 });
  });

  it('si el servidor tiene una versión más nueva, el teléfono se queda con esa', async () => {
    const { store, server, queue } = setup();
    server.entries.set('e1', entry('e1', '2026-11-12T12:00:00Z', { thread: 'del otro teléfono' }));
    store.entries.set('e1', entry('e1', '2026-11-12T11:00:00Z', { thread: 'viejo' }));
    await queue.enqueue({ kind: 'entry', entryId: 'e1' });
    await queue.flush();
    expect(store.entries.get('e1')?.thread).toBe('del otro teléfono');
    expect(server.entries.get('e1')?.thread).toBe('del otro teléfono');
  });

  it('cierre de sesión: manda la última versión guardada', async () => {
    const { store, server, queue } = setup();
    store.closings.set('2026-11-12', { whatWeDid: 'x', updatedAt: 't' });
    await queue.enqueue({ kind: 'closing', date: '2026-11-12' });
    await queue.enqueue({ kind: 'member', memberId: 'nuevo', name: 'Nuevo' });
    await queue.flush();
    expect(server.calls).toEqual(['member:nuevo', 'closing']);
    expect(server.closings[0]?.whatWeDid).toBe('x');
  });
});
