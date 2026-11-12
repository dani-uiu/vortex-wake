/**
 * El mapa de campos (src/field-map.json) contra la plantilla real.
 * Si alguien edita la plantilla y cambia nombres de formas, tablas o el orden
 * de las secciones, esta prueba dice exactamente qué ya no coincide.
 */

import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import { PAGE_TYPES, PAGE_TYPE_IDS, type PageTypeSpec } from '@vortex-wake/shared';
import { defaultFieldMap as map, pageTypeFingerprint, type FixedPageId, type TemplateSection } from '../src/field-map.ts';
import { Template, matchesFingerprint } from '../src/template.ts';
import { TEMPLATES, readTemplate } from './helpers.ts';

function sectionsFor(type: keyof typeof PAGE_TYPES): TemplateSection[] {
  const spec: PageTypeSpec = PAGE_TYPES[type];
  if (spec.placement === 'common') return ['common'];
  if (spec.placement === 'organization') return ['organization'];
  return [...(spec.sections ?? [])];
}

describe('mapa de campos vs. documento', () => {
  it('cada tipo de página del documento tiene su mapeo, con los mismos campos', () => {
    for (const type of PAGE_TYPE_IDS) {
      const m = map.pageTypes[type];
      expect(m, `falta "${type}" en field-map.json`).toBeDefined();
      expect(Object.keys(m.fields).sort(), `campos de "${type}" distintos entre notebook.ts y field-map.json`).toEqual(
        Object.keys(PAGE_TYPES[type].fields).sort(),
      );
    }
    expect(Object.keys(map.pageTypes).sort()).toEqual([...PAGE_TYPE_IDS].sort());
  });
});

describe.each(TEMPLATES)('plantilla %s', (_label, path) => {
  const template = new Template(readTemplate(path));

  it('tiene los separadores de sección en el orden esperado', () => {
    const dividers = template.slides.filter((s) => s.divider).map((s) => s.section);
    expect(dividers, 'separadores de sección (diapositivas con solo un título)').toEqual(map.sectionOrder);
  });

  for (const type of PAGE_TYPE_IDS) {
    for (const section of sectionsFor(type)) {
      it(`encuentra la página modelo "${type}" en "${section}" y sus campos coinciden`, () => {
        const slide = template.modelFor(type, section);
        const byName = new Map(slide.shapes.map((s) => [s.name, s]));
        const mapping = map.pageTypes[type];
        for (const [key, f] of Object.entries(mapping.fields)) {
          const shape = byName.get(f.shape);
          expect(shape, `diapositiva ${slide.index}: falta la forma "${f.shape}" del campo ${type}.${key}`).toBeDefined();
          const spec = PAGE_TYPES[type].fields[key as never] as { kind: string; columns?: number; maxRows?: number };
          if (spec.kind === 'area') {
            expect(shape?.kind, `diapositiva ${slide.index}: "${f.shape}" (${type}.${key}) debería ser un recuadro`).toBe('sp');
          } else {
            const expectedCols = (spec.columns ?? 1) + (spec.kind === 'fixedTable' ? 1 : 0);
            expect(shape?.tableColumns, `diapositiva ${slide.index}: "${f.shape}" (${type}.${key}) debería ser una tabla de ${expectedCols} columnas`).toBe(expectedCols);
            if (spec.kind === 'fixedTable') {
              expect((shape?.tableRows ?? 0) - 1, `diapositiva ${slide.index}: "${f.shape}" debería tener ${spec.maxRows} filas fijas`).toBe(spec.maxRows);
            }
          }
          if (f.heading) {
            expect(byName.get(f.heading)?.kind, `diapositiva ${slide.index}: falta el encabezado "${f.heading}" de ${type}.${key}`).toBe('sp');
          }
        }
        for (const ref of Object.values(map.footer)) {
          const ok = slide.shapes.some((s) => s.placeholder?.type === ref.type && (ref.idx === undefined ? s.placeholder.idx === undefined : s.placeholder.idx === ref.idx));
          expect(ok, `diapositiva ${slide.index}: falta el marcador del pie ${ref.type}/${ref.idx ?? '-'}`).toBe(true);
        }
      });
    }
  }

  it('ninguna diapositiva coincide con dos tipos de página distintos', () => {
    for (const slide of template.slides) {
      const matches = PAGE_TYPE_IDS.filter((t) => matchesFingerprint(slide, pageTypeFingerprint(map, t)) && sectionsFor(t).includes(slide.section));
      expect(matches.length, `la diapositiva ${slide.index} coincide con ${matches.join(' y ')}`).toBeLessThanOrEqual(1);
    }
  });

  for (const id of Object.keys(map.fixedPages) as FixedPageId[]) {
    it(`encuentra la página fija "${id}"`, () => {
      const slide = template.fixedPage(id);
      const fp = map.fixedPages[id];
      const names = new Set(slide.shapes.map((s) => s.name));
      for (const n of [...Object.values(fp.text), ...fp.remove, ...(fp.photo ? [fp.photo] : []), ...(fp.toc ? [fp.toc.shape] : [])]) {
        expect(names.has(n), `diapositiva ${slide.index}: falta la forma "${n}" de la página ${id}`).toBe(true);
      }
    });
  }

  it('cada forma de cada página modelo está contemplada en el mapa', () => {
    // Si la plantilla agrega una forma nueva a una página modelo, la huella deja de coincidir
    // y modelFor() falla; esta prueba lo dice con nombre y apellido.
    for (const type of PAGE_TYPE_IDS) {
      for (const section of sectionsFor(type)) {
        const fp = pageTypeFingerprint(map, type);
        const candidates = template.sectionSlides(section).filter((s) => !s.divider);
        const found = candidates.some((s) => matchesFingerprint(s, fp));
        expect(found, `no hay página "${type}" en "${section}" con exactamente las formas ${fp.shapes.join(', ')}`).toBe(true);
      }
    }
  });
});

describe('mensajes claros cuando la plantilla ya no coincide', () => {
  it('si se renombra una forma, dice qué página modelo no encuentra', () => {
    const files = unzipSync(readTemplate());
    // Renombra "Table 13" en todas las diapositivas.
    for (const name of Object.keys(files)) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
      files[name] = strToU8(strFromU8(files[name] as Uint8Array).replace(/name="Table 13"/g, 'name="Tabla renombrada"'));
    }
    const broken = new Template(zipSync(files));
    expect(() => broken.modelFor('problem', 'mechanics')).toThrow(/no tiene la página modelo "problem" en la sección "mechanics"/);
  });

  it('si falta un separador, lo dice al abrir la plantilla', () => {
    const files = unzipSync(readTemplate());
    const pres = strFromU8(files['ppt/presentation.xml'] as Uint8Array);
    // Quita el primer separador (Team Organization, id 354).
    files['ppt/presentation.xml'] = strToU8(pres.replace(/<p:sldId id="354" r:id="rId11"\/>/, ''));
    expect(() => new Template(zipSync(files))).toThrow(/separadores de sección/);
  });
});
