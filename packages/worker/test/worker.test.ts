/**
 * Pruebas del Worker contra el entorno local de Workers (workerd con D1 y R2
 * locales; ver scripts/harness.ts): contrato HTTP, mezcla, permisos de cada
 * clave, rechazo sin clave, límites de tamaño y cabeceras.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_JSON_BYTES,
  MAX_PHOTO_BYTES,
  apiPath,
  type CaptureSession,
  type Entry,
  type QrResponse,
  type StateResponse,
  type TeamConfig,
} from '@vortex-wake/shared';
import { startLocalWorker, type LocalWorker } from '../scripts/harness.ts';
import { accessFor, keysProblem } from '../src/auth.ts';

let w: LocalWorker;

beforeAll(async () => {
  w = await startLocalWorker();
}, 60_000);

afterAll(async () => {
  await w?.close();
});

const call = (path: string, init: RequestInit = {}, key: string | null = w.captureKey) =>
  fetch(w.url + path, {
    ...init,
    headers: { ...(key ? { 'x-team-key': key } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
const put = (path: string, body: unknown, key?: string | null) => call(path, { method: 'PUT', body: JSON.stringify(body) }, key);
const post = (path: string, body: unknown, key?: string | null) => call(path, { method: 'POST', body: JSON.stringify(body) }, key);

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

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

describe('claves', () => {
  it('sin clave o con una clave equivocada, toda ruta de /api responde lo mismo (401)', async () => {
    const routes: [string, RequestInit][] = [
      [apiPath.state(), {}],
      [apiPath.entry('x'), { method: 'PUT', body: '{}' }],
      [apiPath.photo('x'), {}],
      [apiPath.photo('x'), { method: 'PUT', body: jpeg }],
      [apiPath.attendance('2026-11-12'), { method: 'POST', body: '{}' }],
      [apiPath.closing('2026-11-12'), { method: 'PUT', body: '{}' }],
      [apiPath.team(), { method: 'PUT', body: '{}' }],
      [apiPath.members(), { method: 'POST', body: '{}' }],
      [apiPath.template(), {}],
      [apiPath.qr(), {}],
      ['/api/no-existe', {}],
    ];
    const bodies = new Set<string>();
    for (const [path, init] of routes) {
      for (const key of [null, '', 'otra-clave-cualquiera-123', w.captureKey.slice(0, -1), `${w.editKey}x`]) {
        const r = await call(path, init, key);
        expect(r.status, `${init.method ?? 'GET'} ${path} con "${key}"`).toBe(401);
        bodies.add(await r.text());
      }
    }
    expect(bodies.size).toBe(1);
  });

  it('?k= solo vale para las fotos', async () => {
    expect((await fetch(`${w.url}${apiPath.state()}?k=${w.editKey}`)).status).toBe(401);
    expect((await fetch(`${w.url}${apiPath.template()}?k=${w.editKey}`)).status).toBe(401);
    expect((await fetch(`${w.url}${apiPath.photo('nada')}?k=${w.captureKey}`)).status).toBe(404);
  });

  it('el estado dice qué permite cada clave', async () => {
    const c = (await (await call(apiPath.state())).json()) as StateResponse;
    expect(c.access).toBe('capture');
    expect(c.hosted).toBe(true);
    const e = (await (await call(apiPath.state(), {}, w.editKey)).json()) as StateResponse;
    expect(e.access).toBe('edit');
  });

  it('la clave de captura no puede editar el equipo, bajar la plantilla ni ver el QR', async () => {
    const s = (await (await call(apiPath.state())).json()) as StateResponse;
    expect((await put(apiPath.team(), s.team)).status).toBe(403);
    expect((await call(apiPath.template())).status).toBe(403);
    expect((await call(apiPath.qr())).status).toBe(403);
  });

  it('la clave de edición sí', async () => {
    const t = await call(apiPath.template(), {}, w.editKey);
    expect(t.status).toBe(200);
    expect(t.headers.get('content-type')).toContain('presentationml');
    expect(new Uint8Array(await t.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]));
    const qr = (await (await call(apiPath.qr(), {}, w.editKey)).json()) as QrResponse;
    expect(qr.captureUrl).toBe(`${w.url}/#k=${w.captureKey}`);
    expect(qr.svg).toContain('<svg');
    expect(qr.captureUrl).not.toContain(w.editKey);
  });

  it('comparación de claves: tiempo constante y sin claves débiles', async () => {
    const env = { CAPTURE_KEY: 'c'.repeat(20), EDIT_KEY: 'e'.repeat(20) };
    expect(await accessFor('c'.repeat(20), env)).toBe('capture');
    expect(await accessFor('e'.repeat(20), env)).toBe('edit');
    expect(await accessFor('c'.repeat(19), env)).toBeNull();
    expect(await accessFor(null, env)).toBeNull();
    expect(keysProblem({ CAPTURE_KEY: 'corta', EDIT_KEY: 'e'.repeat(20) })).toBeDefined();
    expect(keysProblem({ CAPTURE_KEY: 'x'.repeat(20), EDIT_KEY: 'x'.repeat(20) })).toBeDefined();
    expect(keysProblem({})).toBeDefined();
    // Sin secretos definidos nadie entra, ni con una clave vacía.
    expect(await accessFor('', {})).toBeNull();
  });
});

describe('contrato y mezcla (D1)', () => {
  it('entradas: idempotente y gana la más reciente', async () => {
    const e1 = entry();
    for (let i = 0; i < 2; i++) expect(await (await put(apiPath.entry(e1.id), e1)).json()).toEqual({ applied: true, entry: e1 });
    const newer = entry({ updatedAt: '2026-11-12T17:00:00.000Z', subsystem: 'intake' });
    expect(((await (await put(apiPath.entry(e1.id), newer)).json()) as { applied: boolean }).applied).toBe(true);
    const stale = await put(apiPath.entry(e1.id), entry({ updatedAt: '2026-11-12T16:30:00.000Z' }));
    expect(await stale.json()).toEqual({ applied: false, entry: newer });
    const s = (await (await call(apiPath.state('2026-11-12'))).json()) as StateResponse;
    expect(s.entries).toEqual([newer]);
    expect(s.sessions.map((x) => x.date)).toEqual(['2026-11-12']);
  });

  it('dos teléfonos editando la misma entrada al mismo tiempo: queda la más reciente', async () => {
    const versions = Array.from({ length: 12 }, (_, i) => entry({ id: 'carrera', updatedAt: `2026-11-12T18:00:${String(i).padStart(2, '0')}.000Z`, thread: `v${i}` }));
    const statuses = await Promise.all(versions.sort(() => Math.random() - 0.5).map(async (v) => (await put(apiPath.entry(v.id), v)).status));
    expect(statuses.every((st) => st === 200)).toBe(true);
    const s = (await (await call(apiPath.state('2026-11-12'))).json()) as StateResponse;
    expect(s.entries.find((e) => e.id === 'carrera')?.thread).toBe('v11');
  });

  it('rechaza entradas inválidas', async () => {
    expect((await put(apiPath.entry('mala'), { ...entry({ id: 'mala' }), section: 'cocina' })).status).toBe(400);
    expect((await put(apiPath.entry('mala'), entry({ id: 'otra' }))).status).toBe(400);
    expect((await put(apiPath.entry('mala'), entry({ id: 'mala', updatedAt: '9999' }))).status).toBe(400);
    expect((await put(apiPath.entry('mala'), entry({ id: 'mala', sessionDate: '2026-13-40' }))).status).toBe(400);
    expect((await call(apiPath.entry('mala'), { method: 'PUT', body: '{no es json' })).status).toBe(400);
    expect((await call(apiPath.state('ayer'))).status).toBe(400);
  });

  it('asistencia de varios teléfonos al mismo tiempo se une, con la hora más temprana', async () => {
    const date = '2026-11-13';
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const statuses = await Promise.all(ids.map(async (id, i) => (await post(apiPath.attendance(date), { memberId: id, checkIn: `2026-11-13T16:${String(10 + i).padStart(2, '0')}:00.000Z` })).status));
    expect(statuses.every((st) => st === 200)).toBe(true);
    await post(apiPath.attendance(date), { memberId: 'm3', checkIn: '2026-11-13T15:00:00.000Z' });
    await post(apiPath.attendance(date), { memberId: 'm3', checkIn: '2026-11-13T19:00:00.000Z' });
    const s = (await (await call(apiPath.state(date))).json()) as StateResponse;
    const att = (s.sessions[0] as CaptureSession).attendance;
    expect(att.map((a) => a.memberId).sort()).toEqual([...ids].sort());
    expect(att[0]).toEqual({ memberId: 'm3', checkIn: '2026-11-13T15:00:00.000Z' });
    expect((await post(apiPath.attendance(date), { memberId: 'x', checkIn: 'ayer' })).status).toBe(400);
  });

  it('cierre: gana el más reciente', async () => {
    const date = '2026-11-13';
    await put(apiPath.closing(date), { whatWeDid: 'b', updatedAt: '2026-11-13T20:05:00.000Z' });
    const old = await put(apiPath.closing(date), { whatWeDid: 'a', updatedAt: '2026-11-13T20:00:00.000Z' });
    expect(((await old.json()) as { applied: boolean }).applied).toBe(false);
    const s = (await (await call(apiPath.state(date))).json()) as StateResponse;
    expect(s.sessions[0]?.closing?.whatWeDid).toBe('b');
    expect(s.sessions[0]?.attendance.length).toBe(10);
  });

  it('equipo: alta de integrantes con la clave de captura y reemplazo con la de edición', async () => {
    const r1 = await post(apiPath.members(), { name: 'Elena Nueva' });
    await post(apiPath.members(), { name: 'Elena Nueva' });
    const { team } = (await r1.json()) as { team: TeamConfig };
    expect(team.members.filter((m) => m.id === 'elena-nueva')).toHaveLength(1);
    expect((await post(apiPath.members(), { name: '  ' })).status).toBe(400);
    expect((await post(apiPath.members(), { name: 'x'.repeat(500) })).status).toBe(400);
    const next: TeamConfig = { ...team, robots: [{ id: 'r1', name: 'Robot 1', subsystems: ['chasis'] }] };
    expect((await put(apiPath.team(), next, w.editKey)).status).toBe(200);
    expect((await put(apiPath.team(), { ...next, format: 'otro' }, w.editKey)).status).toBe(400);
    const s = (await (await call(apiPath.state())).json()) as StateResponse;
    expect(s.team.robots[0]?.name).toBe('Robot 1');
  });
});

describe('fotos (R2)', () => {
  it('JPEG inmutables, servidas con la clave y caché privada', async () => {
    const send = (bytes: Uint8Array, id = 'foto1') => call(apiPath.photo(id), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': 'image/jpeg' } });
    expect(await (await send(jpeg)).json()).toEqual({ id: 'foto1', bytes: 9, created: true });
    expect(await (await send(new Uint8Array([...jpeg, 7]))).json()).toEqual({ id: 'foto1', bytes: 10, created: false });
    const got = await fetch(`${w.url}${apiPath.photo('foto1')}?k=${w.captureKey}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg);
    expect((await fetch(`${w.url}${apiPath.photo('foto1')}`)).status).toBe(401);
    expect((await send(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'png')).status).toBe(400);
    expect((await send(jpeg, 'mal.id')).status).toBe(400);
  });

  it('límites de tamaño: foto y JSON', async () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(jpeg);
    const r = await call(apiPath.photo('grande'), { method: 'PUT', body: big, headers: { 'content-type': 'image/jpeg' } });
    expect(r.status).toBe(413);
    expect((await fetch(`${w.url}${apiPath.photo('grande')}?k=${w.captureKey}`)).status).toBe(404);
    const huge = entry({ id: 'enorme', elements: [{ id: 't', type: 'text', text: 'a'.repeat(MAX_JSON_BYTES) }] });
    expect((await put(apiPath.entry('enorme'), huge)).status).toBe(413);
  });
});

describe('app y cabeceras', () => {
  it('la app se sirve sin clave, sin indexar y con cabeceras de seguridad', async () => {
    const r = await fetch(`${w.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-robots-tag')).toContain('noindex');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-cache');
    const a = await fetch(`${w.url}/assets/app-abc123.js`);
    expect(a.headers.get('cache-control')).toContain('immutable');
    const api = await call(apiPath.state());
    expect(api.headers.get('x-robots-tag')).toContain('noindex');
    expect(api.headers.get('cache-control')).toBe('no-store');
  });

  it('robots.txt prohíbe todo; private/ y rutas desconocidas no existen', async () => {
    expect(await (await fetch(`${w.url}/robots.txt`)).text()).toBe('User-agent: *\nDisallow: /\n');
    expect((await fetch(`${w.url}/private/template.pptx`)).status).toBe(404);
    expect((await fetch(`${w.url}/data/team.json`)).status).toBe(404);
    expect((await fetch(`${w.url}/`, { method: 'POST' })).status).toBe(405);
    const qr = await fetch(`${w.url}/qr`, { redirect: 'manual' });
    expect(qr.status).toBe(302);
    expect(qr.headers.get('location')).toBe(`${w.url}/#/qr`);
  });
});
