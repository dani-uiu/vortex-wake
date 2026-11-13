/**
 * Pendientes en el inicio del celular: lo que quedó en "¿Qué sigue?" de
 * sesiones anteriores y lo agregado a mano. Marcar como hecho (queda quién y
 * cuándo), posponer a la próxima sesión, quitar y agregar. Todo se guarda en
 * el teléfono y se manda con la cola, como las entradas.
 */

import type { TaskItem } from '@vortex-wake/shared';
import type { App } from '../app.ts';
import { dateLabel, h, icon, openSheet, setChildren, timeOf, toast } from '../ui.ts';

let open = true;

export function tasksBlock(app: App): HTMLElement | null {
  const list = app.visibleTasks();
  if (list.length === 0) return null;
  const pending = list.filter((t) => !t.done).length;
  const details = h(
    'details',
    { class: 'tasks', 'data-testid': 'tasks', open },
    h(
      'summary',
      {},
      h('span', { class: 'sum-text' }, h('span', { class: 'more-title', text: 'Pendientes' }), h('span', { class: 'sum-sub', text: pending > 0 ? `${pending} por hacer${list.length > pending ? ` · ${list.length - pending} hecho(s) hoy` : ''}` : 'Todo hecho' })),
    ),
    h('ul', { class: 'task-list' }, list.map((t) => taskRow(app, t))),
    h('button', { class: 'btn-text', type: 'button', 'data-testid': 'task-add', onclick: () => openAddTask(app) }, icon('plus', 'icon sm'), 'Agregar pendiente'),
  );
  details.addEventListener('toggle', () => (open = details.open));
  return details;
}

function taskRow(app: App, t: TaskItem): HTMLElement {
  const done = !!t.done;
  const who = t.done?.by ? app.memberName(t.done.by).split(' ')[0] : '';
  return h(
    'li',
    { class: `task ${done ? 'done' : ''}`, 'data-task': t.id },
    h(
      'button',
      {
        class: 'task-check',
        type: 'button',
        role: 'checkbox',
        'aria-checked': String(done),
        'aria-label': done ? `Marcar "${t.text}" como no hecho` : `Marcar "${t.text}" como hecho`,
        onclick: () => void app.setTaskDone(t.id, !done).then(() => toast(done ? 'Pendiente reabierto' : 'Pendiente hecho')),
      },
      done ? icon('check', 'icon sm') : null,
    ),
    h(
      'button',
      { class: 'task-text', type: 'button', 'aria-haspopup': 'dialog', onclick: () => openTask(app, t) },
      h('span', { class: 'task-title', text: t.text }),
      h('span', { class: 'sum-sub', text: done ? `Hecho${who ? ` por ${who}` : ''} · ${timeOf(t.done?.at ?? '')}` : origin(t) }),
    ),
  );
}

function origin(t: TaskItem): string {
  return t.source === 'closing' ? `Del cierre del ${dateLabel(t.fromDate)}` : `Agregado el ${dateLabel(t.fromDate)}`;
}

function openTask(app: App, t: TaskItem): void {
  const sheet = openSheet('Pendiente', 'sheet-task');
  const act = (label: string, ic: Parameters<typeof icon>[0], testid: string, run: () => Promise<void>, msg: string) =>
    h('button', { class: 'sheet-item', type: 'button', 'data-testid': testid, onclick: () => (sheet.close(), void run().then(() => toast(msg))) }, icon(ic), h('span', { text: label }));
  sheet.body.append(
    h('div', { class: 'task-detail' }, h('p', { class: 'task-title', text: t.text }), h('p', { class: 'muted small', text: origin(t) + (t.createdBy ? ` · ${app.memberName(t.createdBy)}` : '') })),
    h(
      'div',
      { class: 'sheet-list' },
      t.done ? act('Marcar como no hecho', 'undo', 'task-undone', () => app.setTaskDone(t.id, false), 'Pendiente reabierto') : act('Ya está hecho', 'check', 'task-done', () => app.setTaskDone(t.id, true), 'Pendiente hecho'),
      t.done ? null : act('Posponer a la próxima sesión', 'clock', 'task-snooze', () => app.snoozeTask(t.id), 'Pospuesto para la próxima sesión'),
      act('Ya no aplica (quitar)', 'trash', 'task-drop', () => app.dropTask(t.id), 'Pendiente quitado'),
    ),
  );
}

export function openAddTask(app: App): void {
  const sheet = openSheet('Agregar pendiente', 'sheet-task-add');
  const input = h('input', { type: 'text', placeholder: 'Ej. "Cambiar el engrane del brazo"', 'data-testid': 'task-text', enterkeyhint: 'done', autocomplete: 'off' });
  const add = () => {
    const v = input.value.trim();
    if (!v) return;
    sheet.close();
    void app.addTask(v).then(() => toast('Pendiente agregado'));
  };
  setChildren(
    sheet.body,
    h('form', { class: 'stack', onsubmit: (ev: Event) => (ev.preventDefault(), add()) }, input, h('button', { class: 'btn primary big', type: 'submit', 'data-testid': 'task-save' }, 'Agregar')),
  );
  requestAnimationFrame(() => input.focus());
}
