// Detonation pages through server.mjs (SPEC 4.1, 4.2, 15.4; AT-30): routes, static files, production flag and security
// headers over a real loopback server, then the same pages in headless Chromium under the real CSP. The browser tests
// need playwright-core and Chromium (same lookup as tests/detonation-job-view.test.mjs); without them they are skipped.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDetonationRoutes } from '../backend/detonation/routes.mjs';
import { createAppServer } from '../server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(join(ROOT, file), 'utf8');
const JOB_ID = 'j-0123456789abcdef';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);
// Just enough controller for /api/ocean and one artifact; the real one needs Docker.
const controller = {
  oceanView: () => ({ batchAt: null, schools: [], creatures: [] }),
  getJob: id => (id === JOB_ID ? { id } : null),
  authorise: () => true,
  artifact: (job, name) => (name === 'timeline.png' ? PNG : null),
  stop() {},
};

const servers = [];
async function start(options = {}) {
  const server = createAppServer({ detonation: createDetonationRoutes({ controller, env: {} }), ...options });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});

let dev;
let prod;
before(async () => {
  dev = await start({ production: false });
  prod = await start({ production: true });
});

const PAGES = [
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/upload', 'index.html'],
  ['/bestiary', 'bestiary.html'], ['/about', 'about.html'], [`/job/${JOB_ID}`, 'job.html'], ['/job/x?mock=invoice-py', 'job.html'],
];

function assertStrictHeaders(response, label) {
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp, `${label} has a CSP`);
  assert.match(csp, /(^|; )default-src 'self'(;|$)/, label);
  assert.match(csp, /frame-ancestors 'none'/, label);
  assert.match(csp, /object-src 'none'/, label);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, `${label} has no inline script allowance`);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/, label);
  assert.doesNotMatch(csp, /https?:\/\//, `${label} names no other origin`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', label);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer', label);
}

test('AT-30: each page route serves its file with the strict CSP, nosniff and no-referrer', async () => {
  for (const [path, file] of PAGES) {
    const response = await fetch(`${dev}${path}`);
    const label = path;
    assert.equal(response.status, 200, label);
    assert.match(response.headers.get('content-type'), /^text\/html/, label);
    assertStrictHeaders(response, label);
    const body = await response.text();
    const source = read(file);
    assert.ok(body === source || (file === 'index.html' && body.replace('<a href="/ocean-profiles.html">Creature matrix</a>', '') === source), `${label} serves ${file}`);
  }
});

test('AT-30: inline scripts run only by hash and the CSP lists a hash for each one', async () => {
  const response = await fetch(`${dev}/`);
  const csp = response.headers.get('content-security-policy');
  const inline = (await response.text()).match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) ?? [];
  assert.ok(inline.length > 0, 'the main menu has an inline loader script to hash');
  assert.equal([...csp.matchAll(/'sha256-[A-Za-z0-9+/=]+'/g)].length, inline.length);
  for (const page of ['/bestiary', '/about', `/job/${JOB_ID}`]) {
    assert.doesNotMatch((await (await fetch(`${dev}${page}`)).text()).replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), /<script/, `${page} has no inline script`);
  }
  assert.match((await fetch(`${dev}/`)).headers.get('content-security-policy'), /script-src[^;]*'wasm-unsafe-eval'/);
  assert.doesNotMatch((await fetch(`${dev}/bestiary`)).headers.get('content-security-policy'), /wasm-unsafe-eval/);
});

