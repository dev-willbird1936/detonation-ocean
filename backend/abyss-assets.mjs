// Exact, integrity-checked renderer routes; no general filesystem/static-directory endpoint.
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
export function loadAbyssAssets(root) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(root, 'ui/abyss/manifest.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return new Map(); throw e; }
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid renderer manifest.');
  const assets = new Map();
  for (const f of manifest.files) {
    if (!/^ui\/abyss\/[A-Za-z0-9_./-]+$/.test(f.path) || f.path.split('/').some(p=>p==='..'||p==='.') ||
        !/^[a-f0-9]{64}$/.test(f.sha256) || typeof f.mime !== 'string' || /[\r\n]/.test(f.mime)) throw new Error('Invalid renderer asset entry.');
    const full = join(root, f.path);
    if (!lstatSync(full).isFile() || lstatSync(full).isSymbolicLink()) throw new Error('Renderer asset is not a regular file.');
    const b = readFileSync(full);
    if (b.length !== f.bytes || createHash('sha256').update(b).digest('hex') !== f.sha256) throw new Error('Renderer asset integrity mismatch: ' + f.path);
    if (assets.has('/' + f.path)) throw new Error('Duplicate renderer route.');
    assets.set('/' + f.path, { full, mime:f.mime });
  }
  return assets;
}
