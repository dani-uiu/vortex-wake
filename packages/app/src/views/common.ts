import { ENTRY_KIND_LABELS, MARK_LABELS, SECTION_LABELS, isUnclassified, matchRow, type Entry } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { targetLabel } from '../classify.ts';
import { h, icon, timeOf } from '../ui.ts';
import { annotationsToMarks, markedImage } from './marks.ts';

/** Indicador de sincronización: "guardado en este teléfono" / "enviado". */
/**
 * Indicador de sincronización. Con `quiet`, cuando todo está enviado se
 * reduce a una marca discreta; solo llama la atención si hay pendientes o error.
 */
export function syncBadge(app: App, quiet = false): HTMLElement {
  const s = app.sync;
  let cls = 'ok';
  let text = 'Todo enviado';
  let ic: Parameters<typeof icon>[0] = 'cloud';
  if (s.unauthorized) {
    cls = 'bad';
    text = 'Clave incorrecta: vuelve a escanear el QR';
    ic = 'alert';
  } else if (s.online === false) {
    cls = 'warn';
    text = s.pending > 0 ? `Sin conexión · ${s.pending} guardado(s) en este teléfono` : app.hosted ? 'Sin conexión' : 'Sin conexión con la laptop';
    ic = 'phone';
  } else if (s.lastError) {
    cls = 'bad';
    text = `${s.pending} sin enviar: ${s.lastError}`;
    ic = 'alert';
  } else if (s.pending > 0) {
    cls = 'warn';
    text = `Enviando… ${s.pending} en este teléfono`;
    ic = 'phone';
  } else if (s.online === undefined) {
    cls = 'warn';
    text = 'Conectando…';
    ic = 'phone';
  }
  const attrs = { 'data-testid': 'sync', 'data-pending': String(s.pending), 'data-online': String(s.online), 'data-state': cls };
  if (quiet && cls === 'ok') return h('div', { ...attrs, class: 'sync-quiet', role: 'status' }, icon('cloud', 'icon sm'), h('span', { text: 'Enviado' }));
  return h('div', { ...attrs, class: `sync ${cls}`, role: 'status' }, icon(ic), h('span', { text }));
}

export function statusPill(app: App, e: Entry, compact = false): HTMLElement {
  const st = app.entryStatus(e);
  // En la lista del celular, "Enviado" es solo un ícono: lo normal no ocupa espacio.
  if (st === 'sent' && compact) return h('span', { class: 'pill sent quiet', 'data-status': 'sent', title: 'Enviado', 'aria-label': 'Enviado', role: 'img' }, icon('cloud', 'icon sm'));
  if (st === 'sent') return h('span', { class: 'pill sent', 'data-status': 'sent' }, icon('cloud', 'icon sm'), 'Enviado');
  if (st === 'error') return h('span', { class: 'pill bad', 'data-status': 'error' }, icon('alert', 'icon sm'), 'Error al enviar');
  return h('span', { class: 'pill local', 'data-status': 'local' }, icon('phone', 'icon sm'), 'En este teléfono');
}

export function entrySummary(e: Entry): string {
  const parts: string[] = [];
  for (const el of e.elements) {
    if (el.type === 'text' && el.text.trim()) parts.push(el.text.trim());
    else if (el.type === 'link' && el.url.trim()) parts.push(el.title?.trim() || el.url.trim());
    else if (el.type === 'list') parts.push(el.items.filter((i) => i.trim()).join(', '));
    else if (el.type === 'trials' && el.trials.length > 0) parts.push(`Prueba: ${el.trials.filter((t) => t.ok).length} de ${el.trials.length}`);
    else if (el.type === 'table') parts.push(`Tabla (${el.rows.length} filas)`);
    else if (el.type === 'photo') {
      if (el.caption?.trim()) parts.push(el.caption.trim());
      // Fotos anotadas: las letras con lo que son, para reconocerlas en la lista.
      const labels = (el.annotations ?? []).flatMap((a) => (a.type === 'label' ? [`${a.letter}${a.what?.trim() ? ` ${a.what.trim()}` : ''}`] : []));
      if (labels.length > 0) parts.push(labels.join(', '));
    }
    else if (el.type === 'devicemap') parts.push(`${el.kind === 'ports' ? 'Mapa de puertos' : 'Mapa del control'} (${Object.values(el.slots).filter((v) => v.trim()).length})`);
    else if (el.type === 'audio') parts.push(el.caption?.trim() || `Nota de voz${el.durationMs ? ` (${Math.floor(el.durationMs / 60000)}:${String(Math.round((el.durationMs % 60000) / 1000) % 60).padStart(2, '0')})` : ''}`);
    else if (el.type === 'route') parts.push(`Ruta del autónomo: ${el.points.length} paso(s)`);
    else if (el.type === 'match') parts.push(['Partido', ...matchRow(el).slice(0, 3)].filter((s) => s).join(' · '));
  }
  return parts.join(' · ');
}

