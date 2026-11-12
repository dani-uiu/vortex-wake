import { defineConfig } from 'vite';

// En desarrollo (`npm run dev -w @vortex-wake/app`) las llamadas a /api van al
// servidor local del taller (packages/dev-server) en el puerto 4321.
export default defineConfig({
  root: import.meta.dirname,
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { host: true, proxy: { '/api': 'http://localhost:4321' } },
});
