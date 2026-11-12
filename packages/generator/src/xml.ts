/**
 * Utilidades mínimas de XML sobre @xmldom/xmldom (funciona igual en Node y en
 * el navegador, sin depender del DOMParser de cada entorno).
 */

import { DOMParser, XMLSerializer, type Document, type Element, type Node } from '@xmldom/xmldom';

export type { Document, Element, Node };

export const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  a16: 'http://schemas.microsoft.com/office/drawing/2014/main',
} as const;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml');
}

export function serializeXml(doc: Document): string {
  let out = new XMLSerializer().serializeToString(doc);
  out = out.replace(/^<\?xml[^?]*\?>\s*/, '');
  return XML_DECL + out;
}

/** Crea un elemento a partir de un fragmento XML que usa los prefijos p:, a: y r:. */
export function fragment(doc: Document, xml: string): Element {
  const wrapped = `<w xmlns:p="${NS.p}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${xml}</w>`;
  const frag = parseXml(wrapped);
  const first = elementChildren(frag.documentElement as unknown as Element)[0];
  if (!first) throw new Error('fragmento XML vacío');
  return doc.importNode(first, true) as Element;
}

export function isElement(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === 1;
}

export function elementChildren(el: Element): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n);
  return out;
}

export function children(el: Element, ns: string, local: string): Element[] {
  return elementChildren(el).filter((c) => c.namespaceURI === ns && c.localName === local);
}

export function child(el: Element, ns: string, local: string): Element | undefined {
  return children(el, ns, local)[0];
}

/** Sigue una ruta de hijos directos, por ejemplo `[[NS.p,'cSld'],[NS.p,'spTree']]`. */
export function path(el: Element, steps: [string, string][]): Element | undefined {
  let cur: Element | undefined = el;
  for (const [ns, local] of steps) {
    if (!cur) return undefined;
    cur = child(cur, ns, local);
  }
  return cur;
}

export function descendants(el: Element, ns: string, local: string): Element[] {
  const list = el.getElementsByTagNameNS(ns, local);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list.item(i) as Element);
  return out;
}

export function remove(n: Node): void {
  n.parentNode?.removeChild(n);
}

export function removeChildren(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function insertAfter(newNode: Node, ref: Node): void {
  const parent = ref.parentNode;
  if (!parent) throw new Error('el nodo de referencia no tiene padre');
  parent.insertBefore(newNode, ref.nextSibling);
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de control que XML 1.0 no admite.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}
