/**
 * `npm run nube:subir-datos` contra el Worker en el entorno local, con una
 * carpeta de datos ficticios con el mismo formato que data/ del servidor local.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiPath, type CaptureSession, type Entry, type StateResponse, type TeamConfig } from '@vortex-wake/shared';
import { startLocalWorker, type LocalWorker } from '../scripts/harness.ts';
import { uploadData } from '../scripts/upload-data.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let w: LocalWorker;
let dir: string;

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  sessionDate: '2026-11-12',
  createdAt: '2026-11-12T16:00:00.000Z',
  updatedAt: '2026-11-12T16:00:00.000Z',
  authorIds: ['ana'],
  capturedBy: 'ana',
  marks: [],
  elements: [{ id: `t-${id}`, type: 'text', text: `texto ${id}` }],
  ...over,
});

beforeAll(async () => {
  w = await startLocalWorker();
  dir = mkdtempSync(join(tmpdir(), 'vw-datos-'));
  for (const sub of ['sessions', 'entries', 'photos']) mkdirSync(join(dir, sub));
  cpSync(join(ROOT, 'examples/team-ejemplo.json'), join(dir, 'team.json'));
  cpSync(join(ROOT, 'examples/notebook-ejemplo/fotos/equipo.jpg'), join(dir, 'photos/foto1.jpg'));
  cpSync(join(ROOT, 'examples/notebook-ejemplo/fotos/intake-v2.jpg'), join(dir, 'photos/foto2.jpg'));
  const session: CaptureSession = {
    date: '2026-11-12',
    attendance: [
      { memberId: 'ana', checkIn: '2026-11-12T16:00:00.000Z' },
      { memberId: 'beto', checkIn: '2026-11-12T16:05:00.000Z' },
    ],
    closing: { whatWeDid: 'Chasis', updatedAt: '2026-11-12T20:00:00.000Z', by: 'ana' },
  };
  writeFileSync(join(dir, 'sessions/2026-11-12.json'), JSON.stringify(session, null, 2));
  writeFileSync(join(dir, 'entries/e1.json'), JSON.stringify(entry('e1', { elements: [{ id: 'p', type: 'photo', photoId: 'foto1' }] })));
  writeFileSync(join(dir, 'entries/e2.json'), JSON.stringify(entry('e2', { kind: 'test', section: 'mechanics' })));
  writeFileSync(join(dir, 'entries/e3.json'), JSON.stringify(entry('e3', { elements: [{ id: 'p2', type: 'photo', photoId: 'foto2' }] })));
  writeFileSync(join(dir, 'entries/mala.json'), '{"id": "mala"}');
}, 60_000);

afterAll(async () => {
  await w?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const state = async () => (await (await fetch(w.url + apiPath.state(), { headers: { 'x-team-key': w.editKey } })).json()) as StateResponse;
const quiet = () => undefined;

describe('subir datos locales al Worker', () => {
  it('rechaza la clave de captura', async () => {
    await expect(uploadData({ url: w.url, editKey: w.captureKey, dataDir: dir, log: quiet })).rejects.toThrow(/clave de edición/);
    await expect(uploadData({ url: w.url, editKey: 'otra-clave-cualquiera', dataDir: dir, log: quiet })).rejects.toThrow(/no es válida/);
  });

  it('--simular no manda nada', async () => {
    await uploadData({ url: w.url, editKey: w.editKey, dataDir: dir, dryRun: true, log: quiet });
    expect((await state()).entries).toHaveLength(0);
  });

  it('sube equipo, fotos, asistencia, cierre y entradas', async () => {
    // Alguien se agregó desde su teléfono antes de subir: no se pierde.
    await fetch(w.url + apiPath.members(), { method: 'POST', headers: { 'x-team-key': w.captureKey }, body: JSON.stringify({ name: 'Nueva Desde Teléfono' }) });
    const r = await uploadData({ url: w.url, editKey: w.editKey, dataDir: dir, log: quiet });
    expect(r.team).toBe('sent');
    expect(r.photos).toEqual({ created: 2, existing: 0 });
    expect(r.attendance).toBe(2);
    expect(r.closings).toEqual({ applied: 1, kept: 0 });
    expect(r.entries).toEqual({ applied: 3, kept: 0 });
    expect(r.invalid).toEqual(['entries/mala.json: sessionDate inválida']);
    expect(r.failed).toEqual([]);
    const s = await state();
    const team: TeamConfig = s.team;
    expect(team.team.name).toBe('Equipo Ejemplo');
    expect(team.members.map((m) => m.id)).toEqual(['ana', 'beto', 'carla', 'dario', 'nueva-desde-telefono']);
    expect(s.entries.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(s.sessions[0]?.attendance.map((a) => a.memberId)).toEqual(['ana', 'beto']);
    expect(s.sessions[0]?.closing?.whatWeDid).toBe('Chasis');
    const photo = await fetch(`${w.url}${apiPath.photo('foto1')}?k=${w.captureKey}`);
    expect(photo.status).toBe(200);
  });

  it('es idempotente y no pisa lo editado después en la nube', async () => {
    const edited = entry('e2', { updatedAt: '2026-11-13T10:00:00.000Z', thread: 'editada en la nube' });
    await fetch(w.url + apiPath.entry('e2'), { method: 'PUT', headers: { 'x-team-key': w.captureKey }, body: JSON.stringify(edited) });
    const r = await uploadData({ url: w.url, editKey: w.editKey, dataDir: dir, log: quiet });
    expect(r.photos).toEqual({ created: 0, existing: 2 });
    expect(r.entries).toEqual({ applied: 2, kept: 1 });
    expect(r.closings).toEqual({ applied: 1, kept: 0 });
    const s = await state();
    expect(s.entries).toHaveLength(3);
    expect(s.entries.find((e) => e.id === 'e2')?.thread).toBe('editada en la nube');
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]?.attendance).toHaveLength(2);
  });
});
