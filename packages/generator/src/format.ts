/** Textos que agrega el generador y formato de fechas, por idioma. */

import type { Language } from '@vortex-wake/shared';

export function formatDate(iso: string, lang: Language): string {
  const [y, m, d] = iso.split('-');
  return lang === 'es' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`;
}

export const LABELS = {
  es: {
    continued: '(continuación)',
    continuedShort: '(cont.)',
    reviewHeading: 'NOTA DE REVISIÓN',
    reviewFooter: 'Borra esta nota antes de la evaluación.',
  },
  en: {
    continued: '(continued)',
    continuedShort: '(cont.)',
    reviewHeading: 'REVIEW NOTE',
    reviewFooter: 'Delete this note before judging.',
  },
} as const;

export function languageTag(lang: Language): string {
  return lang === 'es' ? 'es-MX' : 'en-US';
}
