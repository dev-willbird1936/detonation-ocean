import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServer } from '../server.mjs';
import { createComparisonServer } from '../desktop-comparison/server.mjs';
import { AVATAR_ID_RE, readAvatar } from '../backend/desktop-avatars.mjs';
import { BUILD_ID_PATHS, computeDesktopBuildId } from '../backend/desktop-world-build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DEPTHS = ['sunlight', 'twilight', 'midnight', 'abyss', 'trench'];
const GIF = /^\/ocean-creatures\/[a-z-]+\/(sunlight|twilight|midnight|abyss|trench)\.gif$/;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

test('readAvatar finds an avatar by exact id and extension, and refuses bad ids, empty and oversized files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'avatars-'));
  try {
    mkdirSync(join(dir, 'data/desktop-profiles/avatars'), { recursive: true });
    const folder = join(dir, 'data/desktop-profiles/avatars');
    writeFileSync(join(folder, 'sam-novak.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(folder, 'lee.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(folder, 'empty.png'), '');
    writeFileSync(join(folder, 'huge.png'), Buffer.alloc(512 * 1024 + 1));
    writeFileSync(join(folder, 'notes.txt'), 'x');
    assert.deepEqual([readAvatar(dir, 'sam-novak').mime, readAvatar(dir, 'sam-novak').bytes.length], ['image/png', 4]);
    assert.equal(readAvatar(dir, 'lee').mime, 'image/svg+xml');
    for (const id of ['empty', 'huge', 'notes', 'missing', '../avatars/lee', 'Lee', 'lee.svg', '', 'a'.repeat(41)]) assert.equal(readAvatar(dir, id), null, id);
    assert.equal(AVATAR_ID_RE.test('sam-novak'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the shell server serves the 30 creature GIFs by exact route, the scenario scripts, and nothing outside the lists', async () => {
  const server = createComparisonServer();
  const base = await listen(server);
  try {
    const gif = await fetch(`${base}/ocean-creatures/anglerfish/sunlight.gif`);
    assert.equal(gif.status, 200);
    assert.equal(gif.headers.get('content-type'), 'image/gif');
    assert.equal(gif.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await gif.arrayBuffer());
    assert.equal(bytes.subarray(0, 3).toString('latin1'), 'GIF');
    const head = await fetch(`${base}/ocean-creatures/anglerfish/sunlight.gif`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), bytes.length);
    for (const route of ['/ocean-creatures/anglerfish/nowhere.gif', '/ocean-creatures/../server.mjs', '/ocean-creatures/anglerfish/sunlight.png',
      '/ocean-creatures/nobody/sunlight.gif', '/avatars/', '/avatars/../server', '/avatars/missing-person', '/previews/ocean-scenarios/other.js']) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, route);
      await response.arrayBuffer();
    }
    assert.equal((await fetch(`${base}/ocean-creatures/anglerfish/sunlight.gif`, { method: 'POST' })).status, 405);
    for (const depth of DEPTHS) {
      const response = await fetch(`${base}/previews/ocean-scenarios/${depth}.js`);
      assert.equal(response.status, existsSync(join(root, `desktop-comparison/previews/ocean-scenarios/${depth}.js`)) ? 200 : 503, depth);
      await response.arrayBuffer();
    }
  } finally {
    await close(server);
  }
});

test('the shell server serves an existing avatar by id with a sandboxed image CSP', async () => {
  const folder = join(root, 'data/desktop-profiles/avatars');
  const file = existsSync(folder) ? readdirSync(folder).find(name => /^[a-z0-9-]{1,40}\.(png|jpg|webp|svg)$/.test(name)) : undefined;
  if (!file) return;
  const id = file.replace(/\.[a-z]+$/, '');
  const server = createComparisonServer();
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/avatars/${id}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\//);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  } finally {
    await close(server);
  }
});

