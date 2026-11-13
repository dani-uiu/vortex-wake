/**
 * Fotos anotadas: las flechas y etiquetas salen como formas reales de
 * PowerPoint (conectores con punta y círculos con texto), agrupadas con la foto.
 */

import { describe, expect, it } from 'vitest';
import { generateNotebook } from '../src/generate.ts';
import { markStyle, marksXml } from '../src/marks.ts';
import { TEMPLATE_ES, fakePng, minimalDocument, parseStrict, readTemplate, slidesInOrder, text, unzip } from './helpers.ts';

describe('fotos anotadas', () => {
  it('dibuja flechas y etiquetas sobre la foto y llena la tabla de etiquetas', async () => {
    const doc = minimalDocument({
      pages: [
        {
          id: 'm1',
          type: 'mechanism',
          section: 'mechanics',
          date: '2026-10-01',
          authors: ['a'],
          subsystem: 'intake',
          fields: {
            picture: {
              images: [
                {
                  src: 'f.png',
                  marks: [
                    { kind: 'label', text: 'A', x: 0.1, y: 0.1, tx: 0.5, ty: 0.5 },
                    { kind: 'label', text: 'B', x: 0.9, y: 0.2 },
                    { kind: 'arrow', x: 0.2, y: 0.9, tx: 0.6, ty: 0.6 },
                  ],
                },
              ],
            },
            labels: [['A: Rodillo', 'Jala', 'Porque sí'], ['B: Motor', '', '']],
          },
        },
      ],
    });
    const r = await generateNotebook({ template: readTemplate(TEMPLATE_ES), document: doc, loadAsset: () => fakePng(800, 600) });
    const files = unzip(r.bytes);
    const page = r.pages.find((p) => p.pageId === 'm1');
    const xml = text(files, slidesInOrder(files)[(page?.slide ?? 1) - 1] as string);
    parseStrict(xml, 'slide');
    expect((xml.match(/<p:grpSp>/g) ?? []).length).toBe(1);
    expect((xml.match(/prst="straightConnector1"/g) ?? []).length).toBe(2);
    expect((xml.match(/prst="ellipse"/g) ?? []).length).toBe(2);
    expect(xml).toContain('<a:tailEnd type="triangle"');
    expect(xml).toMatch(/name="Etiqueta A"/);
    expect(xml).toContain('<a:t>A: Rodillo</a:t>');
    // ids únicos dentro de la diapositiva
    const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('las etiquetas no se salen de la foto y la flecha sale del borde del círculo', () => {
    const box = { x: 100, y: 100, w: 200, h: 100 };
    let id = 1;
    const out = marksXml([{ kind: 'label', text: 'A', x: 0, y: 0, tx: 1, ty: 1 }], box, 'es-MX', () => id++);
    expect(out.length).toBe(2);
    const d = markStyle(box).diameter;
    const off = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)"/.exec(out[1] as string);
    expect(Number(off?.[1]) / 12700).toBeCloseTo(100, 0);
    expect(Number(off?.[3]) / 12700).toBeCloseTo(d, 0);
    const arrow = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(out[0] as string);
    expect(Number(arrow?.[1]) / 12700).toBeGreaterThan(100 + d / 2);
  });
});
