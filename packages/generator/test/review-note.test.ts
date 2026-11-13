/**
 * Nota de revisión (`review`): se dibuja como nota adhesiva amarilla en la
 * primera página (no en las continuaciones), no choca con el título y el
 * paquete sigue siendo válido.
 */

import { describe, expect, it } from 'vitest';
import { validateNotebook } from '@vortex-wake/shared';
import { generateNotebook } from '../src/generate.ts';
import { REVIEW_NOTE_NAME } from '../src/render.ts';
import { TEMPLATES, fakePng, minimalDocument, parseStrict, readTemplate, slideText, slidesInOrder, text, unzip } from './helpers.ts';

const EMU_PER_PT = 12700;

function noteCount(xml: string): number {
  return (xml.match(new RegExp(`name="${REVIEW_NOTE_NAME} \\d+"`, 'g')) ?? []).length;
}

describe('nota de revisión', () => {
  for (const [lang, path] of TEMPLATES) {
    it(`aparece solo en la primera página y el paquete es válido (${lang})`, async () => {
      const long = Array.from({ length: 160 }, (_, i) => `Renglón ${i + 1} de lo que hicimos hoy.`).join('\n');
      const doc = minimalDocument({
        language: lang === 'ES' ? 'es' : 'en',
        pages: [
          { id: 'd1', type: 'decision', section: 'mechanics', date: '2026-10-01', authors: ['a'], subsystem: 'un subsistema con un nombre bastante largo para el título', fields: { decision: 'Usamos rodillos.' }, review: 'Falta la foto.\nFuente: chat del 01/10. Ver pág. {{page:d2}}.' },
          { id: 'd2', type: 'dailyWork', section: 'coding', date: '2026-10-02', authors: ['b'], fields: { notes: long }, review: 'Pregunta: ¿quién escribió esto?' },
          { id: 'd3', type: 'dailyWork', section: 'wiring', date: '2026-10-03', authors: ['b'], fields: { notes: 'Sin nota.' } },
        ],
      });
      const r = await generateNotebook({ template: readTemplate(path), document: doc, loadAsset: () => fakePng(10, 10) });
      const files = unzip(r.bytes);
      for (const name of [...files.keys()].filter((n) => n.endsWith('.xml') || n.endsWith('.rels'))) parseStrict(text(files, name), name);
      const parts = slidesInOrder(files);
      const xmlOf = (slide: number) => text(files, parts[slide - 1] as string);

      const decision = r.pages.find((p) => p.pageId === 'd1');
      const dXml = xmlOf(decision?.slide ?? 0);
      expect(noteCount(dXml)).toBe(1);
      const t = slideText(dXml);
      expect(t).toContain('Falta la foto.');
      expect(t).toContain(lang === 'ES' ? 'NOTA DE REVISIÓN' : 'REVIEW NOTE');
      // La referencia se resolvió al número de la página.
      expect(t).toContain('Ver pág. C-1.');

      // El título no se mete debajo de la nota.
      const title = dXml.match(/name="TextBox 6"[\s\S]*?<a:off x="(\d+)"[^>]*\/><a:ext cx="(\d+)"/);
      expect(title).not.toBeNull();
      const right = (Number(title?.[1]) + Number(title?.[2])) / EMU_PER_PT;
      expect(right).toBeLessThanOrEqual(414);

      // Página con continuación: la nota solo en la primera.
      const daily = r.pages.filter((p) => p.pageId === 'd2');
      expect(daily.length).toBeGreaterThan(1);
      expect(noteCount(xmlOf(daily[0]?.slide ?? 0))).toBe(1);
      for (const p of daily.slice(1)) expect(noteCount(xmlOf(p.slide))).toBe(0);

      // Sin `review`, sin nota.
      const plain = r.pages.find((p) => p.pageId === 'd3');
      expect(noteCount(xmlOf(plain?.slide ?? 0))).toBe(0);
    });
  }

  it('avisa si la nota es tan larga que tapa el contenido', async () => {
    const doc = minimalDocument({
      pages: [{ id: 'd1', type: 'decision', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { decision: 'X' }, review: Array.from({ length: 30 }, () => 'Pendiente largo.').join('\n') }],
    });
    const r = await generateNotebook({ template: readTemplate(TEMPLATES[0]?.[1]), document: doc, loadAsset: () => fakePng(10, 10) });
    expect(r.warnings.some((w) => w.includes('nota de revisión'))).toBe(true);
  });

  it('la validación exige que sea texto y revisa sus referencias', () => {
    const bad = minimalDocument({
      pages: [{ id: 'd1', type: 'decision', section: 'mechanics', date: '2026-10-01', authors: ['a'], review: 3 as unknown as string }],
    });
    const r1 = validateNotebook(bad);
    expect(r1.ok).toBe(false);
    expect(r1.issues.some((i) => i.path === 'pages[0].review')).toBe(true);

    const ref = minimalDocument({
      pages: [{ id: 'd1', type: 'decision', section: 'mechanics', date: '2026-10-01', authors: ['a'], review: 'ver {{page:nada}}' }],
    });
    const r2 = validateNotebook(ref);
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.path === 'pages[0].review')).toBe(true);
  });
});
