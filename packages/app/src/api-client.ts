/** Cliente HTTP del contrato de `@vortex-wake/shared` (api.ts). */

import {
  TEAM_KEY_HEADER,
  TEAM_KEY_QUERY,
  apiPath,
  type Attendance,
  type Entry,
  type PutEntryResponse,
  type PutTaskResponse,
  type TaskItem,
  type QrResponse,
  type SessionClosing,
  type StateResponse,
  type TeamConfig,
} from '@vortex-wake/shared';
import { HttpStatusError, NetworkError, type Transport } from './sync-queue.ts';

const TIMEOUT_MS = 20_000;
const PHOTO_TIMEOUT_MS = 90_000;

export class ApiClient implements Transport {
  private readonly key: string;
  private readonly base: string;

  constructor(key: string, base = '') {
    this.key = key;
    this.base = base;
  }

  private async req(path: string, init: RequestInit = {}, timeout = TIMEOUT_MS): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        ...init,
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { [TEAM_KEY_HEADER]: this.key, ...(init.headers ?? {}) },
      });
    } catch (e) {
      throw new NetworkError((e as Error).message || 'sin conexión');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let msg = `error ${res.status}`;
      try {
        msg = ((await res.json()) as { error?: string }).error ?? msg;
      } catch {
        /* sin cuerpo */
      }
      throw new HttpStatusError(res.status, msg);
    }
    return res;
  }

  private async json<T>(path: string, method: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await this.req(path, init);
    return (await res.json()) as T;
  }

  state(date?: string): Promise<StateResponse> {
    return this.json<StateResponse>(apiPath.state(date), 'GET');
  }
  putEntry(entry: Entry): Promise<PutEntryResponse> {
    return this.json<PutEntryResponse>(apiPath.entry(entry.id), 'PUT', entry);
  }
  async putPhoto(id: string, bytes: Uint8Array): Promise<void> {
    await this.req(apiPath.photo(id), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': 'image/jpeg' } }, PHOTO_TIMEOUT_MS);
  }
  async putAudio(id: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.req(apiPath.audio(id), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': mime } }, PHOTO_TIMEOUT_MS);
  }
  async attend(date: string, a: Attendance): Promise<void> {
    await this.json(apiPath.attendance(date), 'POST', a);
  }
  async closing(date: string, c: SessionClosing): Promise<void> {
    await this.json(apiPath.closing(date), 'PUT', c);
  }
  async addMember(id: string, name: string): Promise<void> {
    await this.json(apiPath.members(), 'POST', { id, name });
  }
  putTask(task: TaskItem): Promise<PutTaskResponse> {
    return this.json<PutTaskResponse>(apiPath.task(task.id), 'PUT', task);
  }
  async putTeam(team: TeamConfig): Promise<TeamConfig> {
    return (await this.json<{ team: TeamConfig }>(apiPath.team(), 'PUT', team)).team;
  }
  photoUrl(id: string): string {
    return `${this.base}${apiPath.photo(id)}?${TEAM_KEY_QUERY}=${encodeURIComponent(this.key)}`;
  }
  audioUrl(id: string): string {
    return `${this.base}${apiPath.audio(id)}?${TEAM_KEY_QUERY}=${encodeURIComponent(this.key)}`;
  }
  async template(): Promise<Uint8Array> {
    const res = await this.req(apiPath.template(), {}, 60_000);
    return new Uint8Array(await res.arrayBuffer());
  }
  /** Solo en la versión hospedada y con la clave de edición. */
  qr(): Promise<QrResponse> {
    return this.json<QrResponse>(apiPath.qr(), 'GET');
  }
  async photo(id: string): Promise<Uint8Array> {
    const res = await this.req(apiPath.photo(id), {}, PHOTO_TIMEOUT_MS);
    return new Uint8Array(await res.arrayBuffer());
  }
}
