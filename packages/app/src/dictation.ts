/**
 * Dictado por voz en los campos de texto, con el reconocimiento de voz del
 * navegador (`SpeechRecognition`), en español de México. El texto aparece
 * mientras se habla y queda editable. No se guarda el audio.
 *
 * - Solo empieza cuando la persona toca el micrófono. La primera vez (en cada
 *   teléfono) se avisa que, en la mayoría de los navegadores, el audio se
 *   manda a los servidores del fabricante del navegador para convertirlo en
 *   texto.
 * - Donde no existe (por ejemplo Firefox, o por HTTP en algunos teléfonos) no
 *   se muestra el botón: en los recuadros de texto se sugiere el micrófono del
 *   teclado.
 */

import { lsGet, lsSet } from './app.ts';
import { h, icon, openSheet, toast } from './ui.ts';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: RecognitionEvent) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

const LS_OK = 'vw.dictation.ok';
export const DICTATION_LANG = 'es-MX';
export const KEYBOARD_HINT = 'o dicta con el micrófono del teclado';

export function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

let active: { stop(): void } | undefined;

/**
 * Agrega el botón de dictado a un campo (y devuelve el contenedor). Sin
 * reconocimiento de voz devuelve el campo tal cual (en recuadros grandes,
 * con la sugerencia del micrófono del teclado).
 */
export function dictationFor(field: HTMLInputElement | HTMLTextAreaElement): HTMLElement {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    if (field instanceof HTMLTextAreaElement && !field.placeholder.includes(KEYBOARD_HINT)) {
      field.placeholder = field.placeholder ? `${field.placeholder} (${KEYBOARD_HINT})` : `Escribe aquí, ${KEYBOARD_HINT}`;
    }
    return field;
  }
  const btn = h('button', { class: 'dict-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Dictar', title: 'Dictar', 'data-testid': 'dictate' }, icon('mic', 'icon sm'));
  const wrap = h('div', { class: `dict-wrap ${field instanceof HTMLTextAreaElement ? 'area' : 'line'}` }, field, btn);
  let rec: Recognition | undefined;

  const setOn = (on: boolean) => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Detener el dictado' : 'Dictar');
    btn.replaceChildren(icon(on ? 'stop' : 'mic', 'icon sm'));
  };

  const start = () => {
    active?.stop();
    const r = new Ctor();
    rec = r;
    r.lang = DICTATION_LANG;
    r.continuous = true;
    r.interimResults = true;
    // Lo dictado se inserta donde está el cursor; lo que ya estaba se respeta.
    const at = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? at;
    const before = field.value.slice(0, at);
    const after = field.value.slice(end);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    let finals = '';
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i] as RecognitionResult;
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }
      const said = (finals + interim).replace(/^\s+/, '');
      field.value = before + (said ? sep + said : '') + after;
      const caret = (before + sep + said).length;
      field.setSelectionRange?.(caret, caret);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('El navegador no dio permiso para usar el micrófono.');
      else if (ev.error === 'network') toast('El dictado necesita conexión a internet. Puedes usar el micrófono del teclado.');
      else if (ev.error === 'language-not-supported') toast('Este navegador no dicta en español de México.');
    };
    r.onend = () => {
      setOn(false);
      if (active?.stop === stop) active = undefined;
      rec = undefined;
      field.dispatchEvent(new Event('blur'));
    };
    const stop = () => rec?.stop();
    active = { stop };
    try {
      r.start();
      setOn(true);
      field.focus({ preventScroll: true });
    } catch {
      toast('No se pudo empezar a dictar.');
    }
  };

  btn.addEventListener('click', () => {
    if (rec) {
      rec.stop();
      return;
    }
    if (lsGet(LS_OK) === '1') start();
    else askConsent(start);
  });
  return wrap;
}

/** Aviso la primera vez: a dónde va el audio. No se activa sin que la persona acepte. */
function askConsent(onYes: () => void): void {
  const sheet = openSheet('Dictar con la voz', 'sheet-dictation');
  sheet.body.append(
    h('p', { text: 'El texto aparece mientras hablas y lo puedes corregir después.' }),
    h('p', { class: 'dict-warning', text: 'Ojo: en la mayoría de los navegadores (Chrome, Edge, Safari) el audio se manda a los servidores del fabricante del navegador (Google, Microsoft o Apple) para convertirlo en texto. Vortex Wake no guarda el audio.' }),
    h('p', { class: 'muted small', text: 'Si prefieres que no salga del teléfono, usa el micrófono del teclado (si tu teclado lo permite sin conexión).' }),
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'dictation-accept', onclick: () => (lsSet(LS_OK, '1'), sheet.close(), onYes()) }, 'Entendido, dictar'),
    h('button', { class: 'btn-text', type: 'button', onclick: () => sheet.close() }, 'Ahora no'),
  );
}
