/**
 * Arranca el servidor del taller.
 *
 *   node packages/dev-server/src/main.ts [--port 4321] [--open]
 *
 * Variables: VW_DATA_DIR (carpeta de datos, por defecto data/), VW_TEAM_KEY
 * (clave del equipo; por defecto la de data/server.json), PORT.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureUrl, lanAddresses, qrAscii, startServer } from './server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const port = Number(arg('--port') ?? process.env.PORT ?? 4321);
const dataDir = resolve(process.env.VW_DATA_DIR ?? join(ROOT, 'data'));
const staticDir = join(ROOT, 'packages/app/dist');

const running = await startServer({
  dataDir,
  exampleTeamPath: join(ROOT, 'examples/team-ejemplo.json'),
  staticDir,
  templatePath: join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx'),
  port,
  ...(process.env.VW_TEAM_KEY ? { teamKey: process.env.VW_TEAM_KEY } : {}),
}).catch((e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`El puerto ${port} ya está ocupado. ¿Ya hay otro servidor del taller abierto? Ciérralo o usa --port 4322.`);
  else console.error(e);
  process.exit(1);
});

const addrs = lanAddresses();
const main = addrs[0]?.address;
const line = '─'.repeat(60);
console.log(line);
console.log(' Vortex Wake · servidor del taller');
console.log(line);
if (!existsSync(join(staticDir, 'index.html'))) console.log(' AVISO: la app no está compilada (corre "npm run taller").');
if (running.store.teamFromExample) console.log(' AVISO: no existe data/team.json; se usa el equipo de ejemplo.');
console.log(` Datos:        ${dataDir}`);
console.log(` En esta laptop (QR y vista de computadora): http://localhost:${running.port}/qr`);
if (main) {
  console.log(` Celulares:    ${captureUrl(main, running.port, running.teamKey)}`);
  for (const a of addrs.slice(1)) console.log(`               (otra red: ${captureUrl(a.address, running.port, running.teamKey)} · ${a.name})`);
  console.log('');
  console.log(qrAscii(captureUrl(main, running.port, running.teamKey)));
} else {
  console.log(' No hay red local: conecta la laptop al wifi o activa su hotspot y reinicia.');
}
console.log(' Para detener: Ctrl+C');
console.log(line);

if (args.includes('--open')) {
  const url = `http://localhost:${running.port}/qr`;
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

const stop = () => {
  void running.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
