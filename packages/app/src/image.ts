/**
 * Fotos: se reducen en el teléfono (lado mayor 1600 px, JPEG) antes de
 * guardarse y mandarse. La hora de captura sale del EXIF (DateTimeOriginal)
 * si existe, o de la fecha del archivo.
 */

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.82;

/** Lee DateTimeOriginal (o DateTime) del EXIF de un JPEG. Devuelve ISO o undefined. */
export function exifDate(bytes: Uint8Array): string | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1] as number;
    const len = dv.getUint16(i + 2);
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      return readTiffDate(dv, i + 10, Math.min(bytes.length, i + 2 + len));
    }
    if (marker === 0xda) return undefined; // empieza la imagen: no hay EXIF
    i += 2 + len;
  }
  return undefined;
}

function readTiffDate(dv: DataView, tiff: number, end: number): string | undefined {
  try {
    const le = dv.getUint16(tiff) === 0x4949;
    const u16 = (o: number) => dv.getUint16(tiff + o, le);
    const u32 = (o: number) => dv.getUint32(tiff + o, le);
    const ascii = (o: number, n: number) => {
      let s = '';
      for (let k = 0; k < n && tiff + o + k < end; k++) {
        const c = dv.getUint8(tiff + o + k);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const readIfd = (off: number) => {
      const out = new Map<number, { type: number; count: number; value: number }>();
      const n = u16(off);
      for (let k = 0; k < n; k++) {
        const e = off + 2 + k * 12;
        out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8) });
      }
      return out;
    };
    const ifd0 = readIfd(u32(4));
    let date: string | undefined;
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const t = readIfd(exifPtr.value).get(0x9003);
      if (t && t.type === 2) date = ascii(t.value, t.count);
    }
    if (!date) {
      const t = ifd0.get(0x0132);
      if (t && t.type === 2) date = ascii(t.value, t.count);
    }
    const m = date ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(date) : null;
    if (!m) return undefined;
    // El EXIF no trae zona horaria: es la hora local del teléfono.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

export interface ResizedPhoto {
  bytes: ArrayBuffer;
  width: number;
  height: number;
}

/** Reduce una foto con un <img> y un <canvas> (respeta la orientación EXIF en navegadores actuales). */
export async function resizePhoto(bytes: ArrayBuffer, type: string): Promise<ResizedPhoto> {
  const url = URL.createObjectURL(new Blob([bytes], { type: type || 'image/jpeg' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('imagen vacía');
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('el navegador no permite dibujar la foto');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('no se pudo convertir la foto a JPEG');
    canvas.width = 0;
    canvas.height = 0;
    return { bytes: await blob.arrayBuffer(), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function isJpeg(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return b[0] === 0xff && b[1] === 0xd8;
}
