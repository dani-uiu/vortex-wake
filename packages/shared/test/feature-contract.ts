/**
 * Casos del contrato HTTP de las funciones nuevas, para correrlos igual contra
 * el servidor local y contra el Worker (mismo comportamiento en los dos).
 */

import { expect, it } from 'vitest';
import { apiPath, type Entry, type PutTaskResponse, type StateResponse, type TaskItem } from '../src/index.ts';

export interface ContractCtx {
  /** Petición con la clave de captura. */
  call(path: string, init?: RequestInit): Promise<Response>;
  /** Petición con la clave de edición. */
  editCall(path: string, init?: RequestInit): Promise<Response>;
}

export function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'f-entrada1',
    sessionDate: '2026-11-12',
    createdAt: '2026-11-12T16:00:00.000Z',
    updatedAt: '2026-11-12T16:00:00.000Z',
    authorIds: ['ana'],
    marks: [],
    elements: [{ id: 'x', type: 'text', text: 'hola' }],
    ...over,
  };
}

export function featureContract(ctx: () => ContractCtx): void {
  const put = (path: string, body: unknown) => ctx().call(path, { method: 'PUT', body: JSON.stringify(body) });
  const state = async (date?: string) => (await (await ctx().call(apiPath.state(date))).json()) as StateResponse;

  it('fotos anotadas: se guardan tal cual y las inválidas se rechazan', async () => {
    const e = entry({
      id: 'anotada1',
      elements: [{ id: 'p', type: 'photo', photoId: 'foto-a', annotations: [{ id: 'l', type: 'label', letter: 'A', x: 0.2, y: 0.3, tx: 0.5, ty: 0.5, what: 'Rodillo' }, { id: 'f', type: 'arrow', x: 0, y: 1, tx: 0.4, ty: 0.6 }] }],
    });
    expect((await put(apiPath.entry(e.id), e)).status).toBe(200);
    expect((await state()).entries.find((x) => x.id === 'anotada1')).toEqual(e);
    const bad = { ...e, elements: [{ id: 'p', type: 'photo', photoId: 'foto-a', annotations: [{ id: 'l', type: 'label', letter: 'A', x: 5, y: 0 }] }] };
    expect((await put(apiPath.entry(e.id), bad)).status).toBe(400);
  });

  it('pendientes: se guardan, se mezclan por updatedAt, llegan en el estado (también con ?date=) y se validan', async () => {
    const t: TaskItem = { id: 'n-2026-11-11-abc', text: 'Probar el intake', fromDate: '2026-11-11', source: 'closing', createdAt: '2026-11-11T22:00:00.000Z', updatedAt: '2026-11-11T22:00:00.000Z' };
    let r = (await (await put(apiPath.task(t.id), t)).json()) as PutTaskResponse;
    expect(r).toEqual({ applied: true, task: t });
    const done = { ...t, done: { by: 'ana', at: '2026-11-12T17:00:00.000Z' }, updatedAt: '2026-11-12T17:00:00.000Z' };
    expect(((await (await put(apiPath.task(t.id), done)).json()) as PutTaskResponse).applied).toBe(true);
    r = (await (await put(apiPath.task(t.id), t)).json()) as PutTaskResponse;
    expect(r).toEqual({ applied: false, task: done });
    expect((await state('2026-11-12')).tasks?.find((x) => x.id === t.id)).toEqual(done);
    expect((await state()).tasks?.find((x) => x.id === t.id)).toEqual(done);
    expect((await put(apiPath.task(t.id), { ...t, text: '' })).status).toBe(400);
    expect((await put(apiPath.task('otro'), t)).status).toBe(400);
  });

  it('con ?date= llegan las sesiones recientes (para el recordatorio de cierre); sin fecha no', async () => {
    const post = (path: string, body: unknown) => ctx().call(path, { method: 'POST', body: JSON.stringify(body) });
    expect((await post(apiPath.attendance('2026-11-03'), { memberId: 'ana', checkIn: '2026-11-03T16:00:00.000Z' })).status).toBe(200);
    expect((await post(apiPath.attendance('2026-10-01'), { memberId: 'ana', checkIn: '2026-10-01T16:00:00.000Z' })).status).toBe(200);
    const s = await state('2026-11-05');
    expect(s.recentSessions?.map((x) => x.date)).toEqual(['2026-11-03']);
    expect(s.sessions.every((x) => x.date === '2026-11-05')).toBe(true);
    expect((await state()).recentSessions).toBeUndefined();
  });

  it('partido de torneo: se guarda y los inválidos se rechazan', async () => {
    const e = entry({ id: 'partido1', kind: 'tournamentLog', section: 'strategy', marks: ['tournament'], elements: [{ id: 'm', type: 'match', match: 'Q12', alliance: 'blue', ourScore: '40', theirScore: '52', result: 'loss', adjusted: 'Más tensión', adjustedSection: 'mechanics' }] });
    expect((await put(apiPath.entry(e.id), e)).status).toBe(200);
    expect((await state()).entries.find((x) => x.id === 'partido1')).toEqual(e);
    expect((await put(apiPath.entry(e.id), { ...e, elements: [{ id: 'm', type: 'match', match: 'Q12', result: 'quizá' }] })).status).toBe(400);
  });

  it('ruta del autónomo: se guarda y los puntos fuera del campo se rechazan', async () => {
    const e = entry({ id: 'ruta1', kind: 'autonomousPlan', section: 'strategy', elements: [{ id: 'r', type: 'route', points: [{ id: 'p', x: 0.2, y: 0.8, action: 'Salir', points: '2' }] }] });
    expect((await put(apiPath.entry(e.id), e)).status).toBe(200);
    expect((await state()).entries.find((x) => x.id === 'ruta1')).toEqual(e);
    expect((await put(apiPath.entry(e.id), { ...e, elements: [{ id: 'r', type: 'route', points: [{ id: 'p', x: -1, y: 0 }] }] })).status).toBe(400);
  });

  it('equipo con mapas de puertos y del control (historial): se guarda tal cual; uno dañado se rechaza', async () => {
    const st = await state();
    const team = {
      ...st.team,
      robots: [
        ...st.team.robots.filter((r) => r.id !== 'robot-mapas'),
        { id: 'robot-mapas', name: 'Robot Mapas', subsystems: [], ports: [{ date: '2026-10-01', savedAt: '2026-10-01T18:00:00.000Z', slots: { '1': 'Motor' } }, { date: '2026-10-08', savedAt: '2026-10-08T18:00:00.000Z', by: 'ana', slots: { '1': 'Motor', A: 'Pistón' } }], controller: [{ date: '2026-10-03', savedAt: '2026-10-03T18:00:00.000Z', slots: { L1: 'Intake' } }] },
      ],
    };
    const r = await ctx().editCall(apiPath.team(), { method: 'PUT', body: JSON.stringify(team) });
    expect(r.status).toBe(200);
    expect((await state()).team.robots.find((x) => x.id === 'robot-mapas')).toEqual(team.robots[team.robots.length - 1]);
    const bad = { ...team, robots: [{ id: 'robot-mapas', name: 'Robot Mapas', subsystems: [], ports: [{ date: 'x', slots: {} }] }] };
    expect((await ctx().editCall(apiPath.team(), { method: 'PUT', body: JSON.stringify(bad) })).status).toBe(400);
  });

  it('una entrada en el formato anterior (sin campos nuevos) se sigue aceptando igual', async () => {
    const e = entry({ id: 'vieja1', elements: [{ id: 'p', type: 'photo', photoId: 'foto-b', caption: 'Intake' }, { id: 't', type: 'text', text: 'antes' }] });
    expect((await put(apiPath.entry(e.id), e)).status).toBe(200);
    expect((await state()).entries.find((x) => x.id === 'vieja1')).toEqual(e);
  });
}