/** Tarjeta de una entrada. `phone`: lista del celular (pocas etiquetas); `desk`: computadora (clasificación completa). */
export function entryCard(app: App, e: Entry, onOpen: (id: string) => void, variant: 'phone' | 'desk' = 'phone'): HTMLElement {
  const compact = variant === 'phone';
  const photos = e.elements.filter((el) => el.type === 'photo');
  const thumb = h('div', { class: 'thumb' });
  const first = photos[0];
  if (first && first.type === 'photo') {
    thumb.append(markedImage(app.photoUrl(first.photoId), annotationsToMarks(first.annotations), { fit: 'cover' }));
    if (photos.length > 1) thumb.append(h('span', { class: 'count', text: `+${photos.length - 1}` }));
  } else {
    const kindIcon = e.elements.some((x) => x.type === 'trials') ? 'trials' : e.elements.some((x) => x.type === 'link') ? 'link' : e.elements.some((x) => x.type === 'audio') ? 'mic' : 'text';
    thumb.append(icon(kindIcon));
  }
  const chips: HTMLElement[] = [];
  if (compact) {
    // Celular: solo lo que ayuda a reconocer la entrada.
    if (isUnclassified(e)) chips.push(h('span', { class: 'tag todo', text: 'Sin clasificar' }));
    if (e.kind) chips.push(h('span', { class: 'tag', text: ENTRY_KIND_LABELS[e.kind] }));
    const target = targetLabel(app.team?.robots ?? [], e.robotId, e.subsystem);
    if (target) chips.push(h('span', { class: 'tag', text: target }));
    if (e.marks.includes('milestone')) chips.push(h('span', { class: 'tag mark', text: MARK_LABELS.milestone }));
  } else {
    // Computadora: todo a la vista, para revisar sin abrir.
    if (isUnclassified(e)) chips.push(h('span', { class: 'tag todo', text: 'Sin clasificar' }));
    if (e.kind) chips.push(h('span', { class: 'tag', text: ENTRY_KIND_LABELS[e.kind] }));
    if (e.section) chips.push(h('span', { class: 'tag', text: SECTION_LABELS[e.section] }));
    const target = targetLabel(app.team?.robots ?? [], e.robotId, e.subsystem);
    if (target) chips.push(h('span', { class: 'tag', text: target }));
    for (const m of e.marks) if (m !== 'normal') chips.push(h('span', { class: 'tag mark', text: MARK_LABELS[m] }));
    if (e.thread && e.thread !== target) chips.push(h('span', { class: 'tag thread', text: `Hilo: ${e.thread}` }));
  }
  const summary = entrySummary(e);
  const authors = e.authorIds.map((id) => app.memberName(id)).join(', ');
  return h(
    'button',
    { class: `card card-${variant}${isUnclassified(e) ? ' todo' : ''}`, type: 'button', 'data-entry': e.id, onclick: () => onOpen(e.id) },
    thumb,
    h(
      'div',
      { class: 'card-body' },
      h('div', { class: 'card-top' }, h('span', { class: 'time', text: timeOf(e.createdAt) }), statusPill(app, e, true)),
      summary ? h('div', { class: 'summary', text: summary }) : h('div', { class: 'summary muted', text: photos.length > 0 ? (photos.every((p) => p.type === 'photo' && p.sketch) ? 'Boceto' : photos.length === 1 ? 'Foto' : `${photos.length} fotos`) : 'Vacía' }),
      chips.length > 0 ? h('div', { class: 'tags' }, chips) : null,
      authors ? h('div', { class: 'authors muted', text: authors }) : null,
    ),
  );
}

/** Botón que abre la cámara con un toque (o la galería). */
export function photoButton(label: string, opts: { camera: boolean; cls: string; onFiles: (files: File[]) => void; testid?: string }): HTMLElement {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'file-input', 'data-testid': opts.testid, multiple: !opts.camera });
  if (opts.camera) input.setAttribute('capture', 'environment');
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) opts.onFiles(files);
  });
  return h('label', { class: opts.cls }, input, icon(opts.camera ? 'camera' : 'gallery'), h('span', { text: label }));
}
