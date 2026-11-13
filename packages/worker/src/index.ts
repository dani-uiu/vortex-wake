/**
 * Worker de Vortex Wake: el mismo contrato HTTP que el servidor local
 * (`@vortex-wake/shared`, api.ts) con D1 (equipo, sesiones y entradas) y R2
 * (fotos), y la app compilada como archivos estáticos.
 *
 * Todas las peticiones pasan primero por aquí (`run_worker_first`), para que
 * todas lleven las cabeceras de seguridad y nada privado se sirva sin clave.
 */

import qrcode from 'qrcode-generator';
import {
  API_VERSION,
  ID_PATTERN,
  MAX_JSON_BYTES,
  MAX_AUDIO_BYTES,
  MAX_PHOTO_BYTES,
  TEAM_KEY_HEADER,
  audioType,
  TEAM_KEY_QUERY,
  RECENT_SESSION_DAYS,
  CAPTURE_EDIT_EXPIRED,
  captureEditAllowed,
  daysBefore,
  type DaysResponse,
  checkAttendance,
  checkClosing,
  checkEntry,
  checkTask,
  checkTeam,
  isJpegBytes,
  isValidDate,
  type AccessLevel,
  type Attendance,
  type Entry,
  type QrResponse,
  type SessionClosing,
  type StateResponse,
  type TaskItem,
  type TeamConfig,
} from '@vortex-wake/shared';
import { accessFor, keysProblem } from './auth.ts';
import { HttpError, json, readBody, readJson, withSecurityHeaders } from './http.ts';
import { R2AudioStore, R2PhotoStore, type PhotoStore } from './photos.ts';
import { ConflictError, D1Store } from './store.ts';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  CAPTURE_KEY?: string;
  EDIT_KEY?: string;
}

/** Ruta (dentro de los archivos estáticos) de la plantilla; solo se entrega por /api/template con clave de edición. */
const TEMPLATE_ASSET = '/private/template.pptx';

/** Punto de extensión: aquí se cambia R2 por otro almacén de fotos (ver src/photos.ts). */
function photoStore(env: Env): PhotoStore {
  return new R2PhotoStore(env.PHOTOS);
}

const UNAUTHORIZED = 'clave del equipo incorrecta: vuelve a escanear el QR del taller';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) res = json(e.status, { error: e.message });
      else if (e instanceof ConflictError) res = json(409, { error: e.message });
      else {
        console.error(e);
        res = json(500, { error: 'error interno del servidor' });
      }
    }
    return withSecurityHeaders(res);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  const method = req.method;

  if (p === '/robots.txt') {
    return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
  }
  if (p === '/qr' || p === '/qr/') return Response.redirect(new URL('/#/qr', url).toString(), 302);
  if (p.startsWith('/api/')) return api(req, env, url);
  if (p.startsWith('/private/')) throw new HttpError(404, 'no existe');
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'método no permitido');
  return staticFile(req, env, p);
}

