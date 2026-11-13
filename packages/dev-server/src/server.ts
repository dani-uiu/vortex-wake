/**
 * Servidor local para el taller: sirve la app ya compilada y el contrato HTTP
 * de `@vortex-wake/shared` (api.ts) guardando en archivos (store.ts).
 * Solo módulos de Node; sin frameworks.
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
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
  addMemberToTeam,
  daysBefore,
  summarizeDays,
  type DaysResponse,
  checkAttendance,
  checkClosing,
  checkEntry,
  checkTask,
  checkTeam,
  isJpegBytes,
  isValidDate,
  type TaskItem,
  type AddMemberRequest,
  type Attendance,
  type Entry,
  type SessionClosing,
  type StateResponse,
  type TeamConfig,
} from '@vortex-wake/shared';
import { FileStore } from './store.ts';

export interface ServerOptions {
  dataDir: string;
  exampleTeamPath: string;
  /** Carpeta con la app compilada (`packages/app/dist`). */
  staticDir: string;
  templatePath: string;
  port: number;
  host?: string;
  /** Si falta, se usa (o crea) la de `data/server.json`. */
  teamKey?: string;
}

export interface RunningServer {
  server: Server;
  store: FileStore;
  port: number;
  teamKey: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const store = new FileStore(opts.dataDir, opts.exampleTeamPath);
  const teamKey = store.teamKey(opts.teamKey);
  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    const p = url.pathname;

    if (p === '/qr' || p === '/qr/') return sendQr(req, res, url);
    if (!p.startsWith('/api/')) return sendStatic(res, p);

    const key = req.headers[TEAM_KEY_HEADER] ?? url.searchParams.get(TEAM_KEY_QUERY);
    if (key !== teamKey) throw new HttpError(401, 'clave del equipo incorrecta: vuelve a escanear el QR del taller');

    if (method === 'GET' && p === '/api/state') {
      const date = url.searchParams.get('date');
      const body: StateResponse = {
        version: API_VERSION,
        team: store.team,
        sessions: [...store.sessions.values()].filter((s) => !date || s.date === date).sort((a, b) => (a.date < b.date ? -1 : 1)),
        entries: [...store.entries.values()].filter((e) => !date || e.sessionDate === date),
        serverTime: new Date().toISOString(),
        tasks: [...store.tasks.values()],
      };
      if (date) {
        const from = daysBefore(date, RECENT_SESSION_DAYS);
        body.recentSessions = [...store.sessions.values()].filter((s) => s.date >= from && s.date < date).sort((a, b) => (a.date < b.date ? -1 : 1));
      }
      return sendJson(res, 200, body);
    }
    if (method === 'GET' && p === '/api/days') {
      const counts = new Map<string, number>();
      for (const e of store.entries.values()) if (!e.deleted) counts.set(e.sessionDate, (counts.get(e.sessionDate) ?? 0) + 1);
      const body: DaysResponse = { days: summarizeDays(store.sessions.values(), counts) };
      return sendJson(res, 200, body);
    }
    if (method === 'PUT' && p === '/api/team') {
      const team = (await readJson(req)) as TeamConfig;
      const err = checkTeam(team);
      if (err) throw new HttpError(400, err);
      store.setTeam(team);
      return sendJson(res, 200, { team: store.team });
    }
    if (method === 'POST' && p === '/api/team/members') {
      const r = addMemberToTeam(store.team, (await readJson(req)) as AddMemberRequest);
      if ('error' in r) throw new HttpError(400, r.error);
      if (r.changed) store.setTeam(r.team);
      return sendJson(res, 200, { team: store.team });
    }

    let m = /^\/api\/entries\/([^/]+)$/.exec(p);
    if (m && method === 'PUT') {
      const entry = (await readJson(req)) as Entry;
      const err = checkEntry(entry);
      if (err) throw new HttpError(400, err);
      if (entry.id !== decodeURIComponent(m[1] as string)) throw new HttpError(400, 'el id no coincide con la ruta');
      return sendJson(res, 200, store.putEntry(entry));
    }

    m = /^\/api\/tasks\/([^/]+)$/.exec(p);
    if (m && method === 'PUT') {
      const task = (await readJson(req)) as TaskItem;
      const err = checkTask(task);
      if (err) throw new HttpError(400, err);
      if (task.id !== decodeURIComponent(m[1] as string)) throw new HttpError(400, 'el id no coincide con la ruta');
      return sendJson(res, 200, store.putTask(task));
    }

    m = /^\/api\/photos\/([^/]+)$/.exec(p);
    if (m) {
      const id = decodeURIComponent(m[1] as string);
      if (!ID_PATTERN.test(id)) throw new HttpError(400, 'id de foto inválido');
      if (method === 'PUT') {
        const bytes = await readBody(req, MAX_PHOTO_BYTES);
        if (!isJpegBytes(bytes)) throw new HttpError(400, 'la foto debe ser JPEG');
        const created = store.putPhoto(id, bytes);
        return sendJson(res, 200, { id, bytes: bytes.length, created });
      }
      if (method === 'GET') {
        const file = store.photoPath(id);
        if (!existsSync(file)) throw new HttpError(404, 'no existe esa foto');
        return sendFile(res, file, 'image/jpeg', 'private, max-age=31536000, immutable');
      }
    }

