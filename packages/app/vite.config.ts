import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Etiqueta de la versión (se muestra al pie de la app). */
const BUILD_LABEL = process.env.VW_BUILD_LABEL ?? new Date().toISOString().slice(0, 16).replace('T', ' ');

/**
 * Escribe dist/sw.js a partir de service-worker.js con la lista de archivos
 * de esta compilación y una huella de su contenido (si cambia cualquier
 * archivo, cambia sw.js y el navegador instala la versión nueva).
 */
function serviceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'vortex-wake-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, d.name);
          if (d.isDirectory()) walk(full);
          else files.push(relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 16);
      const precache = ['/', ...list.filter((f) => f !== 'index.html').map((f) => `/${f}`)];
      const src = readFileSync(resolve(import.meta.dirname, 'service-worker.js'), 'utf8')
        .replace("const VERSION = '__VW_VERSION__';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = __VW_PRECACHE__;', `const PRECACHE = ${JSON.stringify(precache)};`);
      if (src.includes("'__VW_VERSION__';") || src.includes('= __VW_PRECACHE__')) throw new Error('service-worker.js: no se pudieron llenar la versión y la lista de archivos');
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

// En desarrollo (`npm run dev -w @vortex-wake/app`) las llamadas a /api van al
// servidor local del taller (packages/dev-server) en el puerto 4321.
export default defineConfig({
  root: import.meta.dirname,
  define: { __VW_BUILD__: JSON.stringify(BUILD_LABEL) },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true, proxy: { '/api': 'http://localhost:4321' } },
  plugins: [serviceWorker()],
});
