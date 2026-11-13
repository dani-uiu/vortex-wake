/**
 * Almacén en archivos legibles dentro de `data/`:
 *
 *   data/team.json              equipo (si no existe, se usa el ejemplo)
 *   data/server.json            clave del equipo
 *   data/sessions/AAAA-MM-DD.json
 *   data/entries/<id>.json
 *   data/photos/<id>.jpg
 *   data/tasks/<id>.json        pendientes entre sesiones
 *
 * Todo se carga en memoria al arrancar y se escribe al instante (archivo
 * temporal + renombrar, para no dejar un JSON a medias si se apaga la laptop).
 * Las operaciones son síncronas: Node atiende una a la vez, así que leer,
 * mezclar y escribir no se cruza entre dos teléfonos.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptySession,
  mergeAttendance,
  mergeClosing,
  mergeEntry,
  mergeTask,
  type TaskItem,
  type Attendance,
  type CaptureSession,
  type Entry,
  type PutEntryResponse,
  type SessionClosing,
  type TeamConfig,
} from '@vortex-wake/shared';

export class FileStore {
  readonly dir: string;
  private readonly exampleTeam: string;
  team: TeamConfig;
  teamFromExample: boolean;
  readonly sessions = new Map<string, CaptureSession>();
  readonly entries = new Map<string, Entry>();

  constructor(dir: string, exampleTeamPath: string) {
    this.dir = dir;
    this.exampleTeam = exampleTeamPath;
    for (const sub of ['', 'sessions', 'entries', 'photos', 'tasks']) mkdirSync(join(dir, sub), { recursive: true });
    const teamPath = join(dir, 'team.json');
    this.teamFromExample = !existsSync(teamPath);
    this.team = JSON.parse(readFileSync(this.teamFromExample ? this.exampleTeam : teamPath, 'utf8')) as TeamConfig;
    for (const f of readdirSync(join(dir, 'sessions')).filter((n) => n.endsWith('.json'))) {
      const s = readJson<CaptureSession>(join(dir, 'sessions', f));
      if (s) this.sessions.set(s.date, s);
    }
    for (const f of readdirSync(join(dir, 'entries')).filter((n) => n.endsWith('.json'))) {
      const e = readJson<Entry>(join(dir, 'entries', f));
      if (e) this.entries.set(e.id, e);
    }
    for (const f of readdirSync(join(dir, 'tasks')).filter((n) => n.endsWith('.json'))) {
      const t = readJson<TaskItem>(join(dir, 'tasks', f));
      if (t) this.tasks.set(t.id, t);
    }
  }

  readonly tasks = new Map<string, TaskItem>();

  /** Pendientes: gana el más reciente (como las entradas). */
  putTask(task: TaskItem): { applied: boolean; task: TaskItem } {
    const r = mergeTask(this.tasks.get(task.id), task);
    if (r.applied) {
      this.tasks.set(task.id, task);
      writeAtomic(join(this.dir, 'tasks', `${task.id}.json`), JSON.stringify(task, null, 2));
    }
    return r;
  }

  /** Clave del equipo: la de `data/server.json`, o una nueva. */
  teamKey(fromEnv?: string): string {
    if (fromEnv) return fromEnv;
    const p = join(this.dir, 'server.json');
    const cfg = readJson<{ teamKey?: string }>(p) ?? {};
    if (cfg.teamKey) return cfg.teamKey;
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const key = [...bytes].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
    writeAtomic(p, JSON.stringify({ ...cfg, teamKey: key }, null, 2));
    return key;
  }

  setTeam(team: TeamConfig): void {
    this.team = team;
    this.teamFromExample = false;
    writeAtomic(join(this.dir, 'team.json'), JSON.stringify(team, null, 2));
  }

  putEntry(entry: Entry): PutEntryResponse {
    const r = mergeEntry(this.entries.get(entry.id), entry);
    if (r.applied) {
      this.entries.set(entry.id, entry);
      writeAtomic(join(this.dir, 'entries', `${entry.id}.json`), JSON.stringify(entry, null, 2));
      this.ensureSession(entry.sessionDate);
    }
    return r;
  }

  private ensureSession(date: string): CaptureSession {
    let s = this.sessions.get(date);
    if (!s) {
      s = emptySession(date);
      this.saveSession(s);
    }
    return s;
  }

  private saveSession(s: CaptureSession): void {
    this.sessions.set(s.date, s);
    writeAtomic(join(this.dir, 'sessions', `${s.date}.json`), JSON.stringify(s, null, 2));
  }

  attend(date: string, a: Attendance): CaptureSession {
    const before = this.ensureSession(date);
    const after = mergeAttendance(before, a);
    if (after !== before) this.saveSession(after);
    return after;
  }

  close(date: string, c: SessionClosing): { session: CaptureSession; applied: boolean } {
    const r = mergeClosing(this.ensureSession(date), c);
    if (r.applied) this.saveSession(r.session);
    return r;
  }

  photoPath(id: string): string {
    return join(this.dir, 'photos', `${id}.jpg`);
  }

  /** Las fotos no cambian: si ya existe, no se reescribe. */
  putPhoto(id: string, bytes: Uint8Array): boolean {
    const p = this.photoPath(id);
    if (existsSync(p)) return false;
    writeAtomic(p, bytes);
    return true;
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function writeAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
