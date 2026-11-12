/**
 * Crecimiento y continuación de tablas, texto largo y fotos.
 */

import { describe, expect, it } from 'vitest';
import type { NotebookPage } from '@vortex-wake/shared';
import { generateNotebook } from '../src/generate.ts';
import { EMU_PER_PT } from '../src/template.ts';
import { fakePng, minimalDocument, readTemplate, slidesInOrder, text, unzip } from './helpers.ts';

const template = readTemplate();
const assets = (src: string) => {
  const m = /(\d+)x(\d+)/.exec(src);
  return fakePng(Number(m?.[1] ?? 400), Number(m?.[2] ?? 300));
};

async function generate(page: Partial<NotebookPage>) {
  const doc = minimalDocument({
    pages: [{ id: 'p', type: 'test', section: 'mechanics', date: '2026-10-01', authors: ['a'], ...page } as NotebookPage],
  });
  const r = await generateNotebook({ template, document: doc, loadAsset: assets });
  const files = unzip(r.bytes);
  const slides = slidesInOrder(files);
  const pages = r.pages.filter((p) => p.pageId === 'p').map((p) => ({ ...p, xml: text(files, slides[p.slide - 1] as string) }));
  return { r, pages };
}

function tableRows(xml: string, name: string): string[][] {
  const i = xml.indexOf(`name="${name}"`);
  if (i < 0) return [];
  const tbl = xml.slice(i, xml.indexOf('</a:tbl>', i));
  return [...tbl.matchAll(/<a:tr [\s\S]*?<\/a:tr>/g)].map((tr) =>
    [...(tr[0] as string).matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)].map((tc) => [...(tc[0] as string).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('\n')),
  );
}

function frameBox(xml: string, name: string) {
  const i = xml.indexOf(`name="${name}"`);
  const off = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(xml.slice(i));
  return { x: Number(off?.[1]) / EMU_PER_PT, y: Number(off?.[2]) / EMU_PER_PT, w: Number(off?.[3]) / EMU_PER_PT, h: Number(off?.[4]) / EMU_PER_PT };
}

const trial = (i: number) => [String(i), `${i} piezas`, i % 3 === 0 ? 'Observación' : '', 'v1'];

describe('tablas', () => {
  it('con menos filas que la plantilla, conserva las filas vacías para escribir a mano', async () => {
    const { pages } = await generate({ fields: { results: [trial(1), trial(2)] } });
    expect(pages).toHaveLength(1);
    const rows = tableRows(pages[0]?.xml as string, 'Table 13');
    expect(rows).toHaveLength(7); // encabezado + 6 filas de la plantilla
    expect(rows[1]?.[1]).toBe('1 piezas');
    expect(rows[3]?.join('')).toBe('');
  });

  it('con más filas de las de la plantilla, agrega filas mientras quepan en la página', async () => {
    const { pages } = await generate({ fields: { results: Array.from({ length: 10 }, (_, i) => trial(i + 1)) } });
    expect(pages).toHaveLength(1);
    expect(tableRows(pages[0]?.xml as string, 'Table 13')).toHaveLength(11);
    // La tabla crecida no se encima con el bloque siguiente.
    const table = frameBox(pages[0]?.xml as string, 'Table 13');
    const next = frameBox(pages[0]?.xml as string, 'TextBox 14');
    expect(table.y + table.h).toBeLessThanOrEqual(next.y + 0.5);
  });

  it('si no caben, sigue en una página de continuación con el encabezado repetido', async () => {
    const all = Array.from({ length: 45 }, (_, i) => trial(i + 1));
    const { pages, r } = await generate({ fields: { results: all } });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.slice(1).every((p) => p.continuation)).toBe(true);
    const collected: string[] = [];
    for (const p of pages) {
      const rows = tableRows(p.xml, 'Table 13');
      expect(rows[0]?.[0]).toBe('Trial');
      collected.push(...rows.slice(1).map((row) => row[0] as string).filter((c) => c !== ''));
    }
    expect(collected).toEqual(all.map((row) => row[0]));
    expect(r.warnings.join(' ')).toMatch(/continuación/);
    // La continuación conserva el tipo de página, sección y pie.
    expect(pages[1]?.title).toMatch(/\(cont\.\)$/);
    expect(pages[1]?.number).toBe('M-2');
  });

  it('las tablas de filas fijas conservan sus etiquetas y llenan las demás columnas', async () => {
    const { pages } = await generate({ fields: { setup: [['Piezas'], ['Cronómetro'], ['Batería llena'], ['10'], ['Hoy']] } });
    const rows = tableRows(pages[0]?.xml as string, 'Table 11');
    expect(rows[1]).toEqual(['What we measure (variable, unit)', 'Piezas']);
    expect(rows[5]).toEqual(['Date and who ran the test', 'Hoy']);
  });
});

