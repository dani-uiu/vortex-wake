/**
 * Arma los archivos estáticos del Worker en packages/worker/dist/public:
 * la app ya compilada (packages/app/dist) y la plantilla en private/ (que el
 * Worker solo entrega por /api/template con la clave de edición).
 *
 *   node packages/worker/scripts/build.ts [--app <carpeta>] [--out <carpeta>]
 *
 * La compilación de la app la hace antes `npm run build` (ver los scripts
 * nube:* de la raíz).
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const WORKER_DIR = join(ROOT, 'packages/worker');
export const TEMPLATE = join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx');

export function buildAssets(appDist = join(ROOT, 'packages/app/dist'), out = join(WORKER_DIR, 'dist/public')): string {
  if (!existsSync(join(appDist, 'index.html'))) throw new Error(`La app no está compilada (${appDist}). Corre "npm run build" primero.`);
  if (!existsSync(join(appDist, 'sw.js'))) throw new Error('La compilación de la app no trae sw.js (¿vite.config.ts sin el plugin del service worker?).');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'private'), { recursive: true });
  cpSync(appDist, out, { recursive: true });
  cpSync(TEMPLATE, join(out, 'private/template.pptx'));
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = buildAssets(arg('--app') ? resolve(arg('--app') as string) : undefined, arg('--out') ? resolve(arg('--out') as string) : undefined);
  console.log(`Archivos del Worker listos en ${out}`);
}
