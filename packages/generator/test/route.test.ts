/**
 * Ruta del autónomo: el mapa del campo sale de la plantilla (recortado con
 * srcRect) y la ruta se dibuja encima con formas reales.
 */

import { describe, expect, it } from 'vitest';
import { FIELD_IMAGE, routeMarks } from '@vortex-wake/shared';
import { generateNotebook } from '../src/generate.ts';
import { readImageInfo } from '../src/images.ts';
import { Template } from '../src/template.ts';
import { TEMPLATES, minimalDocument, parseStrict, readTemplate, slideText, slidesInOrder, text, unzip } from './helpers.ts';

const route = [
  { id: 'p1', x: 0.2, y: 0.8, action: 'Salir de la esquina' },
  { id: 'p2', x: 0.4, y: 0.5, action: 'Tomar el objeto', points: '3' },
  { id: 'p3', x: 0.7, y: 0.3, action: 'Anotar' },
];

describe('ruta del autónomo sobre el mapa del campo', () => {
  for (const [lang, path] of TEMPLATES) {
    it(`la plantilla trae el mapa del campo del tamaño esperado (${lang})`, () => {
      const info = readImageInfo(new Template(readTemplate(path)).fieldImage());
      expect([info.width, info.height]).toEqual([FIELD_IMAGE.width, FIELD_IMAGE.height]);
    });

    it(`dibuja la ruta con puntos numerados y flechas, y llena los pasos (${lang})`, async () => {
      const doc = minimalDocument({
        pages: [
          {
            id: 'a1',
            type: 'autonomousPlan',
            section: 'strategy',
            date: '2026-11-14',
            authors: ['a'],
            fields: {
              path: { images: [{ src: 'template:field', marks: routeMarks(route) }] },
              steps: route.map((p, i) => [String(i + 1), p.action, '', p.points ?? '']),
            },
          },
        ],
      });
      const r = await generateNotebook({ template: readTemplate(path), document: doc, loadAsset: () => { throw new Error('no se pide ninguna imagen de afuera'); } });
      const files = unzip(r.bytes);
      const page = r.pages.find((p) => p.pageId === 'a1');
      const xml = text(files, slidesInOrder(files)[(page?.slide ?? 1) - 1] as string);
      parseStrict(xml, 'ruta');
      expect(xml).toMatch(/<a:srcRect l="13455" t="21826" r="13455" b="21680"\/>/);
      expect((xml.match(/prst="straightConnector1"/g) ?? []).length).toBe(2);
      expect((xml.match(/prst="ellipse"/g) ?? []).length).toBe(3);
      expect(slideText(xml)).toContain('Tomar el objeto');
      // El mapa queda cuadrado (el recorte es cuadrado).
      const ext = /<p:pic>.*?<a:ext cx="(\d+)" cy="(\d+)"/s.exec(xml);
      expect(Number(ext?.[1])).toBe(Number(ext?.[2]));
    });
  }
});
