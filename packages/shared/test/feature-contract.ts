/**
 * Casos del contrato HTTP de las funciones nuevas, para correrlos igual contra
 * el servidor local y contra el Worker (mismo comportamiento en los dos).
 */

import { expect, it } from 'vitest';
import { apiPath, type Entry, type StateResponse } from '../src/index.ts';

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

  it('una entrada en el formato anterior (sin campos nuevos) se sigue aceptando igual', async () => {
    const e = entry({ id: 'vieja1', elements: [{ id: 'p', type: 'photo', photoId: 'foto-b', caption: 'Intake' }, { id: 't', type: 'text', text: 'antes' }] });
    expect((await put(apiPath.entry(e.id), e)).status).toBe(200);
    expect((await state()).entries.find((x) => x.id === 'vieja1')).toEqual(e);
  });
}