test('the app server serves scenario scripts only with the shells enabled, a missing script as 404, avatars and scenario-profile.js', async () => {
  const shells = createAppServer({ templateShellsEnabled: true, shellOrigin: 'http://127.0.0.1:4371' });
  const plain = createAppServer();
  const [shellBase, plainBase] = [await listen(shells), await listen(plain)];
  try {
    for (const depth of DEPTHS) {
      const response = await fetch(`${shellBase}/ocean-scenarios/${depth}.js`);
      const written = existsSync(join(root, `desktop-comparison/previews/ocean-scenarios/${depth}.js`));
      assert.equal(response.status, written ? 200 : 404, depth);
      if (written) assert.match(response.headers.get('content-type'), /^text\/javascript/);
      await response.arrayBuffer();
      assert.equal((await fetch(`${plainBase}/ocean-scenarios/${depth}.js`)).status, 404, `${depth} is not served without the shells`);
    }
    assert.equal((await fetch(`${shellBase}/ocean-scenarios/other.js`)).status, 404);
    for (const base of [shellBase, plainBase]) {
      const response = await fetch(`${base}/scenario-profile.js`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /OceanScenarioProfile/);
    }
    const unknown = await fetch(`${shellBase}/avatars/missing-person`);
    assert.equal(unknown.status, 404);
    await unknown.arrayBuffer();
    assert.equal((await fetch(`${shellBase}/avatars/..%2Fserver`)).status, 404);
  } finally {
    await Promise.all([close(shells), close(plain)]);
  }
});

test('GET /api/desktop/world?profile=<scenario id> works for every id of the 60 selected scenarios', async () => {
  const selection = JSON.parse((await import('node:fs')).readFileSync(join(root, 'data/ocean-selection.json'), 'utf8'));
  const ids = Object.values(selection.depths).flat().map(entry => entry.id);
  assert.equal(ids.length, 60);
  const server = createAppServer();
  const base = await listen(server);
  try {
    for (const id of ids) {
      const response = await fetch(`${base}/api/desktop/world?profile=${id}`);
      assert.equal(response.status, 200, id);
      const world = await response.json();
      assert.equal(world.v, 3, id);
      assert.equal(response.headers.get('x-desktop-profile'), existsSync(join(root, `data/desktop-profiles/${id}.json`)) ? 'applied' : 'none', id);
    }
  } finally {
    await close(server);
  }
});

test('the build id covers the scenario scripts and the avatar route', () => {
  assert.ok(BUILD_ID_PATHS.includes('desktop-comparison/previews/ocean-scenarios'));
  assert.ok(BUILD_ID_PATHS.includes('backend/desktop-avatars.mjs'));
  assert.match(computeDesktopBuildId(root), /^[0-9a-f]{16}$/);
});

test('the shell server answers a byte range for media with 206, a suffix range, 416 when unsatisfiable, and the whole file otherwise', async () => {
  const server = createComparisonServer();
  const base = await listen(server);
  const url = `${base}/previews/macos-final/track-3.mp3`;
  try {
    const whole = await fetch(url);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    const size = (await whole.arrayBuffer()).byteLength;
    const part = await fetch(url, { headers: { Range: 'bytes=100-200' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 100-200/${size}`);
    assert.equal((await part.arrayBuffer()).byteLength, 101);
    const open = await fetch(url, { headers: { Range: `bytes=${size - 10}-` } });
    assert.equal(open.status, 206);
    assert.equal(open.headers.get('content-range'), `bytes ${size - 10}-${size - 1}/${size}`);
    await open.arrayBuffer();
    const tail = await fetch(url, { headers: { Range: 'bytes=-10' } });
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get('content-range'), `bytes ${size - 10}-${size - 1}/${size}`);
    await tail.arrayBuffer();
    const beyond = await fetch(url, { headers: { Range: `bytes=${size + 5}-` } });
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get('content-range'), `bytes */${size}`);
    await beyond.arrayBuffer();
    const multi = await fetch(url, { headers: { Range: 'bytes=0-1,5-6' } });
    assert.equal(multi.status, 200);
    assert.equal((await multi.arrayBuffer()).byteLength, size);
    const page = await fetch(`${base}/previews/macos-final/index.html`, { headers: { Range: 'bytes=0-10' } });
    assert.equal(page.status, 200, 'non-media files ignore Range');
    assert.equal(page.headers.get('accept-ranges'), null);
    await page.arrayBuffer();
  } finally {
    await close(server);
  }
});
