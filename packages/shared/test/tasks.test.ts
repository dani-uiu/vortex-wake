import { describe, expect, it } from 'vitest';
import { checkTask, closingLines, closingTaskId, mergeTask, nextDay, tasksFromClosing, visibleTasks, type TaskItem } from '../src/index.ts';

const T0 = '2026-11-10T22:00:00.000Z';
const day = (iso: string) => iso.slice(0, 10);

describe('pendientes entre sesiones', () => {
  it('un renglón = un pendiente; sin viñetas ni repetidos', () => {
    expect(closingLines('- Probar el intake\n\n• Cambiar engrane\n2) Ajustar PID\nprobar el intake  ')).toEqual(['Probar el intake', 'Cambiar engrane', 'Ajustar PID']);
    expect(closingLines(undefined)).toEqual([]);
  });

  it('el id sale de la fecha y el texto: dos teléfonos no duplican', () => {
    expect(closingTaskId('2026-11-10', 'Probar el intake')).toBe(closingTaskId('2026-11-10', '  probar  el INTAKE'));
    expect(closingTaskId('2026-11-10', 'a')).not.toBe(closingTaskId('2026-11-11', 'a'));
    const a = tasksFromClosing('2026-11-10', 'Probar el intake\nCambiar engrane', [], T0, 'ana');
    const b = tasksFromClosing('2026-11-10', 'Probar el intake\nCambiar engrane', [], T0, 'beto');
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.every((t) => checkTask(t) === undefined)).toBe(true);
  });

  it('editar el cierre quita los renglones borrados (si no se hicieron) y no toca los demás', () => {
    const first = tasksFromClosing('2026-11-10', 'A\nB\nC', [], T0);
    const done = { ...(first[2] as TaskItem), done: { at: T0 } };
    const existing = [first[0] as TaskItem, first[1] as TaskItem, done];
    const second = tasksFromClosing('2026-11-10', 'A\nD', existing, '2026-11-10T23:00:00.000Z');
    expect(second.map((t) => [t.text, !!t.deleted])).toEqual([
      ['D', false],
      ['B', true],
    ]);
    // Si el renglón vuelve, el pendiente regresa.
    const third = tasksFromClosing('2026-11-10', 'A\nB', [...existing.slice(0, 1), second[1] as TaskItem], '2026-11-10T23:30:00.000Z');
    expect(third.find((t) => t.text === 'B')?.deleted).toBeUndefined();
  });

  it('qué se ve: lo de cierres anteriores, lo manual, sin pospuestos; lo hecho solo el día que se hizo', () => {
    const [a, b] = tasksFromClosing('2026-11-10', 'A\nB', [], T0) as [TaskItem, TaskItem];
    const today = '2026-11-12';
    const manual: TaskItem = { id: 'm-1', text: 'Manual', fromDate: today, source: 'manual', createdAt: '2026-11-12T15:00:00.000Z', updatedAt: '2026-11-12T15:00:00.000Z' };
    const fromToday = tasksFromClosing(today, 'Hoy', [], '2026-11-12T22:00:00.000Z');
    expect(visibleTasks([a, b, manual, ...fromToday], today, day).map((t) => t.text)).toEqual(['A', 'B', 'Manual']);
    const snoozed = { ...b, snoozedUntil: nextDay(today) };
    expect(visibleTasks([a, snoozed], today, day).map((t) => t.text)).toEqual(['A']);
    expect(visibleTasks([a, snoozed], nextDay(today), day).map((t) => t.text)).toEqual(['A', 'B']);
    const done = { ...a, done: { at: '2026-11-12T18:00:00.000Z', by: 'ana' } };
    expect(visibleTasks([done], today, day).length).toBe(1);
    expect(visibleTasks([done], nextDay(today), day).length).toBe(0);
  });

  it('mezcla por updatedAt y validación', () => {
    const [a] = tasksFromClosing('2026-11-10', 'A', [], T0) as [TaskItem];
    const newer = { ...a, done: { at: '2026-11-11T10:00:00.000Z' }, updatedAt: '2026-11-11T10:00:00.000Z' };
    expect(mergeTask(newer, a)).toEqual({ applied: false, task: newer });
    expect(mergeTask(a, newer).applied).toBe(true);
    expect(checkTask({ ...a, text: '' })).toBeDefined();
    expect(checkTask({ ...a, source: 'otro' })).toBeDefined();
    expect(checkTask({ ...a, done: { at: 'ayer' } })).toBe('done inválido');
  });
});