describe('texto largo', () => {
  it('no se sale del recuadro: el resto pasa a una continuación sin perder palabras', async () => {
    const words = Array.from({ length: 900 }, (_, i) => `palabra${i}`);
    const { pages } = await generate({ fields: { analysis: words.join(' ') } });
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const got = pages
      .flatMap((p) => {
        const i = p.xml.indexOf('name="Rectangle 15"');
        if (i < 0) return [];
        const body = p.xml.slice(i, p.xml.indexOf('</p:sp>', i));
        return [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1] as string);
      })
      .join(' ')
      .split(/\s+/)
      .filter((w) => w !== '');
    expect(got).toEqual(words);
    // Nada por debajo del límite del contenido (arriba del pie).
    for (const p of pages) {
      const box = frameBox(p.xml, 'Rectangle 15');
      expect(box.y + box.h).toBeLessThanOrEqual(728.5);
    }
  });
});

describe('fotos', () => {
  it('se acomodan en rejilla dentro de la zona, conservando la proporción', async () => {
    const images = [{ src: 'a-400x300.png', caption: 'A' }, { src: 'b-300x400.png' }, { src: 'c-800x400.png', caption: 'C' }];
    const doc = minimalDocument({
      pages: [{ id: 'b', type: 'buildIteration', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { photos: { images } } }],
    });
    const r = await generateNotebook({ template, document: doc, loadAsset: assets });
    const files = unzip(r.bytes);
    const slide = slidesInOrder(files)[(r.pages.find((p) => p.pageId === 'b')?.slide as number) - 1] as string;
    const xml = text(files, slide);
    const zone = frameBox(xml, 'Rectangle 13');
    const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => {
      const o = /<a:off x="(\d+)" y="(\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(m[0] as string);
      return { x: Number(o?.[1]) / EMU_PER_PT, y: Number(o?.[2]) / EMU_PER_PT, w: Number(o?.[3]) / EMU_PER_PT, h: Number(o?.[4]) / EMU_PER_PT };
    });
    expect(pics).toHaveLength(3);
    const ratios = [4 / 3, 3 / 4, 2];
    pics.forEach((p, i) => {
      expect(p.w / p.h).toBeCloseTo(ratios[i] as number, 1);
      expect(p.x).toBeGreaterThanOrEqual(zone.x - 0.5);
      expect(p.y).toBeGreaterThanOrEqual(zone.y - 0.5);
      expect(p.x + p.w).toBeLessThanOrEqual(zone.x + zone.w + 0.5);
      expect(p.y + p.h).toBeLessThanOrEqual(zone.y + zone.h + 0.5);
    });
    expect(xml).toContain('>A</a:t>');
    expect(xml).toContain('>C</a:t>');
  });

  it('muchas fotos pasan a una continuación en lugar de quedar diminutas', async () => {
    const images = Array.from({ length: 30 }, (_, i) => ({ src: `f${i}-400x300.png` }));
    const doc = minimalDocument({
      pages: [{ id: 'b', type: 'buildIteration', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { photos: { images } } }],
    });
    const r = await generateNotebook({ template, document: doc, loadAsset: assets });
    const pages = r.pages.filter((p) => p.pageId === 'b');
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const files = unzip(r.bytes);
    const slides = slidesInOrder(files);
    let total = 0;
    for (const p of pages) {
      const xml = text(files, slides[p.slide - 1] as string);
      for (const m of xml.matchAll(/<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>/g)) {
        total++;
        expect(Math.min(Number(m[1]), Number(m[2])) / EMU_PER_PT).toBeGreaterThanOrEqual(59.9);
      }
    }
    expect(total).toBe(30);
  });
});
