/**
 * Contrato de las funciones nuevas en el Worker (los mismos casos que
 * packages/dev-server/test/features.test.ts).
 */

import { afterAll, beforeAll, describe } from 'vitest';
import { startLocalWorker, type LocalWorker } from '../scripts/harness.ts';
import { featureContract } from '../../shared/test/feature-contract.ts';

let w: LocalWorker;

beforeAll(async () => {
  w = await startLocalWorker();
}, 60_000);

afterAll(async () => {
  await w?.close();
});

const req = (key: string) => (path: string, init: RequestInit = {}) =>
  fetch(w.url + path, { ...init, headers: { 'x-team-key': key, 'content-type': 'application/json', ...(init.headers ?? {}) } });

describe('Worker: funciones nuevas', () => {
  featureContract(() => ({ call: req(w.captureKey), editCall: req(w.editKey) }));
});
