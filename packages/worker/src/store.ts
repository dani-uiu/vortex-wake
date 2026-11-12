/**
 * Equipo, sesiones (asistencia y cierre) y entradas en D1.
 *
 * Las reglas de mezcla son las de `@vortex-wake/shared` (mergeEntry,
 * mergeAttendance, mergeClosing, addMemberToTeam): aquí solo se leen y se
 * escriben filas. Como dos teléfonos pueden mandar algo al mismo tiempo y D1
 * no tiene transacciones interactivas, cada escritura es "optimista": se lee
 * la fila con su `version`, se mezcla y se escribe solo si `version` no
 * cambió; si cambió, se vuelve a leer y a mezclar.
 */

import {
  TEAM_FORMAT,
  addMemberToTeam,
  emptySession,
  mergeAttendance,
  mergeClosing,
  mergeEntry,
  type Attendance,
  type CaptureSession,
  type Entry,
  type PutEntryResponse,
  type SessionClosing,
  type TeamConfig,
} from '@vortex-wake/shared';

const MAX_TRIES = 30;

/** Espera corta y al azar antes de reintentar, para que dos escrituras no choquen otra vez. */
function backoff(i: number): Promise<void> {
  return i === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, Math.random() * Math.min(200, 10 * i)));
}

/** Equipo vacío hasta que se suba el real (`npm run nube:subir-datos`) o se agregue gente desde la app. */
export function emptyTeam(): TeamConfig {
  return { format: TEAM_FORMAT, version: 1, team: { name: 'Equipo' }, members: [], robots: [] };
}

export class ConflictError extends Error {}

interface Row {
  json: string;
  version: number;
}

export class D1Store {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  // --- equipo ---------------------------------------------------------------------

  private async teamRow(): Promise<Row | null> {
    return this.db.prepare('SELECT json, version FROM team WHERE id = 1').first<Row>();
  }

  async team(): Promise<TeamConfig> {
    const row = await this.teamRow();
    return row ? (JSON.parse(row.json) as TeamConfig) : emptyTeam();
  }

  /** Reemplaza el equipo completo (vista de computadora o subida de datos). */
  async setTeam(team: TeamConfig): Promise<TeamConfig> {
    await this.db
      .prepare('INSERT INTO team (id, json, version) VALUES (1, ?1, 1) ON CONFLICT (id) DO UPDATE SET json = excluded.json, version = team.version + 1')
      .bind(JSON.stringify(team))
      .run();
    return team;
  }

  async addMember(body: unknown): Promise<{ team: TeamConfig } | { error: string }> {
    for (let i = 0; i < MAX_TRIES; i++) {
      await backoff(i);
      const row = await this.teamRow();
      const current = row ? (JSON.parse(row.json) as TeamConfig) : emptyTeam();
      const r = addMemberToTeam(current, body);
      if ('error' in r) return r;
      if (!r.changed) return { team: current };
      if (await this.writeRow('team', 'id', 1, row, JSON.stringify(r.team))) return { team: r.team };
    }
    throw new ConflictError('demasiados cambios al mismo tiempo; intenta de nuevo');
  }

  // --- sesiones -------------------------------------------------------------------

  private async sessionRow(date: string): Promise<Row | null> {
    return this.db.prepare('SELECT json, version FROM sessions WHERE date = ?1').bind(date).first<Row>();
  }

  private async updateSession(date: string, fn: (s: CaptureSession) => CaptureSession): Promise<CaptureSession> {
    for (let i = 0; i < MAX_TRIES; i++) {
      await backoff(i);
      const row = await this.sessionRow(date);
      const before = row ? (JSON.parse(row.json) as CaptureSession) : emptySession(date);
      const after = fn(before);
      if (row && after === before) return before;
      if (await this.writeRow('sessions', 'date', date, row, JSON.stringify(after))) return after;
    }
    throw new ConflictError('demasiados cambios al mismo tiempo; intenta de nuevo');
  }

  attend(date: string, a: Attendance): Promise<CaptureSession> {
    return this.updateSession(date, (s) => mergeAttendance(s, a));
  }