    m = /^\/api\/audio\/([^/]+)$/.exec(p);
    if (m) {
      const id = decodeURIComponent(m[1] as string);
      if (!ID_PATTERN.test(id)) throw new HttpError(400, 'id de nota de voz inválido');
      if (method === 'PUT') {
        const type = audioType(req.headers['content-type']);
        if (!type) throw new HttpError(400, 'tipo de audio no aceptado');
        const bytes = await readBody(req, MAX_AUDIO_BYTES);
        if (bytes.length === 0) throw new HttpError(400, 'la nota de voz está vacía');
        const created = store.putAudio(id, bytes, type);
        return sendJson(res, 200, { id, bytes: bytes.length, created });
      }
      if (method === 'GET') {
        const f = store.audioFile(id);
        if (!f) throw new HttpError(404, 'no existe esa nota de voz');
        return sendFile(res, f.path, f.type, 'private, max-age=31536000, immutable');
      }
    }

    m = /^\/api\/sessions\/([^/]+)\/(attendance|closing)$/.exec(p);
    if (m) {
      const date = m[1] as string;
      if (!isValidDate(date)) throw new HttpError(400, 'fecha inválida');
      if (m[2] === 'attendance' && method === 'POST') {
        const a = (await readJson(req)) as Attendance;
        const err = checkAttendance(a);
        if (err) throw new HttpError(400, err);
        return sendJson(res, 200, { session: store.attend(date, a) });
      }
      if (m[2] === 'closing' && method === 'PUT') {
        const c = (await readJson(req)) as SessionClosing;
        const err = checkClosing(c);
        if (err) throw new HttpError(400, err);
        return sendJson(res, 200, store.close(date, c));
      }
    }

    if (method === 'GET' && p === '/api/template') {
      if (!existsSync(opts.templatePath)) throw new HttpError(404, 'no se encontró la plantilla');
      return sendFile(res, opts.templatePath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'no-cache');
    }

    throw new HttpError(404, `ruta desconocida: ${method} ${p}`);
  }

  function sendStatic(res: ServerResponse, pathname: string): void {
    const root = resolve(opts.staticDir);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (file !== root && !file.startsWith(root + sep)) throw new HttpError(403, 'ruta inválida');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('La app no está compilada. Corre "npm run taller" desde la raíz del repositorio.');
      return;
    }
    const hashed = /[\\/]assets[\\/]/.test(file);
    sendFile(res, file, MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
  }

  function sendQr(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const remote = req.socket.remoteAddress ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      throw new HttpError(403, 'la página del QR solo se abre en la laptop del taller');
    }
    const port = (server.address() as { port: number }).port;
    const addrs = lanAddresses();
    const chosen = url.searchParams.get('ip') ?? addrs[0]?.address ?? 'localhost';
    const link = captureUrl(chosen, port, teamKey);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(qrPage(link, chosen, addrs, port, store.teamFromExample));
  }

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      const port = (server.address() as { port: number }).port;
      resolvePromise({
        server,
        store,
        port,
        teamKey,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            server.closeAllConnections();
          }),
      });
    });
  });
}

export function captureUrl(host: string, port: number, key: string): string {
  return `http://${host}:${port}/?${TEAM_KEY_QUERY}=${encodeURIComponent(key)}`;
}

export interface LanAddress {
  name: string;
  address: string;
}

/** Direcciones IPv4 de la red local (Wi-Fi primero, luego Ethernet, luego las demás). */
export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
    }
  }
  const rank = (n: string) => (/wi-?fi|wlan|inal/i.test(n) ? 0 : /ethernet|eth|en\d/i.test(n) ? 1 : /vethernet|virtual|vmware|vbox|hyper-v|wsl|loopback/i.test(n) ? 3 : 2);
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

export function qrAscii(text: string): string {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  return qr.createASCII(1, 2);
}

function qrPage(link: string, chosen: string, addrs: LanAddress[], port: number, example: boolean): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const others = addrs
    .filter((a) => a.address !== chosen)
    .map((a) => `<a href="/qr?ip=${esc(a.address)}">${esc(a.address)} (${esc(a.name)})</a>`)
    .join(' · ');
  return `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QR del taller · Vortex Wake</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--muted:#555;--warn:#8a5300}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--fg:#f2f2f2;--muted:#aaa;--warn:#ffc266}}
body{margin:0;font:18px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;align-items:center;padding:24px 16px;text-align:center}
.qr{background:#fff;padding:16px;border-radius:12px;width:min(80vmin,520px)}
.qr svg{width:100%;height:auto;display:block}
code{font-size:20px;word-break:break-all}
p{max-width:640px}.muted{color:var(--muted)}.warn{color:var(--warn);font-weight:600}
</style></head><body>
<h1>Escanea para capturar</h1>
<div class="qr">${qrSvg(link)}</div>
<p><code>${esc(link)}</code></p>
<p class="muted">Los celulares deben estar en la misma red wifi que esta laptop (o en su hotspot).</p>
${others ? `<p class="muted">Otras direcciones de esta laptop: ${others}</p>` : ''}
${addrs.length === 0 ? '<p class="warn">No se encontró una dirección de red local. Conecta la laptop al wifi o activa su hotspot y recarga.</p>' : ''}
${example ? '<p class="warn">Usando el equipo de ejemplo: falta data/team.json.</p>' : ''}
<p class="muted">Vista de computadora: <a href="http://localhost:${port}/?${TEAM_KEY_QUERY}=${esc(new URL(link).searchParams.get(TEAM_KEY_QUERY) ?? '')}#/escritorio">abrir aquí</a></p>
</body></html>`;
}

// --- utilidades HTTP -------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sendFile(res: ServerResponse, file: string, type: string, cache: string): void {
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'content-length': statSync(file).size });
  createReadStream(file).pipe(res);
}

function readBody(req: IncomingMessage, max: number): Promise<Uint8Array> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, 'archivo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(req, MAX_JSON_BYTES);
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}
