/**
 * Copia el mapa del campo de la plantilla (la imagen de fondo de la página
 * "Campo en blanco" de Estrategia) a public/field.png, para dibujar la ruta
 * del autónomo en la app. Se corre a mano cuando cambia la plantilla de
 * temporada:
 *
 *   node packages/app/scripts/extract-field.ts
 *
 * Revisa que la imagen mida lo que dice FIELD_IMAGE (@vortex-wake/shared): el
 * recorte del cuadro del campo está ahí y lo usan la app y el generador. Si la
 * plantilla nueva tiene otro campo, hay que volver a medir ese recorte.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_IMAGE } from '@vortex-wake/shared';
import { readImageInfo } from '../../generator/src/images.ts';
import { Template } from '../../generator/src/template.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bytes = new Template(new Uint8Array(readFileSync(join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx')))).fieldImage();
const info = readImageInfo(bytes);
if (info.format !== 'png' || info.width !== FIELD_IMAGE.width || info.height !== FIELD_IMAGE.height) {
  throw new Error(`el mapa del campo mide ${info.width}x${info.height} (${info.format}); FIELD_IMAGE espera ${FIELD_IMAGE.width}x${FIELD_IMAGE.height}: vuelve a medir el recorte`);
}
const out = join(ROOT, 'packages/app/public/field.png');
writeFileSync(out, bytes);
console.log(`Listo: ${out} (${(bytes.length / 1024).toFixed(0)} KB)`);