  async close(date: string, c: SessionClosing): Promise<{ session: CaptureSession; applied: boolean }> {
    let applied = false;
    const session = await this.updateSession(date, (s) => {
      const r = mergeClosing(s, c);
      applied = r.applied;
      return r.applied ? r.session : s;
    });
    return { session, applied };
  }

  // --- entradas -------------------------------------------------------------------

  async putEntry(entry: Entry): Promise<PutEntryResponse> {
    for (let i = 0; i < MAX_TRIES; i++) {
      await backoff(i);
      const row = await this.db.prepare('SELECT json, version FROM entries WHERE id = ?1').bind(entry.id).first<Row>();
      const r = mergeEntry(row ? (JSON.parse(row.json) as Entry) : undefined, entry);
      if (!r.applied) return r;
      const json = JSON.stringify(entry);
      const write = row
        ? this.db
            .prepare('UPDATE entries SET json = ?1, updated_at = ?2, session_date = ?3, version = version + 1 WHERE id = ?4 AND version = ?5')
            .bind(json, entry.updatedAt, entry.sessionDate, entry.id, row.version)
        : this.db
            .prepare('INSERT INTO entries (id, session_date, updated_at, json, version) VALUES (?1, ?2, ?3, ?4, 1) ON CONFLICT (id) DO NOTHING')
            .bind(entry.id, entry.sessionDate, entry.updatedAt, json);
      // La sesión del día existe en cuanto llega una entrada (como en el servidor local).
      const ensureSession = this.db
        .prepare('INSERT INTO sessions (date, json, version) VALUES (?1, ?2, 1) ON CONFLICT (date) DO NOTHING')
        .bind(entry.sessionDate, JSON.stringify(emptySession(entry.sessionDate)));
      const [res] = await this.db.batch([write, ensureSession]);
      if (res?.meta.changes === 1) return r;
    }
    throw new ConflictError('demasiados cambios al mismo tiempo; intenta de nuevo');
  }

  // --- estado ---------------------------------------------------------------------

  /**
   * Sesiones y entradas como texto JSON (una lista), uniendo las filas tal
   * como se guardaron: sin volver a leer ni a escribir cada objeto. La vista
   * de computadora pide todo, y el plan gratuito da 10 ms de CPU por petición.
   * (Cada fila ya se validó al entrar y se guardó con JSON.stringify.)
   */
  async sessionsJson(date?: string): Promise<string> {
    const q = date
      ? this.db.prepare('SELECT json FROM sessions WHERE date = ?1 ORDER BY date').bind(date)
      : this.db.prepare('SELECT json FROM sessions ORDER BY date');
    const { results } = await q.all<{ json: string }>();
    return `[${results.map((r) => r.json).join(',')}]`;
  }

  async entriesJson(date?: string): Promise<string> {
    const q = date
      ? this.db.prepare('SELECT json FROM entries WHERE session_date = ?1').bind(date)
      : this.db.prepare('SELECT json FROM entries');
    const { results } = await q.all<{ json: string }>();
    return `[${results.map((r) => r.json).join(',')}]`;
  }

  async teamJson(): Promise<string> {
    const row = await this.teamRow();
    return row ? row.json : JSON.stringify(emptyTeam());
  }

  // --- utilidades -----------------------------------------------------------------

  /** Escribe solo si la fila sigue en la versión leída (o si sigue sin existir). */
  private async writeRow(table: 'team' | 'sessions', keyCol: 'id' | 'date', key: string | number, row: Row | null, json: string): Promise<boolean> {
    const res = row
      ? await this.db.prepare(`UPDATE ${table} SET json = ?1, version = version + 1 WHERE ${keyCol} = ?2 AND version = ?3`).bind(json, key, row.version).run()
      : await this.db.prepare(`INSERT INTO ${table} (${keyCol}, json, version) VALUES (?1, ?2, 1) ON CONFLICT (${keyCol}) DO NOTHING`).bind(key, json).run();
    return res.meta.changes === 1;
  }
}
