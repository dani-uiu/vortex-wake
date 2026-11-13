/**
 * Sube al Worker lo capturado con el servidor local (carpeta data/): equipo,
 * fotos, asistencia, cierres y entradas. Se puede correr las veces que sea:
 * usa el mismo contrato que la app (ids del cliente, fotos inmutables, gana la
 * edición más reciente, la asistencia se junta), así que repetir no duplica
 * nada ni pisa lo que se haya editado después en la nube.
 *
 *   npm run nube:subir-datos -- --url https://vortex-wake.<tu-subdominio>.workers.dev
 *   npm run nube:subir-datos -- --local              (simulador: http://localhost:8787)
 *
 * Opciones: --datos <carpeta> (por defecto data/), --simular (solo revisa y
 * cuenta, no manda nada).
 *
 * La clave de edición se toma de la variable VW_CLAVE_EDICION o se pregunta
 * (sin mostrarla en pantalla). Nunca se pasa como argumento, para que no quede
 * en el historial de la terminal.
 *
 * El equipo: se manda el de data/team.json; si en la nube hay integrantes o
 * robots que no están en ese archivo (por ejemplo, alguien se agregó desde su
 * teléfono), se conservan.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ID_PATTERN,
  TEAM_KEY_HEADER,
  apiPath,
  checkAttendance,
  checkClosing,
  checkEntry,
  checkTask,
  checkTeam,
  isJpegBytes,
  isValidDate,
  type TaskItem,
  type CaptureSession,
  type Entry,
  type PutEntryResponse,
  type PutPhotoResponse,
  type StateResponse,
  type TeamConfig,
} from '@vortex-wake/shared';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');

export interface UploadOptions {
  url: string;
  editKey: string;
  dataDir: string;
  dryRun?: boolean;
  log?: (msg: string) => void;
}

export interface UploadReport {
  team: 'sent' | 'missing' | 'skipped';
  photos: { created: number; existing: number };
  attendance: number;
  closings: { applied: number; kept: number };
  entries: { applied: number; kept: number };
  /** Archivos que no se pudieron leer o no pasan la validación (no se mandan). */
  invalid: string[];
  /** Lo que el servidor rechazó. */
  failed: string[];
}

class UploadError extends Error {}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function list(dir: string, ext: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : [];
}

/** El equipo local, más los integrantes y robots que solo existen en la nube. */
export function mergeTeams(local: TeamConfig, remote: TeamConfig | undefined): TeamConfig {
  if (!remote) return local;
  const members = [...local.members, ...remote.members.filter((m) => !local.members.some((x) => x.id === m.id))];
  const robots = [...local.robots, ...remote.robots.filter((r) => !local.robots.some((x) => x.id === r.id))];
  return { ...local, members, robots };
}

