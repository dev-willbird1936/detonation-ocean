// Live desktop world events. A sandbox controller POSTs {type:'patch', patch} or {type:'replace', world} for a run;
// every parent page subscribed to that run (GET /api/desktop/events, Server-Sent Events) receives it and applies it
// with patchWorld / replaceWorld. Events are validated here and again, against the live world, by the parent.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { DesktopWorldError } from './desktop-world-source.mjs';

const OceanWorldModel = createRequire(import.meta.url)('../ui/desktop/world-model.js');
export const RUN_ID_RE = /^[a-z0-9-]{1,40}$/;
export const EVENT_MAX_BYTES = OceanWorldModel.WORLD_MAX_BYTES + 64 * 1024;
export const EVENTS_TOKEN_MIN_LENGTH = 16;
const RETRY_MS = 2000;
const HISTORY_MAX_BYTES = 1024 * 1024;
const PATCH_FORBIDDEN_KEYS = new Set(['v', 'revision', 'scene']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(String(value)).digest();

// Bearer token check in constant time.
export function tokenMatches(authorization, token) {
  const match = /^Bearer (\S+)$/.exec(String(authorization ?? ''));
  return Boolean(match) && timingSafeEqual(digest(match[1]), digest(token));
}

// A patch must merge into `seed` as a valid world (the parent checks it again against the live world).
export function parseDesktopEvent(input, seed) {
  const keys = isRecord(input) ? Object.keys(input).sort().join(',') : '';
  if (input?.type === 'patch' && keys === 'patch,type') {
    if (!isRecord(input.patch) || Object.keys(input.patch).length === 0) throw new DesktopWorldError('The patch must be a non-empty object.', 422);
    const forbidden = Object.keys(input.patch).find(key => PATCH_FORBIDDEN_KEYS.has(key));
    if (forbidden) throw new DesktopWorldError(`The patch may not set ${forbidden}.`, 422);
    try {
      OceanWorldModel.createWorld(seed, input.patch);
    } catch (error) {
      throw new DesktopWorldError(`The patch is invalid: ${String(error.message).replace(/^Invalid world: /, '')}`, 422);
    }
    return { type: 'patch', patch: input.patch };
  }
  if (input?.type === 'replace' && keys === 'type,world') {
    const check = OceanWorldModel.validate(input.world);
    if (!check.ok) throw new DesktopWorldError(`The world is invalid: ${check.error}`, 422);
    return { type: 'replace', world: input.world };
  }
  throw new DesktopWorldError('An event is exactly {type: "patch", patch} or {type: "replace", world}.', 422);
}

export class DesktopEventHub {
  #runs = new Map();
  #boot = randomBytes(4).toString('hex');
  #heartbeat = null;

  constructor({ maxRuns = 64, maxClientsPerRun = 8, historySize = 32, heartbeatMs = 15000 } = {}) {
    Object.assign(this, { maxRuns, maxClientsPerRun, historySize, heartbeatMs });
  }

  // Event ids are `<boot>-<seq>`: a reconnect after a server restart replays nothing stale.
  #entry(run) {
    let entry = this.#runs.get(run);
    if (entry) return entry;
    if (this.#runs.size >= this.maxRuns) {
      const idle = [...this.#runs].find(([, item]) => item.clients.size === 0);
      if (!idle) return null;
      this.#runs.delete(idle[0]);
    }
    entry = { clients: new Set(), history: [], historyBytes: 0, seq: 0 };
    this.#runs.set(run, entry);
    return entry;
  }

  // Opens the stream on `response` and replays the events after lastEventId. False when the run is full.
  subscribe(run, response, lastEventId = '', headers = {}) {
    const entry = this.#entry(run);
    if (!entry || entry.clients.size >= this.maxClientsPerRun) return false;
    response.writeHead(200, {
      ...headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(`retry: ${RETRY_MS}\n: connected\n\n`);
    const [boot, seq] = String(lastEventId).split('-');
    if (boot === this.#boot && /^\d+$/.test(seq ?? '')) {
      for (const item of entry.history) if (item.seq > Number(seq)) response.write(item.frame);
    }
    entry.clients.add(response);
    response.on('close', () => entry.clients.delete(response));
    this.#heartbeat ??= setInterval(() => {
      for (const { clients } of this.#runs.values()) for (const client of clients) client.write(': ping\n\n');
    }, this.heartbeatMs).unref();
    return true;
  }

  // Sends a validated event to every subscriber of the run and keeps it for reconnecting clients.
  publish(run, event) {
    const entry = this.#entry(run);
    if (!entry) throw new DesktopWorldError('Too many active runs.', 503);
    const seq = ++entry.seq;
    const id = `${this.#boot}-${seq}`;
    const frame = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
    entry.history.push({ seq, frame });
    entry.historyBytes += frame.length;
    while (entry.history.length > this.historySize || (entry.historyBytes > HISTORY_MAX_BYTES && entry.history.length > 1)) {
      entry.historyBytes -= entry.history.shift().frame.length;
    }
    for (const client of entry.clients) client.write(frame);
    return { id, delivered: entry.clients.size };
  }

  // True once an event was published to the run or a client subscribed to it; a query never creates the run.
  has(run) {
    return this.#runs.has(run);
  }

  subscribers(run) {
    return this.#runs.get(run)?.clients.size ?? 0;
  }

  close() {
    clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    for (const { clients } of this.#runs.values()) for (const client of clients) client.end();
    this.#runs.clear();
  }
}
