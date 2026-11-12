import { describe, expect, it } from 'vitest';
import { exifDate } from '../src/image.ts';

/** JPEG mínimo con EXIF (little endian) y DateTimeOriginal. */
function jpegWithExif(date: string): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  tiff.push(0x49, 0x49);
  u16(42);
  u32(8);
  // IFD0 (en 8): una entrada, puntero al ExifIFD (en 26)
  u16(1);
  u16(0x8769), u16(4), u32(1), u32(26);
  u32(0);
  // ExifIFD (en 26): DateTimeOriginal (ASCII, 20 bytes en 44)
  u16(1);
  u16(0x9003), u16(2), u32(20), u32(44);
  u32(0);
  for (const ch of date) tiff.push(ch.charCodeAt(0));
  tiff.push(0);
  const app1Len = 2 + 6 + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, app1Len >> 8, app1Len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9]);
}

describe('hora de captura de la foto (EXIF)', () => {
  it('lee DateTimeOriginal como hora local', () => {
    const iso = exifDate(jpegWithExif('2026:11:12 16:30:05'));
    expect(iso).toBe(new Date(2026, 10, 12, 16, 30, 5).toISOString());
  });
  it('sin EXIF o con bytes raros no falla', () => {
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
    expect(exifDate(new Uint8Array([0x89, 0x50]))).toBeUndefined();
    expect(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 40, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2]))).toBeUndefined();
  });
});
