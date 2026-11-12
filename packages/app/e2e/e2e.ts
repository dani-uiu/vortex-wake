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
import { TEAM_FORMAT, apiPath, type CaptureSession, type Entry, type StateResponse, type TeamConfig } from '@vortex-wake/shared';
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

const liveEntries = async () => (await backend.entries()).filter((e) => !e.deleted);
const hasKey = (url: string) => url.includes(backend.captureKey) || url.includes(backend.editKey);

try {
  // --- Teléfono A ---------------------------------------------------------------
  const ctxA = await browser.newContext(phone);
  let a = await ctxA.newPage();
  watch(a, 'A');
  await a.goto(backend.captureLink());
  await a.waitForSelector('.who-btn');
  assert(!hasKey(a.url()), `la clave se quita de la barra de direcciones (${a.url()})`);
  await shot(a, '01-quien-eres');
  await a.click('[data-member="ana"]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('asistencia de Ana en el servidor', async () => (await backend.sessions()).some((s) => s.attendance.some((x) => x.memberId === 'ana')));
  log('A: eligió su nombre y quedó su asistencia');

  // Foto primero: un toque y queda guardada.
  await a.setInputFiles('[data-testid=photo-input]', PHOTO);
  await a.waitForSelector('.card [data-status]');
  await until('foto en el servidor', async () => (await liveEntries()).some((e) => e.elements.some((x) => x.type === 'photo')) && (await backend.photoIds()).length >= 1);
  const jpg = await backend.photo((await backend.photoIds())[0] as string);
  assert(jpg[0] === 0xff && jpg[1] === 0xd8, 'la foto llega como JPEG');
  log(`A: foto guardada y enviada (${jpg.length} bytes)`);

  // Nota con clasificación.
  await a.click('[data-testid=new-text]');
  await a.waitForSelector('[data-testid=text-input]');
  await a.fill('[data-testid=text-input]', 'Armamos el chasis y tensamos la cadena del lado izquierdo.');
  await a.click('[data-testid=section] [data-value=mechanics]');
  await a.click('[data-testid=kind] [data-value=buildIteration]');
  await a.click('[data-testid=robot] [data-value=robot-a]');
  await a.click('[data-testid=subsystem] [data-value=chasis]');
  await a.click('[data-testid=marks] [data-value=change]');
  await a.fill('[data-testid=thread-input]', 'chasis v1');
  await shot(a, '02-editor-nota');
  await a.click('[data-testid=editor-done]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('nota clasificada en el servidor', async () => (await liveEntries()).find((e) => e.kind === 'buildIteration' && e.thread === 'chasis v1' && e.elements.some((x) => x.type === 'text' && x.text.includes('cadena'))));
  log('A: nota clasificada enviada');

  // Contador de pruebas.
  await a.click('[data-testid=new-trials]');
  await a.waitForSelector('[data-testid=trial-ok]');
  for (const ok of [true, true, false, true]) await a.click(ok ? '[data-testid=trial-ok]' : '[data-testid=trial-fail]');
  await a.fill('.trial-list li:nth-child(2) input', 'Se atoró la pieza');
  await a.click('[data-testid=kind] [data-value=test]');
  await a.click('[data-testid=section] [data-value=mechanics]');
  assert((await a.textContent('[data-testid=trials-score]'))?.includes('3 de 4'), 'el contador muestra 3 de 4');
  await shot(a, '03-contador');
  await a.click('[data-testid=editor-done]');
  await until('contador en el servidor', async () => (await liveEntries()).find((e) => e.elements.some((x) => x.type === 'trials' && x.trials.length === 4 && x.trials.some((t) => t.note === 'Se atoró la pieza'))));
  await shot(a, '04-lista');
  log('A: contador de pruebas (3 de 4, con nota) enviado');

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

  // --- Teléfono B (misma sesión) --------------------------------------------------
  const ctxB = await browser.newContext({ ...phone, colorScheme: 'dark' });
  const b = await ctxB.newPage();
  watch(b, 'B');
  await b.goto(backend.captureLink());
  await b.click('[data-member="beto"]');
  await b.waitForSelector('[data-testid=entry-list]');
  await until('B ve las entradas de A', async () => (await b.locator('.card').count()) >= 5);
  await b.click('[data-testid=new-text]');
  await b.fill('[data-testid=text-input]', 'Programamos el autónomo de la izquierda.');
  await b.click('[data-testid=section] [data-value=coding]');
  await b.click('[data-testid=editor-done]');
  // B edita una entrada de A (la foto sin clasificar).
  await b.click('[data-testid=filter-todo]');
  await b.locator('.card', { hasText: 'Capturado sin señal' }).click();
  await b.waitForSelector('[data-testid=marks]');
  await b.click('[data-testid=marks] [data-value=milestone]');
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
  const [download] = await Promise.all([d.waitForEvent('download', { timeout: 120_000 }), d.click('[data-testid=generate]')]);
  const pptx = join(OUT, 'bitacora-e2e.pptx');
  await download.saveAs(pptx);
  await d.waitForSelector('[data-testid=generate-ok]');
  await shot(d, '09-escritorio-generado');
  const bytes = readFileSync(pptx);
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.length > 100_000, 'el .pptx es un zip de buen tamaño');
  log(`PC: bitácora generada en el navegador (${(bytes.length / 1024).toFixed(0)} KB): ${await d.textContent('[data-testid=generate-report]')}`);
  await d.locator('.desk .card').first().click();
  await d.waitForSelector('.panel [data-testid=marks]');
  await shot(d, '10-escritorio-editor');

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
