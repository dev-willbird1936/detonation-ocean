// Build id for GET /api/health: a hash of both final shell builds and the parent/server files, taken when the server
// starts. A launcher compares it with computeDesktopBuildId() on disk; a mismatch means the running server is stale.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const BUILD_ID_PATHS = Object.freeze([
  'desktop-comparison/previews/win11-final',
  'desktop-comparison/previews/macos-final',
  'desktop-comparison/previews/ocean-scenes.js',
  'desktop-comparison/previews/ocean-fx.js',
  'desktop-comparison/previews/ocean-scenarios',
  'desktop-comparison/server.mjs',
  'ui/desktop',
  'server.mjs',
  'backend/desktop-avatars.mjs',
  'backend/desktop-world-build.mjs',
  'backend/desktop-world-events.mjs',
  'backend/desktop-world-source.mjs',
]);

function listFiles(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => listFiles(join(path, entry.name)));
}

// 16 hex chars of sha256 over every file's relative path and content, in sorted path order.
export function computeDesktopBuildId(root) {
  const hash = createHash('sha256');
  const files = BUILD_ID_PATHS.flatMap(path => listFiles(join(root, path)))
    .map(file => [relative(root, file).replaceAll('\\', '/'), file])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, file] of files) hash.update(`${name}\0`).update(readFileSync(file)).update('\0');
  return hash.digest('hex').slice(0, 16);
}
