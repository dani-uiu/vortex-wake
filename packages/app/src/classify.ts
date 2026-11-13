/**
 * Clasificación simple de la captura: "¿De qué es?" (robot y subsistema) y
 * "¿Qué fue?" (pocas opciones en lenguaje llano). Cada opción de "¿Qué fue?"
 * se traduce a un tipo de entrada y una sección del modelo; el tipo exacto y
 * la sección se pueden cambiar después en "Más detalles" o en la vista de
 * computadora. No cambia el formato de los datos: solo escribe `kind`,
 * `section`, `robotId`, `subsystem` y `thread`, que ya existían.
 */

import { ENTRY_KIND_LABELS, SECTION_LABELS, type Entry, type EntryKind, type Robot, type SectionId } from '@vortex-wake/shared';

export type WhatId = 'build' | 'test' | 'ideas' | 'decision' | 'problem' | 'code' | 'wiring' | 'strategy' | 'other';

export interface WhatOption {
  id: WhatId;
  label: string;
  /** Tipo que se asigna al elegirla. */
  kind: EntryKind;
  /** Secciones válidas para ese tipo; la primera es la que se deduce. */
  sections: SectionId[];
  /** Otros tipos que también se muestran como esta opción (y que no se pisan al elegirla). */
  also?: EntryKind[];
}

export const WHAT_OPTIONS: WhatOption[] = [
  { id: 'build', label: 'Construimos o cambiamos algo', kind: 'buildIteration', sections: ['mechanics'], also: ['mechanism'] },
  { id: 'test', label: 'Probamos algo', kind: 'test', sections: ['mechanics', 'coding', 'strategy'] },
  { id: 'ideas', label: 'Tuvimos ideas', kind: 'brainstorm', sections: ['mechanics', 'coding', 'strategy'] },
  { id: 'decision', label: 'Decidimos algo', kind: 'decision', sections: ['mechanics', 'coding', 'wiring', 'strategy'] },
  { id: 'problem', label: 'Algo falló', kind: 'problem', sections: ['mechanics', 'coding'] },
  { id: 'code', label: 'Programamos', kind: 'codeDoc', sections: ['coding'] },
  { id: 'wiring', label: 'Cableamos', kind: 'wiringDoc', sections: ['wiring'] },
  { id: 'strategy', label: 'Estrategia o autónomo', kind: 'gameAnalysis', sections: ['strategy'], also: ['autonomousPlan'] },
  { id: 'other', label: 'Otra cosa', kind: 'dailyWork', sections: ['mechanics', 'coding', 'wiring', 'strategy'], also: ['reflection'] },
];

/** La opción de "¿Qué fue?" que corresponde al tipo de la entrada. */
export function whatOf(kind: EntryKind | undefined): WhatOption | undefined {
  if (!kind) return undefined;
  return WHAT_OPTIONS.find((o) => o.kind === kind || o.also?.includes(kind));
}

/**
 * Aplica una opción: pone el tipo (salvo que ya tenga uno equivalente, por
 * ejemplo "Mecanismo" dentro de "Construimos") y deduce la sección si la
 * actual no sirve para ese tipo.
 */
export function applyWhat(e: Entry, o: WhatOption): void {
  if (!e.kind || (e.kind !== o.kind && !o.also?.includes(e.kind))) e.kind = o.kind;
  if (!e.section || !o.sections.includes(e.section)) e.section = o.sections[0] as SectionId;
}

/** "Robot A · intake", "Robot A", "intake" o "" si no tiene nada. */
export function targetLabel(robots: Robot[], robotId?: string, subsystem?: string): string {
  const robot = robotId ? robots.find((r) => r.id === robotId)?.name ?? robotId : undefined;
  return [robot, subsystem].filter(Boolean).join(' · ');
}

/** Hilo que se propone solo: robot + subsistema (si no hay subsistema, ninguno). */
export function autoThread(robots: Robot[], robotId?: string, subsystem?: string): string | undefined {
  return subsystem ? targetLabel(robots, robotId, subsystem) : undefined;
}

/**
 * Cambia robot y subsistema. Si el hilo estaba vacío o era el que se propuso
 * solo, se actualiza; si alguien lo escribió a mano, se respeta.
 */
export function setTarget(e: Entry, robots: Robot[], robotId?: string, subsystem?: string): void {
  const before = autoThread(robots, e.robotId, e.subsystem);
  if (robotId) e.robotId = robotId;
  else delete e.robotId;
  if (subsystem) e.subsystem = subsystem;
  else delete e.subsystem;
  if (!e.thread || e.thread === before) {
    const t = autoThread(robots, robotId, subsystem);
    if (t) e.thread = t;
    else delete e.thread;
  }
}

/** Tipo y sección exactos, para mostrar debajo de "¿Qué fue?": "Prueba · Mecánica". */
export function exactLabel(e: Entry): string {
  return [e.kind ? ENTRY_KIND_LABELS[e.kind] : undefined, e.section ? SECTION_LABELS[e.section] : undefined].filter(Boolean).join(' · ');
}
