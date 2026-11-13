import { describe, expect, it } from 'vitest';
import { assembleNotebook, checkEntry, labelLetter, nextLabelLetter, validateNotebook, type Entry, type PhotoAnnotation, type TeamConfig } from '../src/index.ts';

const team: TeamConfig = {
  format: 'vortex-wake/team',
  version: 1,
  team: { name: 'Equipo Ejemplo', number: '99999Z' },
  members: [{ id: 'ana', name: 'Ana Prueba' }],
  robots: [{ id: 'grande', name: 'Robot Grande', subsystems: ['intake'] }],
};

const annotations: PhotoAnnotation[] = [
  { id: 'l1', type: 'label', letter: 'A', x: 0.2, y: 0.2, tx: 0.5, ty: 0.5, what: 'Rodillo', does: 'Jala los anillos', why: 'Agarra desde el piso' },
  { id: 'l2', type: 'label', letter: 'B', x: 0.8, y: 0.1, what: 'Motor 11W' },
  { id: 'a1', type: 'arrow', x: 0.1, y: 0.9, tx: 0.3, ty: 0.7 },
];

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    sessionDate: '2026-10-01',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    authorIds: ['ana'],
    marks: [],
    elements: [{ id: 'p1', type: 'photo', photoId: 'foto1', annotations }],
    ...over,
  };
}

