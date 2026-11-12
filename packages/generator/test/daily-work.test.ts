/**
 * Página "trabajo del día": no existe en la plantilla; se arma sobre la página
 * de referencia en blanco. Debe generar un paquete válido, con título, etiqueta
 * de sección, el texto del equipo, fotos y continuación si no cabe.
 */

import { describe, expect, it } from 'vitest';
import { generateNotebook } from '../src/generate.ts';
import { TEMPLATE_ES, fakePng, minimalDocument, parseStrict, readTemplate, slideText, slidesInOrder, text, unzip } from './helpers.ts';

describe('página "trabajo del día"', () => {
  it('se genera en cada sección con su texto y fotos, y el paquete es válido', async () => {
    const doc = minimalDocument({
      pages: [
        { id: 'd1', type: 'dailyWork', section: 'mechanics', date: '2026-10-01', authors: ['a'], subsystem: 'intake', fields: { notes: { text: 'Armamos el intake.\nFalta tensar la cadena.', images: [{ src: 'f1.png', caption: 'Intake armado' }, { src: 'f2.png' }] } } },
        { id: 'd2', type: 'dailyWork', section: 'coding', date: '2026-10-02', authors: ['b'], fields: { notes: 'Probamos el PID.' } },
        { id: 'd3', type: 'dailyWork', section: 'wiring', date: '2026-10-02', authors: ['b'], fields: { notes: 'Cambiamos el puerto 3.' } },
        { id: 'd4', type: 'dailyWork', section: 'strategy', date: '2026-10-03', authors: ['a', 'b'], fields: { notes: 'Ruta nueva.' } },
      ],
    });
    const r = await generateNotebook({ template: readTemplate(TEMPLATE_ES), document: doc, loadAsset: () => fakePng(400, 300) });
    const daily = r.pages.filter((p) => p.type === 'dailyWork');
    expect(daily.map((p) => p.title)).toEqual(['Trabajo del día: intake', 'Trabajo del día', 'Trabajo del día', 'Trabajo del día']);
    expect(daily.map((p) => p.number)).toEqual(['M-1', 'C-1', 'W-1', 'S-1']);
    const files = unzip(r.bytes);
    for (const name of [...files.keys()].filter((n) => n.endsWith('.xml') || n.endsWith('.rels'))) parseStrict(text(files, name), name);
    const parts = slidesInOrder(files);
    const first = text(files, parts[(daily[0]?.slide ?? 1) - 1] as string);
    const t = slideText(first);
    expect(t).toContain('Armamos el intake.');
    expect(t).toContain('Intake armado');
    expect(t).toContain('MECÁNICA');
    expect((first.match(/<p:pic>/g) ?? []).length).toBe(2);
    expect([...files.keys()].some((n) => n.includes('vw-dailyWork'))).toBe(false);
  });

  it('un texto muy largo pasa a una continuación', async () => {
    const long = Array.from({ length: 160 }, (_, i) => `Renglón ${i + 1} de lo que hicimos hoy en el taller.`).join('\n');
    const doc = minimalDocument({
      pages: [{ id: 'd1', type: 'dailyWork', section: 'mechanics', date: '2026-10-01', authors: ['a'], fields: { notes: long } }],
    });
    const r = await generateNotebook({ template: readTemplate(TEMPLATE_ES), document: doc, loadAsset: () => fakePng(10, 10) });
    expect(r.pages.filter((p) => p.type === 'dailyWork').length).toBeGreaterThan(1);
  });
});
