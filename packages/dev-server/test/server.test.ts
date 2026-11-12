import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiPath, TEAM_KEY_HEADER, type Entry, type StateResponse } from '@vortex-wake/shared';
import { startServer, type RunningServer } from '../src/server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let srv: RunningServer;
let dir: string;
let base: string;
const KEY = 'clave-prueba';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-server-'));
  srv = await startServer({
    dataDir: dir,
    exampleTeamPath: join(ROOT, 'examples/team-ejemplo.json'),
    staticDir: join(dir, 'no-app'),
    templatePath: join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx'),
    port: 0,
    host: '127.0.0.1',
    teamKey: KEY,
  });
  base = `http://127.0.0.1:${srv.port}`;
});

afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit = {}, key = KEY) =>
  fetch(base + path, { ...init, headers: { [TEAM_KEY_HEADER]: key, 'content-type': 'application/json', ...(init.headers ?? {}) } });

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'entrada1',
    sessionDate: '2026-11-12',
    createdAt: '2026-11-12T16:00:00.000Z',
    updatedAt: '2026-11-12T16:00:00.000Z',
    authorIds: ['ana'],
    marks: [],
    elements: [{ id: 'x', type: 'text', text: 'hola' }],
    ...over,
  };
}

describe('servidor local (contrato HTTP)', () => {
  it('pide la clave del equipo', async () => {
    expect((await call(apiPath.state(), {}, 'otra')).status).toBe(401);
    expect((await call(apiPath.state())).status).toBe(200);
  });

  it('arranca con el equipo de ejemplo si no hay data/team.json', async () => {
    const s = (await (await call(apiPath.state())).json()) as StateResponse;
    expect(s.team.team.name).toBe('Equipo Ejemplo');
    expect(srv.store.teamFromExample).toBe(true);
  });

  it('guarda entradas como JSON legible, es idempotente y gana la más reciente', async () => {
    const e1 = entry();
    for (let i = 0; i < 2; i++) {
      const r = await call(apiPath.entry(e1.id), { method: 'PUT', body: JSON.stringify(e1) });
      expect(await r.json()).toEqual({ applied: true, entry: e1 });
    }
    const newer = entry({ updatedAt: '2026-11-12T17:00:00.000Z', subsystem: 'intake' });
    await call(apiPath.entry(e1.id), { method: 'PUT', body: JSON.stringify(newer) });
    const stale = await call(apiPath.entry(e1.id), { method: 'PUT', body: JSON.stringify(entry({ updatedAt: '2026-11-12T16:30:00.000Z' })) });
    expect(await stale.json()).toEqual({ applied: false, entry: newer });
    expect(JSON.parse(readFileSync(join(dir, 'entries/entrada1.json'), 'utf8'))).toEqual(newer);
    const s = (await (await call(apiPath.state('2026-11-12'))).json()) as StateResponse;
    expect(s.entries).toEqual([newer]);
    expect(s.sessions.map((x) => x.date)).toEqual(['2026-11-12']);
  });

  it('rechaza entradas inválidas', async () => {
    const r = await call(apiPath.entry('mala'), { method: 'PUT', body: JSON.stringify({ ...entry({ id: 'mala' }), section: 'cocina' }) });
    expect(r.status).toBe(400);
  });

  it('fotos: JPEG inmutables, se sirven con ?k=', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const put = () => call(apiPath.photo('foto1'), { method: 'PUT', body: jpeg, headers: { 'content-type': 'image/jpeg' } });
    expect(await (await put()).json()).toEqual({ id: 'foto1', bytes: 9, created: true });
    expect(await (await put()).json()).toEqual({ id: 'foto1', bytes: 9, created: false });
    const got = await fetch(`${base}${apiPath.photo('foto1')}?k=${KEY}`);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg);
    expect((await call(apiPath.photo('png'), { method: 'PUT', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).status).toBe(400);
  });

  it('dos teléfonos registran asistencia y cierre en la misma sesión', async () => {
    await call(apiPath.attendance('2026-11-12'), { method: 'POST', body: JSON.stringify({ memberId: 'ana', checkIn: '2026-11-12T16:00:00Z' }) });
    await call(apiPath.attendance('2026-11-12'), { method: 'POST', body: JSON.stringify({ memberId: 'beto', checkIn: '2026-11-12T16:02:00Z' }) });
    await call(apiPath.attendance('2026-11-12'), { method: 'POST', body: JSON.stringify({ memberId: 'ana', checkIn: '2026-11-12T16:00:00Z' }) });
    await call(apiPath.closing('2026-11-12'), { method: 'PUT', body: JSON.stringify({ whatWeDid: 'b', updatedAt: '2026-11-12T20:05:00Z' }) });
    const old = await call(apiPath.closing('2026-11-12'), { method: 'PUT', body: JSON.stringify({ whatWeDid: 'a', updatedAt: '2026-11-12T20:00:00Z' }) });
    expect(((await old.json()) as { applied: boolean }).applied).toBe(false);
    const saved = JSON.parse(readFileSync(join(dir, 'sessions/2026-11-12.json'), 'utf8'));
    expect(saved.attendance.map((a: { memberId: string }) => a.memberId)).toEqual(['ana', 'beto']);
    expect(saved.closing.whatWeDid).toBe('b');
  });

  it('agregar integrante crea data/team.json', async () => {
    const r = await call(apiPath.members(), { method: 'POST', body: JSON.stringify({ name: 'Elena Nueva' }) });
    const { team } = (await r.json()) as { team: { members: { id: string }[] } };
    expect(team.members.map((m) => m.id)).toContain('elena-nueva');
    expect(existsSync(join(dir, 'team.json'))).toBe(true);
  });

  it('sirve la plantilla y avisa si la app no está compilada', async () => {
    const t = await fetch(`${base}${apiPath.template()}?k=${KEY}`);
    expect(t.status).toBe(200);
    expect((await t.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`${base}/`)).status).toBe(503);
  });

  it('la página del QR solo se abre desde la laptop', async () => {
    const r = await fetch(`${base}/qr`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<svg');
  });
});
