/**
 * Prueba de punta a punta en Edge (playwright-core con el Edge instalado; no
 * descarga navegadores).
 *
 *   npm run e2e        contra el servidor local del taller (compila la app antes)
 *   npm run e2e:nube   contra el Worker en el entorno local de Workers
 *                      (compila la app y los archivos del Worker antes)
 *
 * - Dos "teléfonos" (contextos de 360 px) en la misma sesión.
 * - Foto (archivo de prueba), texto, contador de pruebas y clasificación.
 * - Sin conexión: lo capturado se queda en el teléfono, sobrevive a cerrar la
 *   pestaña y se envía al volver. También con el servidor caído y de vuelta.
 * - Vista de computadora: genera el .pptx y lo descarga.
 * - Solo con el Worker: cada clave ve lo suyo, página del QR, abrir la app sin
 *   conexión (service worker) y que una versión nueva sí llegue.
 *
 * Capturas, datos y el .pptx van a %TEMP%\vortex-wake-app\e2e (servidor local)
 * o %TEMP%\vortex-wake-worker\e2e (Worker), fuera del repositorio. Usa el
 * equipo de ejemplo (datos ficticios).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { TEAM_FORMAT, apiPath, type CaptureSession, type Entry, type StateResponse, type TaskItem, type TeamConfig } from '@vortex-wake/shared';
import { strFromU8, unzipSync } from 'fflate';
import { lanAddresses, startServer, type RunningServer } from '../../dev-server/src/server.ts';
import { buildAssets } from '../../worker/scripts/build.ts';
import { startLocalWorker, type LocalWorker } from '../../worker/scripts/harness.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const NUBE = process.argv.includes('--nube');
const OUT = join(process.env.TEMP ?? tmpdir(), NUBE ? 'vortex-wake-worker' : 'vortex-wake-app', 'e2e');
const SHOTS = join(OUT, 'capturas');
const PHOTO = join(ROOT, 'examples/notebook-ejemplo/fotos/equipo.jpg');
const PHOTO2 = join(ROOT, 'examples/notebook-ejemplo/fotos/intake-v2.jpg');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

let step = 0;
const log = (msg: string) => console.log(`[${++step}] ${msg}`);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FALLÓ: ${msg}`);
}
async function until<T>(what: string, fn: () => T | Promise<T>, timeout = 20_000): Promise<NonNullable<T>> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - t0 > timeout) throw new Error(`FALLÓ (tiempo agotado): ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --- Servidor: el local del taller o el Worker -------------------------------------

interface Backend {
  /** Dirección para los teléfonos. */
  base: string;
  /** Dirección para la computadora. */
  deskBase: string;
  captureKey: string;
  editKey: string;
  /** Enlace de captura (lo que trae el QR). */
  captureLink(): string;
  deskLink(): string;
  entries(): Promise<Entry[]>;
  sessions(): Promise<CaptureSession[]>;
  tasks(): Promise<TaskItem[]>;
  photoIds(): Promise<string[]>;
  photo(id: string): Promise<Uint8Array>;
  /** Simula que el servidor se cae y vuelve. */
  down(ctx: BrowserContext): Promise<void>;
  up(ctx: BrowserContext): Promise<void>;
  close(): Promise<void>;
}

async function devServerBackend(): Promise<Backend> {
  const DATA = join(OUT, 'data');
  const KEY = 'e2e-clave';
  const opts = (port: number) => ({
    dataDir: DATA,
    exampleTeamPath: join(ROOT, 'examples/team-ejemplo.json'),
    staticDir: join(ROOT, 'packages/app/dist'),
    templatePath: join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx'),
    port,
    host: '0.0.0.0',
    teamKey: KEY,
  });
  let server: RunningServer = await startServer(opts(0));
  const port = server.port;
  const lan = lanAddresses()[0]?.address;
  log(`servidor local en el puerto ${port}; IP de red: ${lan ?? '(ninguna)'}`);
  // Responde por la IP de red, no solo por localhost.
  if (lan) {
    const r = await fetch(`http://${lan}:${port}/api/state`, { headers: { 'x-team-key': KEY } });
    assert(r.status === 200, `el servidor responde en http://${lan}:${port}`);
    const page = await fetch(`http://${lan}:${port}/`);
    assert((await page.text()).includes('<div id="app">'), 'la app se sirve por la IP de red');
    log(`responde por la IP de red ${lan}`);
  }
  const base = `http://${lan ?? 'localhost'}:${port}`;
  const photosDir = join(DATA, 'photos');
  return {
    base,
    deskBase: `http://localhost:${port}`,
    captureKey: KEY,
    editKey: KEY,
    captureLink: () => `${base}/?k=${KEY}`,
    deskLink: () => `http://localhost:${port}/?k=${KEY}#/escritorio`,
    entries: async () => [...server.store.entries.values()],
    sessions: async () => [...server.store.sessions.values()],
    tasks: async () => [...server.store.tasks.values()],
    photoIds: async () => {
      try {
        return readdirSync(photosDir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
      } catch {
        return [];
      }
    },
    photo: async (id) => new Uint8Array(readFileSync(join(photosDir, `${id}.jpg`))),
    // Con el servidor local se apaga y se vuelve a prender de verdad.
    down: async () => server.close(),
    up: async () => {
      server = await startServer(opts(port));
    },
    close: () => server.close(),
  };
}

async function workerBackend(): Promise<{ backend: Backend; worker: LocalWorker }> {
  const assets = join(ROOT, 'packages/worker/dist/public');
  const worker = await startLocalWorker({ assetsDir: assets });
  // 127.0.0.1 cuenta como contexto seguro: el service worker se registra igual que con HTTPS.
  const base = worker.url;
  log(`Worker en el entorno local de Workers: ${base}`);
  // El equipo de ejemplo (datos ficticios), como lo subiría "npm run nube:subir-datos".
  const team = JSON.parse(readFileSync(join(ROOT, 'examples/team-ejemplo.json'), 'utf8')) as TeamConfig;
  assert(team.format === TEAM_FORMAT, 'equipo de ejemplo válido');
  const r = await fetch(base + apiPath.team(), { method: 'PUT', headers: { 'x-team-key': worker.editKey, 'content-type': 'application/json' }, body: JSON.stringify(team) });
  assert(r.ok, 'se sube el equipo de ejemplo con la clave de edición');
  const state = async () => (await (await fetch(base + apiPath.state(), { headers: { 'x-team-key': worker.editKey } })).json()) as StateResponse;
  const env = (await worker.server.getWorker().getEnv()) as { PHOTOS: R2BucketLike };
  // El "servidor caído" se simula cortando /api en el navegador (el Worker no se apaga solo).
  const block = (ctx: BrowserContext) => ctx.route('**/api/**', (route) => route.abort('connectionrefused'));
  return {
    worker,
    backend: {
      base,
      deskBase: base,
      captureKey: worker.captureKey,
      editKey: worker.editKey,
      captureLink: () => `${base}/#k=${worker.captureKey}`,
      deskLink: () => `${base}/#/escritorio?k=${worker.editKey}`,
      entries: async () => (await state()).entries,
      sessions: async () => (await state()).sessions,
      tasks: async () => (await state()).tasks ?? [],
      photoIds: async () => (await env.PHOTOS.list({ prefix: 'photos/' })).objects.map((o) => o.key.slice('photos/'.length, -'.jpg'.length)),
      photo: async (id) => new Uint8Array(await (await fetch(`${base}${apiPath.photo(id)}?k=${worker.captureKey}`)).arrayBuffer()),
      down: block,
      up: (ctx) => ctx.unrouteAll(),
      close: () => worker.close(),
    },
  };
}

interface R2BucketLike {
  list(o: { prefix: string }): Promise<{ objects: { key: string }[] }>;
}

let worker: LocalWorker | undefined;
let backend: Backend;
if (NUBE) ({ backend, worker } = await workerBackend());
else backend = await devServerBackend();
const base = backend.base;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const phone = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-MX', timezoneId: 'America/Mexico_City' };
const errors: string[] = [];
const watch = (p: Page, who: string) => {
  p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|net::ERR/.test(m.text())) errors.push(`${who}: ${m.text()}`);
  });
};
const shot = (p: Page, name: string) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
/** Captura en modo claro y oscuro (funciones nuevas). Las hojas de pantalla completa no se recortan con fullPage. */
const shotBoth = async (p: Page, name: string, fullPage = true) => {
  await p.emulateMedia({ colorScheme: 'light' });
  await p.screenshot({ path: join(SHOTS, `${name}-claro.png`), fullPage });
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.screenshot({ path: join(SHOTS, `${name}-oscuro.png`), fullPage });
  await p.emulateMedia({ colorScheme: null });
};
/** Arrastra sobre un elemento en coordenadas relativas (0 a 1). */
const dragOn = async (p: Page, selector: string, from: [number, number], to: [number, number]) => {
  const box = await p.locator(selector).boundingBox();
  if (!box) throw new Error(`no se ve ${selector}`);
  await p.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height);
  await p.mouse.down();
  await p.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 8 });
  await p.mouse.up();
};
const tapOn = async (p: Page, selector: string, at: [number, number]) => {
  const box = await p.locator(selector).boundingBox();
  if (!box) throw new Error(`no se ve ${selector}`);
  await p.mouse.click(box.x + at[0] * box.width, box.y + at[1] * box.height);
};
/** Fecha local del taller (los teléfonos de la prueba están en la Ciudad de México). */
const mxDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

