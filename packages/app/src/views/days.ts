/**
 * Días pasados en la captura (celular): un calendario para elegir el día y la
 * vista de ese día (asistencia, cierre y entradas).
 *
 * Las entradas de ayer se pueden corregir; las más viejas solo se ven (se
 * corrigen en la vista de computadora). Ver `canEditDay` en shared.
 */

import { canEditDay, daysBefore, nextDay, type DaySummary } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { dateLabel, h, icon, openSheet, setChildren } from '../ui.ts';
import { entryCard } from './common.ts';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Hash de un día: hoy es el inicio. */
export function dayHash(date: string, today: string): string {
  return date === today ? '#/' : `#/dia/${date}`;
}

/** Hoja con el calendario del mes; los días con algo capturado llevan una marca. */
export function openCalendar(app: App, go: (hash: string) => void, selected = app.today): void {
  const today = app.today;
  let month = selected.slice(0, 7);
  let summary = new Map<string, DaySummary>();
  let online = true;
  const sheet = openSheet('Días pasados', 'sheet-calendar');
  const box = h('div', { class: 'cal' });
  const note = h('p', { class: 'muted small', role: 'status' });
  sheet.body.append(box, note, h('p', { class: 'muted small', text: 'Las entradas de hoy y de ayer se pueden corregir; las de antes solo se ven.' }));

  const render = () => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // lunes primero
    const raw = first.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    const title = raw.charAt(0).toUpperCase() + raw.slice(1);
    const shift = (n: number) => {
      const d = new Date(y, m - 1 + n, 1);
      month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      render();
    };
    const cells: HTMLElement[] = [];
    for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'cal-empty' }));
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const s = summary.get(date);
      const future = date > today;
      const label = `${dateLabel(date)}${s ? `: ${s.entries} entrada(s)${s.present ? `, ${s.present} presente(s)` : ''}` : ''}`;
      cells.push(
        h(
          'button',
          {
            class: `cal-day ${s ? 'has' : ''} ${date === today ? 'today' : ''} ${date === selected ? 'on' : ''}`,
            type: 'button',
            disabled: future,
            'data-date': date,
            'aria-label': label,
            'aria-current': date === today ? 'date' : undefined,
            onclick: () => (sheet.close(), go(dayHash(date, today))),
          },
          h('span', { class: 'cal-n', text: String(d) }),
          s && s.entries > 0 ? h('span', { class: 'cal-count', text: String(s.entries) }) : s ? h('span', { class: 'cal-dot' }) : null,
        ),
      );
    }
    setChildren(
      box,
      h(
        'div',
        { class: 'cal-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mes anterior', 'data-testid': 'cal-prev', onclick: () => shift(-1) }, icon('left')),
        h('strong', { class: 'cal-title', text: title }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mes siguiente', 'data-testid': 'cal-next', disabled: month >= today.slice(0, 7), onclick: () => shift(1) }, icon('right')),
      ),
      h('div', { class: 'cal-grid', role: 'grid' }, ...WEEKDAYS.map((w) => h('span', { class: 'cal-wd', 'aria-hidden': 'true', text: w })), ...cells),
    );
    note.textContent = online ? 'El número es cuántas entradas hay ese día.' : 'Sin conexión: solo se marcan los días guardados en este teléfono.';
  };
  render();
  void app.daySummaries().then((r) => {
    summary = r.days;
    online = r.online;
    render();
  });
}

/** Un día pasado: asistencia, cierre y entradas. */
export function renderDay(root: HTMLElement, app: App, go: (hash: string) => void, date: string): () => void {
  const today = app.today;
  if (date >= today) {
    go('#/');
    return () => {};
  }
  const editable = canEditDay(date, today);
  let loading: 'loading' | 'ok' | 'offline' = 'loading';
  const header = h('header', { class: 'topbar day-top' });
  const info = h('div', { class: 'day-info' });
  const list = h('div', { class: 'list', 'data-testid': 'day-list' });
  root.replaceChildren(header, info, h('h2', { class: 'section-title', text: 'Entradas' }), list);

  const render = () => {
    const prev = daysBefore(date, 1);
    const next = nextDay(date);
    setChildren(
      header,
      h(
        'div',
        { class: 'topbar-row' },
        h('button', { class: 'back', type: 'button', 'data-testid': 'day-today', onclick: () => go('#/') }, icon('back'), 'Hoy'),
        h('button', { class: 'chip-btn', type: 'button', 'data-testid': 'open-calendar', onclick: () => openCalendar(app, go, date) }, icon('calendar', 'icon sm'), 'Calendario'),
      ),
      h(
        'div',
        { class: 'day-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Día anterior', 'data-testid': 'day-prev', onclick: () => go(dayHash(prev, today)) }, icon('left')),
        h('h1', { class: 'date', 'data-testid': 'day-title', text: dateLabel(date) }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Día siguiente', 'data-testid': 'day-next', onclick: () => go(dayHash(next, today)) }, icon('right')),
      ),
    );
    const session = app.session(date);
    const present = session.attendance.map((a) => app.memberName(a.memberId).split(' ')[0]);
    const c = session.closing;
    const closed = !!(c && (c.whatWeDid?.trim() || c.whatFailed?.trim() || c.whatsNext?.trim()));
    setChildren(
      info,
      h(
        'p',
        { class: `day-edit ${editable ? 'ok' : 'locked'}`, 'data-testid': 'day-edit', role: 'note' },
        icon(editable ? 'edit' : 'lock', 'icon sm'),
        editable ? 'Ayer: todavía puedes corregir sus entradas.' : 'Solo lectura: las entradas de hace más de un día se corrigen en la vista de computadora.',
      ),
      h('p', { class: 'muted', text: present.length > 0 ? `Presentes: ${present.join(', ')}` : 'Nadie registró asistencia.' }),
      closed && c
        ? h(
            'div',
            { class: 'day-closing' },
            h('span', { class: 'field-label', text: 'Cierre' }),
            c.whatWeDid?.trim() ? h('p', { text: c.whatWeDid.trim() }) : null,
            c.whatFailed?.trim() ? h('p', { class: 'muted', text: `Falló: ${c.whatFailed.trim()}` }) : null,
          )
        : null,
      h('button', { class: 'btn secondary', type: 'button', 'data-testid': 'day-closing', onclick: () => go(`#/cierre/${date}?desde=dia`) }, closed ? 'Ver o corregir el cierre' : 'Llenar el cierre'),
      loading === 'offline' ? h('p', { class: 'muted small', text: 'Sin conexión: se muestra lo guardado en este teléfono.' }) : null,
    );
    const entries = app.liveEntries(date);
    list.replaceChildren(
      ...(entries.length > 0
        ? entries.map((e) => entryCard(app, e, (id) => go(`#/entrada/${id}`), 'phone'))
        : [h('p', { class: 'empty muted', text: loading === 'loading' ? 'Cargando…' : 'No hay entradas de este día.' })]),
    );
  };
  render();
  void app.loadDay(date).then((ok) => {
    loading = ok ? 'ok' : 'offline';
    render();
  });
  return app.subscribe(render);
}
