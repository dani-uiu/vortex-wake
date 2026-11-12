/**
 * Validez del paquete generado: relaciones, tipos de contenido, ids únicos y
 * XML bien formado. Son las causas típicas del aviso de reparación de PowerPoint.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { generateNotebook } from '../src/generate.ts';
import { resolveTarget, relsPathFor } from '../src/opc.ts';
import { exampleAssets, exampleDocument, parseStrict, readTemplate, slidesInOrder, text, unzip } from './helpers.ts';

let files: Map<string, Uint8Array>;

beforeAll(async () => {
  const r = await generateNotebook({ template: readTemplate(), document: exampleDocument(), loadAsset: exampleAssets, options: { includeReferencePages: true } });
  files = unzip(r.bytes);
});

const xmlParts = () => [...files.keys()].filter((n) => n.endsWith('.xml') || n.endsWith('.rels'));

describe('paquete .pptx', () => {
  it('todas las partes XML están bien formadas', () => {
    for (const name of xmlParts()) parseStrict(text(files, name), name);
  });

  it('cada parte tiene tipo de contenido y no sobran declaraciones', () => {
    const ct = text(files, '[Content_Types].xml');
    const defaults = new Set([...ct.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => (m[1] as string).toLowerCase()));
    const overrides = [...ct.matchAll(/<Override PartName="\/([^"]+)"/g)].map((m) => m[1] as string);
    for (const o of overrides) expect(files.has(o), `Override para una parte que no existe: ${o}`).toBe(true);
    for (const name of files.keys()) {
      if (name === '[Content_Types].xml') continue;
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      expect(overrides.includes(name) || defaults.has(ext), `sin tipo de contenido: ${name}`).toBe(true);
    }
  });

  it('todas las relaciones internas apuntan a partes que existen', () => {
    for (const relsName of [...files.keys()].filter((n) => n.endsWith('.rels'))) {
      const source = relsName === '_rels/.rels' ? '' : relsName.replace(/_rels\/([^/]+)\.rels$/, '$1');
      const xml = text(files, relsName);
      for (const m of xml.matchAll(/<Relationship ([^>]+)\/>/g)) {
        const attrs = m[1] as string;
        if (/TargetMode="External"/.test(attrs)) continue;
        const target = /Target="([^"]+)"/.exec(attrs)?.[1] as string;
        const resolved = resolveTarget(source, target);
        expect(files.has(resolved), `${relsName} apunta a ${target}, que no existe`).toBe(true);
      }
    }
  });

  it('no quedan partes huérfanas (diapositivas modelo, notas)', () => {
    const slides = [...files.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.sort()).toEqual(slidesInOrder(files).sort());
    expect([...files.keys()].filter((n) => n.startsWith('ppt/notesSlides/'))).toEqual([]);
  });

  it('ids de diapositiva y de relación únicos en presentation.xml', () => {
    const pres = text(files, 'ppt/presentation.xml');
    const ids = [...pres.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.min(...ids)).toBeGreaterThanOrEqual(256);
    const rels = text(files, 'ppt/_rels/presentation.xml.rels');
    const rids = [...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(rids).size).toBe(rids.length);
  });

  it('en cada diapositiva: ids de forma únicos, imágenes con relación y filas de tabla con id único', () => {
    for (const slide of slidesInOrder(files)) {
      const xml = text(files, slide);
      const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, `ids de forma repetidos en ${slide}`).toBe(ids.length);
      const rels = text(files, relsPathFor(slide));
      const relIds = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
      for (const m of xml.matchAll(/r:(?:embed|id|link)="([^"]+)"/g)) {
        expect(relIds.has(m[1]), `${slide} usa ${m[1]} sin relación`).toBe(true);
      }
      for (const tbl of xml.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)) {
        const rowIds = [...(tbl[0] as string).matchAll(/<a16:rowId [^>]*val="(\d+)"/g)].map((m) => m[1]);
        expect(new Set(rowIds).size, `filas con id repetido en ${slide}`).toBe(rowIds.length);
      }
      const creation = [...xml.matchAll(/<p14:creationId [^>]*val="(\d+)"/g)].map((m) => m[1]);
      expect(creation.length).toBeLessThanOrEqual(1);
    }
  });

  it('las diapositivas no repiten creationId', () => {
    const vals = slidesInOrder(files)
      .map((s) => /<p14:creationId [^>]*val="(\d+)"/.exec(text(files, s))?.[1])
      .filter((v) => v !== undefined);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('las fotos se guardan una sola vez aunque se usen en varias páginas', () => {
    const media = [...files.keys()].filter((n) => n.startsWith('ppt/media/vw-image'));
    const doc = exampleDocument();
    const srcs = new Set<string>();
    if (doc.cover?.photo) srcs.add(doc.cover.photo.src);
    for (const p of doc.pages) for (const v of Object.values(p.fields ?? {})) {
      if (typeof v === 'object' && !Array.isArray(v)) for (const i of v.images ?? []) srcs.add(i.src);
    }
    expect(media.length).toBe(srcs.size);
  });

  it('el resultado sigue siendo editable: textos y tablas reales, no imágenes de página', () => {
    const slides = slidesInOrder(files);
    const withTables = slides.filter((s) => text(files, s).includes('<a:tbl>'));
    expect(withTables.length).toBeGreaterThan(20);
  });
});
