import { describe, expect, it } from 'vitest';
import exampleJson from '../../../examples/notebook-ejemplo/notebook.json' with { type: 'json' };
import { NotebookValidationError, parseNotebook, validateNotebook } from '../src/index.ts';

const example = () => structuredClone(exampleJson) as unknown;

const base = () => ({
  format: 'vortex-wake/notebook',
  version: 1,
  language: 'es',
  project: 'Prueba',
  team: { number: '1A', name: 'Equipo' },
  season: { start: '2026-09-01', end: '2027-04-30' },
  members: [{ id: 'a', name: 'A', roles: [], initials: 'A' }],
  pages: [] as unknown[],
});

const messages = (input: unknown) => {
  const r = validateNotebook(input);
  return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
};

describe('validación del documento', () => {
  it('acepta el ejemplo', () => {
    expect(messages(example())).toEqual([]);
  });

  it('rechaza referencias a páginas que no existen', () => {
    const d = base();
    d.pages = [{ id: 'p1', type: 'decision', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { decision: 'ver {{page:nada}}' } }];
    expect(messages(d).join('\n')).toMatch(/pages\[0\]\.fields\.decision: referencia a una página que no existe: "nada"/);
  });

  it('rechaza fechas inválidas, autores desconocidos e ids repetidos', () => {
    const d = base();
    d.pages = [
      { id: 'p1', type: 'decision', section: 'mechanics', date: '2026-02-30', authors: ['zz'] },
      { id: 'p1', type: 'decision', section: 'mechanics', date: '2026-02-01', authors: ['a'] },
    ];
    const m = messages(d).join('\n');
    expect(m).toMatch(/pages\[0\]\.date: fecha inválida/);
    expect(m).toMatch(/integrante desconocido: "zz"/);
    expect(m).toMatch(/id de página repetido: "p1"/);
  });

  it('rechaza campos desconocidos, tablas con columnas de más y secciones que la plantilla no trae', () => {
    const d = base();
    d.pages = [
      { id: 'p1', type: 'problem', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { foo: 'x', criteria: [['a', 'b', 'c', 'd']] } },
      { id: 'p2', type: 'mechanism', section: 'coding', date: '2026-10-01', authors: ['a'] },
    ];
    const m = messages(d).join('\n');
    expect(m).toMatch(/fields\.foo: campo desconocido/);
    expect(m).toMatch(/criteria\[0\]: la fila tiene 4 celdas; la tabla tiene 3/);
    expect(m).toMatch(/no trae "mechanism" en la sección "coding"/);
  });

  it('no deja escribir páginas automáticas', () => {
    const d = base();
    d.pages = [{ id: 'p1', type: 'changeLog', section: 'mechanics', date: '2026-10-01', authors: ['a'] }];
    expect(messages(d).join('\n')).toMatch(/las arma el generador/);
  });

  it('solo acepta imágenes PNG o JPEG', () => {
    const d = base();
    d.pages = [{ id: 'p1', type: 'buildIteration', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { photos: { images: [{ src: 'x.gif' }] } } }];
    expect(messages(d).join('\n')).toMatch(/solo se aceptan imágenes PNG o JPEG/);
  });

  it('parseNotebook lanza un error con todos los problemas', () => {
    expect(() => parseNotebook({})).toThrow(NotebookValidationError);
  });
});
