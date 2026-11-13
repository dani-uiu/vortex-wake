/**
 * Edición del XML de una diapositiva duplicada: textos, tablas, fotos y pie.
 * Todo lo que se agrega son cuadros de texto, tablas e imágenes reales de
 * PowerPoint, para que la bitácora se pueda seguir editando a mano.
 */

import type { Language } from '@vortex-wake/shared';
import type { PlaceholderRef, StandardDefaults, TocMapping } from './field-map.ts';
import { languageTag } from './format.ts';
import { layoutGrid } from './images.ts';
import type { AreaPlacement, BlockPlacement, BoxPt, TablePlacement } from './layout.ts';
import { ellipsize, textHeightPt, type FontSpec } from './measure.ts';
import type { ResolvedImage } from './plan.ts';
import { EMU_PER_PT, cNvPrOf, readBox, shapeElements, shapeName, spTreeOf, writeBox } from './template.ts';
import {
  NS,
  child,
  children,
  descendants,
  elementChildren,
  escapeXml,
  fragment,
  insertAfter,
  remove,
  type Document,
  type Element,
} from './xml.ts';

const pt = (v: number) => Math.round(v * EMU_PER_PT);

/** Nota de revisión: misma posición, ancho y color que las notas de rúbrica de la plantilla. */
export const REVIEW_NOTE = { x: 414, y: 10, w: 165.6, minH: 93.6 } as const;
export const REVIEW_NOTE_NAME = 'Nota de revisión';
const REVIEW_NOTE_INSET_X = 7.2;
const REVIEW_NOTE_INSET_Y = 5;

export interface ImageSink {
  /** Registra la imagen en el paquete y devuelve el id de relación de la diapositiva. */
  embed(image: ResolvedImage): string;
}

export class SlideEditor {
  readonly doc: Document;
  readonly root: Element;
  readonly lang: Language;
  private nextId: number;

  constructor(doc: Document, lang: Language) {
    this.doc = doc;
    this.root = doc.documentElement as unknown as Element;
    this.lang = lang;
    let max = 1;
    for (const el of descendants(this.root, NS.p, 'cNvPr')) max = Math.max(max, Number(el.getAttribute('id') ?? 0));
    this.nextId = max + 1;
  }

  newId(): number {
    return this.nextId++;
  }

  shape(name: string): Element | undefined {
    return shapeElements(this.root).find((el) => shapeName(el) === name);
  }

  requireShape(name: string): Element {
    const el = this.shape(name);
    if (!el) throw new Error(`la diapositiva no tiene la forma "${name}"`);
    return el;
  }

  removeShape(name: string): void {
    const el = this.shape(name);
    if (el) remove(el);
  }

  placeholder(ref: PlaceholderRef): Element | undefined {
    return shapeElements(this.root).find((el) => {
      const ph = descendants(el, NS.p, 'ph')[0];
      if (!ph) return false;
      const type = ph.getAttribute('type') || 'body';
      const idx = ph.getAttribute('idx');
      if (type !== ref.type) return false;
      if (ref.idx === undefined) return idx === null || idx === '';
      return Number(idx) === ref.idx;
    });
  }

  /** Pone un id único a la diapositiva (`p14:creationId`) para que no se repita entre copias. */
  setCreationId(value: number): void {
    for (const el of descendants(this.root, NS.p14, 'creationId')) el.setAttribute('val', String(value));
  }

  // --- Texto ---------------------------------------------------------------