const liveEntries = async () => (await backend.entries()).filter((e) => !e.deleted);
const hasKey = (url: string) => url.includes(backend.captureKey) || url.includes(backend.editKey);

try {
  // Ayer hubo taller y nadie llenó el cierre (asistencia registrada directo en el servidor).
  const YESTERDAY = mxDate(-1);
  const att = await fetch(backend.deskBase + apiPath.attendance(YESTERDAY), {
    method: 'POST',
    headers: { 'x-team-key': backend.captureKey, 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'carla', checkIn: new Date(Date.now() - 86_400_000).toISOString() }),
  });
  assert(att.ok, 'asistencia de ayer registrada');
  // Y hace tres días, también sin cierre (solo se recuerda la más reciente en el celular; la computadora marca las dos).
  const THREE_AGO = mxDate(-3);
  const att3 = await fetch(backend.deskBase + apiPath.attendance(THREE_AGO), {
    method: 'POST',
    headers: { 'x-team-key': backend.captureKey, 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'beto', checkIn: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
  });
  assert(att3.ok, 'asistencia de hace tres días registrada');

  // --- Teléfono A ---------------------------------------------------------------
  const ctxA = await browser.newContext(phone);
  let a = await ctxA.newPage();
  watch(a, 'A');
  await a.goto(backend.captureLink());
  await a.waitForSelector('[data-testid=who-select]');
  assert(!hasKey(a.url()), `la clave se quita de la barra de direcciones (${a.url()})`);
  await shot(a, '01-quien-eres');
  await a.selectOption('[data-testid=who-select]', 'ana');
  await a.click('[data-testid=who-enter]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('asistencia de Ana en el servidor', async () => (await backend.sessions()).some((s) => s.attendance.some((x) => x.memberId === 'ana')));
  log('A: eligió su nombre y quedó su asistencia');

  // --- Recordatorio de cierre y pendientes ----------------------------------------------
  await a.waitForSelector('[data-testid=closing-nudge]');
  assert(((await a.textContent('[data-testid=closing-nudge]')) ?? '').includes('quedó sin cierre'), 'avisa que la sesión de ayer quedó sin cierre');
  assert((await a.getAttribute('[data-testid=closing-nudge]', 'data-date')) === YESTERDAY, 'el aviso es de la sesión de ayer');
  await shotBoth(a, '20-aviso-sin-cierre');
  await a.click('[data-testid=closing-nudge-go]');
  await a.waitForSelector('[data-testid=closing-next]');
  await a.fill('[data-testid=closing-did]', 'Armamos el intake');
  await a.fill('[data-testid=closing-next]', 'Revisar la batería\nCambiar el engrane del brazo');
  await a.click('[data-testid=closing-save]');
  await a.waitForSelector('[data-testid=tasks]');
  await until('el cierre de ayer llega al servidor', async () => (await backend.sessions()).some((s) => s.date === YESTERDAY && s.closing?.whatsNext?.includes('batería')));
  assert((await a.locator('[data-testid=closing-nudge]').count()) === 0, 'con el cierre lleno ya no hay aviso');
  assert((await a.locator('[data-testid=tasks] .task').count()) === 2, 'los dos renglones de "¿Qué sigue?" son pendientes');
  await shotBoth(a, '21-pendientes');
  await a.locator('[data-testid=tasks] .task', { hasText: 'Revisar la batería' }).locator('.task-check').click();
  await until('pendiente hecho (quién y cuándo) en el servidor', async () => (await backend.tasks()).some((t) => t.text === 'Revisar la batería' && t.done?.by === 'ana'));
  assert(((await a.textContent('[data-testid=tasks]')) ?? '').includes('Hecho por Ana'), 'el pendiente hecho dice quién lo hizo');
  log('A: aviso de la sesión de ayer sin cierre → cierre → pendientes; uno marcado como hecho');

  // Foto primero: un toque y queda guardada.
  await a.setInputFiles('[data-testid=photo-input]', PHOTO);
  await a.waitForSelector('.card [data-status]');
  await until('foto en el servidor', async () => (await liveEntries()).some((e) => e.elements.some((x) => x.type === 'photo')) && (await backend.photoIds()).length >= 1);
  const jpg = await backend.photo((await backend.photoIds())[0] as string);
  assert(jpg[0] === 0xff && jpg[1] === 0xd8, 'la foto llega como JPEG');
  log(`A: foto guardada y enviada (${jpg.length} bytes)`);

  // La foto sin clasificar se abre desde la lista y queda "Sin clasificar" hasta que alguien la clasifique.
  assert((await a.locator('.card .tag.todo').count()) === 1, 'la foto queda "Sin clasificar"');

  // --- Anotar la foto: etiqueta con flecha, etiqueta sola y flecha suelta --------------------
  await a.locator('.card', { has: a.locator('.thumb img') }).first().click();
  await a.click('[data-testid=annotate-photo]');
  const canvas = '[data-testid=annotator-canvas]';
  await until('el anotador muestra la foto', () => a.locator(canvas).evaluate((s) => !!s.getAttribute('viewBox')));
  await dragOn(a, canvas, [0.5, 0.55], [0.2, 0.2]);
  await tapOn(a, canvas, [0.82, 0.25]);
  await a.click('[data-testid=ann-mode-arrow]');
  await dragOn(a, canvas, [0.12, 0.88], [0.38, 0.68]);
  const lbl = (letter: string, field: string) => `[data-testid=annotator-labels] .ann-label[data-letter=${letter}] [data-field=${field}]`;
  await a.fill(lbl('A', 'what'), 'Rodillo de entrada');
  await a.fill(lbl('A', 'does'), 'Jala los anillos hacia adentro');
  await a.fill(lbl('A', 'why'), 'Agarra desde el piso sin alinear');
  await a.fill(lbl('B', 'what'), 'Motor del intake');
  await shotBoth(a, '22-anotador', false);
  await a.click('[data-testid=annotator-done]');
  await a.click('[data-testid=more-details] summary');
  await a.click('[data-testid=kind] [data-value=mechanism]');
  await a.click('[data-testid=section] [data-value=mechanics]');
  await a.evaluate(() => scrollTo(0, 0));
  await shotBoth(a, '23-editor-foto-anotada');
  await a.click('[data-testid=editor-done]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('foto anotada (2 etiquetas, 1 flecha) en el servidor', async () =>
    (await liveEntries()).find((e) => {
      const p = e.elements.find((x) => x.type === 'photo');
      const ann = p && p.type === 'photo' ? p.annotations ?? [] : [];
      return e.kind === 'mechanism' && ann.filter((x) => x.type === 'label').length === 2 && ann.filter((x) => x.type === 'arrow').length === 1 && ann.some((x) => x.type === 'label' && x.what === 'Rodillo de entrada' && x.tx !== undefined);
    }),
  );
  assert((await a.locator('.card .marked[data-marks="3"]').count()) === 1, 'la lista muestra la foto con sus anotaciones');
  await shotBoth(a, '24-lista-foto-anotada');
  log('A: foto anotada (A con flecha, B, flecha suelta) con sus textos, clasificada como mecanismo');

  // Nota con clasificación: "¿De qué es?" → "¿Qué fue?" (se abre sola) → "Más detalles".
  await a.click('[data-testid=new-text]');
  await a.waitForSelector('[data-testid=text-input]');
  await a.fill('[data-testid=text-input]', 'Armamos el chasis y tensamos la cadena del lado izquierdo.');
  // Lo último que Ana clasificó fue la foto anotada (mecanismo): se propone, sin aplicarse.
  assert(((await a.textContent('[data-testid=same-as-before]')) ?? '').includes('Construimos'), 'propone "Igual que la anterior" con la clasificación de la foto anotada');
  await a.click('[data-testid=class-target]');
  await a.click('[data-testid=sheet-target] [data-robot=robot-a] [data-value="robot-a|chasis"]');
  await a.click('[data-testid=sheet-what] [data-value=build]');
  assert(((await a.textContent('[data-testid=class-what]')) ?? '').includes('Construcción · Mecánica'), '"Construimos" se muestra como Construcción · Mecánica');
  await a.click('[data-testid=more-details] summary');
  assert((await a.inputValue('[data-testid=thread-input]')) === 'Robot A · chasis', 'el hilo se propone solo (robot + subsistema)');
  await a.click('[data-testid=marks] [data-value=change]');
  await a.fill('[data-testid=thread-input]', 'chasis v1');
  await a.evaluate(() => scrollTo(0, 0));
  await shot(a, '02-editor-nota');
  await a.click('[data-testid=editor-done]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('nota clasificada en el servidor', async () =>
    (await liveEntries()).find(
      (e) => e.kind === 'buildIteration' && e.section === 'mechanics' && e.robotId === 'robot-a' && e.subsystem === 'chasis' && e.marks.includes('change') && e.thread === 'chasis v1' && e.authorIds.join() === 'ana' && e.elements.some((x) => x.type === 'text' && x.text.includes('cadena')),
    ),
  );
  log('A: nota clasificada enviada');

  // Contador de pruebas (desde "Más"), con "Igual que la anterior" y cambiando "¿Qué fue?".
  await a.click('[data-testid=more-actions]');
  await a.click('[data-testid=sheet-more] [data-testid=new-trials]');
  await a.waitForSelector('[data-testid=trial-ok]');
  for (const ok of [true, true, false, true]) await a.click(ok ? '[data-testid=trial-ok]' : '[data-testid=trial-fail]');
  await a.fill('.trial-list li:nth-child(2) input', 'Se atoró la pieza');
  assert(((await a.textContent('[data-testid=same-as-before]')) ?? '').includes('Robot A · chasis'), 'propone "Igual que la anterior" con lo último de Ana');
  await a.click('[data-testid=same-as-before]');
  await a.click('[data-testid=class-what]');
  await a.click('[data-testid=sheet-what] [data-value=test]');
  assert((await a.textContent('[data-testid=trials-score]'))?.includes('3 de 4'), 'el contador muestra 3 de 4');
  await a.evaluate(() => scrollTo(0, 0));
  await shot(a, '03-contador');
  await a.click('[data-testid=editor-done]');
  await until('contador en el servidor', async () =>
    (await liveEntries()).find((e) => e.kind === 'test' && e.section === 'mechanics' && e.robotId === 'robot-a' && e.subsystem === 'chasis' && e.elements.some((x) => x.type === 'trials' && x.trials.length === 4 && x.trials.some((t) => t.note === 'Se atoró la pieza'))),
  );
  await shot(a, '04-lista');
  log('A: contador de pruebas (3 de 4, con nota) enviado, clasificado con "Igual que la anterior"');

  if (NUBE) {
    assert((await a.locator('a[href="#/escritorio"]').count()) === 0, 'con la clave de captura no aparece "Vista de computadora"');
    await until('el service worker controla la página de A', () => a.evaluate(() => !!navigator.serviceWorker.controller));
    log('A: el service worker quedó instalado y controla la app');
  }

  // --- Sin conexión ------------------------------------------------------------------
  const before = (await liveEntries()).length;
  await ctxA.setOffline(true);
  await a.setInputFiles('[data-testid=photo-input]', PHOTO2);
  await a.click('[data-testid=new-text]');
  await a.fill('[data-testid=text-input]', 'Capturado sin señal');
  await a.click('[data-testid=editor-done]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('indicador "sin conexión"', async () => (await a.getAttribute('[data-testid=sync]', 'data-online')) === 'false');
  const pendingBadge = await a.textContent('[data-testid=sync]');
  assert(/guardado/.test(pendingBadge ?? ''), `indicador dice "guardado en este teléfono" (dice: ${pendingBadge})`);
  assert((await a.locator('.card [data-status=local]').count()) >= 2, 'las entradas sin enviar dicen "En este teléfono"');
  await shot(a, '05-sin-conexion');
  assert((await liveEntries()).length === before, 'sin conexión nada llega al servidor');
  // Se cierra la pestaña sin conexión.
  await a.close();
  log('A: dos capturas sin conexión y pestaña cerrada');

  if (NUBE) {
    // Abrir la app de cero, sin conexión: la sirve el service worker.
    const off = await ctxA.newPage();
    watch(off, 'A-offline');
    await off.goto(`${base}/`);
    await off.waitForSelector('[data-testid=entry-list]');
    await until('la app abierta sin conexión muestra lo capturado', async () => ((await off.textContent('[data-testid=entry-list]')) ?? '').includes('Capturado sin señal'));
    await until('indicador "sin conexión" al abrir sin conexión', async () => (await off.getAttribute('[data-testid=sync]', 'data-online')) === 'false');
    await shot(off, '05b-abierta-sin-conexion');
    await off.close();
    log('A: la app se abrió de cero sin conexión (service worker) y muestra lo del teléfono');
  }

  await ctxA.setOffline(false);
  a = await ctxA.newPage();
  watch(a, 'A2');
  await a.goto(`${base}/`);
  await until('lo capturado sin señal llega al servidor', async () => {
    const live = await liveEntries();
    return live.length === before + 2 && live.some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Capturado sin señal'));
  });
  await until('2 fotos en el servidor', async () => (await backend.photoIds()).length === 2);
  await until('indicador "Todo enviado"', async () => (await a.getAttribute('[data-testid=sync]', 'data-pending')) === '0');
  log('A: al volver, se envió todo lo capturado sin conexión');

  // --- Servidor caído y de vuelta ---------------------------------------------------
  await backend.down(ctxA);
  await a.click('[data-testid=new-text]');
  await a.fill('[data-testid=text-input]', 'Con la laptop apagada');
  await a.click('[data-testid=editor-done]');
  await until('indicador sin conexión (servidor caído)', async () => (await a.getAttribute('[data-testid=sync]', 'data-online')) === 'false', 30_000);
  await backend.up(ctxA);
  await until('entrada con el servidor caído llega al volver', async () => (await liveEntries()).some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Con la laptop apagada')), 30_000);
  log('A: con el servidor caído se guardó en el teléfono y se envió al volver');

  // --- Boceto con el dedo --------------------------------------------------------------
  await a.click('[data-testid=more-actions]');
  await a.click('[data-testid=sheet-more] [data-testid=new-sketch]');
  await a.waitForSelector('[data-testid=sketch-canvas]');
  await dragOn(a, '[data-testid=sketch-canvas]', [0.15, 0.7], [0.5, 0.25]);
  await dragOn(a, '[data-testid=sketch-canvas]', [0.5, 0.25], [0.85, 0.7]);
  await a.click('[data-testid=sketch-color-rojo]');
  await a.click('[data-testid=sketch-width-grueso]');
  await dragOn(a, '[data-testid=sketch-canvas]', [0.2, 0.85], [0.8, 0.85]);
  await dragOn(a, '[data-testid=sketch-canvas]', [0.1, 0.1], [0.3, 0.1]);
  await a.click('[data-testid=sketch-undo]');
  await shotBoth(a, '25-boceto', false);
  const photosBefore = (await backend.photoIds()).length;
  await a.click('[data-testid=sketch-save]');
  await until('boceto en el servidor (lluvia de ideas, foto marcada como boceto)', async () =>
    (await liveEntries()).find((e) => e.kind === 'brainstorm' && e.elements.some((x) => x.type === 'photo' && x.sketch === true)),
  );
  await until('la imagen del boceto llega', async () => (await backend.photoIds()).length === photosBefore + 1);
  log('A: boceto dibujado (dos colores, deshacer) y guardado como imagen en una lluvia de ideas');

  // --- Teléfono B (misma sesión) --------------------------------------------------
  const ctxB = await browser.newContext({ ...phone, colorScheme: 'dark' });
  const b = await ctxB.newPage();
  watch(b, 'B');
  await b.goto(backend.captureLink());
  await b.waitForSelector('[data-testid=who-select]');
  await b.selectOption('[data-testid=who-select]', 'beto');
  await b.click('[data-testid=who-enter]');
  await b.waitForSelector('[data-testid=entry-list]');
  await until('B ve las entradas de A', async () => (await b.locator('.card').count()) >= 5);
  await b.click('[data-testid=new-text]');
  await b.fill('[data-testid=text-input]', 'Programamos el autónomo de la izquierda.');
  await b.click('[data-testid=class-what]');
  await b.click('[data-testid=sheet-what] [data-value=code]');
  await b.click('[data-testid=editor-done]');
  await until('"Programamos" llega como Código · Programación', async () => (await liveEntries()).find((e) => e.kind === 'codeDoc' && e.section === 'coding' && e.capturedBy === 'beto'));
  // --- Modo torneo: un partido y el siguiente ---------------------------------------------
  await b.click('[data-testid=more-actions]');
  await b.click('[data-testid=sheet-more] [data-testid=new-match]');
  await b.waitForSelector('.match');
  await b.fill('.match [data-field=match]', 'Q12');
  await b.click('[data-testid=match-alliance] [data-value=red]');
  await b.fill('.match [data-field=partner]', '1234B');
  await b.fill('.match [data-field=opponents]', '5678A, 9012C');
  await b.fill('.match [data-field=ourScore]', '40');
  await b.fill('.match [data-field=theirScore]', '52');
  assert((await b.getAttribute('[data-testid=match-result] [data-value=loss]', 'aria-pressed')) === 'true', 'con el marcador, el resultado se pone solo (Perdimos)');
  await b.fill('[data-testid=match-failed]', 'Se salió la cadena del intake');
  await b.fill('[data-testid=match-adjusted]', 'Subimos la tensión de la cadena');
  await b.click('[data-testid=match-change] [data-value=mechanics]');
  await b.evaluate(() => scrollTo(0, 0));
  await shotBoth(b, '26-partido');
  await b.click('[data-testid=next-match]');
  await until('se abre otro partido vacío', async () => (await b.inputValue('.match [data-field=match]').catch(() => 'x')) === '');
  await b.fill('.match [data-field=match]', 'Q13');
  await b.click('[data-testid=match-alliance] [data-value=blue]');
  await b.click('[data-testid=editor-done]');
  await until('dos partidos en el servidor, uno con el ajuste para Mecánica', async () => {
    const ms = (await liveEntries()).filter((e) => e.kind === 'tournamentLog' && e.section === 'strategy');
    const els = ms.flatMap((e) => e.elements.filter((x) => x.type === 'match'));
    return ms.length === 2 && els.some((x) => x.type === 'match' && x.match === 'Q12' && x.result === 'loss' && x.adjustedSection === 'mechanics') && els.some((x) => x.type === 'match' && x.match === 'Q13' && x.alliance === 'blue');
  });
  log('B: modo torneo, dos partidos (uno con lo que se ajustó para el registro de cambios)');

  // --- Ruta del autónomo sobre el mapa del campo ----------------------------------------
  await b.click('[data-testid=new-text]');
  await b.fill('[data-testid=text-input]', 'Rutina de la izquierda');
  await b.click('[data-testid=editor-add]');
  await b.click('[data-testid=sheet-add] [data-add=route]');
  await b.waitForSelector('[data-testid=route-canvas]');
  await tapOn(b, '[data-testid=route-canvas]', [0.15, 0.85]);
  await tapOn(b, '[data-testid=route-canvas]', [0.35, 0.55]);
  await tapOn(b, '[data-testid=route-canvas]', [0.7, 0.3]);
  await dragOn(b, '[data-testid=route-canvas]', [0.7, 0.3], [0.75, 0.25]);
  const step = (n: number, f: string) => `[data-testid=route-steps] [data-step="${n}"] [data-field=${f}]`;
  await b.fill(step(1, 'action'), 'Salir de la esquina');
  await b.fill(step(2, 'action'), 'Tomar el objeto del centro');
  await b.fill(step(2, 'points'), '3');
  await b.fill(step(3, 'action'), 'Anotar en la meta');
  await b.fill(step(3, 'expected'), 'Queda dentro');
  await b.waitForTimeout(300);
  await shotBoth(b, '29-ruta', false);
  await b.click('[data-testid=route-done]');
  await b.evaluate(() => scrollTo(0, 0));
  await shotBoth(b, '30-editor-ruta');
  await b.click('[data-testid=editor-done]');
  await until('ruta de 3 pasos en el servidor (plan de autónomo)', async () =>
    (await liveEntries()).find((e) => e.kind === 'autonomousPlan' && e.elements.some((x) => x.type === 'route' && x.points.length === 3 && x.points[1]?.points === '3' && (x.points[2]?.x ?? 0) > 0.72)),
  );
  log('B: ruta del autónomo de 3 pasos dibujada sobre el campo (uno movido) con sus acciones');

  // B edita una entrada de A (la foto sin clasificar).
  await b.click('[data-testid=filter-todo]');
  await b.locator('.card', { hasText: 'Capturado sin señal' }).click();
  await b.waitForSelector('[data-testid=milestone]');
  await b.click('[data-testid=milestone]');
  assert((await b.getAttribute('[data-testid=milestone]', 'aria-checked')) === 'true', '"Es un hito" queda encendido');
  await b.click('[data-testid=editor-done]');
  await shot(b, '06-telefono-b-oscuro');
  await until('B: la edición de una entrada ajena llega', async () => (await liveEntries()).some((e) => e.marks.includes('milestone') && e.capturedBy === 'ana' && e.elements.some((x) => x.type === 'text' && x.text === 'Capturado sin señal')));
  await until('A ve la asistencia de B', async () => ((await a.textContent('.present')) ?? '').includes('Beto'));
  await until('A ve la entrada de B', async () => ((await a.textContent('[data-testid=entry-list]')) ?? '').includes('autónomo'), 30_000);
  log('B: misma sesión; ve lo de A, A ve lo de B, y B editó una entrada de A');

  // Cierre de sesión.
  await b.click('[data-testid=filter-all]');
  await b.goto(`${base}/#/cierre`);
  await b.fill('[data-testid=closing-did]', 'Chasis y autónomo');
  await b.fill('[data-testid=closing-failed]', 'La cadena se salió');
  await b.fill('[data-testid=closing-next]', 'Probar el intake');
  await shot(b, '07-cierre');
  await b.click('[data-testid=closing-save]');
  await until('cierre en el servidor', async () => (await backend.sessions()).some((s) => s.closing?.whatWeDid === 'Chasis y autónomo'));
  log('B: cierre de sesión guardado');
  await until('el pendiente "Probar el intake" llega al servidor', async () => (await backend.tasks()).some((t) => t.text === 'Probar el intake' && t.source === 'closing'));

  // --- Al día siguiente: los pendientes pasan a la sesión nueva ----------------------------
  const ctxC = await browser.newContext(phone);
  const c = await ctxC.newPage();
  await c.clock.install({ time: new Date(Date.now() + 86_400_000) });
  watch(c, 'C');
  await c.goto(backend.captureLink());
  await c.waitForSelector('[data-testid=who-select]');
  await c.selectOption('[data-testid=who-select]', 'dario');
  await c.click('[data-testid=who-enter]');
  await c.waitForSelector('[data-testid=tasks]');
  await until('mañana se ven los pendientes de hoy y los de ayer que no se hicieron', async () => {
    const t = (await c.textContent('[data-testid=tasks]')) ?? '';
    return t.includes('Probar el intake') && t.includes('Cambiar el engrane del brazo') && !t.includes('Revisar la batería');
  });
  assert((await c.locator('[data-testid=closing-nudge]').count()) === 0, 'la sesión de hoy sí tiene cierre: no hay aviso');
  await shotBoth(c, '27-pendientes-dia-siguiente');
  await c.locator('[data-testid=tasks] .task', { hasText: 'Cambiar el engrane' }).locator('.task-text').click();
  await c.click('[data-testid=task-snooze]');
  await until('pendiente pospuesto en el servidor', async () => (await backend.tasks()).some((t) => t.text === 'Cambiar el engrane del brazo' && !!t.snoozedUntil && !t.done));
  await c.click('[data-testid=more-actions]');
  await c.click('[data-testid=sheet-more] [data-testid=new-task]');
  await c.fill('[data-testid=task-text]', 'Imprimir la pieza del brazo');
  await c.click('[data-testid=task-save]');
  await until('pendiente agregado a mano en el servidor', async () => (await backend.tasks()).some((t) => t.text === 'Imprimir la pieza del brazo' && t.source === 'manual' && t.createdBy === 'dario'));
  await ctxC.close();
  log('C (día siguiente): ve los pendientes que quedaron, pospone uno y agrega otro a mano');

  // --- Dictado: con reconocimiento de voz (simulado) y sin él -------------------------------
  const ctxDict = await browser.newContext(phone);
  await ctxDict.addInitScript(() => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((ev: unknown) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { vwDictLang: string }).vwDictLang = this.lang;
        const res = (t: string, isFinal: boolean) => ({ resultIndex: 0, results: { length: 1, 0: { isFinal, 0: { transcript: t } } } });
        setTimeout(() => this.onresult?.(res('probamos el', false)), 150);
        setTimeout(() => this.onresult?.(res('probamos el brazo nuevo', true)), 400);
        setTimeout(() => this.onend?.(), 600);
      }
      stop() {
        this.onend?.();
      }
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, name, { value: FakeRecognition, configurable: true, writable: true });
  });
  const dd = await ctxDict.newPage();
  watch(dd, 'D');
  await dd.goto(backend.captureLink());
  await dd.waitForSelector('[data-testid=who-select]');
  await dd.selectOption('[data-testid=who-select]', 'carla');
  await dd.click('[data-testid=who-enter]');
  await dd.click('[data-testid=new-text]');
  await dd.fill('[data-testid=text-input]', 'Hoy');
  await dd.click('.el-text [data-testid=dictate]');
  await dd.waitForSelector('[data-testid=sheet-dictation]');
  assert(((await dd.textContent('[data-testid=sheet-dictation]')) ?? '').includes('servidores del fabricante'), 'la primera vez avisa a dónde va el audio');
  assert((await dd.evaluate(() => (window as unknown as { vwDictLang?: string }).vwDictLang)) === undefined, 'no empieza a escuchar sin que la persona acepte');
  await dd.waitForTimeout(400); // termina la animación de la hoja
  await shotBoth(dd, '28-dictado-aviso', false);
  await dd.click('[data-testid=dictation-accept]');
  await until('el texto dictado aparece en el campo', async () => (await dd.inputValue('[data-testid=text-input]')) === 'Hoy probamos el brazo nuevo');
  assert((await dd.evaluate(() => (window as unknown as { vwDictLang?: string }).vwDictLang)) === 'es-MX', 'dicta en español de México');
  await dd.click('[data-testid=editor-done]');
  await until('lo dictado llega al servidor', async () => (await liveEntries()).some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Hoy probamos el brazo nuevo')));
  await ctxDict.close();
  // Sin reconocimiento de voz ni grabación (como por HTTP en la red local): no hay
  // botón; se sugiere el micrófono del teclado.
  const ctxE = await browser.newContext(phone);
  await ctxE.addInitScript(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
  });
  const ee = await ctxE.newPage();
  watch(ee, 'E');
  await ee.goto(backend.captureLink());
  await ee.waitForSelector('[data-testid=who-select]');
  await ee.selectOption('[data-testid=who-select]', 'carla');
  await ee.click('[data-testid=who-enter]');
  await ee.click('[data-testid=new-text]');
  await ee.waitForSelector('[data-testid=text-input]');
  assert((await ee.locator('[data-testid=dictate]').count()) === 0, 'sin reconocimiento de voz no hay botón de dictado');
  assert(((await ee.getAttribute('[data-testid=text-input]', 'placeholder')) ?? '').includes('micrófono del teclado'), 'sugiere el micrófono del teclado');
  await ee.fill('[data-testid=text-input]', 'Escrito con el teclado');
  await ee.click('[data-testid=editor-done]');
  await until('la nota sin dictado llega', async () => (await liveEntries()).some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Escrito con el teclado')));
  await ctxE.close();
  log('Dictado: aviso la primera vez, texto en vivo en es-MX que llega al servidor; sin reconocimiento, sugerencia del teclado');

  // --- Notas de voz: grabar necesita contexto seguro (localhost o HTTPS) -------------------
  const secureLink = NUBE ? backend.captureLink() : `${backend.deskBase}/?k=${backend.captureKey}`;
  /** Micrófono falso: un tono de un oscilador, grabado con el MediaRecorder de verdad. */
  const fakeMic = () => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
  };
  const serverAudio = async (p: Page, id: string) =>
    p.evaluate(async (path: string) => {
      const r = await fetch(path, { headers: { 'x-team-key': localStorage.getItem('vw.key') ?? '' } });
      return { status: r.status, type: r.headers.get('content-type'), size: (await r.arrayBuffer()).byteLength };
    }, apiPath.audio(id));
  const audioOf = (e: { elements: { type: string }[] }) => e.elements.find((x): x is { type: 'audio'; audioId: string; mime: string; durationMs?: number } => x.type === 'audio');

  // Como en Firefox: sin reconocimiento de voz, el micrófono graba una nota de voz.
  const ctxF = await browser.newContext(phone);
  await ctxF.addInitScript(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });
  await ctxF.addInitScript(fakeMic);
  const ff = await ctxF.newPage();
  watch(ff, 'F');
  await ff.goto(secureLink);
  await ff.waitForSelector('[data-testid=who-select]');
  await ff.selectOption('[data-testid=who-select]', 'carla');
  await ff.click('[data-testid=who-enter]');
  assert((await ff.locator('[data-testid=mic-settings]').count()) === 0, 'sin reconocimiento de voz no hay elección de modo');
  await ff.click('[data-testid=new-text]');
  await ff.fill('[data-testid=text-input]', 'Probamos el lanzador');
  assert((await ff.getAttribute('.el-text [data-testid=dictate]', 'aria-label')) === 'Grabar nota de voz', 'en Firefox el micrófono graba');
  await ff.click('.el-text [data-testid=dictate]');
  await ff.waitForSelector('.el-text [data-testid=dictate].recording');
  await ff.waitForTimeout(1500);
  await ff.click('.el-text [data-testid=dictate]');
  await ff.waitForSelector('[data-testid=voice-player]');
  assert((await ff.locator('[data-el]').evaluateAll((els) => els.map((e) => e.getAttribute('data-el')))).join() === 'text,audio', 'la nota de voz queda después del texto');
  await ff.fill('[data-testid=voice-caption]', 'Cómo sonó el lanzador');
  await ff.waitForTimeout(400);
  await shotBoth(ff, '30-nota-de-voz', false);

  // Mapa de puertos del Brain sobre el dibujo, como la ruta del autónomo.
  await ff.click('[data-testid=editor-add]');
  await ff.click('[data-add=ports]');
  await ff.waitForSelector('[data-testid=devicemap-editor]');
  await ff.click('[data-testid=devicemap-canvas] [data-slot="1"]');
  assert(await ff.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'devicemap-current'), 'tocar el puerto 1 abre su campo bajo el dibujo');
  await ff.keyboard.type('Motor izquierdo');
  await ff.click('[data-testid=devicemap-canvas] [data-slot="A"]');
  await ff.keyboard.type('Limit switch del brazo');
  assert((await ff.locator('[data-testid=devicemap-canvas] .dm-slot.filled').count()) === 2, 'los puertos con algo se ven llenos');
  await ff.waitForTimeout(300);
  await shotBoth(ff, '31-mapa-de-puertos', false);
  await ff.click('[data-testid=devicemap-done]');
  await ff.click('[data-testid=editor-add]');
  await ff.click('[data-add=controller]');
  await ff.click('[data-testid=devicemap-canvas] [data-slot="R1"]');
  await ff.keyboard.type('Intake');
  await ff.click('[data-testid=devicemap-done]');
  await ff.click('[data-testid=editor-done]');
  await until('la nota de voz y los mapas llegan al servidor', async () =>
    (await liveEntries()).some((e) => {
      const a = audioOf(e);
      const ports = e.elements.find((x) => x.type === 'devicemap' && x.kind === 'ports');
      const ctl = e.elements.find((x) => x.type === 'devicemap' && x.kind === 'controller');
      return !!a && (a as { caption?: string }).caption === 'Cómo sonó el lanzador' && ports?.type === 'devicemap' && ports.slots['1'] === 'Motor izquierdo' && ports.slots.A === 'Limit switch del brazo' && ctl?.type === 'devicemap' && ctl.slots.R1 === 'Intake' && e.section === 'wiring';
    }));
  const withAudio = (await liveEntries()).find((e) => audioOf(e) && e.elements.some((x) => x.type === 'text' && x.text === 'Probamos el lanzador'));
  const voice = withAudio ? audioOf(withAudio) : undefined;
  assert(!!voice && (voice.durationMs ?? 0) >= 1000, 'la nota de voz guarda su duración');
  await until('el audio llega al servidor', async () => voice !== undefined && (await serverAudio(ff, voice.audioId)).status === 200);
  const got = voice ? await serverAudio(ff, voice.audioId) : undefined;
  assert(!!got && got.size > 500 && (got.type ?? '').startsWith('audio/'), `el servidor devuelve el audio (${JSON.stringify(got)})`);
  await ctxF.close();

  // Con reconocimiento de voz: se puede elegir "Solo grabar" (transcribir es lo normal).
  const ctxG = await browser.newContext(phone);
  await ctxG.addInitScript(() => {
    class FakeRecognition {
      start() {}
      stop() {}
    }
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, name, { value: FakeRecognition, configurable: true, writable: true });
  });
  await ctxG.addInitScript(fakeMic);
  const gg = await ctxG.newPage();
  watch(gg, 'G');
  await gg.goto(secureLink);
  await gg.waitForSelector('[data-testid=who-select]');
  await gg.selectOption('[data-testid=who-select]', 'carla');
  await gg.click('[data-testid=who-enter]');
  await gg.waitForSelector('[data-testid=mic-settings]');
  assert(((await gg.textContent('[data-testid=mic-settings]')) ?? '').includes('transcribir'), 'por omisión, el micrófono transcribe');
  await gg.click('[data-testid=new-text]');
  assert((await gg.getAttribute('.el-text [data-testid=dictate]', 'aria-label')) === 'Dictar', 'transcribir es lo normal');
  await gg.click('[data-testid=editor-done]');
  await gg.click('[data-testid=mic-settings]');
  await gg.click('[data-testid=sheet-mic] [data-mode=record]');
  assert(((await gg.textContent('[data-testid=mic-settings]')) ?? '').includes('solo grabar'), 'se eligió solo grabar');
  await gg.click('[data-testid=new-text]');
  await gg.fill('[data-testid=text-input]', 'Con solo grabar');
  await gg.click('.el-text [data-testid=dictate]');
  await gg.waitForSelector('.el-text [data-testid=dictate].recording');
  await gg.waitForTimeout(800);
  await gg.click('.el-text [data-testid=dictate]');
  await gg.waitForSelector('[data-testid=voice-player]');
  await gg.click('[data-testid=editor-done]');
  await until('con "Solo grabar" la nota de voz llega', async () => (await liveEntries()).some((e) => audioOf(e) && e.elements.some((x) => x.type === 'text' && x.text === 'Con solo grabar')));
  await ctxG.close();
  log('Notas de voz: en Firefox el micrófono graba; con reconocimiento se elige transcribir o solo grabar; mapas del Brain y del control en la entrada');

  // --- Días pasados en el celular: calendario; ayer se corrige, antes solo se ve --------
  const seed = async (id: string, date: string, text: string) => {
    const at = new Date(`${date}T18:00:00Z`).toISOString();
    const e: Entry = { id, sessionDate: date, createdAt: at, updatedAt: at, authorIds: ['beto'], marks: [], elements: [{ id: `${id}-t`, type: 'text', text }] };
    const r = await fetch(backend.deskBase + apiPath.entry(id), { method: 'PUT', headers: { 'x-team-key': backend.editKey, 'content-type': 'application/json' }, body: JSON.stringify(e) });
    assert(r.ok, `entrada sembrada del ${date}`);
  };
  await seed('pasada-vieja', THREE_AGO, 'Armamos la base del chasis');
  await seed('pasada-ayer', YESTERDAY, 'Calibramos el giroscopio');
  const ctxH = await browser.newContext(phone);
  const hh = await ctxH.newPage();
  watch(hh, 'H');
  await hh.goto(backend.captureLink());
  await hh.waitForSelector('[data-testid=who-select]');
  await hh.selectOption('[data-testid=who-select]', 'beto');
  await hh.click('[data-testid=who-enter]');
  await hh.click('[data-testid=open-calendar]');
  await hh.waitForSelector('[data-testid=sheet-calendar]');
  if (THREE_AGO.slice(0, 7) !== mxDate().slice(0, 7)) await hh.click('[data-testid=cal-prev]');
  await until('el calendario marca el día con entradas', async () => (await hh.locator(`.cal-day.has[data-date="${THREE_AGO}"]`).count()) === 1);
  assert(await hh.locator(`.cal-day[data-date="${mxDate(1)}"]`).evaluateAll((els) => els.every((e) => (e as HTMLButtonElement).disabled)), 'los días futuros no se eligen');
  await hh.waitForTimeout(300);
  await shotBoth(hh, '33-calendario', false);
  await hh.click(`.cal-day[data-date="${THREE_AGO}"]`);
  await hh.waitForSelector('[data-testid=day-title]');
  await until('se ve la entrada de hace tres días', async () => (await hh.locator('[data-testid=day-list] .card, [data-testid=day-list] [data-entry]').count()) > 0 || ((await hh.textContent('[data-testid=day-list]')) ?? '').includes('chasis'));
  assert(((await hh.textContent('[data-testid=day-edit]')) ?? '').includes('Solo lectura'), 'el día de hace tres días es de solo lectura');
  await shotBoth(hh, '34-dia-pasado', false);
  await hh.locator('[data-testid=day-list]').getByText('chasis').click();
  await hh.waitForSelector('[data-testid=editor-read-only]');
  assert(await hh.locator('[data-testid=text-input]').isDisabled(), 'la entrada vieja no se puede editar');
  assert((await hh.locator('[data-testid=editor-add]').count()) === 0, 'ni agregarle cosas');
  await hh.click('[data-testid=editor-done]');
  await hh.waitForSelector('[data-testid=day-title]');
  assert(hh.url().includes(`#/dia/${THREE_AGO}`), 'al salir vuelve al día');
  // Ayer sí se corrige (con flechas de día en día).
  await hh.click('[data-testid=day-next]');
  await hh.click('[data-testid=day-next]');
  await until('llega a ayer', async () => hh.url().includes(`#/dia/${YESTERDAY}`));
  assert(((await hh.textContent('[data-testid=day-edit]')) ?? '').includes('corregir'), 'ayer se puede corregir');
  await until('se ve la entrada de ayer', async () => ((await hh.textContent('[data-testid=day-list]')) ?? '').includes('giroscopio'));
  await hh.locator('[data-testid=day-list]').getByText('giroscopio').click();
  await hh.waitForSelector('[data-testid=text-input]');
  assert((await hh.locator('[data-testid=editor-read-only]').count()) === 0, 'la de ayer se abre para editar');
  await hh.fill('[data-testid=text-input]', 'Calibramos el giroscopio (corregido)');
  await hh.click('[data-testid=editor-done]');
  await until('la corrección de ayer llega al servidor', async () => (await liveEntries()).some((e) => e.id === 'pasada-ayer' && e.elements.some((x) => x.type === 'text' && x.text.includes('corregido'))));
  await hh.click('[data-testid=day-next]');
  await hh.waitForSelector('[data-testid=new-text]');
  await ctxH.close();
  log('Días pasados: calendario con los días capturados; ayer se corrige y lo de antes solo se ve');

  if (NUBE) {
    // Con la clave de captura no se entra a la vista de computadora ni al QR.
    await b.goto(`${base}/#/escritorio`);
    await b.waitForSelector('[data-testid=needs-edit-key]');
    await shot(b, '07b-captura-sin-escritorio');
    await b.goto(`${base}/#/qr`);
    await b.waitForSelector('[data-testid=needs-edit-key]');
    const tpl = await b.evaluate(async () => (await fetch('/api/template', { headers: { 'x-team-key': localStorage.getItem('vw.key') ?? '' } })).status);
    assert(tpl === 403, `la clave de captura no baja la plantilla (respondió ${tpl})`);
    log('B: con la clave de captura no hay vista de computadora, QR ni plantilla');
  }

  // --- Computadora: generar la bitácora ---------------------------------------------
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'es-MX' });
  const d = await ctxD.newPage();
  watch(d, 'PC');
  await d.goto(backend.deskLink());
  await d.waitForSelector('.desk .card');
  assert(!hasKey(d.url()), `la clave de edición se quita de la barra de direcciones (${d.url()})`);
  await shot(d, '08-escritorio');
  // Indicador de sesión sin cierre (hace tres días) en la computadora.
  await d.locator('.side-item', { hasText: 'sin cierre' }).first().click();
  await d.waitForSelector('[data-testid=desk-no-closing]');
  await shotBoth(d, '31-escritorio-sin-cierre', false);
  await d.locator('.side-item').first().click();
  log('PC: la sesión de hace tres días se marca "sin cierre"');

  // Editar el cierre de un día desde la computadora.
  await d.waitForSelector('[data-testid=desk-edit-closing]');
  const closingDate = await d.getAttribute('[data-testid=desk-edit-closing] >> nth=0', 'data-date');
  await d.click('[data-testid=desk-edit-closing] >> nth=0');
  await d.waitForSelector('[data-testid=closing-did]');
  const didBefore = await d.inputValue('[data-testid=closing-did]');
  await d.fill('[data-testid=closing-did]', `${didBefore} (corregido en la computadora)`);
  await d.click('[data-testid=closing-save]');
  await d.waitForSelector('[data-testid=desk-edit-closing]');
  assert(d.url().includes('#/escritorio'), 'al guardar el cierre vuelve a la vista de computadora');
  await until('el cierre corregido llega al servidor', async () => (await backend.sessions()).some((s) => s.date === closingDate && (s.closing?.whatWeDid ?? '').includes('corregido en la computadora')));
  log('PC: el cierre de un día se corrige desde la vista de computadora');

  // Mapas de puertos y del control del Robot A (computadora), con historial.
  const fillMap = async (kind: 'ports' | 'controller', values: Record<string, string>) => {
    await d.click('[data-testid=open-team]');
    await d.click(`[data-testid=open-map-${kind}][data-robot=robot-a]`);
    for (const [slot, v] of Object.entries(values)) await d.fill(`[data-testid=map-form-${kind}] [data-slot="${slot}"]`, v);
    await shotBoth(d, `32-mapa-${kind}`, false);
    await d.click('[data-testid=map-save]');
    await d.waitForSelector(`[data-testid=open-map-${kind}][data-robot=robot-a]`);
  };
  await fillMap('ports', { '1': 'Motor izq. delantero', '2': 'Motor izq. trasero', '11': 'Motor der. delantero', '21': 'Radio', A: 'Pistón del intake' });
  await fillMap('controller', { L1: 'Intake adentro', R2: 'Disparar', axis3: 'Avanzar / retroceder', X: 'Cambiar modo' });
  await d.click('[data-testid=team-close]');
  const teamNow = (await (await fetch(backend.deskBase + apiPath.state(), { headers: { 'x-team-key': backend.editKey } })).json()) as StateResponse;
  const ra = teamNow.team.robots.find((r) => r.id === 'robot-a');
  assert(ra?.ports?.[0]?.slots['21'] === 'Radio' && ra.controller?.[0]?.slots.L1 === 'Intake adentro', 'los mapas llegan al equipo en el servidor');
  log('PC: mapa de puertos y del control del Robot A guardados');
  const [download] = await Promise.all([d.waitForEvent('download', { timeout: 120_000 }), d.click('[data-testid=generate]')]);
  const pptx = join(OUT, 'bitacora-e2e.pptx');
  await download.saveAs(pptx);
  await d.waitForSelector('[data-testid=generate-ok]');
  await shot(d, '09-escritorio-generado');
  const bytes = readFileSync(pptx);
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 100_000, 'el .pptx es un zip de buen tamaño');
  // Lo nuevo dentro del .pptx: las diapositivas se llaman slide1.xml… en orden.
  const zip = unzipSync(new Uint8Array(bytes));
  const slides = Object.keys(zip)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((x, y) => Number(/\d+/.exec(x)?.[0]) - Number(/\d+/.exec(y)?.[0]))
    .map((n) => strFromU8(zip[n] as Uint8Array));
  const slideWith = (s: string) => slides.find((x) => x.includes(s));
  const mech = slideWith('A: Rodillo de entrada');
  assert(mech && mech.includes('<p:grpSp>') && (mech.match(/straightConnector1/g) ?? []).length === 2 && (mech.match(/prst="ellipse"/g) ?? []).length === 2, 'la foto anotada sale con flechas y etiquetas como formas, y la tabla de etiquetas llena');
  assert(mech.includes('Jala los anillos hacia adentro') && mech.includes('Motor del intake'), 'la tabla de etiquetas trae qué hace y por qué');
  const tour = slides.find((x) => x.includes('Registro de torneo') && x.includes('Q12'));
  assert(tour && tour.includes('PARTIDOS') && tour.includes('Q13') && tour.includes('Se salió la cadena del intake'), 'la página de registro de torneo trae los partidos');
  assert(slides.some((x) => x.includes('Subimos la tensión de la cadena') && x.includes('Registro de cambios')), 'lo que se ajustó en el torneo llega al registro de cambios');
  assert(slides.some((x) => x.includes('Lluvia de ideas') && x.includes('<p:pic>')), 'el boceto llega a la lluvia de ideas');
  // (La tabla de contenido también trae los títulos: se busca la página por su contenido.)
  assert(slides.some((x) => x.includes('Mapa de puertos del Brain: Robot A') && x.includes('Pistón del intake') && x.includes('Radio')), 'el mapa de puertos sale lleno');
  assert(slides.some((x) => x.includes('Mapa del control: Robot A') && x.includes('Avanzar / retroceder')), 'el mapa del control sale lleno');
  const monthTitle = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).replace(/ de /, ' ');
  const monthCap = monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1);
  assert(slides.some((x) => x.includes(`<a:t>${monthCap}</a:t>`) && x.includes('Taller (')), `el calendario de ${monthCap} sale con las sesiones`);
  const auton = slideWith('Tomar el objeto del centro');
  assert(auton && auton.includes('<a:srcRect') && (auton.match(/prst="ellipse"/g) ?? []).length === 3 && (auton.match(/straightConnector1/g) ?? []).length === 2, 'la ruta sale sobre el mapa del campo con puntos y flechas, y la tabla de pasos llena');
  log(`PC: en el .pptx están la foto anotada (formas), el registro de torneo, el ajuste en el registro de cambios y el boceto (${slides.length} diapositivas)`);
  log(`PC: bitácora generada en el navegador (${(bytes.length / 1024).toFixed(0)} KB): ${await d.textContent('[data-testid=generate-report]')}`);
  await d.locator('.desk .card').first().click();
  await d.waitForSelector('.panel [data-testid=marks]');
  // "Más detalles" abierto por defecto, con la clasificación completa a la vista.
  assert(await d.locator('.panel [data-testid=more-details]').evaluate((x) => (x as HTMLDetailsElement).open), 'en la computadora "Más detalles" va abierto');
  for (const t of ['class-target', 'class-what', 'class-authors', 'milestone', 'mark-change', 'section', 'kind-select', 'thread-input']) assert((await d.locator(`.panel [data-testid=${t}]`).count()) === 1, `el editor de la computadora muestra ${t}`);
  await shot(d, '10-escritorio-editor');
  // Siguiente sin cerrar el panel: con la tecla J y con el botón.
  const pos1 = await d.textContent('[data-testid=editor-position]');
  await d.keyboard.press('j');
  await until('J pasa a la siguiente entrada', async () => (await d.textContent('[data-testid=editor-position]')) !== pos1);
  const nextId = await d.locator('.desk .card.selected').getAttribute('data-entry');
  // Marca "Cambio" desde su interruptor; llega al servidor.
  await d.click('.panel [data-testid=mark-change]');
  await until('"Cambio" desde la computadora llega al servidor', async () => (await liveEntries()).find((e) => e.id === nextId && e.marks.includes('change')));
  await d.click('[data-testid=editor-prev]');
  await until('el botón anterior regresa', async () => (await d.textContent('[data-testid=editor-position]')) === pos1);
  await d.keyboard.press('Escape');
  await until('Esc cierra el panel', async () => (await d.locator('.panel[hidden]').count()) === 1);
  log('PC: editor con la clasificación completa, siguiente/anterior (J y botones), "Cambio" y Esc');

  if (!NUBE) {
    // Con el servidor local no hay service worker, ni en localhost (que sí es contexto seguro).
    const regs = await d.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    assert(regs === 0, `sin service worker con el servidor local (hay ${regs})`);
    log('PC: con el servidor local no se registra service worker');
  }

  if (NUBE) {
    // Página del QR (clave de edición): el enlace de captura con la clave de captura.
    await d.click('[data-testid=open-qr]');
    await d.waitForSelector('[data-testid=qr-image]');
    const link = (await d.textContent('.qr-link')) ?? '';
    assert(link === backend.captureLink(), `el QR lleva el enlace de captura (${link})`);
    assert(!link.includes(backend.editKey), 'el QR no lleva la clave de edición');
    await shot(d, '11-qr');
    log('PC: página del QR con el enlace de captura');
  }

  if (NUBE && worker) {
    // --- Una versión nueva de la app sí llega ------------------------------------------
    const v2App = join(OUT, 'app-v2');
    const viteBin = join(ROOT, 'node_modules/vite/bin/vite.js');
    const build = spawnSync(process.execPath, [viteBin, 'build', '--outDir', v2App, '--emptyOutDir', '--logLevel', 'warn'], {
      cwd: join(ROOT, 'packages/app'),
      env: { ...process.env, VW_BUILD_LABEL: 'e2e-v2' },
      stdio: 'inherit',
    });
    assert(build.status === 0, 'se compila la versión 2 de la app');
    const v1Label = (await a.textContent('[data-testid=build]')) ?? '';
    const oldCaches = await a.evaluate(() => caches.keys());
    await worker.setAssets(buildAssets(v2App, join(OUT, 'public-v2')));
    // Los datos siguen ahí después de publicar.
    assert((await liveEntries()).length >= 6, 'los datos siguen después de publicar la versión nueva');
    // El teléfono A tiene la app abierta: busca la versión nueva (como al volver a la pestaña).
    await a.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await a.waitForSelector('[data-testid=update-banner]', { timeout: 30_000 });
    await shot(a, '12-aviso-version-nueva');
    await Promise.all([a.waitForEvent('load'), a.click('[data-testid=update-reload]')]);
    await until('A tiene la versión nueva', async () => ((await a.textContent('[data-testid=build]').catch(() => '')) ?? '').includes('e2e-v2'));
    const newCaches = await a.evaluate(() => caches.keys());
    assert(newCaches.length === 1 && !oldCaches.includes(newCaches[0] as string), `se borró la caché vieja (${oldCaches} → ${newCaches})`);
    log(`A: llegó la versión nueva (${v1Label} → e2e-v2) y se borró la caché vieja`);
    // Un teléfono que abre la app de cero recibe la versión nueva directo.
    const fresh = await ctxB.newPage();
    watch(fresh, 'B2');
    await fresh.goto(`${base}/`);
    await until('B abre la versión nueva', async () => ((await fresh.textContent('[data-testid=build]').catch(() => '')) ?? '').includes('e2e-v2'));
    await shot(fresh, '13-version-nueva-b');
    log('B: al abrir la app ya recibe la versión nueva');
  }

  assert(errors.length === 0, `sin errores en la consola:\n${errors.join('\n')}`);
  writeFileSync(join(OUT, 'resultado.json'), JSON.stringify({ ok: true, backend: NUBE ? 'worker' : 'dev-server', pptx, shots: SHOTS, entries: (await liveEntries()).length }, null, 2));
  console.log(`\nTODO BIEN. Capturas en ${SHOTS}\nBitácora: ${pptx}`);
} finally {
  await browser.close();
  await backend.close();
}
