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
  },
  en: {
    continued: '(continued)',
    continuedShort: '(cont.)',
  },
} as const;

export function languageTag(lang: Language): string {
  return lang === 'es' ? 'es-MX' : 'en-US';
}
