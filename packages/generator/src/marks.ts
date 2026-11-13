/**
 * Flechas y etiquetas sobre una imagen (fotos anotadas, ruta del autónomo
 * sobre el mapa del campo), como formas reales de PowerPoint: conectores con
 * punta de flecha y círculos con texto. Van agrupadas con la imagen para que
 * se muevan juntas; se pueden desagrupar y editar una por una.
 */

import type { ImageMark } from '@vortex-wake/shared';
import type { BoxPt } from './layout.ts';
import { EMU_PER_PT } from './template.ts';
import { escapeXml } from './xml.ts';

const pt = (v: number) => Math.round(v * EMU_PER_PT);

export const MARK_COLOR = 'C8102E';

export interface MarkStyle {
  /** Diámetro del círculo de cada etiqueta, en puntos. */
  diameter: number;
  fontPt: number;
  lineWidthPt: number;
}

/** Tamaño de las marcas según el tamaño de la imagen en la página. */
export function markStyle(box: BoxPt): MarkStyle {
  const diameter = Math.max(12, Math.min(20, Math.min(box.w, box.h) * 0.085));
  return { diameter, fontPt: Math.max(7, Math.round(diameter * 0.55)), lineWidthPt: diameter >= 16 ? 2 : 1.5 };
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * XML de las formas de cada marca (primero las flechas, después los círculos,
 * para que las letras queden encima). `nextId` da ids únicos de la diapositiva.
 */
export function marksXml(marks: ImageMark[], box: BoxPt, lang: string, nextId: () => number): string[] {
  const s = markStyle(box);
  const r = s.diameter / 2;
  const at = (fx: number, fy: number) => ({ x: box.x + clamp01(fx) * box.w, y: box.y + clamp01(fy) * box.h });
  const center = (fx: number, fy: number) => {
    const p = at(fx, fy);
    return { x: clamp(p.x, box.x + r, box.x + box.w - r), y: clamp(p.y, box.y + r, box.y + box.h - r) };
  };
  const arrows: string[] = [];
  const labels: string[] = [];
  // Una flecha que sale o llega al centro de un círculo (la ruta del autónomo) empieza y termina en su borde.
  const onLabel = (fx: number, fy: number) => marks.some((l) => l.kind === 'label' && Math.abs(l.x - fx) < 1e-6 && Math.abs(l.y - fy) < 1e-6);
  for (const m of marks) {
    if (m.kind === 'arrow') {
      if (m.tx === undefined || m.ty === undefined) continue;
      let a = at(m.x, m.y);
      let b = at(m.tx, m.ty);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const trimA = onLabel(m.x, m.y) ? r + 1 : 0;
      const trimB = onLabel(m.tx, m.ty) ? r + 1 : 0;
      if (d - trimA - trimB < 4) continue;
      const ux = (b.x - a.x) / d;
      const uy = (b.y - a.y) / d;
      a = { x: a.x + ux * trimA, y: a.y + uy * trimA };
      b = { x: b.x - ux * trimB, y: b.y - uy * trimB };
      arrows.push(connector({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, s, nextId(), 'Flecha'));
      continue;
    }
    const c = center(m.x, m.y);
    if (m.tx !== undefined && m.ty !== undefined) {
      const t = at(m.tx, m.ty);
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d > r + 4) {
        const ux = (t.x - c.x) / d;
        const uy = (t.y - c.y) / d;
        arrows.push(connector({ x1: c.x + ux * r, y1: c.y + uy * r, x2: t.x, y2: t.y }, s, nextId(), `Flecha ${m.text ?? ''}`.trim()));
      }
    }
    labels.push(bubble(m.text ?? '', c, s, lang, nextId()));
  }
  return [...arrows, ...labels];
}

/** Agrupa la imagen y sus marcas en un grupo del tamaño de la imagen. */
export function groupXml(id: number, name: string, box: BoxPt, childrenXml: string[]): string {
  const off = `<a:off x="${pt(box.x)}" y="${pt(box.y)}"/><a:ext cx="${pt(box.w)}" cy="${pt(box.h)}"/>`;
  const ch = `<a:chOff x="${pt(box.x)}" y="${pt(box.y)}"/><a:chExt cx="${pt(box.w)}" cy="${pt(box.h)}"/>`;
  return (
    `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm>${off}${ch}</a:xfrm></p:grpSpPr>${childrenXml.join('')}</p:grpSp>`
  );
}

function connector(seg: Seg, s: MarkStyle, id: number, name: string): string {
  const x = Math.min(seg.x1, seg.x2);
  const y = Math.min(seg.y1, seg.y2);
  const flip = `${seg.x2 < seg.x1 ? ' flipH="1"' : ''}${seg.y2 < seg.y1 ? ' flipV="1"' : ''}`;
  return (
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${escapeXml(name)} ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr><a:xfrm${flip}><a:off x="${pt(x)}" y="${pt(y)}"/><a:ext cx="${pt(Math.abs(seg.x2 - seg.x1))}" cy="${pt(Math.abs(seg.y2 - seg.y1))}"/></a:xfrm>` +
    `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>` +
    `<a:ln w="${pt(s.lineWidthPt)}" cap="rnd"><a:solidFill><a:srgbClr val="${MARK_COLOR}"/></a:solidFill><a:round/><a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`
  );
}

function bubble(text: string, c: { x: number; y: number }, s: MarkStyle, lang: string, id: number): string {
  const d = s.diameter;
  const size = text.length > 1 ? Math.max(6, s.fontPt - 2 * (text.length - 1)) : s.fontPt;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Etiqueta ${escapeXml(text)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${pt(c.x - d / 2)}" y="${pt(c.y - d / 2)}"/><a:ext cx="${pt(d)}" cy="${pt(d)}"/></a:xfrm>` +
    `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>` +
    `<a:ln w="${pt(s.lineWidthPt * 0.75)}"><a:solidFill><a:srgbClr val="${MARK_COLOR}"/></a:solidFill></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" anchorCtr="0" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="${lang}" sz="${Math.round(size * 100)}" b="1" dirty="0"><a:solidFill><a:srgbClr val="${MARK_COLOR}"/></a:solidFill>` +
    `<a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}
