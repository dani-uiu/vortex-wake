/**
 * Medida aproximada de texto.
 *
 * Los cuadros de la plantilla usan Arial (la fuente del tema). No podemos
 * medir con la fuente real sin un motor de render, así que usamos la tabla de
 * anchos de Arial (en milésimas de em) y partimos líneas por palabras como lo
 * hace PowerPoint. Se agrega un margen de seguridad para no quedarnos cortos.
 *
 * Límites conocidos: los caracteres fuera del latín básico se miden con un
 * ancho promedio; PowerPoint puede partir una línea en un lugar distinto, por
 * eso el margen. La medida sirve para decidir cuándo crece un cuadro o cuándo
 * se manda el resto a una página de continuación, no para maquetar al punto.
 */

// Anchos de Arial para los caracteres 32..126 (milésimas de em).
const ARIAL_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // espacio .. /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // A-Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // a-z
  334, 260, 334, 584, // { | } ~
];

const EXTRA_WIDTHS: Record<string, number> = {
  '“': 333, '”': 333, '‘': 222, '’': 222, '–': 556, '—': 1000, '…': 1000, '•': 350, '·': 278, '°': 400, '×': 584, '±': 584, '¿': 611, '¡': 333, 'ñ': 556, 'Ñ': 722,
};

const MONO_WIDTH = 600;
const DEFAULT_WIDTH = 600;
/** Margen de seguridad sobre el ancho medido. */
const WIDTH_SAFETY = 1.06;
/** Alto de línea de Arial con interlineado sencillo, como fracción del tamaño. */
export const LINE_HEIGHT_FACTOR = 1.2;

export interface FontSpec {
  sizePt: number;
  bold?: boolean;
  mono?: boolean;
}

export function charWidth(ch: string, font: FontSpec): number {
  const code = ch.codePointAt(0) ?? 32;
  // Referencia a página codificada (ver layout.ts): se mide como "W-000".
  if (code >= 0xe000 && code <= 0xf8ff) return font.mono ? MONO_WIDTH * 5 : 2945;
  if (font.mono) return MONO_WIDTH;
  let w: number | undefined;
  if (code >= 32 && code <= 126) w = ARIAL_WIDTHS[code - 32];
  else w = EXTRA_WIDTHS[ch];
  if (w === undefined) {
    const base = ch.normalize('NFD')[0] ?? ch;
    const bc = base.codePointAt(0) ?? 0;
    w = bc >= 32 && bc <= 126 ? ARIAL_WIDTHS[bc - 32] : DEFAULT_WIDTH;
  }
  return (w ?? DEFAULT_WIDTH) * (font.bold ? 1.07 : 1);
}

/** Ancho en puntos de un texto de una línea. */
export function textWidthPt(text: string, font: FontSpec): number {
  let total = 0;
  for (const ch of text) total += charWidth(ch, font);
  return (total / 1000) * font.sizePt * WIDTH_SAFETY;
}

export function lineHeightPt(font: FontSpec): number {
  return font.sizePt * LINE_HEIGHT_FACTOR;
}

/**
 * Parte un párrafo en líneas que caben en `widthPt`. Las palabras más largas
 * que la línea se cortan por carácter.
 */
export function wrapParagraph(paragraph: string, widthPt: number, font: FontSpec): string[] {
  if (paragraph === '') return [''];
  const words = paragraph.split(/(\s+)/).filter((w) => w !== '');
  const lines: string[] = [];
  let line = '';
  const push = () => {
    lines.push(line.trimEnd());
    line = '';
  };
  for (const word of words) {
    const candidate = line + word;
    if (textWidthPt(candidate.trimEnd(), font) <= widthPt) {
      line = candidate;
      continue;
    }
    if (/^\s+$/.test(word)) {
      push();
      continue;
    }
    if (line.trim() !== '') push();
    if (textWidthPt(word, font) <= widthPt) {
      line = word;
      continue;
    }
    // Palabra más larga que la línea: se corta por carácter.
    let chunk = '';
    for (const ch of word) {
      if (textWidthPt(chunk + ch, font) > widthPt && chunk !== '') {
        lines.push(chunk);
        chunk = '';
      }
      chunk += ch;
    }
    line = chunk;
  }
  if (line !== '' || lines.length === 0) push();
  return lines;
}

/** Líneas de un texto con varios párrafos (separados por `\n`). */
export function wrapText(text: string, widthPt: number, font: FontSpec): { paragraph: number; text: string }[] {
  const out: { paragraph: number; text: string }[] = [];
  text.split('\n').forEach((p, i) => {
    for (const l of wrapParagraph(p, widthPt, font)) out.push({ paragraph: i, text: l });
  });
  return out;
}

export function textHeightPt(text: string, widthPt: number, font: FontSpec): number {
  return wrapText(text, widthPt, font).length * lineHeightPt(font);
}

/**
 * Divide un texto en la parte que cabe en `maxLines` líneas y el resto. El
 * corte se hace entre líneas: el resto empieza donde termina la última línea
 * que cupo, aunque sea a mitad de un párrafo.
 */
export function splitTextByLines(text: string, widthPt: number, font: FontSpec, maxLines: number): { fitted: string; rest: string } {
  const lines = wrapText(text, widthPt, font);
  if (lines.length <= maxLines) return { fitted: text, rest: '' };
  const take = Math.max(0, maxLines);
  return { fitted: joinLines(lines.slice(0, take)), rest: joinLines(lines.slice(take)) };
}

function joinLines(lines: { paragraph: number; text: string }[]): string {
  const paras: string[] = [];
  let last = -1;
  for (const l of lines) {
    if (l.paragraph === last && paras.length > 0) paras[paras.length - 1] += ` ${l.text}`;
    else paras.push(l.text);
    last = l.paragraph;
  }
  return paras.join('\n');
}

/** Recorta un texto de una línea para que quepa, con "…" al final. */
export function ellipsize(text: string, widthPt: number, font: FontSpec): string {
  if (textWidthPt(text, font) <= widthPt) return text;
  let out = text;
  while (out.length > 1 && textWidthPt(`${out}…`, font) > widthPt) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}
