import { describe, expect, it } from 'vitest';
import {
  assembleNotebook,
  checkEntry,
  checkTeam,
  emptySession,
  mergeAttendance,
  mergeClosing,
  mergeEntry,
  mergeSessions,
  newId,
  localDate,
  validateNotebook,
  type CaptureSession,
  type Entry,
  type TeamConfig,
} from '../src/index.ts';

const team: TeamConfig = {
  format: 'vortex-wake/team',
  version: 1,
  team: { name: 'Equipo Ejemplo', number: '99999Z' },
  members: [
    { id: 'ana', name: 'Ana Prueba' },
    { id: 'beto', name: 'Beto Ejemplo', roles: ['Programación'] },
  ],
  robots: [{ id: 'grande', name: 'Robot Grande', subsystems: ['chasis', 'intake'] }],
};

let seq = 0;
function entry(over: Partial<Entry> = {}): Entry {
  seq++;
  const t = `2026-10-0${over.sessionDate?.slice(-1) ?? '1'}T10:00:${String(seq).padStart(2, '0')}.000Z`;
  return {
    id: `e${seq}`,
    sessionDate: '2026-10-01',
    createdAt: t,
    updatedAt: t,
    authorIds: ['ana'],
    marks: [],
    elements: [{ id: `t${seq}`, type: 'text', text: `texto ${seq}` }],
    ...over,
  };
}

