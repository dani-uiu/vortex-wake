import { describe, expect, it } from 'vitest';
import type { ContentPage } from '../src/plan.ts';
import { buildTitle } from '../src/generate.ts';
import { readImageInfo, layoutGrid } from '../src/images.ts';
import { splitTextByLines, wrapText } from '../src/measure.ts';
import { fakePng } from './helpers.ts';

const page = (p: Partial<ContentPage>): ContentPage =>
  ({ kind: 'content', pageId: 'x', type: 'buildIteration', section: 'mechanics', group: 'mechanics', date: '2026-01-01', authors: [], fields: {}, ...p }) as ContentPage;

describe('títulos', () => {
  it('cambia [subsystem] y #__ sin depender del idioma', () => {
    expect(buildTitle('Prototype / Build Iteration #__: [subsystem]', page({ subsystem: 'intake', iteration: 3 }))).toBe('Prototype / Build Iteration #3: intake');
    expect(buildTitle('Prototipo / iteración de construcción #__: [subsistema]', page({ subsystem: 'intake', iteration: 2 }))).toBe(
      'Prototipo / iteración de construcción #2: intake',
    );
    expect(buildTitle('Decision Record: [subsystem]', page({}))).toBe('Decision Record');
    expect(buildTitle('Problem, Criteria & Constraints: Robot design', page({ subsystem: 'chasis' }))).toBe('Problem, Criteria & Constraints: chasis');
    expect(buildTitle('Problem, Criteria & Constraints: Robot design', page({}))).toBe('Problem, Criteria & Constraints: Robot design');
    expect(buildTitle('Cualquiera', page({ title: 'Título propio' }))).toBe('Título propio');
  });
});

describe('imágenes', () => {
  it('lee el tamaño de PNG', () => {
    expect(readImageInfo(fakePng(640, 480))).toEqual({ format: 'png', width: 640, height: 480 });
  });

  it('lee el tamaño de JPEG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(readImageInfo(jpeg)).toEqual({ format: 'jpeg', width: 400, height: 300 });
  });

  it('rechaza otros formatos', () => {
    expect(() => readImageInfo(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(/PNG o JPEG/);
  });

  it('la rejilla conserva la proporción y no se sale del área', () => {
    const g = layoutGrid([4 / 3, 1, 16 / 9, 3 / 4], [true, false, false, true], 500, 200);
    for (const c of g.images) {
      expect(c.x).toBeGreaterThanOrEqual(-0.01);
      expect(c.y).toBeGreaterThanOrEqual(-0.01);
      expect(c.x + c.width).toBeLessThanOrEqual(500.01);
      expect(c.y + c.height).toBeLessThanOrEqual(200.01);
    }
    expect(g.images[0]!.width / g.images[0]!.height).toBeCloseTo(4 / 3);
  });
});

describe('medida de texto', () => {
  it('parte en líneas y no pierde palabras al dividir', () => {
    const t = 'uno dos tres cuatro cinco seis siete ocho nueve diez\nonce doce';
    const lines = wrapText(t, 60, { sizePt: 10 });
    expect(lines.length).toBeGreaterThan(3);
    const { fitted, rest } = splitTextByLines(t, 60, { sizePt: 10 }, 2);
    expect(`${fitted} ${rest}`.split(/\s+/)).toEqual(t.split(/\s+/));
    expect(rest).toContain('\n');
  });
});