export async function uploadData(opts: UploadOptions): Promise<UploadReport> {
  const log = opts.log ?? console.log;
  const base = opts.url.replace(/\/+$/, '');
  const report: UploadReport = { team: 'missing', photos: { created: 0, existing: 0 }, attendance: 0, closings: { applied: 0, kept: 0 }, entries: { applied: 0, kept: 0 }, invalid: [], failed: [] };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, { ...init, headers: { [TEAM_KEY_HEADER]: opts.editKey, ...(init.headers ?? {}) } });
    } catch (e) {
      throw new UploadError(`no se pudo conectar con ${base} (${(e as Error).message})`);
    }
    if (res.status === 401) throw new UploadError('la clave no es válida para ese servidor');
    if (!res.ok) {
      const msg = await res.text().then((t) => {
        try {
          return (JSON.parse(t) as { error?: string }).error ?? t;
        } catch {
          return t;
        }
      });
      throw new Error(`${res.status}: ${msg}`);
    }
    return (await res.json()) as T;
  }
  const sendJson = <T>(path: string, method: string, body: unknown) => call<T>(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  // --- leer y validar todo antes de mandar nada ----------------------------------
  const dir = opts.dataDir;
  if (!existsSync(dir)) throw new UploadError(`no existe la carpeta de datos ${dir}`);

  let team: TeamConfig | undefined;
  const teamPath = join(dir, 'team.json');
  if (existsSync(teamPath)) {
    try {
      const t = readJson(teamPath);
      const err = checkTeam(t);
      if (err) report.invalid.push(`team.json: ${err}`);
      else team = t as TeamConfig;
    } catch (e) {
      report.invalid.push(`team.json: ${(e as Error).message}`);
    }
  }

  const photos: { id: string; file: string }[] = [];
  for (const f of list(join(dir, 'photos'), '.jpg')) {
    const id = basename(f, '.jpg');
    if (ID_PATTERN.test(id)) photos.push({ id, file: join(dir, 'photos', f) });
    else report.invalid.push(`photos/${f}: nombre inválido`);
  }

  const sessions: CaptureSession[] = [];
  for (const f of list(join(dir, 'sessions'), '.json')) {
    try {
      const s = readJson(join(dir, 'sessions', f)) as CaptureSession;
      const errs = [
        isValidDate(s?.date) && `${s.date}.json` === f ? undefined : 'fecha inválida',
        Array.isArray(s?.attendance) ? s.attendance.map(checkAttendance).find((x) => x) : 'falta la asistencia',
        s?.closing ? checkClosing(s.closing) : undefined,
      ].filter((x): x is string => !!x);
      if (errs.length > 0) report.invalid.push(`sessions/${f}: ${errs.join(', ')}`);
      else sessions.push(s);
    } catch (e) {
      report.invalid.push(`sessions/${f}: ${(e as Error).message}`);
    }
  }

  const entries: Entry[] = [];
  for (const f of list(join(dir, 'entries'), '.json')) {
    try {
      const e = readJson(join(dir, 'entries', f));
      const err = checkEntry(e);
      if (err) report.invalid.push(`entries/${f}: ${err}`);
      else entries.push(e as Entry);
    } catch (e) {
      report.invalid.push(`entries/${f}: ${(e as Error).message}`);
    }
  }

  log(`Datos en ${dir}: ${team ? `equipo (${team.members.length} integrantes), ` : 'sin team.json, '}${sessions.length} sesiones, ${entries.length} entradas, ${photos.length} fotos.`);
  for (const i of report.invalid) log(`  NO SE MANDA ${i}`);

  // --- revisar la clave --------------------------------------------------------------
  const state = await call<StateResponse>(apiPath.state());
  if (state.access && state.access !== 'edit') throw new UploadError('esa es la clave de captura; se necesita la clave de edición');
  log(`Servidor: ${base} (ya tiene ${state.entries.length} entradas y ${state.sessions.length} sesiones).`);
  if (opts.dryRun) {
    report.team = team ? 'skipped' : 'missing';
    log('Modo --simular: no se mandó nada.');
    return report;
  }

  // --- equipo ------------------------------------------------------------------------
  if (team) {
    const merged = mergeTeams(team, state.team);
    await sendJson(apiPath.team(), 'PUT', merged);
    report.team = 'sent';
    log(`Equipo: ${merged.members.length} integrantes, ${merged.robots.length} robots.`);
  }

  // --- fotos (antes que las entradas que las usan), de 4 en 4 ------------------------------
  let next = 0;
  const worker = async () => {
    while (next < photos.length) {
      const p = photos[next++] as { id: string; file: string };
      const bytes = new Uint8Array(readFileSync(p.file));
      if (!isJpegBytes(bytes)) {
        report.invalid.push(`photos/${p.id}.jpg: no es JPEG`);
        continue;
      }
      try {
        const r = await call<PutPhotoResponse>(apiPath.photo(p.id), { method: 'PUT', body: bytes, headers: { 'content-type': 'image/jpeg' } });
        if (r.created) report.photos.created++;
        else report.photos.existing++;
      } catch (e) {
        if (e instanceof UploadError) throw e;
        report.failed.push(`foto ${p.id}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  log(`Fotos: ${report.photos.created} nuevas, ${report.photos.existing} ya estaban.`);

  // --- sesiones: asistencia y cierre -------------------------------------------------
  for (const s of sessions) {
    for (const a of s.attendance) {
      try {
        await sendJson(apiPath.attendance(s.date), 'POST', { memberId: a.memberId, checkIn: a.checkIn });
        report.attendance++;
      } catch (e) {
        if (e instanceof UploadError) throw e;
        report.failed.push(`asistencia ${s.date} ${a.memberId}: ${(e as Error).message}`);
      }
    }
    if (s.closing) {
      try {
        const r = await sendJson<{ applied: boolean }>(apiPath.closing(s.date), 'PUT', s.closing);
        if (r.applied) report.closings.applied++;
        else report.closings.kept++;
      } catch (e) {
        if (e instanceof UploadError) throw e;
        report.failed.push(`cierre ${s.date}: ${(e as Error).message}`);
      }
    }
  }
  log(`Sesiones: ${sessions.length} (${report.attendance} registros de asistencia, ${report.closings.applied + report.closings.kept} cierres).`);

  // --- entradas ----------------------------------------------------------------------
  for (const e of entries) {
    try {
      const r = await sendJson<PutEntryResponse>(apiPath.entry(e.id), 'PUT', e);
      if (r.applied) report.entries.applied++;
      else report.entries.kept++;
    } catch (err) {
      if (err instanceof UploadError) throw err;
      report.failed.push(`entrada ${e.id}: ${(err as Error).message}`);
    }
  }
  log(`Entradas: ${report.entries.applied} enviadas (si ya estaban iguales no se duplican), ${report.entries.kept} ya tenían en la nube una versión más nueva (se quedó esa).`);

  // --- pendientes (data/tasks, si existe) -------------------------------------------
  let tasksSent = 0;
  for (const f of list(join(dir, 'tasks'), '.json')) {
    try {
      const t = readJson(join(dir, 'tasks', f));
      const err = checkTask(t);
      if (err) {
        report.invalid.push(`tasks/${f}: ${err}`);
        continue;
      }
      await sendJson(apiPath.task((t as TaskItem).id), 'PUT', t);
      tasksSent++;
    } catch (err) {
      if (err instanceof UploadError) throw err;
      report.failed.push(`pendiente ${f}: ${(err as Error).message}`);
    }
  }
  if (tasksSent > 0) log(`Pendientes: ${tasksSent} enviados.`);
  for (const f of report.failed) log(`  FALLÓ ${f}`);
  return report;
}

// --- línea de comandos ------------------------------------------------------------

async function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Sin terminal interactiva (por ejemplo, con la clave por tubería): se lee una línea.
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0]?.trim() ?? '';
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((done) => {
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          done(value.trim());
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = args.includes('--local') ? 'http://localhost:8787' : (arg('--url') ?? process.env.VW_URL);
  if (!url) {
    console.error('Falta a dónde subir: --url https://vortex-wake.<tu-subdominio>.workers.dev (o --local para el simulador).');
    process.exit(2);
  }
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    console.error('La dirección debe empezar con https:// (o ser http://localhost para el simulador): la clave no debe viajar sin cifrar.');
    process.exit(2);
  }
  const dataDir = resolve(arg('--datos') ?? process.env.VW_DATA_DIR ?? join(ROOT, 'data'));
  const editKey = process.env.VW_CLAVE_EDICION || (await askHidden('Clave de edición (no se muestra): '));
  if (!editKey) {
    console.error('Falta la clave de edición.');
    process.exit(2);
  }
  try {
    const dryRun = args.includes('--simular');
    const r = await uploadData({ url, editKey, dataDir, dryRun });
    const problems = r.invalid.length + r.failed.length;
    console.log(dryRun ? `Revisión terminada: ${problems} problema(s).` : problems === 0 ? 'Listo: todo subido.' : `Terminó con ${problems} problema(s) (ver arriba). Se puede volver a correr.`);
    process.exit(r.failed.length > 0 ? 1 : 0);
  } catch (e) {
    console.error(`No se pudo subir: ${(e as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