  /**
   * Cambia el texto de una forma conservando el formato de su primer renglón
   * (o del marcador de fin de párrafo si estaba vacía).
   */
  setShapeText(shape: Element, text: string): void {
    const txBody = child(shape, NS.p, 'txBody');
    if (!txBody) throw new Error(`la forma "${shapeName(shape)}" no tiene texto`);
    const paras = children(txBody, NS.a, 'p');
    const first = paras[0];
    const pPr = first ? child(first, NS.a, 'pPr') : undefined;
    const run = first ? descendants(first, NS.a, 'r')[0] : undefined;
    let rPr = run ? child(run, NS.a, 'rPr') : undefined;
    if (!rPr && first) {
      const end = child(first, NS.a, 'endParaRPr');
      if (end) {
        rPr = this.doc.createElementNS(NS.a, 'a:rPr') as unknown as Element;
        for (let i = 0; i < end.attributes.length; i++) {
          const at = end.attributes.item(i);
          if (at) rPr.setAttribute(at.name, at.value);
        }
        for (const c of elementChildren(end)) rPr.appendChild(c.cloneNode(true));
      }
    }
    for (const p of paras) remove(p);
    const lines = text.split('\n');
    for (const line of lines) {
      const p = this.doc.createElementNS(NS.a, 'a:p') as unknown as Element;
      if (pPr) p.appendChild(pPr.cloneNode(true));
      if (line !== '') {
        const r = this.doc.createElementNS(NS.a, 'a:r') as unknown as Element;
        const rp = rPr ? (rPr.cloneNode(true) as Element) : (this.doc.createElementNS(NS.a, 'a:rPr') as unknown as Element);
        rp.setAttribute('lang', languageTag(this.lang));
        rp.removeAttribute('dirty');
        r.appendChild(rp);
        const t = this.doc.createElementNS(NS.a, 'a:t') as unknown as Element;
        t.appendChild(this.doc.createTextNode(line));
        r.appendChild(t);
        p.appendChild(r);
      } else if (rPr) {
        const end = this.doc.createElementNS(NS.a, 'a:endParaRPr') as unknown as Element;
        for (let i = 0; i < rPr.attributes.length; i++) {
          const at = rPr.attributes.item(i);
          if (at) end.setAttribute(at.name, at.value);
        }
        p.appendChild(end);
      }
      txBody.appendChild(p);
    }
  }

  /** Deja solo el primer párrafo (quita el texto de ayuda gris bajo un encabezado). */
  keepFirstParagraph(shape: Element): void {
    const txBody = child(shape, NS.p, 'txBody');
    if (!txBody) return;
    children(txBody, NS.a, 'p').slice(1).forEach(remove);
  }

  clearText(shape: Element): void {
    const txBody = child(shape, NS.p, 'txBody');
    if (!txBody) return;
    const paras = children(txBody, NS.a, 'p');
    paras.forEach(remove);
    txBody.appendChild(fragment(this.doc, `<a:p><a:endParaRPr lang="${languageTag(this.lang)}"/></a:p>`));
  }

  /** Reemplaza los párrafos de un cuerpo de texto por los de `text`, con formato fijo. */
  writeParagraphs(txBody: Element, text: string, opts: { sizePt: number; color: string; mono?: boolean; bold?: boolean }): void {
    children(txBody, NS.a, 'p').forEach(remove);
    const lang = languageTag(this.lang);
    const sz = Math.round(opts.sizePt * 100);
    const font = opts.mono ? '<a:latin typeface="Roboto Mono"/><a:cs typeface="Roboto Mono"/>' : '';
    const rPr = `<a:rPr lang="${lang}" sz="${sz}" b="${opts.bold ? 1 : 0}" i="0" dirty="0"><a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill>${font}</a:rPr>`;
    const lines = text === '' ? [''] : text.split('\n');
    for (const line of lines) {
      const xml =
        line === ''
          ? `<a:p><a:pPr algn="l"/><a:endParaRPr lang="${lang}" sz="${sz}" dirty="0"/></a:p>`
          : `<a:p><a:pPr algn="l"/><a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`;
      txBody.appendChild(fragment(this.doc, xml));
    }
  }

  // --- Bloques ---------------------------------------------------------------

  placeBlock(
    placement: BlockPlacement,
    shapeNameOf: { shape: string; heading?: string },
    style: StandardDefaults,
    images: ImageSink,
  ): void {
    const content = this.requireShape(shapeNameOf.shape);
    if (shapeNameOf.heading && placement.headingBox) {
      writeBox(this.requireShape(shapeNameOf.heading), { y: pt(placement.headingBox.y) });
    }
    writeBox(content, { y: pt(placement.box.y), cy: pt(placement.box.h) });
    if (placement.area) this.fillArea(content, placement.box, placement.area, style, images);
    if (placement.table) this.fillTable(content, placement.table, style);
  }

