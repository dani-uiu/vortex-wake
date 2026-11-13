import { describe, expect, it } from 'vitest';
import { assembleNotebook, checkEntry, matchRow, validateNotebook, type Entry, type TeamConfig } from '../src/index.ts';

const team: TeamConfig = { format: 'vortex-wake/team', version: 1, team: { name: 'Equipo Ejemplo', number: '99999Z' }, members: [{ id: 'ana', name: 'Ana Prueba' }], robots: [] };

function match(id: string, over: Record<string, unknown>, at: string): Entry {
  return {
    id,
    sessionDate: '2026-11-14',
    createdAt: at,
    updatedAt: at,
    authorIds: ['ana'],
    marks: ['tournament'],
    kind: 'tournamentLog',
    section: 'strategy',
    elements: [{ id: `m${id}`, type: 'match', match: 'Q1', ...over } as Entry['elements'][number]],
  };
}

describe('modo torneo', () => {
  it('fila de un partido', () => {
    expect(matchRow({ id: 'x', type: 'match', match: 'Q12', alliance: 'red', partner: '1234B', opponents: '5678A, 9012C', ourScore: '52', theirScore: '40', result: 'win', failed: 'Nada', adjusted: '' })).toEqual([
      'Q12',
      'Roja con 1234B vs 5678A, 9012C',
      '52-40 · Ganamos',
      'Nada',
      '',
    ]);
    expect(matchRow({ id: 'x', type: 'match', match: 'Q2' })).toEqual(['Q2', '', '', '', '']);
  });

  it('el contrato acepta partidos y rechaza valores inválidos', () => {
    expect(checkEntry(match('a', {}, '2026-11-14T15:00:00.000Z'))).toBeUndefined();
    expect(checkEntry(match('a', { alliance: 'verde' }, '2026-11-14T15:00:00.000Z'))).toBe('alianza inválida');
    expect(checkEntry(match('a', { adjustedSection: 'strategy' }, '2026-11-14T15:00:00.000Z'))).toBe('sección del ajuste inválida');
  });

  it('una página por día de torneo, una fila por partido, y el ajuste al registro de cambios de su sección', () => {
    const r = assembleNotebook({
      team,
      sessions: [],
      entries: [
        match('a', { match: 'Q1', ourScore: '52', theirScore: '40', result: 'win' }, '2026-11-14T15:00:00.000Z'),
        match('b', { match: 'Q7', failed: 'Se atoró el intake', adjusted: 'Bajamos la velocidad', adjustedSection: 'mechanics' }, '2026-11-14T16:00:00.000Z'),
      ],
    });
    const page = r.document.pages[0];
    expect(r.document.pages.length).toBe(1);
    expect(page?.type).toBe('tournamentLog');
    expect((page?.fields?.matches as string[][]).map((x) => x[0])).toEqual(['Q1', 'Q7']);
    expect(page?.changes).toEqual([{ section: 'mechanics', change: 'Bajamos la velocidad', test: page?.id, evidence: 'Partido Q7 · Se atoró el intake' }]);
    expect(validateNotebook(r.document).ok).toBe(true);
  });
});