async function staticFile(req: Request, env: Env, p: string): Promise<Response> {
  const res = await env.ASSETS.fetch(req);
  if (res.status === 404) return new Response('No existe esta página.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const out = new Response(res.body, res);
  // Los archivos de assets/ llevan hash en el nombre: nunca cambian. Lo demás
  // (index.html, sw.js, manifiesto, íconos) se revisa siempre, para que una
  // versión nueva llegue en cuanto se publica.
  out.headers.set('cache-control', p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  return out;
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;
  const method = req.method;

  const problem = keysProblem(env);
  if (problem) {
    console.error(`Vortex Wake: ${problem}. Defínelos con "npx wrangler secret put" (ver packages/worker/README.md).`);
    throw new HttpError(503, 'el servicio todavía no está configurado');
  }

  // La clave va en el encabezado; solo las fotos (que se piden desde <img>)
  // aceptan `?k=`. Sin clave válida, toda ruta de /api responde igual: no se
  // puede saber qué rutas existen ni si una clave "casi" coincide.
  const fromQuery = method === 'GET' && /^\/api\/(photos|audio)\/[^/]+$/.test(p) ? url.searchParams.get(TEAM_KEY_QUERY) : null;
  const access = await accessFor(req.headers.get(TEAM_KEY_HEADER) ?? fromQuery, env);
  if (!access) throw new HttpError(401, UNAUTHORIZED);
  const needEdit = () => {
    if (access !== 'edit') throw new HttpError(403, 'esto necesita la clave de edición (la de la vista de computadora)');
  };

  const store = new D1Store(env.DB);

  if (method === 'GET' && p === '/api/state') return state(store, url, access);
  if (method === 'GET' && p === '/api/days') {
    const body: DaysResponse = { days: await store.daySummaries() };
    return json(200, body);
  }

  if (method === 'PUT' && p === '/api/team') {
    needEdit();
    const team = await readJson(req, MAX_JSON_BYTES);
    const err = checkTeam(team);
    if (err) throw new HttpError(400, err);
    return json(200, { team: await store.setTeam(team as TeamConfig) });
  }

  if (method === 'POST' && p === '/api/team/members') {
    const r = await store.addMember(await readJson(req, MAX_JSON_BYTES));
    if ('error' in r) throw new HttpError(400, r.error);
    return json(200, r);
  }

  let m = /^\/api\/entries\/([^/]+)$/.exec(p);
  if (m && method === 'PUT') {
    const entry = await readJson(req, MAX_JSON_BYTES);
    const err = checkEntry(entry);
    if (err) throw new HttpError(400, err);
    if ((entry as Entry).id !== safeDecode(m[1] as string)) throw new HttpError(400, 'el id no coincide con la ruta');
    // El celular corrige solo lo de hoy y ayer; lo demás, la vista de computadora.
    if (access === 'capture' && !captureEditAllowed(entry as Entry)) throw new HttpError(403, CAPTURE_EDIT_EXPIRED);
    return json(200, await store.putEntry(entry as Entry));
  }

  m = /^\/api\/tasks\/([^/]+)$/.exec(p);
  if (m && method === 'PUT') {
    const task = await readJson(req, MAX_JSON_BYTES);
    const err = checkTask(task);
    if (err) throw new HttpError(400, err);
    if ((task as TaskItem).id !== safeDecode(m[1] as string)) throw new HttpError(400, 'el id no coincide con la ruta');
    return json(200, await store.putTask(task as TaskItem));
  }

  m = /^\/api\/photos\/([^/]+)$/.exec(p);
  if (m) {
    const id = safeDecode(m[1] as string);
    if (!ID_PATTERN.test(id)) throw new HttpError(400, 'id de foto inválido');
    const photos = photoStore(env);
    if (method === 'PUT') {
      const bytes = await readBody(req, MAX_PHOTO_BYTES);
      if (!isJpegBytes(bytes)) throw new HttpError(400, 'la foto debe ser JPEG');
      // Las fotos no cambian: si ya existe, no se reescribe.
      const created = !(await photos.has(id));
      if (created) await photos.put(id, bytes);
      return json(200, { id, bytes: bytes.length, created });
    }
    if (method === 'GET') {
      const photo = await photos.get(id);
      if (!photo) throw new HttpError(404, 'no existe esa foto');
      return new Response(photo.body, {
        headers: { 'content-type': 'image/jpeg', 'content-length': String(photo.size), 'cache-control': 'private, max-age=31536000, immutable' },
      });
    }
  }

  m = /^\/api\/audio\/([^/]+)$/.exec(p);
  if (m) {
    const id = safeDecode(m[1] as string);
    if (!ID_PATTERN.test(id)) throw new HttpError(400, 'id de nota de voz inválido');
    const audio = new R2AudioStore(env.PHOTOS);
    if (method === 'PUT') {
      const type = audioType(req.headers.get('content-type'));
      if (!type) throw new HttpError(400, 'tipo de audio no aceptado');
      const bytes = await readBody(req, MAX_AUDIO_BYTES);
      if (bytes.length === 0) throw new HttpError(400, 'la nota de voz está vacía');
      const created = !(await audio.has(id));
      if (created) await audio.put(id, bytes, type);
      return json(200, { id, bytes: bytes.length, created });
    }
    if (method === 'GET') {
      const a = await audio.get(id);
      if (!a) throw new HttpError(404, 'no existe esa nota de voz');
      return new Response(a.body, {
        headers: { 'content-type': a.type, 'content-length': String(a.size), 'cache-control': 'private, max-age=31536000, immutable' },
      });
    }
  }

  m = /^\/api\/sessions\/([^/]+)\/(attendance|closing)$/.exec(p);
  if (m) {
    const date = m[1] as string;
    if (!isValidDate(date)) throw new HttpError(400, 'fecha inválida');
    if (m[2] === 'attendance' && method === 'POST') {
      const a = await readJson(req, MAX_JSON_BYTES);
      const err = checkAttendance(a);
      if (err) throw new HttpError(400, err);
      const { memberId, checkIn } = a as Attendance;
      return json(200, { session: await store.attend(date, { memberId, checkIn }) });
    }
    if (m[2] === 'closing' && method === 'PUT') {
      const c = await readJson(req, MAX_JSON_BYTES);
      const err = checkClosing(c);
      if (err) throw new HttpError(400, err);
      return json(200, await store.close(date, c as SessionClosing));
    }
  }

  if (method === 'GET' && p === '/api/template') {
    needEdit();
    const res = await env.ASSETS.fetch(new Request(new URL(TEMPLATE_ASSET, url)));
    if (!res.ok) throw new HttpError(404, 'no se encontró la plantilla');
    return new Response(res.body, {
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'cache-control': 'private, no-cache' },
    });
  }

  if (method === 'GET' && p === '/api/qr') {
    needEdit();
    const captureUrl = `${url.origin}/#${TEAM_KEY_QUERY}=${encodeURIComponent(env.CAPTURE_KEY as string)}`;
    const body: QrResponse = { captureUrl, svg: qrSvg(captureUrl) };
    return json(200, body);
  }

  throw new HttpError(404, `ruta desconocida: ${method} ${p}`);
}

/** `StateResponse`, armado como texto con las filas tal como están guardadas (ver D1Store.entriesJson). */
async function state(store: D1Store, url: URL, access: AccessLevel): Promise<Response> {
  const raw = url.searchParams.get('date');
  const date = raw && isValidDate(raw) ? raw : undefined;
  if (raw && !date) throw new HttpError(400, 'fecha inválida');
  const [team, sessions, entries, tasks, recent] = await Promise.all([
    store.teamJson(),
    store.sessionsJson(date),
    store.entriesJson(date),
    store.tasksJson(),
    date ? store.sessionsBetweenJson(daysBefore(date, RECENT_SESSION_DAYS), date) : Promise.resolve(undefined),
  ]);
  const rest: Omit<StateResponse, 'team' | 'sessions' | 'entries' | 'tasks' | 'recentSessions'> = { version: API_VERSION, serverTime: new Date().toISOString(), access, hosted: true };
  const body = `{"team":${team},"sessions":${sessions},"entries":${entries},"tasks":${tasks},${recent ? `"recentSessions":${recent},` : ''}${JSON.stringify(rest).slice(1)}`;
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    throw new HttpError(400, 'ruta inválida');
  }
}

function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}
