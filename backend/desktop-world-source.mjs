// Where GET /api/desktop/world reads the world from: a local data directory (seed + profile overlays) or an upstream
// controller that serves the same route. Every world is checked with OceanWorldModel before it is served.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const OceanWorldModel = createRequire(import.meta.url)('../ui/desktop/world-model.js');
export const PROFILE_SLUG_RE = /^[a-z0-9-]{1,40}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const HOST_RE = /^[a-z0-9.-]{1,253}$/;
const UPSTREAM_TIMEOUT_MS = 5000;
const UPSTREAM_MAX_BYTES = 2 * OceanWorldModel.WORLD_MAX_BYTES;
export const SEED_FILE = 'desktop-world-seed.json';
export const PROFILES_DIR = 'desktop-profiles';

export class DesktopWorldError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DesktopWorldError';
    this.status = status;
  }
}

// The upstream base URL: http(s), no credentials, query or fragment. Loopback unless the host is explicitly allowed.
export function parseUpstreamUrl(value, allowHosts = []) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('DESKTOP_WORLD_URL must be an absolute http(s) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('DESKTOP_WORLD_URL must be http(s) without credentials, query or fragment.');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) && !allowHosts.includes(url.hostname)) {
    throw new TypeError(`DESKTOP_WORLD_URL host ${url.hostname} is not loopback and not in DESKTOP_WORLD_ALLOW_HOSTS.`);
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

export function parseAllowHosts(value) {
  const hosts = String(value ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  for (const host of hosts) if (!HOST_RE.test(host)) throw new TypeError(`DESKTOP_WORLD_ALLOW_HOSTS has an invalid host: ${host}`);
  return hosts;
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function readCappedText(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > UPSTREAM_MAX_BYTES) {
      await reader.cancel();
      throw new DesktopWorldError('The upstream world is too large.', 502);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// load(profile) -> { world, profileApplied }. profile is null for the plain seed.
export function createDesktopWorldSource({ dir, url, allowHosts = [], fetchImpl = fetch } = {}) {
  if (dir && url) throw new TypeError('Set DESKTOP_WORLD_DIR or DESKTOP_WORLD_URL, not both.');
  if (url) {
    const base = parseUpstreamUrl(url, allowHosts);
    return {
      kind: 'url',
      describe: base.origin,
      async load(profile) {
        const target = new URL('api/desktop/world', base);
        if (profile !== null) target.searchParams.set('profile', profile);
        let response;
        try {
          // Only Accept is sent: no cookies, authorization or forwarded client headers.
          response = await fetchImpl(target, {
            method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit',
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          });
        } catch {
          throw new DesktopWorldError('The upstream world controller is unreachable.', 502);
        }
        if (response.status === 400) throw new DesktopWorldError('The profile must be 1-40 characters of a-z, 0-9 or -.', 400);
        if (!response.ok) throw new DesktopWorldError(`The upstream world controller returned ${response.status}.`, 502);
        let world;
        try {
          world = OceanWorldModel.createWorld(JSON.parse(await readCappedText(response)), null);
        } catch (error) {
          throw error instanceof DesktopWorldError ? error : new DesktopWorldError('The upstream world is invalid.', 502);
        }
        return { world, profileApplied: response.headers.get('x-desktop-profile') === 'applied' };
      },
    };
  }
  const root = resolve(dir);
  if (!existsSync(join(root, SEED_FILE)) || !statSync(join(root, SEED_FILE)).isFile()) {
    throw new TypeError(`DESKTOP_WORLD_DIR must contain ${SEED_FILE}.`);
  }
  return {
    kind: 'dir',
    describe: root,
    // Read per request so edited data applies without a restart.
    async load(profile) {
      try {
        const overlayFile = profile === null ? null : join(root, PROFILES_DIR, `${profile}.json`);
        const overlay = overlayFile && existsSync(overlayFile) ? readJsonFile(overlayFile) : null;
        return { world: OceanWorldModel.createWorld(readJsonFile(join(root, SEED_FILE)), overlay), profileApplied: Boolean(overlay) };
      } catch {
        throw new DesktopWorldError('The desktop world or its profile overlay is invalid.', 500);
      }
    },
  };
}
