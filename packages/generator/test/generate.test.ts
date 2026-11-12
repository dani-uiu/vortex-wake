/**
 * Generación completa sobre la plantilla real: numeración en ambos modos,
 * referencias entre páginas, orden, páginas automáticas y limpieza de notas.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { generateNotebook, type GenerateResult } from '../src/generate.ts';
import { exampleAssets, exampleDocument, minimalDocument, readTemplate, slideText, slidesInOrder, text, unzip, TEMPLATES } from './helpers.ts';

let bySection: GenerateResult;
let continuous: GenerateResult;

beforeAll(async () => {
  const template = readTemplate();
  bySection = await generateNotebook({ template, document: exampleDocument(), loadAsset: exampleAssets });
  continuous = await generateNotebook({ template, document: exampleDocument(), loadAsset: exampleAssets, options: { numbering: 'continuous' } });
});

function numberOf(r: GenerateResult, pageId: string): string | undefined {
  return r.pages.find((p) => p.pageId === pageId && !p.continuation)?.number;
}

describe('orden de la bitácora', () => {
  it('portada, comunes, organización y las cuatro secciones en orden', () => {
    const kinds = bySection.pages.map((p) => p.kind);
    expect(kinds[0]).toBe('cover');
    expect(kinds.slice(1, 3)).toEqual(['resources', 'toc']);
    const dividers = bySection.pages.filter((p) => p.kind === 'divider').map((p) => p.slide);
    expect(dividers).toHaveLength(5); // organización + 4 secciones
    const groups = bySection.pages.filter((p) => p.number).map((p) => p.number?.split('-')[0]);
    const order = [...new Set(groups)];
    expect(order).toEqual(['G', 'T', 'M', 'C', 'W', 'S']);
  });

  it('dentro de cada sección, las páginas van en orden cronológico', () => {
    const doc = exampleDocument();
    const dateOf = new Map(doc.pages.map((p) => [p.id, p.date]));
    for (const prefix of ['M', 'C', 'W', 'S']) {
      const dates = bySection.pages
        .filter((p) => p.number?.startsWith(`${prefix}-`) && p.pageId && dateOf.has(p.pageId))
        .map((p) => dateOf.get(p.pageId as string) as string);
      expect([...dates].sort(), `sección ${prefix}`).toEqual(dates);
    }
  });

  it('omite las páginas internas, las modelo sin usar y las de referencia', () => {
    const files = unzip(bySection.bytes);
    const all = slidesInOrder(files).map((s) => slideText(text(files, s))).join('\n');
    expect(all).not.toMatch(/How to Use This Template|Rubric Map|DELETE THIS PAGE/);
    expect(all).not.toMatch(/RUBRIC TIP|Delete this note before judging/);
    expect(all).not.toMatch(/Reference Pages/);
    expect(all).not.toMatch(/Week of: MM\/DD\/YYYY/);
  });

  it('las páginas de referencia se agregan con la opción', async () => {
    const r = await generateNotebook({ template: readTemplate(), document: minimalDocument(), loadAsset: exampleAssets, options: { includeReferencePages: true } });
    const ref = r.pages.filter((p) => p.number?.startsWith('R-'));
    expect(ref.length).toBe(5);
  });
});

describe('numeración', () => {
  it('por sección: M-1, C-1, W-1, S-1, consecutiva dentro de cada sección', () => {
    const numbered = bySection.pages.filter((p) => p.number);
    const counters = new Map<string, number>();
    for (const p of numbered) {
      const [prefix, n] = (p.number as string).split('-');
      const expected = (counters.get(prefix as string) ?? 0) + 1;
      expect(Number(n), `${p.number} (${p.title})`).toBe(expected);
      counters.set(prefix as string, expected);
    }
    expect(numberOf(bySection, 'm-problem')).toBe('M-1');
    expect(numberOf(bySection, 'c-problem')).toBe('C-1');
    expect(numberOf(bySection, 'w-wiring')).toBe('W-1');
    expect(numberOf(bySection, 's-game')).toBe('S-1');
  });

  it('corrida: 1, 2, 3... sin saltos; portada y separadores sin número', () => {
    const numbered = continuous.pages.filter((p) => p.number);
    numbered.forEach((p, i) => expect(p.number).toBe(String(i + 1)));
    for (const p of continuous.pages) {
      if (p.kind === 'cover' || p.kind === 'divider') expect(p.number).toBeUndefined();
    }
  });

  it('las continuaciones llevan su propio número y no salen en la tabla de contenido', () => {
    const cont = bySection.pages.filter((p) => p.continuation && p.kind === 'content');
    expect(cont.length).toBeGreaterThan(0);
    const files = unzip(bySection.bytes);
    const slides = slidesInOrder(files);
    const tocText = bySection.pages
      .filter((p) => p.kind === 'toc')
      .map((p) => slideText(text(files, slides[p.slide - 1] as string)))
      .join('\n');
    for (const c of cont) expect(tocText).not.toContain(`${c.number}\t`);
  });

  it('el pie de cada página trae proyecto, autor, fecha y número', () => {
    const files = unzip(bySection.bytes);
    const slides = slidesInOrder(files);
    const doc = exampleDocument();
    const page = bySection.pages.find((p) => p.pageId === 'm-build-intake-2');
    const t = slideText(text(files, slides[(page?.slide as number) - 1] as string));
    expect(t).toContain(doc.project);
    expect(t).toContain('Emilio Garza, Ximena Robles');
    expect(t).toContain('19/09/2026');
    expect(t).toContain(page?.number as string);
  });
});

describe('referencias entre páginas', () => {
  it('se resuelven con el esquema activo', () => {
    for (const r of [bySection, continuous]) {
      const files = unzip(r.bytes);
      const slides = slidesInOrder(files);
      const page = r.pages.find((p) => p.pageId === 'm-build-intake-2');
      const t = slideText(text(files, slides[(page?.slide as number) - 1] as string));
      expect(t).toContain(`Continúa la iteración #1 (${numberOf(r, 'm-build-intake-1')})`);
      expect(t).not.toMatch(/\{\{page:/);
    }
  });

  it('ninguna diapositiva conserva marcas {{page:...}} sin resolver', () => {
    const files = unzip(continuous.bytes);
    for (const s of slidesInOrder(files)) expect(text(files, s)).not.toMatch(/\{\{page:/);
  });

  it('la tabla de contenido usa los mismos números', () => {
    const files = unzip(continuous.bytes);
    const slides = slidesInOrder(files);
    const tocText = continuous.pages
      .filter((p) => p.kind === 'toc')
      .map((p) => text(files, slides[p.slide - 1] as string))
      .join('\n');
    const n = numberOf(continuous, 'm-decision-intake') as string;
    expect(tocText).toContain(`${n}\tDecision Record: intake\t10/09/2026`);
  });

  it('la tabla de contenido se parte en varias páginas si no cabe', async () => {
    const doc = minimalDocument({
      pages: Array.from({ length: 60 }, (_, i) => ({
        id: `d${i}`,
        type: 'decision' as const,
        section: 'mechanics' as const,
        date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        authors: ['a'],
        subsystem: `opción ${i}`,
      })),
    });
    const r = await generateNotebook({ template: readTemplate(), document: doc, loadAsset: exampleAssets });
    expect(r.pages.filter((p) => p.kind === 'toc').length).toBe(2);
  });
});

describe('páginas automáticas', () => {
  it('integrantes, cronología, registro de cambios por sección y créditos', () => {
    const types = bySection.pages.map((p) => p.type);
    expect(types).toContain('teamMembers');
    expect(types).toContain('seasonTimeline');
    expect(types).toContain('creditSummary');
    const logs = bySection.pages.filter((p) => p.type === 'changeLog').map((p) => p.number?.split('-')[0]);
    expect(logs).toEqual(['M', 'C', 'W']);
  });

  it('el registro de cambios apunta a la prueba que motivó cada cambio', () => {
    const files = unzip(bySection.bytes);
    const slides = slidesInOrder(files);
    const log = bySection.pages.find((p) => p.pageId === 'auto-change-log-mechanics');
    const t = slideText(text(files, slides[(log?.slide as number) - 1] as string));
    expect(t).toContain(`${numberOf(bySection, 'm-test-intake-1')}: 13 de 16, fallas por piezas inclinadas`);
  });

  it('la iteración de construcción se numera por hilo', () => {
    const titles = bySection.pages.filter((p) => p.type === 'buildIteration' && !p.continuation).map((p) => p.title);
    expect(titles).toEqual([1, 2, 3, 4].map((n) => `Prototype / Build Iteration #${n}: intake`));
  });
});

describe.each(TEMPLATES)('con la plantilla %s', (_label, path) => {
  it('genera sin errores y con el texto de la plantilla en su idioma', async () => {
    const r = await generateNotebook({ template: readTemplate(path), document: exampleDocument(), loadAsset: exampleAssets });
    expect(r.pages.length).toBeGreaterThan(30);
    expect(r.pages.filter((p) => p.kind === 'content').every((p) => p.title && !/\[|#__/.test(p.title))).toBe(true);
  });
});
