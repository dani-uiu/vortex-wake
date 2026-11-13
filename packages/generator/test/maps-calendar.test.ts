/**
 * Mapa de puertos del Brain, mapa del control y calendarios mensuales: se
 * llenan sobre las páginas de la plantilla que ya traen esos diagramas.
 */

import { describe, expect, it } from 'vitest';
import { generateNotebook } from '../src/generate.ts';
import { slotFontSize } from '../src/maps-render.ts';
import { TEMPLATES, fakePng, minimalDocument, parseStrict, readTemplate, slideText, slidesInOrder, text, unzip } from './helpers.ts';

const doc = (lang: 'es' | 'en') =>
  minimalDocument({
    language: lang,
    editors: ['a'],
    sessions: [
      { date: '2026-09-28', event: 'Taller', summary: '' },
      { date: '2026-10-02', event: 'Taller (Persona A, Persona B)', summary: 'Armamos el chasis' },
      { date: '2026-10-16', event: 'Taller (Persona A)', summary: '' },
    ],
    pages: [{ id: 'w1', type: 'dailyWork', section: 'wiring', date: '2026-10-05', authors: ['b'], fields: { notes: 'Cables' } }],
    robotMaps: [
      { id: 'map-ports-a-1', kind: 'ports', robot: 'Robot A', date: '2026-10-01', authors: ['b'], slots: { '1': 'Motor izq. delantero', '11': 'Motor der. delantero', '21': 'Radio', A: 'Pistón del intake' } },
      { id: 'map-ports-a-2', kind: 'ports', robot: 'Robot A', date: '2026-10-09', authors: ['b'], slots: { '1': 'Motor izquierdo delantero (11W, 600 rpm, cadena)', '2': 'Sensor de distancia' } },
      { id: 'map-controller-a-1', kind: 'controller', robot: 'Robot A', date: '2026-10-03', authors: ['a'], slots: { L1: 'Intake adentro', R2: 'Disparar', axis3: 'Avanzar / retroceder', X: 'Cambiar modo' } },
    ],
  });

describe('mapas de puertos y del control, y calendarios', () => {
  it('el texto de un puerto cabe en su cuadro', () => {
    expect(slotFontSize('Radio').sizePt).toBe(11);
    expect(slotFontSize('Motor izquierdo delantero (11W, 600 rpm, cadena)').sizePt).toBeLessThanOrEqual(9);
  });

  for (const [lang, path] of TEMPLATES) {
    it(`llena los diagramas y los calendarios (${lang})`, async () => {
      const es = lang === 'ES';
      const r = await generateNotebook({ template: readTemplate(path), document: doc(es ? 'es' : 'en'), loadAsset: () => fakePng(10, 10) });
      const files = unzip(r.bytes);
      const parts = slidesInOrder(files);
      const xmlOf = (slide: number) => text(files, parts[slide - 1] as string);
      for (const p of parts) parseStrict(text(files, p), p);

      // Cableado: por fecha, mapa de puertos v1 (1 oct), control (3 oct), trabajo del día (5 oct), puertos v2 (9 oct).
      const wiring = r.pages.filter((p) => p.number?.startsWith('W-'));
      expect(wiring.map((p) => p.type)).toEqual(['portMap', 'controllerMap', 'dailyWork', 'portMap']);
      const ports1 = slideText(xmlOf(wiring[0]?.slide ?? 0));
      expect(ports1).toContain('Motor izq. delantero');
      expect(ports1).toContain('Pistón del intake');
      expect(ports1).toContain(es ? 'Mapa de puertos del Brain: Robot A' : 'Brain Port Map: Robot A');
      expect(ports1).not.toContain(es ? 'PUERTO' : 'PORT ');
      expect(ports1).toContain(es ? '01/10/2026' : '10/01/2026');
      const ctl = slideText(xmlOf(wiring[1]?.slide ?? 0));
      expect(ctl).toContain('Intake adentro');
      expect(ctl).toContain('Avanzar / retroceder');
      expect(ctl).toContain(es ? 'Mapa del control: Robot A' : 'Controller Map: Robot A');

      // Calendario: solo octubre (la plantilla no trae septiembre: aviso).
      const cal = r.pages.filter((p) => p.type === 'calendar');
      expect(cal.map((p) => p.title)).toEqual([es ? 'Octubre 2026' : 'October 2026']);
      const calXml = xmlOf(cal[0]?.slide ?? 0);
      const rows = [...calXml.matchAll(/<a:tr\b.*?<\/a:tr>/gs)].map((m) => slideText(m[0]));
      expect(rows[1]).toBe('Taller (Persona A, Persona B) — Armamos el chasis');
      expect(rows[15]).toBe('Taller (Persona A)');
      expect(rows[0]).toBe('');
      expect(r.warnings.some((w) => w.includes('2026-09'))).toBe(true);
      // En la tabla de contenido.
      const toc = slideText(xmlOf(r.pages.find((p) => p.kind === 'toc')?.slide ?? 0));
      expect(toc).toContain(es ? 'Octubre 2026' : 'October 2026');
      expect(toc).toContain(es ? 'Mapa del control: Robot A' : 'Controller Map: Robot A');
    });
  }

  it('sin calendarios si se piden así', async () => {
    const r = await generateNotebook({ template: readTemplate(TEMPLATES[0]?.[1]), document: doc('es'), loadAsset: () => fakePng(10, 10), options: { includeCalendars: false } });
    expect(r.pages.some((p) => p.type === 'calendar')).toBe(false);
  });
});