  fillArea(shape: Element, box: BoxPt, area: AreaPlacement, style: StandardDefaults, images: ImageSink): void {
    const txBody = child(shape, NS.p, 'txBody');
    if (txBody) {
      this.writeParagraphs(txBody, area.text, {
        sizePt: area.code ? style.areaFontSizePt - 1 : style.areaFontSizePt,
        color: style.areaColor,
        mono: area.code,
      });
    }
    if (area.grid && area.gridOrigin && area.images.length > 0) {
      let anchor: Element = shape;
      area.images.forEach((img, i) => {
        const cell = area.grid?.images[i];
        if (!cell) return;
        const x = box.x + (area.gridOrigin?.x ?? 0) + cell.x;
        const y = box.y + (area.gridOrigin?.y ?? 0) + cell.y;
        const pic = this.picture(img, images.embed(img), { x, y, w: cell.width, h: cell.height });
        insertAfter(pic, anchor);
        anchor = pic;
        const cap = area.grid?.captions[i];
        if (cap && img.caption) {
          const tb = this.caption(img.caption, { x: box.x + (area.gridOrigin?.x ?? 0) + cap.x, y: box.y + (area.gridOrigin?.y ?? 0) + cap.y, w: cap.width, h: cap.height });
          insertAfter(tb, anchor);
          anchor = tb;
        }
      });
    }
  }

