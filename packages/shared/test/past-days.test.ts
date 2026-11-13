import { describe, expect, it } from 'vitest';
import { canEditDay, captureEditAllowed, summarizeDays } from '../src/api.ts';

describe('días pasados en la captura', () => {
  it('se corrigen solo las entradas de hoy y de ayer', () => {
    expect(canEditDay('2026-11-13', '2026-11-13')).toBe(true);
    expect(canEditDay('2026-11-12', '2026-11-13')).toBe(true);
    expect(canEditDay('2026-11-11', '2026-11-13')).toBe(false);
    expect(canEditDay('2026-10-31', '2026-11-01')).toBe(true);
    expect(canEditDay('2026-11-14', '2026-11-13')).toBe(false);
  });

  it('el servidor usa la hora de la edición, con margen por la zona horaria', () => {
    // Editada ayer en la noche (México, UTC-6) = madrugada del día siguiente en UTC.
    expect(captureEditAllowed({ sessionDate: '2026-11-12', updatedAt: '2026-11-14T05:30:00Z' })).toBe(true);
    // Editada sin conexión el día siguiente y mandada después: vale por su updatedAt.
    expect(captureEditAllowed({ sessionDate: '2026-11-12', updatedAt: '2026-11-13T20:00:00Z' })).toBe(true);
    expect(captureEditAllowed({ sessionDate: '2026-11-10', updatedAt: '2026-11-13T12:00:00Z' })).toBe(false);
  });

  it('resume por día entradas, asistencia y cierre', () => {
    const days = summarizeDays(
      [
        { date: '2026-11-10', attendance: [{ memberId: 'ana', checkIn: '2026-11-10T22:00:00Z' }], closing: { updatedAt: '2026-11-11T01:00:00Z', whatWeDid: 'Intake' } },
        { date: '2026-11-11', attendance: [], closing: { updatedAt: '2026-11-12T01:00:00Z', whatWeDid: ' ' } },
      ],
      [['2026-11-10', 3], ['2026-11-12', 1]],
    );
    expect(days).toEqual([
      { date: '2026-11-10', entries: 3, present: 1, closed: true },
      { date: '2026-11-12', entries: 1, present: 0, closed: false },
    ]);
  });
});
