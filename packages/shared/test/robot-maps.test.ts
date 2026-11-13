import { describe, expect, it } from 'vitest';
import { PORT_SLOTS, assembleNotebook, checkTeam, saveMapVersion, validateNotebook, type TeamConfig } from '../src/index.ts';

const base: TeamConfig = {
  format: 'vortex-wake/team',
  version: 1,
  team: { name: 'Equipo Ejemplo', number: '99999Z' },
  members: [{ id: 'ana', name: 'Ana Prueba' }],
  robots: [{ id: 'robot-a', name: 'Robot A', subsystems: [] }],
  editors: ['ana'],
};

describe('mapas de puertos y del control', () => {
  it('29 puertos: 1 a 21 y A a H', () => {
    expect(PORT_SLOTS.length).toBe(29);
    expect(PORT_SLOTS.slice(-2)).toEqual(['G', 'H']);
  });

  it('historial: el mismo día se reemplaza, otro día se agrega, sin cambios no se agrega', () => {
    let h = saveMapVersion(undefined, { '1': ' Motor ', '2': '' }, '2026-10-01', '2026-10-01T18:00:00.000Z', 'ana');
    expect(h).toEqual([{ date: '2026-10-01', savedAt: '2026-10-01T18:00:00.000Z', by: 'ana', slots: { '1': 'Motor' } }]);
    h = saveMapVersion(h, { '1': 'Motor', '3': 'Radio' }, '2026-10-01', '2026-10-01T19:00:00.000Z');
    expect(h.length).toBe(1);
    expect(h[0]?.slots).toEqual({ '1': 'Motor', '3': 'Radio' });
    expect(saveMapVersion(h, { '3': 'Radio', '1': 'Motor' }, '2026-10-08', '2026-10-08T18:00:00.000Z')).toEqual(h);
    const h2 = saveMapVersion(h, { '1': 'Motor nuevo' }, '2026-10-08', '2026-10-08T18:00:00.000Z');
    expect(h2.map((v) => v.date)).toEqual(['2026-10-01', '2026-10-08']);
    expect(saveMapVersion(undefined, {}, '2026-10-01', '2026-10-01T18:00:00.000Z')).toEqual([]);
  });

  it('el equipo con mapas es válido, el viejo (sin mapas) también, y uno dañado no', () => {
    const team: TeamConfig = { ...base, robots: [{ ...base.robots[0]!, ports: saveMapVersion(undefined, { '1': 'Motor' }, '2026-10-01', '2026-10-01T18:00:00.000Z') }] };
    expect(checkTeam(team)).toBeUndefined();
    expect(checkTeam(base)).toBeUndefined();
    expect(checkTeam({ ...base, robots: [{ ...base.robots[0]!, ports: [{ date: 'ayer', savedAt: 'x', slots: {} }] }] })).toBe('versión de ports inválida');
  });

  it('cada versión es una página del documento, con su fecha y autor', () => {
    const ports = saveMapVersion(saveMapVersion(undefined, { '1': 'Motor' }, '2026-10-01', '2026-10-01T18:00:00.000Z', 'ana'), { '1': 'Motor', '2': 'Radio' }, '2026-10-08', '2026-10-08T18:00:00.000Z');
    const controller = saveMapVersion(undefined, { L1: 'Intake' }, '2026-10-03', '2026-10-03T18:00:00.000Z');
    const team: TeamConfig = { ...base, robots: [{ ...base.robots[0]!, ports, controller }] };
    const r = assembleNotebook({ team, sessions: [], entries: [] });
    expect(r.document.robotMaps?.map((m) => [m.kind, m.date, m.authors.join()])).toEqual([
      ['ports', '2026-10-01', 'ana'],
      ['ports', '2026-10-08', 'ana'],
      ['controller', '2026-10-03', 'ana'],
    ]);
    expect(validateNotebook(r.document).ok).toBe(true);
  });
});
