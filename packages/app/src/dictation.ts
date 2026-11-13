/**
 * Micrófono en los campos de texto. Dos modos:
 *
 * - **Transcribir** (por omisión, donde existe): reconocimiento de voz del
 *   navegador (`SpeechRecognition`), en español de México. El texto aparece
 *   mientras se habla y queda editable. No se guarda el audio. La primera vez
 *   (en cada teléfono) se avisa que, en la mayoría de los navegadores, el
 *   audio va a los servidores del fabricante del navegador.
 * - **Solo grabar**: graba una nota de voz (voice.ts) y la agrega a la entrada
 *   después del campo. Es lo único que hay en Firefox, que no trae
 *   reconocimiento de voz; en los demás se elige en "Micrófono" (inicio).
 *
 * Solo graba en campos que pertenecen a una entrada (`onRecorded`). Donde no
 * se puede ni transcribir ni grabar no hay botón: en los recuadros de texto se
 * sugiere el micrófono del teclado.
 */

import { lsGet, lsSet } from './app.ts';
import { h, icon, openSheet, setChildren, toast } from './ui.ts';
import { canRecord, durationLabel, micErrorMessage, startRecording, type Recording } from './voice.ts';

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
const LS_MODE = 'vw.mic.mode';
export const DICTATION_LANG = 'es-MX';
export const KEYBOARD_HINT = 'o dicta con el micrófono del teclado';

export type MicMode = 'transcribe' | 'record';

/** Lo elegido en este teléfono (transcribir, si no se ha elegido). */
export function micMode(): MicMode {
  return lsGet(LS_MODE) === 'record' ? 'record' : 'transcribe';
}
export function setMicMode(m: MicMode): void {
  lsSet(LS_MODE, m);
}
/** Hay elección solo si el navegador puede hacer las dos cosas. */
export function micModeChoice(): boolean {
  return recognitionCtor() !== undefined && canRecord();
}

export function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

let active: { stop(): void } | undefined;

/**
 * Agrega el botón del micrófono a un campo (y devuelve el contenedor). Con
 * `onRecorded` el campo puede grabar notas de voz (ver arriba). Sin nada que
 * hacer devuelve el campo tal cual (en recuadros grandes, con la sugerencia
 * del micrófono del teclado).
 */
export function dictationFor(field: HTMLInputElement | HTMLTextAreaElement, opts: { onRecorded?: (blob: Blob, ms: number) => void } = {}): HTMLElement {
  const Ctor = recognitionCtor();
  const onRecorded = canRecord() ? opts.onRecorded : undefined;
  if (!Ctor && !onRecorded) {
    if (field instanceof HTMLTextAreaElement && !field.placeholder.includes(KEYBOARD_HINT)) {
      field.placeholder = field.placeholder ? `${field.placeholder} (${KEYBOARD_HINT})` : `Escribe aquí, ${KEYBOARD_HINT}`;
    }
    return field;
  }
  /** Qué hace el botón ahora (el modo puede cambiar mientras la vista está abierta). */
  const recordNow = () => !!onRecorded && (!Ctor || micMode() === 'record');
  const idleLabel = () => (recordNow() ? 'Grabar nota de voz' : 'Dictar');
  const btn = h('button', { class: 'dict-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': idleLabel(), title: idleLabel(), 'data-testid': 'dictate' }, icon('mic', 'icon sm'));
  const wrap = h('div', { class: `dict-wrap ${field instanceof HTMLTextAreaElement ? 'area' : 'line'}` }, field, btn);
  let rec: Recognition | undefined;
  let recording: Recording | undefined;
  let tick: number | undefined;

  const setOn = (on: boolean, audio = false) => {
    btn.classList.toggle('on', on);
    btn.classList.toggle('recording', on && audio);
    btn.setAttribute('aria-pressed', String(on));
    const label = on ? (audio ? 'Terminar la nota de voz' : 'Detener el dictado') : idleLabel();
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.replaceChildren(icon(on ? 'stop' : 'mic', 'icon sm'));
  };

  const stopAudio = () => recording?.stop();
  const startAudio = async (save: (blob: Blob, ms: number) => void) => {
    active?.stop();
    try {
      recording = await startRecording((blob, ms) => {
        clearInterval(tick);
        recording = undefined;
        if (active?.stop === stopAudio) active = undefined;
        setOn(false);
        if (blob) save(blob, ms);
        else toast('No se grabó nada.');
      });
    } catch (e) {
      toast(micErrorMessage(e));
      return;
    }
    active = { stop: stopAudio };
    setOn(true, true);
    const started = recording.startedAt;
    const time = h('span', { class: 'dict-time', text: '0:00' });
    btn.append(time);
    tick = window.setInterval(() => (time.textContent = durationLabel(Date.now() - started)), 250);
  };

  const start = (R: RecognitionCtor) => {
    active?.stop();
    const r = new R();
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
    if (rec) return rec.stop();
    if (recording) return recording.stop();
    if (onRecorded && recordNow()) {
      // Lo que se escribió se guarda antes de agregar la nota de voz.
      field.dispatchEvent(new Event('blur'));
      return void startAudio(onRecorded);
    }
    if (!Ctor) return;
    if (lsGet(LS_OK) === '1') start(Ctor);
    else askConsent(() => start(Ctor), onRecorded ? () => (field.dispatchEvent(new Event('blur')), void startAudio(onRecorded)) : undefined);
  });
  return wrap;
}

