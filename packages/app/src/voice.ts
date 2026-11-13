/**
 * Notas de voz: grabar el micrófono con `MediaRecorder` (sin transcribir).
 *
 * Es lo que usa Firefox, que no trae reconocimiento de voz, y lo que se usa en
 * los demás navegadores con la opción "Solo grabar". El audio se queda en el
 * teléfono y se manda al servidor del equipo como las fotos; no pasa por los
 * servidores del fabricante del navegador.
 *
 * Necesita contexto seguro (HTTPS o localhost): por HTTP en la red local el
 * navegador no da el micrófono y no se ofrece.
 */

import { MAX_AUDIO_MS } from '@vortex-wake/shared';
import { h, icon, openSheet, toast } from './ui.ts';

/** Tipos a probar, en orden: Opus en WebM (Chrome, Firefox), Opus en Ogg (Firefox), MP4/AAC (Safari). */
const PREFERRED = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export interface Recording {
  /** Termina y entrega el audio (o `undefined` si no se grabó nada). */
  stop(): void;
  /** Cuándo empezó (para mostrar el tiempo). */
  readonly startedAt: number;
}

/**
 * Empieza a grabar. `onDone` recibe el audio al terminar (al llamar `stop()`
 * o al llegar a `MAX_AUDIO_MS`). Lanza si el navegador no da el micrófono.
 */
export async function startRecording(onDone: (blob: Blob | undefined, ms: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = PREFERRED.find((t) => MediaRecorder.isTypeSupported?.(t));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    throw e;
  }
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let timer: number | undefined;
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  rec.onstop = () => {
    clearTimeout(timer);
    for (const t of stream.getTracks()) t.stop();
    const ms = Date.now() - startedAt;
    const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm';
    onDone(chunks.length > 0 ? new Blob(chunks, { type }) : undefined, ms);
  };
  rec.start(1000);
  timer = window.setTimeout(() => {
    if (rec.state !== 'inactive') {
      toast('La nota de voz llegó a 5 minutos y se guardó.');
      rec.stop();
    }
  }, MAX_AUDIO_MS);
  return {
    startedAt,
    stop: () => {
      if (rec.state !== 'inactive') rec.stop();
    },
  };
}

/** "1:05" */
export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'El navegador no dio permiso para usar el micrófono.';
  if (name === 'NotFoundError') return 'No se encontró un micrófono.';
  return 'No se pudo empezar a grabar.';
}

/** Hoja con un botón grande para grabar una nota de voz (desde "Agregar" o "Más"). */
export function openRecorder(onSaved: (blob: Blob, ms: number) => void): void {
  let recording: Recording | undefined;
  // Si se cierra la hoja grabando, no se pierde: se guarda lo grabado.
  const sheet = openSheet('Nota de voz', 'sheet-recorder', () => recording?.stop());
  const time = h('div', { class: 'rec-time', 'aria-live': 'polite', text: '0:00' });
  const hint = h('p', { class: 'muted small', text: 'El audio se guarda en el teléfono y se manda al servidor del equipo. No se transcribe.' });
  const btn = h('button', { class: 'btn primary big rec-btn', type: 'button', 'data-testid': 'recorder-toggle' }, icon('mic'), 'Grabar');
  let tick: number | undefined;
  const reset = () => {
    clearInterval(tick);
    recording = undefined;
    btn.classList.remove('on');
    btn.replaceChildren(icon('mic'), 'Grabar');
  };
  btn.addEventListener('click', async () => {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      recording = await startRecording((blob, ms) => {
        reset();
        if (!blob) return toast('No se grabó nada.');
        sheet.close();
        onSaved(blob, ms);
      });
    } catch (e) {
      reset();
      toast(micErrorMessage(e));
      return;
    }
    const started = recording.startedAt;
    btn.classList.add('on');
    btn.replaceChildren(icon('stop'), 'Terminar y guardar');
    tick = window.setInterval(() => (time.textContent = durationLabel(Date.now() - started)), 250);
  });
  sheet.body.append(time, btn, hint);
}
