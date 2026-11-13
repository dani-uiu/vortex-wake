/**
 * Registro de torneo: página armada sobre la página en blanco con la tabla de
 * la página de análisis del juego; lo que se ajustó va al registro de cambios
 * de su sección.
 */

import { describe, expect, it } from 'vitest';
import { generateNotebook } from '../src/generate.ts';
import { TEMPLATES, fakePng, minimalDocument, parseStrict, readTemplate, slideText, slidesInOrder, text, unzip } from './helpers.ts';

describe('registro de torneo', () => {
  for (const [lang, path] of TEMPLATES) {
    it(`arma la página con la tabla de partidos y alimenta el registro de cambios (${lang})`, async () => {
      const doc = minimalDocument({
        language: lang === 'ES' ? 'es' : 'en',
        pages: [
          // Antes, una página de trabajo del día (también armada sobre la página en blanco): cada una con su título.
          { id: 'd1', type: 'dailyWork', section: 'strategy', date: '2026-11-13', authors: ['a'], fields: { notes: 'Ruta nueva' } },
          {
            id: 't1',
            type: 'tournamentLog',
            section: 'strategy',
            date: '2026-11-14',
            authors: ['a'],
            fields: {
              matches: [
                ['Q1', 'Roja con 1234B vs 5678A, 9012C', '52-40 · Ganamos', '', ''],
                ['Q7', 'Azul con 4321C vs 1111A, 2222B', '30-61 · Perdimos', 'Se atoró el intake', 'Bajamos la velocidad del intake'],
              ],
              notes: { text: 'Notas del torneo', images: [{ src: 'f.png' }] },
            },
            changes: [{ section: 'mechanics', change: 'Bajamos la velocidad del intake', test: 't1', evidence: 'Partido Q7 · 30-61 · Perdimos' }],
          },
        ],
      });
      const r = await generateNotebook({ template: readTemplate(path), document: doc, loadAsset: () => fakePng(400, 300) });
      const page = r.pages.find((p) => p.pageId === 't1');
      expect(page?.title).toBe(lang === 'ES' ? 'Registro de torneo' : 'Tournament Log');
      const files = unzip(r.bytes);
      const parts = slidesInOrder(files);
      const xml = text(files, parts[(page?.slide ?? 1) - 1] as string);
      parseStrict(xml, 'torneo');
      const t = slideText(xml);
      expect(t).toContain(lang === 'ES' ? 'Alianza: aliado y rivales' : 'Alliance: partner and opponents');
      expect(t).toContain(lang === 'ES' ? 'PARTIDOS' : 'MATCHES');
      expect(t).toContain('Bajamos la velocidad del intake');
      expect(t).not.toContain('Sacrificio');
      // Registro de cambios de Mecánica con el ajuste y la página del torneo como evidencia.
      const log = r.pages.find((p) => p.type === 'changeLog');
      expect(log).toBeDefined();
      const logText = slideText(text(files, parts[(log?.slide ?? 1) - 1] as string));
      expect(logText).toContain('Bajamos la velocidad del intake');
      expect(logText).toContain(`${page?.number}: Partido Q7`);
    });
  }
});
