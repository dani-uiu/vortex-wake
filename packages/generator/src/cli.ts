#!/usr/bin/env node
/**
 * Línea de comandos del generador. Hace la entrada y salida de archivos; el
 * núcleo (generate.ts) solo recibe y devuelve bytes.
 *
 *   npm run generate -- <documento.json> --template <plantilla.pptx> --out <salida.pptx>
 *                       [--numbering section|continuous] [--reference-pages]
 *                       [--no-resources] [--keep-help-text]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NotebookValidationError } from '@vortex-wake/shared';
import { generateNotebook, type Numbering } from './generate.ts';

const USAGE = `Uso:
  npm run generate -- <documento.json> --template <plantilla.pptx> --out <salida.pptx> [opciones]

Opciones:
  --numbering section|continuous   Numeración por sección (M-1, C-1...) o corrida (1, 2, 3...). Por defecto: section
  --reference-pages                Agrega al final las páginas de referencia de la plantilla
  --no-resources                   Omite la página de recursos de VEX
  --keep-help-text                 Conserva el texto de ayuda gris bajo cada encabezado
  --list                           Muestra la lista de diapositivas generadas
  -h, --help                      Muestra esta ayuda`;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        template: { type: 'string', short: 't' },
        out: { type: 'string', short: 'o' },
        numbering: { type: 'string', default: 'section' },
        'reference-pages': { type: 'boolean', default: false },
        'no-resources': { type: 'boolean', default: false },
        'keep-help-text': { type: 'boolean', default: false },
        list: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const docPath = positionals[0];
  if (!docPath || !values.template || !values.out) {
    console.error(`Faltan argumentos.\n\n${USAGE}`);
    return 2;
  }
  if (values.numbering !== 'section' && values.numbering !== 'continuous') {
    console.error('--numbering debe ser "section" o "continuous".');
    return 2;
  }

  const docFile = resolve(docPath);
  const baseDir = dirname(docFile);
  let document: unknown;
  try {
    document = JSON.parse(await readFile(docFile, 'utf8'));
  } catch (e) {
    console.error(`No se pudo leer el documento ${docFile}: ${(e as Error).message}`);
    return 1;
  }
  const template = new Uint8Array(await readFile(resolve(values.template)));

  try {
    const result = await generateNotebook({
      template,
      document,
      loadAsset: async (src) => new Uint8Array(await readFile(resolve(baseDir, src))),
      options: {
        numbering: values.numbering as Numbering,
        includeReferencePages: values['reference-pages'],
        includeResources: !values['no-resources'],
        keepHelpText: values['keep-help-text'],
      },
    });
    const outFile = resolve(values.out);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, result.bytes);
    const numbered = result.pages.filter((p) => p.number).length;
    console.log(`Bitácora generada: ${outFile}`);
    console.log(`  ${result.pages.length} diapositivas (${numbered} numeradas), numeración ${values.numbering === 'section' ? 'por sección' : 'corrida'}.`);
    for (const w of result.warnings) console.log(`  Aviso: ${w}`);
    if (values.list) {
      for (const p of result.pages) {
        const names: Record<string, string> = {
          cover: 'Portada',
          divider: 'Separador de sección',
          resources: 'Recursos',
          toc: 'Tabla de contenido',
          asIs: 'Página de referencia',
        };
        const label = p.title ?? names[p.kind] ?? p.kind;
        console.log(`  ${String(p.slide).padStart(3)}  ${(p.number ?? '').padEnd(5)} ${label}`);
      }
    }
    return 0;
  } catch (e) {
    if (e instanceof NotebookValidationError) {
      console.error(e.message);
      return 1;
    }
    console.error(`Error: ${(e as Error).message}`);
    return 1;
  }
}

main().then((code) => process.exit(code));