  picture(img: ResolvedImage, relId: string, b: BoxPt): Element {
    const id = this.newId();
    const descr = escapeXml(img.caption ?? img.src.split('/').pop() ?? 'foto');
    return fragment(
      this.doc,
      `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Foto ${id}" descr="${descr}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="${pt(b.x)}" y="${pt(b.y)}"/><a:ext cx="${pt(b.w)}" cy="${pt(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    );
  }

  caption(text: string, b: BoxPt): Element {
    const id = this.newId();
    const font: FontSpec = { sizePt: 8 };
    const shown = ellipsize(text, b.w, font);
    return fragment(
      this.doc,
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Pie de foto ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${pt(b.x)}" y="${pt(b.y)}"/><a:ext cx="${pt(b.w)}" cy="${pt(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
        `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="${languageTag(this.lang)}" sz="800" b="0" i="1" dirty="0"><a:solidFill><a:srgbClr val="5F6366"/></a:solidFill></a:rPr><a:t>${escapeXml(shown)}</a:t></a:r></a:p></p:txBody></p:sp>`,
    );
  }

  fillTable(frame: Element, table: TablePlacement, style: StandardDefaults): void {
    const tbl = descendants(frame, NS.a, 'tbl')[0];
    if (!tbl) throw new Error(`la forma "${shapeName(frame)}" no es una tabla`);
    const trs = children(tbl, NS.a, 'tr');
    const header = trs[0];
    if (!header) throw new Error('tabla sin encabezado');
    header.setAttribute('h', String(pt(table.headerHeight)));
    const cellStyle = { sizePt: style.cellFontSizePt, color: style.cellColor };

    if (table.fixed) {
      trs.slice(1).forEach((tr, i) => {
        tr.setAttribute('h', String(pt(table.rowHeights[i] ?? 22)));
        const row = table.rows[i] ?? [];
        children(tr, NS.a, 'tc').forEach((tc, j) => {
          if (j === 0) return;
          this.writeCell(tc, row[j] ?? '', cellStyle);
        });
      });
      return;
    }

    const firstProto = trs[1];
    const nextProto = trs[2] ?? trs[1];
    if (!firstProto || !nextProto) throw new Error('tabla sin filas de datos');
    trs.slice(1).forEach(remove);
    table.rows.forEach((row, i) => {
      const tr = (i === 0 ? firstProto : nextProto).cloneNode(true) as Element;
      tr.setAttribute('h', String(pt(table.rowHeights[i] ?? 22)));
      for (const rid of descendants(tr, NS.a16, 'rowId')) rid.setAttribute('val', String(20000 + i));
      children(tr, NS.a, 'tc').forEach((tc, j) => this.writeCell(tc, row[j] ?? '', cellStyle));
      tbl.appendChild(tr);
    });
  }

  writeCell(tc: Element, text: string, opts: { sizePt: number; color: string }): void {
    const txBody = child(tc, NS.a, 'txBody');
    if (!txBody) return;
    this.writeParagraphs(txBody, text, opts);
  }

  // --- Pie de página ---------------------------------------------------------

  setPlaceholderText(ref: PlaceholderRef, text: string, sizePt?: number): void {
    const el = this.placeholder(ref);
    if (!el) return;
    const txBody = child(el, NS.p, 'txBody');
    if (!txBody) return;
    children(txBody, NS.a, 'p').forEach(remove);
    const lang = languageTag(this.lang);
    const sz = sizePt ? ` sz="${Math.round(sizePt * 100)}"` : '';
    // Con letra más chica que la del patrón (15 pt), se baja el texto para que
    // su línea base quede a la altura de las etiquetas del pie.
    if (sizePt) {
      const bodyPr = child(txBody, NS.a, 'bodyPr');
      bodyPr?.setAttribute('anchor', 't');
      bodyPr?.setAttribute('tIns', String(Math.round(Math.max(0, (15 - sizePt) * 0.9) * EMU_PER_PT)));
    }
    txBody.appendChild(
      fragment(
        this.doc,
        text === ''
          ? `<a:p><a:endParaRPr lang="${lang}"${sz}/></a:p>`
          : `<a:p><a:r><a:rPr lang="${lang}"${sz} dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`,
      ),
    );
  }

  // --- Tabla de contenido ------------------------------------------------------

  writeToc(shape: Element, toc: TocMapping, lines: { number: string; title: string; date: string; header: boolean }[]): void {
    const txBody = child(shape, NS.p, 'txBody');
    if (!txBody) throw new Error('la tabla de contenido no tiene cuadro de texto');
    const firstP = children(txBody, NS.a, 'p')[0];
    const pPrTemplate = firstP ? child(firstP, NS.a, 'pPr') : undefined;
    children(txBody, NS.a, 'p').forEach(remove);
    const lang = languageTag(this.lang);
    const sz = Math.round(toc.fontSizePt * 100);
    const titleWidth = toc.dateTabPt - toc.titleTabPt - 8;
    const font: FontSpec = { sizePt: toc.fontSizePt };
    const lnSpc = Math.round(toc.lineSpacingPt * 100);
    for (const line of lines) {
      const p = this.doc.createElementNS(NS.a, 'a:p') as unknown as Element;
      const pPr = pPrTemplate
        ? (pPrTemplate.cloneNode(true) as Element)
        : (this.doc.createElementNS(NS.a, 'a:pPr') as unknown as Element);
      for (const old of children(pPr, NS.a, 'lnSpc')) remove(old);
      const ln = fragment(this.doc, `<a:lnSpc><a:spcPts val="${lnSpc}"/></a:lnSpc>`);
      pPr.insertBefore(ln, pPr.firstChild);
      p.appendChild(pPr);
      const title = ellipsize(line.title, titleWidth, { ...font, bold: line.header });
      const text = `${line.number}\t${title}\t${line.date}`;
      p.appendChild(
        fragment(this.doc, `<a:r><a:rPr lang="${lang}" sz="${sz}" b="${line.header ? 1 : 0}" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r>`),
      );
      txBody.appendChild(p);
    }
    if (lines.length === 0) txBody.appendChild(fragment(this.doc, `<a:p><a:endParaRPr lang="${lang}"/></a:p>`));
  }

  /** Coloca una foto dentro del rectángulo de `shape` y quita la forma. */
  replaceWithPhoto(shape: Element, img: ResolvedImage, images: ImageSink): void {
    const b = readBox(shape);
    if (!b) return;
    const box = { x: b.x / EMU_PER_PT, y: b.y / EMU_PER_PT, w: b.cx / EMU_PER_PT, h: b.cy / EMU_PER_PT };
    const grid = layoutGrid([img.info.width / img.info.height], [false], box.w, box.h);
    const cell = grid.images[0];
    if (!cell) return;
    const pic = this.picture(img, images.embed(img), { x: box.x + cell.x, y: box.y + cell.y, w: cell.width, h: cell.height });
    insertAfter(pic, shape);
    remove(shape);
  }

  spTree(): Element {
    return spTreeOf(this.root);
  }

  /**
   * Agrega una nota adhesiva amarilla (como las notas de rúbrica de la
   * plantilla) en la esquina superior derecha, con encabezado, el texto de
   * revisión y el aviso de borrarla. Crece hacia abajo si el texto no cabe;
   * devuelve su caja para que quien llama avise si invade el contenido.
   */
  addReviewNote(text: string, labels: { heading: string; footer: string }): BoxPt {
    const box = REVIEW_NOTE;
    const inner = box.w - REVIEW_NOTE_INSET_X * 2;
    const heading: FontSpec = { sizePt: 8, bold: true };
    const body: FontSpec = { sizePt: 7 };
    const foot: FontSpec = { sizePt: 6.5 };
    const needed =
      REVIEW_NOTE_INSET_Y * 2 +
      textHeightPt(labels.heading, inner, heading) +
      textHeightPt(text, inner, body) +
      3 +
      textHeightPt(labels.footer, inner, foot);
    const h = Math.max(box.minH, Math.ceil(needed));
    const lang = languageTag(this.lang);
    const run = (t: string, f: FontSpec, color: string, italic = false) =>
      `<a:r><a:rPr lang="${lang}" sz="${Math.round(f.sizePt * 100)}" b="${f.bold ? 1 : 0}" i="${italic ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${escapeXml(t)}</a:t></a:r>`;
    const para = (t: string, f: FontSpec, color: string, italic = false, spcBefore = 0) =>
      t === ''
        ? `<a:p><a:pPr algn="l"/><a:endParaRPr lang="${lang}" sz="${Math.round(f.sizePt * 100)}" dirty="0"/></a:p>`
        : `<a:p><a:pPr algn="l">${spcBefore ? `<a:spcBef><a:spcPts val="${spcBefore * 100}"/></a:spcBef>` : ''}</a:pPr>${run(t, f, color, italic)}</a:p>`;
    const paras = [
      para(labels.heading, heading, 'A22124'),
      ...text.split('\n').map((line) => para(line, body, '1A1A1A')),
      para(labels.footer, foot, '5F6366', true, 3),
    ].join('');
    const id = this.newId();
    const sp = fragment(
      this.doc,
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${REVIEW_NOTE_NAME} ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm rot="21480000"><a:off x="${pt(box.x)}" y="${pt(box.y)}"/><a:ext cx="${pt(box.w)}" cy="${pt(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
        `<a:solidFill><a:srgbClr val="FFF1A6"/></a:solidFill><a:ln><a:noFill/></a:ln>` +
        `<a:effectLst><a:outerShdw blurRad="50800" dist="25400" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="28000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" lIns="${pt(REVIEW_NOTE_INSET_X)}" tIns="${pt(REVIEW_NOTE_INSET_Y)}" rIns="${pt(REVIEW_NOTE_INSET_X)}" bIns="${pt(REVIEW_NOTE_INSET_Y)}" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`,
    );
    this.spTree().appendChild(sp);
    return { x: box.x, y: box.y, w: box.w, h };
  }

  /** Ensancha el título hasta el borde derecho del contenido (ya no está la nota de rúbrica). */
  widen(shape: Element, rightEdgePt: number): void {
    const b = readBox(shape);
    if (!b) return;
    const cx = pt(rightEdgePt) - b.x;
    if (cx > b.cx) writeBox(shape, { cx });
  }

  nameOf(el: Element): string {
    return cNvPrOf(el)?.getAttribute('name') ?? '';
  }
}
