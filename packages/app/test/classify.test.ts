import { describe, expect, it } from 'vitest';
import { ENTRY_KINDS, PAGE_TYPES, type Entry } from '@vortex-wake/shared';
import { WHAT_OPTIONS, applyWhat, autoThread, setTarget, whatOf } from '../src/classify.ts';

const robots = [
  { id: 'robot-a', name: 'Robot A', subsystems: ['chasis', 'intake'] },
  { id: 'robot-b', name: 'Robot B', subsystems: ['intake'] },
];

const entry = (extra: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  sessionDate: '2026-11-12',
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  authorIds: [],
  marks: [],
  elements: [],
  ...extra,
});

describe('"¿Qué fue?"', () => {
  it('cada opción usa secciones que la plantilla sí trae para su tipo', () => {
    for (const o of WHAT_OPTIONS) {
      const allowed = PAGE_TYPES[o.kind].sections;
      for (const s of o.sections) expect(allowed ?? [s], `${o.id} → ${s}`).toContain(s);
      for (const k of o.also ?? []) for (const s of o.sections) expect(PAGE_TYPES[k].sections ?? [s], `${o.id} (${k}) → ${s}`).toContain(s);
    }
  });

  it('todo tipo de entrada se muestra como alguna opción', () => {
    for (const k of ENTRY_KINDS) expect(whatOf(k), k).toBeDefined();
  });

  it('deduce la sección y respeta la que ya sirve', () => {
    const code = WHAT_OPTIONS.find((o) => o.id === 'code')!;
    const test = WHAT_OPTIONS.find((o) => o.id === 'test')!;
    const build = WHAT_OPTIONS.find((o) => o.id === 'build')!;
    const e = entry();
    applyWhat(e, code);
    expect([e.kind, e.section]).toEqual(['codeDoc', 'coding']);
    applyWhat(e, test);
    expect([e.kind, e.section]).toEqual(['test', 'coding']);
    applyWhat(e, build);
    expect([e.kind, e.section]).toEqual(['buildIteration', 'mechanics']);
  });

  it('no pisa un tipo fino equivalente (Mecanismo dentro de "Construimos")', () => {
    const e = entry({ kind: 'mechanism', section: 'mechanics' });
    applyWhat(e, WHAT_OPTIONS.find((o) => o.id === 'build')!);
    expect(e.kind).toBe('mechanism');
  });
});

describe('"¿De qué es?" y el hilo', () => {
  it('propone el hilo robot + subsistema y lo actualiza mientras no se escriba a mano', () => {
    const e = entry();
    setTarget(e, robots, 'robot-a', 'intake');
    expect(e.thread).toBe('Robot A · intake');
    setTarget(e, robots, 'robot-b', 'intake');
    expect(e.thread).toBe('Robot B · intake');
    setTarget(e, robots, 'robot-b');
    expect(e.thread).toBeUndefined();
    expect(autoThread(robots, 'robot-a')).toBeUndefined();
  });

  it('respeta un hilo escrito a mano', () => {
    const e = entry({ thread: 'intake v2' });
    setTarget(e, robots, 'robot-a', 'intake');
    expect(e.thread).toBe('intake v2');
    setTarget(e, robots);
    expect(e.robotId).toBeUndefined();
    expect(e.thread).toBe('intake v2');
  });
});
