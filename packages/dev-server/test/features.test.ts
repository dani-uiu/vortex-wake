/**
 * Contrato de las funciones nuevas en el servidor local (los mismos casos que
 * packages/worker/test/features.test.ts): todo es aditivo y opcional.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe } from 'vitest';
import { TEAM_KEY_HEADER } from '@vortex-wake/shared';
import { startServer, type RunningServer } from '../src/server.ts';
import { featureContract } from '../../shared/test/feature-contract.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let srv: RunningServer;
let dir: string;
const KEY = 'clave-prueba';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-server-f-'));
  srv = await startServer({
    dataDir: dir,
    exampleTeamPath: join(ROOT, 'examples/team-ejemplo.json'),
    staticDir: join(dir, 'no-app'),
    templatePath: join(ROOT, 'template/V5_Engineering_Notebook_Template_ES.pptx'),
    port: 0,
    host: '127.0.0.1',
    teamKey: KEY,
  });
});

afterAll(async () => {
  await srv.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('servidor local: funciones nuevas', () => {
  featureContract(() => ({
    call: (path, init = {}) =>
      fetch(`http://127.0.0.1:${srv.port}${path}`, { ...init, headers: { [TEAM_KEY_HEADER]: KEY, 'content-type': 'application/json', ...(init.headers ?? {}) } }),
    editCall: (path, init = {}) =>
      fetch(`http://127.0.0.1:${srv.port}${path}`, { ...init, headers: { [TEAM_KEY_HEADER]: KEY, 'content-type': 'application/json', ...(init.headers ?? {}) } }),
  }));
});
