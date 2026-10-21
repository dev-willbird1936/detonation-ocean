// Refreshes ui/abyss/manifest.json for the retro menu theme: re-hashes index.html, NOTICE.txt and every theme file
// (stylesheet, scripts, patched bundle, fonts, pixel art) and drops theme entries whose file no longer exists.
// Renderer entries from the original package are left alone. Usage: node tools/refresh-abyss-manifest.mjs
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'ui/abyss/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const mimes = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff': 'font/woff', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
});
const theme = ['ui/abyss/retro-pixel.css', 'ui/abyss/retro-pixel.js', 'ui/abyss/pixel-lit.js', 'ui/abyss/pixel-fish.js', 'ui/abyss/detonation-menu.js', 'ui/abyss/drop-panel.js', 'ui/abyss/menu-octopus.js', 'ui/abyss/assets/index-retro.js', ...walk('ui/abyss/fonts'), ...walk('ui/abyss/pixel')];

manifest.files = manifest.files.filter((file) => file.owner !== 'retro-theme' || existsSync(join(root, file.path)));
const byPath = new Map(manifest.files.map((file) => [file.path, file]));
for (const path of ['ui/abyss/index.html', 'ui/abyss/NOTICE.txt', ...theme]) {
  const bytes = readFileSync(join(root, path));
  let entry = byPath.get(path);
  if (!entry) { entry = { path, owner: 'retro-theme' }; manifest.files.push(entry); byPath.set(path, entry); }
  Object.assign(entry, { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, mime: mimes[extname(path)] });
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest files:', manifest.files.length);
