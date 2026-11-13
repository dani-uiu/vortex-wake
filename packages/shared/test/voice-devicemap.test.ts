import { describe, expect, it } from 'vitest';
import { audioType, checkEntry } from '../src/api.ts';
import type { Entry, EntryElement } from '../src/model.ts';

const entry = (elements: EntryElement[]): Entry => ({
  id: 'e1',
  sessionDate: '2026-11-13',
  createdAt: '2026-11-13T10:00:00Z',
  updatedAt: '2026-11-13T10:00:00Z',
  authorIds: ['ana'],
  marks: [],
  elements,
});

describe('notas de voz', () => {
  it('acepta los tipos de audio comunes, sin parámetros', () => {
    expect(audioType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(audioType('Audio/Ogg')).toBe('audio/ogg');
    expect(audioType('image/jpeg')).toBeUndefined();
    expect(audioType(null)).toBeUndefined();
  });

  it('valida el elemento', () => {
    expect(checkEntry(entry([{ id: 'a', type: 'audio', audioId: 'v1', mime: 'audio/ogg', durationMs: 4200 }]))).toBeUndefined();
    expect(checkEntry(entry([{ id: 'a', type: 'audio', audioId: 'v1', mime: 'audio/webm;codecs=opus' }]))).toBe('nota de voz inválida');
    expect(checkEntry(entry([{ id: 'a', type: 'audio', audioId: '../x', mime: 'audio/ogg' }]))).toBe('nota de voz inválida');
  });
});

describe('mapa del Brain y del control en una entrada', () => {
  it('valida lugares y textos', () => {
    expect(checkEntry(entry([{ id: 'm', type: 'devicemap', kind: 'ports', slots: { '1': 'Motor izq', A: 'Limit switch' } }]))).toBeUndefined();
    expect(checkEntry(entry([{ id: 'm', type: 'devicemap', kind: 'controller', slots: { R1: 'Intake', axis3: 'Avanzar' } }]))).toBeUndefined();
    expect(checkEntry(entry([{ id: 'm', type: 'devicemap', kind: 'ports', slots: { '22': 'x' } }]))).toBe('mapa inválido');
    expect(checkEntry(entry([{ id: 'm', type: 'devicemap', kind: 'controller', slots: { '1': 'x' } }]))).toBe('mapa inválido');
  });
});
