import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import type { NotebookDocument } from '@vortex-wake/shared';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const TEMPLATE_EN = join(ROOT, 'template/V5_Engineering_Notebook_Template_EN.pptx');
export const TEMPLATE_ES = join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx');
export const EXAMPLE_DIR = join(ROOT, 'examples/notebook-ejemplo');

/** Plantillas disponibles (la ES puede no existir todavía). */
export const TEMPLATES: [string, string][] = [
  ['EN', TEMPLATE_EN],
  ...(existsSync(TEMPLATE_ES) ? ([['ES', TEMPLATE_ES]] as [string, string][]) : []),
];

export function readTemplate(path = TEMPLATE_EN): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

export function exampleDocument(): NotebookDocument {
  return JSON.parse(readFileSync(join(EXAMPLE_DIR, 'notebook.json'), 'utf8')) as NotebookDocument;
}

export const exampleAssets = (src: string) => new Uint8Array(readFileSync(join(EXAMPLE_DIR, src)));

/** Imagen PNG mínima válida de `w` x `h` (sin datos reales de pixeles, basta para medir). */
export function fakePng(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(bytes)));
}

export function text(files: Map<string, Uint8Array>, name: string): string {
  const f = files.get(name);
  if (!f) throw new Error(`falta ${name}`);
  return strFromU8(f);
}

/** Parser estricto: falla con cualquier error de XML. */
export function parseStrict(xml: string, name: string) {
  return new DOMParser({
    onError: (level, msg) => {
      if (level !== 'warning') throw new Error(`${name}: XML inválido: ${msg}`);
    },
  }).parseFromString(xml, 'text/xml');
}

/** Documento mínimo válido para pruebas. */
export function minimalDocument(overrides: Partial<NotebookDocument> = {}): NotebookDocument {
  return {
    format: 'vortex-wake/notebook',
    version: 1,
    language: 'es',
    project: 'Prueba',
    team: { number: '1A', name: 'Equipo de prueba' },
    season: { start: '2026-09-01', end: '2027-04-30' },
    members: [
      { id: 'a', name: 'Persona A', roles: ['Constructora'], initials: 'PA' },
      { id: 'b', name: 'Persona B', roles: ['Programador'], initials: 'PB' },
    ],
    pages: [],
    ...overrides,
  };
}

/** Todos los textos (`a:t`) de una diapositiva, unidos. */
export function slideText(xml: string): string {
  return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ');
}

/** Partes de diapositiva en el orden de la presentación. */
export function slidesInOrder(files: Map<string, Uint8Array>): string[] {
  const pres = text(files, 'ppt/presentation.xml');
  const rels = text(files, 'ppt/_rels/presentation.xml.rels');
  const target = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const targetAlt = new Map([...rels.matchAll(/Target="([^"]+)"[^>]*Id="([^"]+)"/g)].map((m) => [m[2], m[1]]));
  return [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => `ppt/${target.get(m[1] as string) ?? targetAlt.get(m[1] as string)}`);
}