/** Hoja "Micrófono": transcribir o solo grabar (solo donde se pueden las dos). */
export function openMicSettings(onChange?: () => void): void {
  const sheet = openSheet('Micrófono', 'sheet-mic');
  const opt = (m: MicMode, title: string, desc: string) =>
    h(
      'button',
      {
        class: `sheet-item mic-opt ${micMode() === m ? 'on' : ''}`,
        type: 'button',
        'aria-pressed': String(micMode() === m),
        'data-mode': m,
        onclick: () => {
          setMicMode(m);
          sheet.close();
          onChange?.();
          toast(m === 'record' ? 'El micrófono grabará notas de voz' : 'El micrófono transcribirá a texto');
        },
      },
      icon(m === 'record' ? 'mic' : 'text'),
      h('span', { class: 'mic-opt-text' }, h('strong', { text: title }), h('span', { class: 'muted small', text: desc })),
    );
  sheet.body.append(
    h('p', { class: 'muted small', text: 'Qué hace el micrófono de los campos de texto en este teléfono.' }),
    h(
      'div',
      { class: 'sheet-list' },
      opt('transcribe', 'Transcribir', 'El texto aparece mientras hablas. El audio pasa por los servidores del navegador.'),
      opt('record', 'Solo grabar', 'Guarda una nota de voz en la entrada, sin texto. El audio solo va al servidor del equipo.'),
    ),
  );
}

/** Aviso la primera vez: a dónde va el audio. No se activa sin que la persona acepte. */
function askConsent(onYes: () => void, onRecord?: () => void): void {
  const sheet = openSheet('Dictar con la voz', 'sheet-dictation');
  setChildren(
    sheet.body,
    h('p', { text: 'El texto aparece mientras hablas y lo puedes corregir después.' }),
    h('p', { class: 'dict-warning', text: 'Ojo: en la mayoría de los navegadores (Chrome, Edge, Safari) el audio se manda a los servidores del fabricante del navegador (Google, Microsoft o Apple) para convertirlo en texto. Vortex Wake no guarda el audio.' }),
    h('p', {
      class: 'muted small',
      text: onRecord
        ? 'Si prefieres que no pase por ellos, graba una nota de voz: se guarda en la entrada sin transcribir. Lo puedes cambiar después en "Micrófono", en el inicio.'
        : 'Si prefieres que no salga del teléfono, usa el micrófono del teclado (si tu teclado lo permite sin conexión).',
    }),
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'dictation-accept', onclick: () => (lsSet(LS_OK, '1'), sheet.close(), onYes()) }, 'Entendido, dictar'),
    onRecord
      ? h('button', { class: 'btn secondary', type: 'button', 'data-testid': 'dictation-record', onclick: () => (setMicMode('record'), sheet.close(), onRecord()) }, icon('mic'), 'Mejor solo grabar')
      : null,
    h('button', { class: 'btn-text', type: 'button', onclick: () => sheet.close() }, 'Ahora no'),
  );
}
