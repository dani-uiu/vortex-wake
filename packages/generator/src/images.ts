/**
 * Tamaño de imágenes PNG y JPEG leído de los bytes (sin dependencias), y
 * acomodo de varias fotos en rejilla conservando su proporción.
 */

export interface ImageInfo {
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] as number;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = ((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number);
      // SOF0..SOF15 excepto DHT (C4), JPG (C8) y DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = ((bytes[i + 5] as number) << 8) | (bytes[i + 6] as number);
        const width = ((bytes[i + 7] as number) << 8) | (bytes[i + 8] as number);
        return { format: 'jpeg', width, height };
      }
      i += 2 + len;
    }
    throw new Error('JPEG sin encabezado de tamaño');
  }
  throw new Error('formato de imagen no soportado (solo PNG o JPEG)');
}

export interface GridCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridLayout {
  columns: number;
  rows: number;
  /** Rectángulo de cada imagen (ya con su proporción), en puntos. */
  images: GridCell[];
  /** Rectángulo del pie de foto de cada imagen, si lleva. */
  captions: (GridCell | undefined)[];
  /** Lado menor de la imagen más chica. */
  minSide: number;
}

export const CAPTION_HEIGHT_PT = 12;
const GAP_PT = 6;

/**
 * Acomoda `aspects` (ancho/alto) en una rejilla dentro de `width` x `height`,
 * probando todas las cantidades de columnas y quedándose con la que deja las
 * imágenes más grandes.
 */
export function layoutGrid(aspects: number[], hasCaption: boolean[], width: number, height: number): GridLayout {
  const n = aspects.length;
  let best: GridLayout | undefined;
  let bestScore = -1;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - GAP_PT * (cols - 1)) / cols;
    const cellH = (height - GAP_PT * (rows - 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;
    const images: GridCell[] = [];
    const captions: (GridCell | undefined)[] = [];
    let area = 0;
    let minSide = Infinity;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const capH = hasCaption[i] ? CAPTION_HEIGHT_PT : 0;
      const availH = Math.max(1, cellH - capH);
      const aspect = aspects[i] as number;
      let w = cellW;
      let h = w / aspect;
      if (h > availH) {
        h = availH;
        w = h * aspect;
      }
      // Centra la última fila si queda incompleta.
      const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
      const rowOffset = ((cols - inRow) * (cellW + GAP_PT)) / 2;
      const cx = rowOffset + c * (cellW + GAP_PT);
      const cy = r * (cellH + GAP_PT);
      const x = cx + (cellW - w) / 2;
      const y = cy + (availH - h) / 2;
      images.push({ x, y, width: w, height: h });
      captions.push(hasCaption[i] ? { x: cx, y: cy + availH, width: cellW, height: capH } : undefined);
      area += w * h;
      minSide = Math.min(minSide, w, h);
    }
    const score = area * Math.min(1, minSide / 40);
    if (score > bestScore) {
      bestScore = score;
      best = { columns: cols, rows, images, captions, minSide };
    }
  }
  if (!best) return { columns: 1, rows: 1, images: [], captions: [], minSide: 0 };
  return best;
}
