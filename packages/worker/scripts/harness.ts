/**
 * Arranca el Worker en el entorno local de Workers (workerd, el mismo que usa
 * `wrangler dev`) para pruebas: D1 y R2 locales en memoria, migraciones
 * aplicadas y claves de prueba. No necesita cuenta de Cloudflare.
 *
 * Lo usan las pruebas del Worker, la de subida de datos y la de punta a punta.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness, type TestHarness } from 'wrangler';
import { WORKER_DIR } from './build.ts';

export interface LocalWorker {
  server: TestHarness;
  url: string;
  captureKey: string;
  editKey: string;
  /** Cambia los archivos estáticos (por ejemplo, para simular que se publicó una versión nueva). */
  setAssets(dir: string): Promise<void>;
  close(): Promise<void>;
}

export interface LocalWorkerOptions {
  /** Carpeta de archivos estáticos (por defecto, una mínima de prueba). */
  assetsDir?: string;
  captureKey?: string;
  editKey?: string;
}

/** Lee wrangler.jsonc (JSON con comentarios) y deja todas las rutas absolutas. */
function configFor(assetsDir: string): Record<string, unknown> {
  const text = readFileSync(join(WORKER_DIR, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const cfg = JSON.parse(text) as Record<string, unknown> & { assets: Record<string, unknown>; d1_databases: Record<string, unknown>[] };
  delete cfg.$schema;
  cfg.main = join(WORKER_DIR, 'src/index.ts');
  cfg.assets = { ...cfg.assets, directory: assetsDir };
  cfg.d1_databases = cfg.d1_databases.map((d) => ({ ...d, migrations_dir: join(WORKER_DIR, 'migrations') }));
  return cfg;
}

/** Archivos estáticos mínimos: una página y una "plantilla" falsa. */
export function fakeAssets(dir: string): string {
  mkdirSync(join(dir, 'private'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Vortex Wake</title><div id="app"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'private', 'template.pptx'), new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]));
  return dir;
}

export async function startLocalWorker(opts: LocalWorkerOptions = {}): Promise<LocalWorker> {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-worker-'));
  const captureKey = opts.captureKey ?? 'captura-de-prueba-0123456789';
  const editKey = opts.editKey ?? 'edicion-de-prueba-0123456789';
  const configPath = join(tmp, 'wrangler.json');
  const write = (assetsDir: string) => writeFileSync(configPath, JSON.stringify(configFor(assetsDir), null, 2));
  write(opts.assetsDir ?? fakeAssets(join(tmp, 'public')));
  const worker = () => ({ configPath, secrets: { CAPTURE_KEY: captureKey, EDIT_KEY: editKey } });
  const server = createTestHarness({ root: tmp, workers: [worker()] });
  const { url } = await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  return {
    server,
    url: url.href.replace(/\/$/, ''),
    captureKey,
    editKey,
    async setAssets(dir: string) {
      write(dir);
      await server.update({ root: tmp, workers: [worker()] });
    },
    async close() {
      await server.close();
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
