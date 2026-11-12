/**
 * Prueba de punta a punta en Edge (playwright-core con el Edge instalado; no
 * descarga navegadores). Corre con `npm run e2e` (compila la app antes).
 *
 * - Dos "teléfonos" (contextos de 360 px) en la misma sesión, por la IP de red.
 * - Foto (archivo de prueba), texto, contador de pruebas y clasificación.
 * - Sin conexión: lo capturado se queda en el teléfono, sobrevive a cerrar la
 *   pestaña y se envía al volver. También con el servidor apagado y vuelto a
 *   prender.
 * - Vista de computadora: genera el .pptx y lo descarga.
 *
 * Capturas, datos y el .pptx van a %TEMP%\vortex-wake-app\e2e (fuera del repo).
 * Usa el equipo de ejemplo (datos ficticios).
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { lanAddresses, startServer, type RunningServer } from '../../dev-server/src/server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(process.env.TEMP ?? tmpdir(), 'vortex-wake-app', 'e2e');
const DATA = join(OUT, 'data');
const SHOTS = join(OUT, 'capturas');
const KEY = 'e2e-clave';
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

const serverOpts = (port: number) => ({
  dataDir: DATA,
  exampleTeamPath: join(ROOT, 'examples/team-ejemplo.json'),
  staticDir: join(ROOT, 'packages/app/dist'),
  templatePath: join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx'),
  port,
  host: '0.0.0.0',
  teamKey: KEY,
});

let server: RunningServer = await startServer(serverOpts(0));
const port = server.port;
const lan = lanAddresses()[0]?.address;
log(`servidor en el puerto ${port}; IP de red: ${lan ?? '(ninguna)'}`);

// 1. Responde por la IP de red, no solo por localhost.
if (lan) {
  const r = await fetch(`http://${lan}:${port}/api/state`, { headers: { 'x-team-key': KEY } });
  assert(r.status === 200, `el servidor responde en http://${lan}:${port}`);
  const page = await fetch(`http://${lan}:${port}/`);
  assert((await page.text()).includes('<div id="app">'), 'la app se sirve por la IP de red');
  log(`responde por la IP de red ${lan}`);
}
const base = `http://${lan ?? 'localhost'}:${port}`;

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

const liveEntries = () => [...server.store.entries.values()].filter((e) => !e.deleted);

try {
  // --- Teléfono A ---------------------------------------------------------------
  const ctxA = await browser.newContext(phone);
  let a = await ctxA.newPage();
  watch(a, 'A');
  await a.goto(`${base}/?k=${KEY}`);
  await a.waitForSelector('.who-btn');
  assert(!a.url().includes('k='), 'la clave se quita de la barra de direcciones');
  await shot(a, '01-quien-eres');
  await a.click('[data-member="ana"]');
  await a.waitForSelector('[data-testid=entry-list]');
  await until('asistencia de Ana en el servidor', () => [...server.store.sessions.values()].some((s) => s.attendance.some((x) => x.memberId === 'ana')));
  log('A: eligió su nombre y quedó su asistencia');

  // Foto primero: un toque y queda guardada.
  await a.setInputFiles('[data-testid=photo-input]', PHOTO);
  await a.waitForSelector('.card [data-status]');
  await until('foto en el servidor', () => liveEntries().some((e) => e.elements.some((x) => x.type === 'photo')) && readDirCount(join(DATA, 'photos')) >= 1);
  const photoFile = readdirFirst(join(DATA, 'photos'));
  const jpg = readFileSync(join(DATA, 'photos', photoFile));
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
  await until('nota clasificada en el servidor', () => liveEntries().find((e) => e.kind === 'buildIteration' && e.thread === 'chasis v1' && e.elements.some((x) => x.type === 'text' && x.text.includes('cadena'))));
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
  await until('contador en el servidor', () => liveEntries().find((e) => e.elements.some((x) => x.type === 'trials' && x.trials.length === 4 && x.trials.some((t) => t.note === 'Se atoró la pieza'))));
  await shot(a, '04-lista');
  log('A: contador de pruebas (3 de 4, con nota) enviado');

  // --- Sin conexión ------------------------------------------------------------------
  const before = liveEntries().length;
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
  assert(liveEntries().length === before, 'sin conexión nada llega al servidor');
  // Se cierra la pestaña sin conexión.
  await a.close();
  log('A: dos capturas sin conexión y pestaña cerrada');
  await ctxA.setOffline(false);
  a = await ctxA.newPage();
  watch(a, 'A2');
  await a.goto(`${base}/`);
  await until('lo capturado sin señal llega al servidor', () => liveEntries().length === before + 2 && liveEntries().some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Capturado sin señal')));
  await until('2 fotos en el servidor', () => readDirCount(join(DATA, 'photos')) === 2);
  await until('indicador "Todo enviado"', async () => (await a.getAttribute('[data-testid=sync]', 'data-pending')) === '0');
  log('A: al volver, se envió todo lo capturado sin conexión');

  // --- Servidor apagado y vuelto a prender ---------------------------------------
  await server.close();
  await a.click('[data-testid=new-text]');
  await a.fill('[data-testid=text-input]', 'Con la laptop apagada');
  await a.click('[data-testid=editor-done]');
  await until('indicador sin conexión (servidor apagado)', async () => (await a.getAttribute('[data-testid=sync]', 'data-online')) === 'false', 30_000);
  server = await startServer(serverOpts(port));
  await until('entrada con el servidor apagado llega al volver', () => liveEntries().some((e) => e.elements.some((x) => x.type === 'text' && x.text === 'Con la laptop apagada')), 30_000);
  log('A: con el servidor apagado se guardó en el teléfono y se envió al volver');

  // --- Teléfono B (misma sesión) --------------------------------------------------
  const ctxB = await browser.newContext({ ...phone, colorScheme: 'dark' });
  const b = await ctxB.newPage();
  watch(b, 'B');
  await b.goto(`${base}/?k=${KEY}`);
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
  await until('B: la edición de una entrada ajena llega', () => liveEntries().some((e) => e.marks.includes('milestone') && e.capturedBy === 'ana' && e.elements.some((x) => x.type === 'text' && x.text === 'Capturado sin señal')));
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
  await until('cierre en el servidor', () => [...server.store.sessions.values()].some((s) => s.closing?.whatWeDid === 'Chasis y autónomo'));
  log('B: cierre de sesión guardado');

  // --- Computadora: generar la bitácora ---------------------------------------------
  const ctxD = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'es-MX' });
  const d = await ctxD.newPage();
  watch(d, 'PC');
  await d.goto(`http://localhost:${port}/?k=${KEY}#/escritorio`);
  await d.waitForSelector('.desk .card');
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

  assert(errors.length === 0, `sin errores en la consola:\n${errors.join('\n')}`);
  writeFileSync(join(OUT, 'resultado.json'), JSON.stringify({ ok: true, pptx, shots: SHOTS, entries: liveEntries().length }, null, 2));
  console.log(`\nTODO BIEN. Capturas en ${SHOTS}\nBitácora: ${pptx}`);
} finally {
  await browser.close();
  await server.close();
}

function readDirCount(dir: string): number {
  try {
    return readdirList(dir).filter((f) => f.endsWith('.jpg')).length;
  } catch {
    return 0;
  }
}
function readdirFirst(dir: string): string {
  return readdirList(dir).filter((f) => f.endsWith('.jpg'))[0] as string;
}
function readdirList(dir: string): string[] {
  return readdirSync(dir);
}