describe('anotaciones de fotos', () => {
  it('letras automáticas', () => {
    expect([0, 1, 25, 26, 27].map(labelLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
    expect(nextLabelLetter(['A', 'C'])).toBe('B');
    expect(nextLabelLetter([])).toBe('A');
  });

  it('el contrato acepta fotos con y sin anotaciones (formato anterior) y rechaza coordenadas inválidas', () => {
    expect(checkEntry(entry())).toBeUndefined();
    expect(checkEntry(entry({ elements: [{ id: 'p1', type: 'photo', photoId: 'foto1' }] }))).toBeUndefined();
    expect(checkEntry(entry({ elements: [{ id: 'p1', type: 'photo', photoId: 'foto1', annotations: [{ id: 'x', type: 'arrow', x: 2, y: 0, tx: 0, ty: 0 }] }] }))).toBe('anotación inválida');
    expect(checkEntry(entry({ elements: [{ id: 'p1', type: 'photo', photoId: 'foto1', annotations: [{ id: 'x', type: 'label', letter: '', x: 0, y: 0 }] }] }))).toBe('etiqueta inválida');
    expect(checkEntry({ ...entry(), elements: [{ id: 'p1', type: 'photo', photoId: 'foto1', annotations: 'no' }] })).toBe('anotaciones inválidas');
  });

  it('mecanismo: las etiquetas llenan la tabla y la foto lleva sus marcas', () => {
    const r = assembleNotebook({ team, sessions: [], entries: [entry({ kind: 'mechanism', section: 'mechanics' })] });
    const page = r.document.pages[0];
    expect(page?.fields?.labels).toEqual([
      ['A: Rodillo', 'Jala los anillos', 'Agarra desde el piso'],
      ['B: Motor 11W', '', ''],
    ]);
    const pic = page?.fields?.picture as { images: { marks: unknown[] }[] };
    expect(pic.images[0]?.marks).toEqual([
      { kind: 'label', text: 'A', x: 0.2, y: 0.2, tx: 0.5, ty: 0.5 },
      { kind: 'label', text: 'B', x: 0.8, y: 0.1 },
      { kind: 'arrow', x: 0.1, y: 0.9, tx: 0.3, ty: 0.7 },
    ]);
    expect(validateNotebook(r.document).ok).toBe(true);
  });

  it('cableado: tabla de puertos con 4 columnas; otros tipos: renglones de texto', () => {
    const w = assembleNotebook({ team, sessions: [], entries: [entry({ kind: 'wiringDoc', section: 'wiring' })] });
    expect(w.document.pages[0]?.fields?.ports).toEqual([
      ['A', 'Rodillo', 'Jala los anillos', 'Agarra desde el piso'],
      ['B', 'Motor 11W', '', ''],
    ]);
    const d = assembleNotebook({ team, sessions: [], entries: [entry()] });
    expect((d.document.pages[0]?.fields?.notes as { text: string }).text).toBe('A · Rodillo · Jala los anillos · Agarra desde el piso\nB · Motor 11W');
  });

  it('una letra repetida en dos fotos dice de qué foto es', () => {
    const e = entry({ kind: 'mechanism', section: 'mechanics' });
    e.elements.push({ id: 'p2', type: 'photo', photoId: 'foto2', annotations: [{ id: 'z', type: 'label', letter: 'A', x: 0.5, y: 0.5, what: 'Cadena' }] });
    const r = assembleNotebook({ team, sessions: [], entries: [e] });
    expect((r.document.pages[0]?.fields?.labels as string[][]).map((row) => row[0])).toEqual(['A (foto 1): Rodillo', 'B: Motor 11W', 'A (foto 2): Cadena']);
  });

  it('boceto: se acepta en el contrato y llega a la zona de bocetos de la lluvia de ideas', () => {
    const e = entry({ kind: 'brainstorm', section: 'mechanics', elements: [{ id: 's', type: 'photo', photoId: 'boceto1', sketch: true }, { id: 't', type: 'text', text: 'Idea' }] });
    expect(checkEntry(e)).toBeUndefined();
    expect(checkEntry({ ...e, elements: [{ id: 's', type: 'photo', photoId: 'b', sketch: 'sí' }] })).toBe('foto inválida');
    const r = assembleNotebook({ team, sessions: [], entries: [e] });
    expect(r.document.pages[0]?.fields?.sketches).toEqual({ images: [{ src: 'photos/boceto1.jpg' }] });
    expect(r.photoIds).toEqual(['boceto1']);
  });

  it('ruta del autónomo: mapa del campo con puntos numerados y flechas; pasos en la tabla', () => {
    const points = [
      { id: 'a', x: 0.1, y: 0.9, action: 'Salir' },
      { id: 'b', x: 0.5, y: 0.5, action: 'Tomar', points: '3' },
    ];
    const e = entry({ kind: 'autonomousPlan', section: 'strategy', elements: [{ id: 'r', type: 'route', points }] });
    expect(checkEntry(e)).toBeUndefined();
    expect(checkEntry({ ...e, elements: [{ id: 'r', type: 'route', points: [{ id: 'x', x: 1.5, y: 0 }] }] })).toBe('punto de ruta inválido');
    const r = assembleNotebook({ team, sessions: [], entries: [e] });
    const page = r.document.pages[0];
    expect(page?.fields?.steps).toEqual([
      ['1', 'Salir', '', ''],
      ['2', 'Tomar', '', '3'],
    ]);
    expect(page?.fields?.path).toEqual({
      images: [{ src: 'template:field', marks: [{ kind: 'arrow', x: 0.1, y: 0.9, tx: 0.5, ty: 0.5 }, { kind: 'label', text: '1', x: 0.1, y: 0.9 }, { kind: 'label', text: '2', x: 0.5, y: 0.5 }] }],
    });
    expect(r.photoIds).toEqual([]);
    expect(validateNotebook(r.document).ok).toBe(true);
  });

  it('el documento rechaza marcas inválidas', () => {
    const r = assembleNotebook({ team, sessions: [], entries: [entry({ kind: 'mechanism', section: 'mechanics' })] });
    const doc = structuredClone(r.document);
    (doc.pages[0]?.fields?.picture as { images: { marks: unknown[] }[] }).images[0]!.marks = [{ kind: 'arrow', x: 0.1, y: 0.1 }];
    const v = validateNotebook(doc);
    expect(v.ok).toBe(false);
  });
});
