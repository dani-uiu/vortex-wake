/**
 * Páginas que se llenan sobre diagramas de la plantilla: el mapa de puertos
 * del Brain y el mapa del control (cada lugar es un cuadro de texto de la
 * plantilla) y los calendarios mensuales (un renglón por día). Todo queda como
 * texto editable en PowerPoint.
 */

import type { NotebookDocument } from '@vortex-wake/shared';
import type { FieldMap } from './field-map.ts';
import { formatDate, languageTag } from './format.ts';
import { ellipsize, wrapText } from './measure.ts';
import type { CalendarLogical, CalendarSlideInfo, LogicalPage } from './plan.ts';
import type { SlideEditor } from './render.ts';
import { EMU_PER_PT } from './template.ts';
import { NS, child, children, descendants, escapeXml, fragment, remove, type Element } from './xml.ts';

const pt = (v: number) => Math.round(v * EMU_PER_PT);
/**
 * Ancho útil de cada cuadro de puerto o botón: la plantilla los hace de 113 pt,
 * pero el número del puerto (en el patrón) ocupa unos 25 pt del lado interior.
 */
const SLOT_WIDTH_PT = 84;
const FOOTER_FONT_PT = 11;

interface Page {
  logical: LogicalPage;
  number?: string;
  title?: string;
}

/** Nombres de los autores (como en el pie de las demás páginas). */
function names(doc: NotebookDocument, ids: string[]): string {
  return ids.map((id) => doc.members.find((m) => m.id === id)?.name ?? id).join(', ');
}

/** Texto de un cuadro del pie (o cualquier marcador), con letra fija. */
function writeFooter(editor: SlideEditor, el: Element | undefined, text: string): void {
  const txBody = el ? child(el, NS.p, 'txBody') : undefined;
  if (!txBody) return;
  children(txBody, NS.a, 'p').forEach(remove);
  const lang = languageTag(editor.lang);
  const sz = Math.round(FOOTER_FONT_PT * 100);
  const bodyPr = child(txBody, NS.a, 'bodyPr');
  bodyPr?.setAttribute('anchor', 't');
  bodyPr?.setAttribute('tIns', String(Math.round(3.6 * EMU_PER_PT)));
  txBody.appendChild(
    fragment(editor.doc, text === '' ? `<a:p><a:endParaRPr lang="${lang}" sz="${sz}"/></a:p>` : `<a:p><a:r><a:rPr lang="${lang}" sz="${sz}" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`),
  );
}

/** El texto más grande que cabe en el cuadro (1 renglón a 11–10 pt, 2 renglones a 9–8 pt). */
export function slotFontSize(text: string): { sizePt: number; text: string } {
  for (const sizePt of [11, 10, 9, 8]) {
    const lines = wrapText(text, SLOT_WIDTH_PT, { sizePt }).length;
    if (lines <= (sizePt <= 9 ? 2 : 1)) return { sizePt, text };
  }
  // No cabe ni en dos renglones a 8 pt: se corta con "…" (el texto completo sigue en la app).
  const first = wrapText(text, SLOT_WIDTH_PT, { sizePt: 8 })[0]?.text ?? '';
  return { sizePt: 8, text: `${first}\n${ellipsize(text.slice(first.length).trim(), SLOT_WIDTH_PT, { sizePt: 8 })}` };
}

export function renderRobotMap(editor: SlideEditor, page: Page, doc: NotebookDocument, map: FieldMap): void {
  const lp = page.logical;
  if (lp.kind !== 'robotMap') return;
  const spec = map.robotMaps?.[lp.map.kind];
  if (!spec) return;
  for (const [slot, shapeName] of Object.entries(spec.slots)) {
    const el = editor.shape(shapeName);
    if (!el) continue;
    const value = lp.map.slots[slot]?.trim() ?? '';
    editor.setShapeText(el, value ? slotFontSize(value).text : '');
    if (value) {
      const { sizePt } = slotFontSize(value);
      for (const r of descendants(el, NS.a, 'rPr')) r.setAttribute('sz', String(sizePt * 100));
      const bodyPr = descendants(el, NS.a, 'bodyPr')[0];
      // El texto ya cabe: que PowerPoint no lo encoja ni lo agrande.
      if (bodyPr) for (const c of children(bodyPr, NS.a, 'normAutofit')) remove(c);
    }
  }
  // Título arriba (la plantilla no lo trae): qué mapa y de qué robot.
  const b = spec.titleBox;
  const lang = languageTag(editor.lang);
  const id = editor.newId();
  editor.spTree().appendChild(
    fragment(
      editor.doc,
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Título ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${pt(b.x)}" y="${pt(b.y)}"/><a:ext cx="${pt(b.w)}" cy="${pt(b.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
        `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="${lang}" sz="1300" b="1" dirty="0"><a:solidFill><a:srgbClr val="1A1A1A"/></a:solidFill></a:rPr><a:t>${escapeXml(page.title ?? '')}</a:t></a:r></a:p></p:txBody></p:sp>`,
    ),
  );
  writeFooter(editor, editor.shape(spec.footer.project), doc.project);
  writeFooter(editor, editor.shape(spec.footer.name), names(doc, lp.map.authors));
  writeFooter(editor, editor.shape(spec.footer.date), formatDate(lp.map.date, doc.language));
  writeFooter(editor, editor.shape(spec.footer.page), page.number ?? '');
}

export function renderCalendar(editor: SlideEditor, page: Page, lp: CalendarLogical, doc: NotebookDocument, map: FieldMap): void {
  const frame = editor.shape(lp.table);
  const tbl = frame ? descendants(frame, NS.a, 'tbl')[0] : undefined;
  if (tbl) {
    const width = descendants(tbl, NS.a, 'gridCol').reduce((s, c) => s + Number(c.getAttribute('w') ?? 0), 0) / EMU_PER_PT;
    children(tbl, NS.a, 'tr').forEach((tr, i) => {
      const text = lp.days[i] ?? '';
      if (!text) return;
      const tc = children(tr, NS.a, 'tc')[0];
      if (tc) editor.writeCell(tc, ellipsize(text, Math.max(40, width - 14), { sizePt: 9 }), { sizePt: 9, color: map.standard.cellColor });
    });
  }
  // Pie de los calendarios: Nombre y Página (sin fecha ni proyecto).
  writeFooter(editor, editor.placeholder({ type: 'subTitle', idx: 1 }), names(doc, doc.editors ?? []));
  writeFooter(editor, editor.placeholder({ type: 'subTitle', idx: 2 }), page.number ?? '');
}

/** Meses con sesiones que la plantilla no trae como calendario (aviso). */
export function missingCalendarMonths(doc: NotebookDocument, slides: CalendarSlideInfo[]): string[] {
  const have = new Set(slides.map((s) => `${s.year}-${String(s.month).padStart(2, '0')}`));
  const months = [...new Set((doc.sessions ?? []).map((s) => s.date.slice(0, 7)))].sort();
  const missing = months.filter((m) => !have.has(m));
  if (missing.length === 0) return [];
  return [`La plantilla no trae calendario de ${missing.join(', ')}: esas sesiones solo salen en la cronología.`];
}
