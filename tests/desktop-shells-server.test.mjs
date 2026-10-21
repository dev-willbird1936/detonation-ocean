import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonServer } from '../desktop-comparison/server.mjs';

async function withShellServer(run) {
  const server = createComparisonServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

const FINAL_SHELLS = ['/previews/win11-final/index.html', '/previews/macos-final/index.html'];

test('the shell server serves only the win11-final and macos-final shells; archived shells are 404', async () => {
  await withShellServer(async base => {
    for (const page of FINAL_SHELLS) {
      const response = await fetch(`${base}${page}?oceanShell=1`);
      assert.equal(response.status, 200, page);
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self' http:\/\/127\.0\.0\.1:4173/);
      assert.match(response.headers.get('content-security-policy'), /frame-src 'none'/);
      assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
      assert.doesNotMatch(await response.text(), /ocean-bridge|ocean-skin|ocean-apps/, `${page} has no v2 injection`);
    }
    for (const script of ['/previews/ocean-scenes.js', '/previews/ocean-fx.js']) {
      const response = await fetch(`${base}${script}`);
      assert.equal(response.status, 200, script);
      await response.arrayBuffer();
    }
    const index = await (await fetch(`${base}/`)).text();
    assert.deepEqual([...index.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map(match => match[1]), FINAL_SHELLS);
    assert.doesNotMatch(index, /<select|demo\.html|windows11\/|previews\/mac\//);
    for (const route of [
      '/previews/windows11/local.html', '/previews/windows11/local.html?oceanShell=1', '/previews/mac/local.html', '/previews/mac/local.html?oceanShell=1',
      '/previews/vanilla/sandboxed.html', '/previews/kimi-win11/local.html', '/previews/kimi-windows11/local.html',
      '/previews/kimi-macos27/local.html', '/sources/kimi-macos27/local.html', '/previews/ocean-bridge.js', '/previews/ocean-apps.js',
      '/previews/ocean-skin-win.js', '/previews/ocean-skin-mac.js', '/vendor/winbox.js', '/vendor/jspanel.js', '/vendor/98/98.css',
      '/vendor/xp/XP.css', '/vendor/7/7.css', '/licenses/mac.txt', '/demo.html', '/demo.js', '/downloads.json',
      '/archive/comparison-index.html', '/archive/previews/windows11/local.html', '/server.mjs',
    ]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, `${route} is not served`);
      await response.arrayBuffer();
    }
  });
});