test('AT-30: an artifact carries its own strict CSP, nosniff and no-referrer', async () => {
  const response = await fetch(`${dev}/api/jobs/${JOB_ID}/artifacts/timeline.png`, { headers: { Authorization: 'Bearer tok_AbCdEf0123456789xyz' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('the desktop page and its replay frames stay framable by this origin only', async () => {
  const response = await fetch(`${dev}/desktop.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
});

test('static files for the new pages are served read-only with the right type', async () => {
  const cases = [
    ['/ui/job/main.mjs', 'ui/job/main.mjs', /^text\/javascript/], ['/ui/job/job.css', 'ui/job/job.css', /^text\/css/],
    ['/ui/bestiary/bestiary.js', 'ui/bestiary/bestiary.js', /^text\/javascript/], ['/ui/bestiary/render.js', 'ui/bestiary/render.js', /^text\/javascript/],
    ['/ui/abyss/pixel-fish.js', 'ui/abyss/pixel-fish.js', /^text\/javascript/], ['/ui/abyss/detonation-menu.js', 'ui/abyss/detonation-menu.js', /^text\/javascript/],
    ['/ui/abyss/drop-panel.js', 'ui/abyss/drop-panel.js', /^text\/javascript/], ['/ui/abyss/retro-pixel.css', 'ui/abyss/retro-pixel.css', /^text\/css/],
    ['/ui/abyss/pixel/fish/barracuda-swim.png', 'ui/abyss/pixel/fish/barracuda-swim.png', /^image\/png/],
    ['/data/creatures.json', 'data/creatures.json', /^application\/json/], ['/data/fish.json', 'data/fish.json', /^application\/json/],
  ];
  for (const [path, file, type] of cases) {
    const response = await fetch(`${dev}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), type, path);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(join(ROOT, file)), path);
  }
  for (const path of ['/data/attacks.json', '/data/personas.json', '/ui/job/', '/ui/job/nope.mjs', '/ui/job/..%2fmain.mjs', '/ui/job/main.mjs/x', '/job/', '/job/a/b']) {
    assert.equal((await fetch(`${dev}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${dev}/bestiary`, { method: 'POST' })).status, 404);
});

test('mock fixtures are served only on a loopback socket outside production', async () => {
  const response = await fetch(`${dev}/tests/fixtures/detonation/events/invoice-py.json`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), JSON.parse(read('tests/fixtures/detonation/events/invoice-py.json')));
  assert.equal((await fetch(`${dev}/tests/fixtures/detonation/events/missing.json`)).status, 404);
  assert.equal((await fetch(`${dev}/tests/fixtures/detonation/events/..%2Finvoice-py.json`)).status, 404);
  assert.equal((await fetch(`${prod}/tests/fixtures/detonation/events/invoice-py.json`)).status, 404);
  assert.equal((await fetch(`${prod}/data/fish.json`)).status, 200, 'read-only data stays public');
});

test('production flag marks the pages, drops the creature matrix link and hides the old routes', async () => {
  const menu = await (await fetch(`${dev}/`)).text();
  assert.match(menu, /<meta name="do-env" content="auto">/);
  assert.match(menu, /ocean-profiles.html">Creature matrix/);
  for (const path of ['/', '/upload', '/bestiary']) {
    const html = await (await fetch(`${prod}${path}`)).text();
    assert.match(html, /<meta name="do-env" content="production">/, path);
    assert.doesNotMatch(html, /content="auto"|ocean-profiles.html/, path);
  }
  assert.doesNotMatch(await (await fetch(`${prod}/about`)).text(), /content="auto"/);

  assert.equal((await fetch(`${dev}/api/training/scenarios`)).status, 200, 'the old training route works in development');
  const oldRoutes = [
    ['GET', '/api/training/scenarios'], ['POST', '/api/training/start'], ['POST', '/api/hackathon/proof'], ['POST', '/api/scenarios/oauth/plan'],
    ['POST', '/api/scenarios/oauth/execute'], ['POST', '/api/ocean/session/start'], ['POST', '/api/desktop/sandbox/run?run=r1'],
  ];
  for (const [method, path] of oldRoutes) {
    const response = await fetch(`${prod}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  assert.equal((await fetch(`${prod}/api/ocean`)).status, 200, 'the ocean API stays');
  assert.equal((await fetch(`${prod}/api/healthz`)).status, 200);
});

test('the production flag reads NODE_ENV and DETONATION_PRODUCTION', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, DETONATION_PRODUCTION: process.env.DETONATION_PRODUCTION };
  try {
    for (const [name, value] of [['NODE_ENV', 'production'], ['DETONATION_PRODUCTION', 'true']]) {
      delete process.env.NODE_ENV;
      delete process.env.DETONATION_PRODUCTION;
      process.env[name] = value;
      const base = await start();
      assert.match(await (await fetch(`${base}/`)).text(), /<meta name="do-env" content="production">/, name);
      assert.equal((await fetch(`${base}/api/training/scenarios`)).status, 404, name);
    }
    delete process.env.NODE_ENV;
    delete process.env.DETONATION_PRODUCTION;
    assert.match(await (await fetch(`${await start()}/`)).text(), /content="auto"/, 'off by default');
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

// ---- browser: AT-30 page load under the real CSP ----------------------------------------------------------

async function launchBrowser() {
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Temp/pw-kimi/node_modules/playwright-core');
    const shell = 'C:/Users/warcr/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
    const full = 'C:/Users/warcr/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
    const executablePath = process.env.CHROME_PATH || (existsSync(shell) ? shell : existsSync(full) ? full : undefined);
    return { browser: await chromium.launch(executablePath ? { executablePath } : {}) };
  } catch (error) {
    return { why: String(error.message).split('\n')[0] };
  }
}

let browser;
let unavailable;
before(async () => { ({ browser, why: unavailable } = await launchBrowser()); });
after(async () => { await browser?.close(); });

async function loadPage(base, path, ready) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const problems = [];
  const requests = [];
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', event => window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('response', answer => { if (answer.status() >= 400) problems.push(`http ${answer.status()}: ${answer.url()}`); });
  page.on('request', request => requests.push(request.url()));
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'load' });
    await page.waitForSelector(ready, { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);
    const violations = await page.evaluate(() => window.__csp);
    return { problems, violations, outside: requests.filter(url => !url.startsWith(base) && !/^(data|blob|about):/.test(url)), requests };
  } finally {
    await context.close();
  }
}

for (const [path, ready] of [
  ['/', '.loader, canvas'], ['/bestiary', 'main'], ['/about', 'main'], [`/job/${JOB_ID}?mock=invoice-py`, '#jv-receipt[data-shown]'],
]) {
  test(`AT-30 browser: ${path.split('?')[0]} loads under the CSP with no violations, errors or outside requests`, async t => {
    if (!browser) return t.skip(`browser automation unavailable (${unavailable}); AT-30 page-load check pending`);
    const result = await loadPage(dev, path, ready);
    assert.deepEqual(result.violations, [], 'no CSP violations');
    assert.deepEqual(result.problems, [], 'no console errors or failed requests');
    assert.deepEqual(result.outside, [], 'no request leaves this origin');
    assert.ok(result.requests.length > 1, 'the page requested its own files');
  });
}