describe('contrato: mezcla', () => {
  it('entradas: gana la más reciente, y repetir es idempotente', () => {
    const a = entry({ updatedAt: '2026-10-01T10:00:00Z' });
    const b = { ...a, updatedAt: '2026-10-01T11:00:00Z', subsystem: 'intake' };
    expect(mergeEntry(undefined, a)).toEqual({ applied: true, entry: a });
    expect(mergeEntry(a, b)).toEqual({ applied: true, entry: b });
    expect(mergeEntry(b, a)).toEqual({ applied: false, entry: b });
    expect(mergeEntry(b, b)).toEqual({ applied: true, entry: b });
  });

  it('asistencia: unión por integrante con la hora más temprana', () => {
    let s: CaptureSession = emptySession('2026-10-01');
    s = mergeAttendance(s, { memberId: 'ana', checkIn: '2026-10-01T16:05:00Z' });
    s = mergeAttendance(s, { memberId: 'beto', checkIn: '2026-10-01T16:00:00Z' });
    s = mergeAttendance(s, { memberId: 'ana', checkIn: '2026-10-01T16:01:00Z' });
    s = mergeAttendance(s, { memberId: 'ana', checkIn: '2026-10-01T18:00:00Z' });
    expect(s.attendance).toEqual([
      { memberId: 'beto', checkIn: '2026-10-01T16:00:00Z' },
      { memberId: 'ana', checkIn: '2026-10-01T16:01:00Z' },
    ]);
  });

  it('cierre: gana el más reciente; dos teléfonos convergen al unir sesiones', () => {
    const s = emptySession('2026-10-01');
    const c1 = { whatWeDid: 'uno', updatedAt: '2026-10-01T20:00:00Z' };
    const c2 = { whatWeDid: 'dos', updatedAt: '2026-10-01T20:05:00Z' };
    expect(mergeClosing(mergeClosing(s, c2).session, c1)).toEqual({ session: { ...s, closing: c2 }, applied: false });
    const p1 = mergeAttendance({ ...s, closing: c1 }, { memberId: 'ana', checkIn: 'a' });
    const p2 = mergeAttendance({ ...s, closing: c2 }, { memberId: 'beto', checkIn: 'b' });
    expect(mergeSessions(p1, p2)).toEqual(mergeSessions(p2, p1));
  });

  it('valida entradas y equipo', () => {
    expect(checkEntry(entry())).toBeUndefined();
    expect(checkEntry({ ...entry(), section: 'cocina' })).toMatch(/sección/);
    expect(checkEntry({ ...entry(), elements: [{ id: 'x', type: 'video' }] })).toMatch(/desconocido/);
    expect(checkEntry({ ...entry(), id: '../x' })).toMatch(/id/);
    expect(checkTeam(team)).toBeUndefined();
    expect(checkTeam({ ...team, members: [team.members[0], team.members[0]] })).toMatch(/repetido/);
  });

  it('ids sin crypto.randomUUID y fecha local', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toMatch(/^[a-z0-9]{20}$/);
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('armado automático', () => {
  it('lo que no tiene tipo va a "trabajo del día", agrupado por día, y el documento es válido', () => {
    const r = assembleNotebook({
      team,
      sessions: [{ date: '2026-10-01', attendance: [{ memberId: 'ana', checkIn: 'x' }, { memberId: 'beto', checkIn: 'y' }], closing: { whatWeDid: 'Armamos el chasis', updatedAt: 'z' } }],
      entries: [
        entry({ elements: [{ id: 'p', type: 'photo', photoId: 'foto1', caption: 'Chasis' }] }),
        entry({ section: 'mechanics' }),
        entry({ sessionDate: '2026-10-02' }),
      ],
    });
    expect(validateNotebook(r.document).ok).toBe(true);
    const daily = r.document.pages.filter((p) => p.type === 'dailyWork');
    expect(daily.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect(daily[0]?.fields?.notes).toEqual({ text: expect.stringMatching(/^texto \d+$/), images: [{ src: 'photos/foto1.jpg', caption: 'Chasis' }] });
    expect(r.photoIds).toEqual(['foto1']);
    expect(r.warnings.some((w) => /sin sección/.test(w))).toBe(true);
    expect(r.document.sessions?.[0]).toEqual({ date: '2026-10-01', event: 'Taller (Ana Prueba, Beto Ejemplo)', summary: 'Armamos el chasis' });
    expect(r.document.members.map((m) => m.initials)).toEqual(['AP', 'BE']);
  });

  it('el contador va a la tabla de resultados de la prueba; robot y subsistema al título', () => {
    const r = assembleNotebook({
      team,
      sessions: [],
      entries: [
        entry({
          kind: 'test',
          section: 'mechanics',
          robotId: 'grande',
          subsystem: 'intake',
          elements: [
            { id: 'a', type: 'text', text: 'Se atora con piezas inclinadas.' },
            { id: 'b', type: 'trials', trials: [{ ok: true, at: 't' }, { ok: false, at: 't', note: 'se atoró' }] },
          ],
        }),
      ],
    });
    const p = r.document.pages[0];
    expect(p?.type).toBe('test');
    expect(p?.subsystem).toBe('intake (Robot Grande)');
    expect(p?.fields?.results).toEqual([
      ['1', 'Acierto', '', ''],
      ['2', 'Fallo', 'se atoró', ''],
    ]);
    expect(p?.fields?.analysis).toEqual({ text: 'Se atora con piezas inclinadas.' });
    expect(validateNotebook(r.document).ok).toBe(true);
  });

  it('cambio → registro de cambios; inspiración → créditos; hilo → iteraciones', () => {
    const r = assembleNotebook({
      team,
      sessions: [],
      entries: [
        entry({ kind: 'buildIteration', section: 'mechanics', thread: 'intake v2', marks: ['change'], elements: [{ id: 'a', type: 'text', text: 'Rodillos más grandes' }] }),
        entry({ kind: 'buildIteration', section: 'mechanics', thread: 'intake v2', sessionDate: '2026-10-03', marks: ['inspiration'], elements: [{ id: 'a', type: 'text', text: 'Idea de ligas' }, { id: 'b', type: 'link', url: 'https://example.com/v', title: 'Video de ejemplo' }] }),
        entry({ kind: 'decision', section: 'strategy', marks: ['change'] }),
        entry({ kind: 'mechanism', section: 'coding' }),
        entry({ deleted: true }),
      ],
    });
    const builds = r.document.pages.filter((p) => p.type === 'buildIteration');
    expect(builds).toHaveLength(2);
    expect(builds.every((p) => p.thread === 'intake v2')).toBe(true);
    expect(builds[0]?.changes).toEqual([{ change: 'Rodillos más grandes' }]);
    expect(builds[1]?.credits).toEqual([{ source: 'Video de ejemplo (https://example.com/v)', used: 'Idea de ligas' }]);
    expect(r.document.pages.find((p) => p.section === 'coding')?.type).toBe('dailyWork');
    expect(r.warnings.some((w) => /Estrategia/.test(w))).toBe(true);
    expect(r.document.pages).toHaveLength(4);
    expect(validateNotebook(r.document).ok).toBe(true);
  });

  it('no inventa texto: sin texto capturado, los campos quedan vacíos', () => {
    const r = assembleNotebook({ team, sessions: [], entries: [entry({ kind: 'decision', section: 'coding', elements: [{ id: 'p', type: 'photo', photoId: 'f' }] })] });
    expect(r.document.pages[0]?.fields).toEqual({ evidence: { images: [{ src: 'photos/f.jpg' }] } });
  });
});
