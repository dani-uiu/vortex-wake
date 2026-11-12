/**
 * Dibuja los íconos de la app (manifiesto e iPhone) a partir de un SVG y los
 * guarda en public/icons/. Se corre a mano solo si cambia el diseño:
 *
 *   node packages/app/scripts/make-icons.ts
 *
 * Usa el Edge instalado (playwright-core) para convertir el SVG a PNG.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public/icons');

/**
 * Una "V" blanca (de Vortex) sobre rojo, con dos líneas de estela.
 * `pad` reduce el dibujo para los íconos "maskable" (Android los recorta en círculo).
 */
function svg(size: number, opts: { rounded: boolean; pad: number }): string {
  const s = 100;
  const k = 1 - opts.pad * 2;
  const t = (v: number) => (opts.pad * s + v * k).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${s} ${s}">
<rect width="${s}" height="${s}" rx="${opts.rounded ? 22 : 0}" fill="#c8102e"/>
<path d="M${t(24)} ${t(28)} L${t(50)} ${t(74)} L${t(76)} ${t(28)}" fill="none" stroke="#fff" stroke-width="${(10 * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M${t(18)} ${t(86)} Q${t(34)} ${t(79)} ${t(50)} ${t(86)} T${t(82)} ${t(86)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${(4 * k).toFixed(2)}" stroke-linecap="round"/>
</svg>`;
}

const icons = [
  { file: 'icon-192.png', size: 192, rounded: true, pad: 0 },
  { file: 'icon-512.png', size: 512, rounded: true, pad: 0 },
  { file: 'maskable-512.png', size: 512, rounded: false, pad: 0.12 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, pad: 0.06 },
];

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg(512, { rounded: true, pad: 0 }));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  for (const i of icons) {
    await page.setViewportSize({ width: i.size, height: i.size });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(i.size, i)}</body></html>`);
    await page.locator('svg').screenshot({ path: join(OUT, i.file), omitBackground: true });
    console.log(`public/icons/${i.file}`);
  }
} finally {
  await browser.close();
}
