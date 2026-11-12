/**
 * Corre el Worker en el simulador local de wrangler (sin cuenta de
 * Cloudflare): `npm run nube:local`.
 *
 * - La primera vez crea packages/worker/.dev.vars con dos claves al azar
 *   (ese archivo está en .gitignore y es solo para el simulador).
 * - Aplica las migraciones a la base D1 local (en packages/worker/.wrangler/).
 * - Muestra los enlaces de captura y de edición y arranca `wrangler dev`.
 *
 * Opciones: --port 8787, --red (escucha también en la red local, para probar
 * desde un celular; por http no hay service worker).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, WORKER_DIR } from './build.ts';
import { newKey } from './keys.ts';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 8787;
const wranglerBin = join(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const wrangler = (a: string[]) => [wranglerBin, ...a];

const devVars = join(WORKER_DIR, '.dev.vars');
if (!existsSync(devVars)) {
  writeFileSync(devVars, `# Claves SOLO para el simulador local (no se suben a git ni a Cloudflare).\nCAPTURE_KEY=${newKey()}\nEDIT_KEY=${newKey()}\n`);
  console.log('Se creó packages/worker/.dev.vars con claves nuevas para el simulador.');
}
const vars = Object.fromEntries(
  readFileSync(devVars, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const migrate = spawnSync(process.execPath, wrangler(['d1', 'migrations', 'apply', 'DB', '--local']), { cwd: WORKER_DIR, stdio: 'inherit', env: { ...process.env, CI: '1' } });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const line = '─'.repeat(70);
console.log(line);
console.log(' Vortex Wake · Worker en el simulador local');
console.log(line);
console.log(` Captura (celular):      http://localhost:${port}/#k=${vars.CAPTURE_KEY ?? '?'}`);
console.log(` Vista de computadora:   http://localhost:${port}/#/escritorio?k=${vars.EDIT_KEY ?? '?'}`);
console.log(` QR:                     http://localhost:${port}/#/qr (con la clave de edición)`);
console.log(` Subir data/ aquí:       npm run nube:subir-datos -- --local   (clave: la EDIT_KEY de packages/worker/.dev.vars)`);
console.log(' Para detener: Ctrl+C');
console.log(line);

const dev = spawn(process.execPath, wrangler(['dev', '--port', String(port), ...(args.includes('--red') ? ['--ip', '0.0.0.0'] : [])]), { cwd: WORKER_DIR, stdio: 'inherit' });
const stop = () => dev.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', (code) => process.exit(code ?? 0));
