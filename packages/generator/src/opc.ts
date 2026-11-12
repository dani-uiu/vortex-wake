/**
 * Paquete OPC (el zip de un .pptx): partes, relaciones y tipos de contenido.
 * Trabaja solo con bytes: no lee ni escribe archivos.
 */

import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from 'fflate';
import { NS, children, parseXml, serializeXml, type Document, type Element } from './xml.ts';

export const REL_TYPES = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
} as const;

export const CONTENT_TYPES = {
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
} as const;

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

export class OpcPackage {
  readonly parts = new Map<string, Uint8Array>();

  static fromBytes(bytes: Uint8Array): OpcPackage {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch (e) {
      throw new Error(`la plantilla no es un archivo .pptx válido (no se pudo abrir el zip): ${(e as Error).message}`);
    }
    const pkg = new OpcPackage();
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue;
      pkg.parts.set(name, data);
    }
    if (!pkg.parts.has('[Content_Types].xml') || !pkg.parts.has('ppt/presentation.xml')) {
      throw new Error('la plantilla no parece una presentación de PowerPoint (falta ppt/presentation.xml)');
    }
    return pkg;
  }

  toBytes(): Uint8Array {
    const z: Zippable = {};
    // [Content_Types].xml primero, como lo escribe Office.
    const names = [...this.parts.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
    for (const name of names) {
      const data = this.parts.get(name) as Uint8Array;
      const stored = /\.(png|jpe?g|fntdata)$/i.test(name);
      z[name] = [data, { level: stored ? 0 : 6 }];
    }
    return zipSync(z);
  }

  has(name: string): boolean {
    return this.parts.has(name);
  }

  getText(name: string): string {
    const data = this.parts.get(name);
    if (!data) throw new Error(`falta la parte ${name} en el paquete`);
    return strFromU8(data);
  }

  getXml(name: string): Document {
    return parseXml(this.getText(name));
  }

  setText(name: string, text: string): void {
    this.parts.set(name, strToU8(text));
  }

  setXml(name: string, doc: Document): void {
    this.setText(name, serializeXml(doc));
  }

  delete(name: string): void {
    this.parts.delete(name);
  }

  // --- Relaciones ---------------------------------------------------------

  readRels(partName: string): Relationship[] {
    const relsName = relsPathFor(partName);
    if (!this.parts.has(relsName)) return [];
    const doc = this.getXml(relsName);
    return children(doc.documentElement as unknown as Element, NS.rel, 'Relationship').map((r) => ({
      id: r.getAttribute('Id') ?? '',
      type: r.getAttribute('Type') ?? '',
      target: r.getAttribute('Target') ?? '',
      external: r.getAttribute('TargetMode') === 'External',
    }));
  }

  writeRels(partName: string, rels: Relationship[]): void {
    const body = rels
      .map(
        (r) =>
          `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`,
      )
      .join('');
    this.setText(
      relsPathFor(partName),
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.rel}">${body}</Relationships>`,
    );
  }

  // --- Tipos de contenido ------------------------------------------------

  ensureOverride(partName: string, contentType: string): void {
    const doc = this.getXml('[Content_Types].xml');
    const root = doc.documentElement as unknown as Element;
    const name = `/${partName}`;
    const existing = children(root, NS.ct, 'Override').find((o) => o.getAttribute('PartName') === name);
    if (existing) existing.setAttribute('ContentType', contentType);
    else {
      const el = doc.createElementNS(NS.ct, 'Override');
      el.setAttribute('PartName', name);
      el.setAttribute('ContentType', contentType);
      root.appendChild(el);
    }
    this.setXml('[Content_Types].xml', doc);
  }

  ensureDefault(extension: string, contentType: string): void {
    const doc = this.getXml('[Content_Types].xml');
    const root = doc.documentElement as unknown as Element;
    const ext = extension.toLowerCase();
    if (children(root, NS.ct, 'Default').some((d) => (d.getAttribute('Extension') ?? '').toLowerCase() === ext)) return;
    const el = doc.createElementNS(NS.ct, 'Default');
    el.setAttribute('Extension', ext);
    el.setAttribute('ContentType', contentType);
    const firstOverride = children(root, NS.ct, 'Override')[0];
    root.insertBefore(el, firstOverride ?? null);
    this.setXml('[Content_Types].xml', doc);
  }

  /**
   * Borra las partes a las que ya no llega ninguna relación (diapositivas
   * modelo, sus notas, imágenes sin usar) y limpia los tipos de contenido.
   */
  collectGarbage(): string[] {
    const reachable = new Set<string>(['[Content_Types].xml', '_rels/.rels']);
    const queue: string[] = [''];
    const visited = new Set<string>();
    while (queue.length) {
      const part = queue.shift() as string;
      if (visited.has(part)) continue;
      visited.add(part);
      const relsName = part === '' ? '_rels/.rels' : relsPathFor(part);
      if (!this.parts.has(relsName)) continue;
      reachable.add(relsName);
      for (const rel of this.readRels(part)) {
        if (rel.external) continue;
        const target = resolveTarget(part, rel.target);
        if (!this.parts.has(target)) continue;
        reachable.add(target);
        queue.push(target);
      }
    }
    const removed: string[] = [];
    for (const name of [...this.parts.keys()]) {
      if (!reachable.has(name)) {
        this.parts.delete(name);
        removed.push(name);
      }
    }
    const doc = this.getXml('[Content_Types].xml');
    const root = doc.documentElement as unknown as Element;
    for (const o of children(root, NS.ct, 'Override')) {
      const pn = (o.getAttribute('PartName') ?? '').replace(/^\//, '');
      if (!this.parts.has(pn)) root.removeChild(o);
    }
    this.setXml('[Content_Types].xml', doc);
    return removed;
  }
}

export function relsPathFor(partName: string): string {
  const i = partName.lastIndexOf('/');
  const dir = i >= 0 ? partName.slice(0, i + 1) : '';
  const file = partName.slice(i + 1);
  return `${dir}_rels/${file}.rels`;
}

/** Resuelve el destino de una relación relativo a la parte de origen. */
export function resolveTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const i = sourcePart.lastIndexOf('/');
  const base = i >= 0 ? sourcePart.slice(0, i).split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') base.pop();
    else if (seg !== '.' && seg !== '') base.push(seg);
  }
  return base.join('/');
}

/** Camino relativo de `from` (parte) a `to` (parte), para escribir en un .rels. */
export function relativeTarget(fromPart: string, toPart: string): string {
  const from = fromPart.split('/').slice(0, -1);
  const to = toPart.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
}

export function nextRelId(rels: Relationship[]): string {
  let max = 0;
  for (const r of rels) {
    const m = /^rId(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `rId${max + 1}`;
}
