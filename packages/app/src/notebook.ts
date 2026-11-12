/**
 * "Generar bitácora" en el navegador: armado automático (shared/assemble.ts)
 * + generador (packages/generator, que recibe y devuelve bytes).
 * El generador se carga solo cuando se usa (no pesa en el celular).
 */

import { assembleNotebook, localDate } from '@vortex-wake/shared';
import type { App } from './app.ts';

export interface GenerateOutcome {
  fileName: string;
  bytes: Uint8Array;
  pages: number;
  warnings: string[];
}

export async function generateNotebookFile(app: App, numbering: 'section' | 'continuous'): Promise<GenerateOutcome> {
  if (!app.team) throw new Error('todavía no se carga el equipo');
  const { generateNotebook } = await import('@vortex-wake/generator');
  const assembled = assembleNotebook({
    team: app.team,
    sessions: [...app.sessions.values()],
    entries: [...app.entries.values()],
  });
  if (assembled.document.pages.length === 0) throw new Error('no hay entradas con contenido para armar la bitácora');
  const template = await app.api.template();
  const byPath = new Map(assembled.photoIds.map((id) => [`photos/${id}.jpg`, id]));
  const result = await generateNotebook({
    template,
    document: assembled.document,
    loadAsset: (src) => {
      const id = byPath.get(src);
      if (!id) throw new Error(`imagen desconocida: ${src}`);
      return app.photoBytes(id);
    },
    options: { numbering },
  });
  return {
    fileName: `bitacora-${localDate()}.pptx`,
    bytes: result.bytes,
    pages: result.pages.length,
    warnings: [...assembled.warnings, ...result.warnings],
  };
}

export function download(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
