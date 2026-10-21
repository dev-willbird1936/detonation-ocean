// Job view (R-UI3, AT-26, AT-27): unit tests for the DOM-free state machine, SSE client and fixtures, plus browser
// tests of job.html through a loopback static server. The browser tests need playwright-core and Chromium (same
// lookup as tools/e2e/desktops-e2e-lib.mjs); without them they are skipped and AT-26/AT-27 stay pending.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const modules = name => import(pathToFileURL(join(ROOT, 'ui/job', name)).href);
const readJson = path => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const fixture = name => readJson(`tests/fixtures/detonation/events/${name}.json`);

const { applyEvent, createJobState, deepestFinding, depthMetres, pathText, receiptView, reportFromJobResponse, stageRows } = await modules('state.mjs');
const { FINDINGS, FINDING_ORDER, FAMILIES, familyName, fishSprite } = await modules('creatures.mjs');
const { SseParser, followEvents, createNetworkSource } = await modules('sse.mjs');
const { isLocalHost } = await modules('mock.mjs');
const { parseCsv } = await modules('report.mjs');

const EVENT_NAMES = new Set(['stage', 'typed', 'evidence', 'signal', 'finding', 'analysis-attempt', 'parser-attempt', 'coverage', 'verdict', 'explanation', 'receipt', 'report', 'error']);
const STAGES = new Set(['received', 'typed', 'queued', 'detonating', 'collecting', 'analysing', 'explaining', 'verdict', 'tearing_down', 'done', 'failed']);

function fold(events) {
  const state = createJobState();
  for (const { delay, ...event } of events) applyEvent(state, event);
  return state;
}

// ---- fixtures follow docs/detonation/EVENTS.md ---------------------------------------------------------------

for (const name of ['invoice-py', 'clean-chart']) {
  test(`fixture ${name} follows the event contract`, () => {
    const { jobId, events, artifacts } = fixture(name);
    assert.match(jobId, /^j-/);
    let last = 0;
    for (const event of events) {
      assert.ok(Number.isInteger(event.id) && event.id > last, `ids increase at ${event.id}`);
      last = event.id;
      assert.ok(EVENT_NAMES.has(event.event), `known event ${event.event}`);
      if (event.event === 'stage') assert.ok(STAGES.has(event.data.stage));
    }
    assert.equal(events.at(-1).event, 'report', 'report is the last event');
    const typed = events.find(item => item.event === 'typed').data;
    for (const key of ['detectedType', 'claimedExtension', 'path', 'species', 'label', 'mismatch', 'sizeTier']) assert.ok(key in typed, `typed.${key}`);
    for (const item of events.filter(event => event.event === 'evidence')) for (const key of ['id', 'source', 'kind', 'detail', 'at']) assert.ok(key in item.data, `evidence.${key}`);
    for (const item of events.filter(event => event.event === 'finding')) {
      assert.ok(FINDINGS[item.data.id], `known finding ${item.data.id}`);
      assert.equal(item.data.creature, FINDINGS[item.data.id].creature);
    }
    for (const file of events.at(-1).data.analysis.attempts.flatMap(attempt => attempt.artifacts ?? [])) assert.ok(artifacts[file], `artifact ${file}`);
    assert.doesNotMatch(JSON.stringify(events), /invoice|\.py"/i, 'no file name in any event');
  });
}

test('invoice-py fixture: Trench, five findings, attempt 1 fails with stderr, attempt 2 succeeds', () => {
  const { events } = fixture('invoice-py');
  const report = events.at(-1).data;
  assert.equal(report.verdict.depth, 'trench');
  assert.deepEqual(events.filter(event => event.event === 'finding').map(event => event.data.id),
    ['steal-credentials', 'exfil-attempt', 'encrypt', 'resource-hijack', 'system-wipe']);
  const [first, second] = events.filter(event => event.event === 'analysis-attempt').map(event => event.data);
  assert.equal(first.exitCode, 1);
  assert.match(first.stderr, /KeyError/);
  assert.equal(second.exitCode, 0);
});

test('clean-chart fixture is Sunlight with no findings', () => {
  const report = fixture('clean-chart').events.at(-1).data;
  assert.equal(report.verdict.depth, 'sunlight');
  assert.deepEqual(report.verdict.findings, []);
  assert.equal(report.verdict.complete, true);
});

// ---- state machine -------------------------------------------------------------------------------------------

test('state folds the invoice stream: depth, findings, attempts, receipt', () => {
  const state = fold(fixture('invoice-py').events);
  assert.equal(state.depth, 'trench');
  assert.equal(depthMetres(state), 8500);
  assert.equal(state.findings.length, 5);
  assert.equal(state.signals.length, 1);
  assert.equal(state.attempts.length, 2);
  assert.equal(state.finished, true);
  assert.deepEqual(stageRows(state).map(row => row.status), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(stageRows(state)[3].label, 'Analysing (2/3)');
  assert.equal(receiptView(state.receipt).headline, 'Sandbox destroyed · Host untouched');
});

test('deepest finding: deepest tier, then the first row of the design table (Jörmungandr before Kraken)', () => {
  const state = fold(fixture('invoice-py').events);
  assert.equal(deepestFinding(state.findings).id, 'system-wipe');
  assert.equal(deepestFinding([{ id: 'encrypt', depth: 'trench' }, { id: 'steal-credentials', depth: 'midnight' }]).id, 'encrypt');
  assert.equal(deepestFinding([{ id: 'persistence', depth: 'abyss' }, { id: 'keylog', depth: 'midnight' }]).id, 'persistence');
  assert.equal(deepestFinding([]), null);
});

test('state rows follow the stream and a replayed event is ignored', () => {
  const { events } = fixture('invoice-py');
  const state = createJobState();
  const seen = [];
  for (const { delay, ...event } of events.slice(0, 24)) { applyEvent(state, event); seen.push(stageRows(state).map(row => row.status).join(',')); }
  assert.equal(stageRows(state)[3].status, 'active');
  assert.equal(stageRows(state)[3].label, 'Analysing (1/3)');
  assert.equal(stageRows(state)[0].status, 'done');
  const before = JSON.stringify(state);
  assert.equal(applyEvent(state, events[5]), false, 'replayed id is skipped');
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.lastEventId, 24);
  assert.equal(applyEvent(state, { id: 25, event: 'unknown-future-event', data: {} }), true);
});

test('failed job marks the active row and keeps later stages', () => {
  const state = createJobState();
  for (const [id, event, data] of [[1, 'stage', { stage: 'received' }], [2, 'stage', { stage: 'detonating' }], [3, 'error', { message: 'Sandbox failed to start.' }], [4, 'stage', { stage: 'tearing_down' }]]) applyEvent(state, { id, event, data });
  const rows = stageRows(state);
  assert.equal(rows[1].status, 'failed');
  assert.equal(rows[5].status, 'active');
  assert.equal(state.error, 'Sandbox failed to start.');
});

test('receipt card tells the truth when teardown or the canary check failed', () => {
  assert.equal(receiptView({ teardownConfirmed: true, hostCanary: 'unchanged' }).ok, true);
  const noTeardown = receiptView({ teardownConfirmed: false, hostCanary: 'unchanged' });
  assert.equal(noTeardown.ok, false);
  assert.doesNotMatch(noTeardown.headline, /destroyed ·/);
  const changed = receiptView({ teardownConfirmed: true, hostCanary: 'changed' });
  assert.equal(changed.ok, false);
  assert.doesNotMatch(changed.headline, /untouched/);
  assert.equal(receiptView(null).ok, false);
  assert.doesNotMatch(receiptView({}).headline, /destroyed · Host untouched/);
});

test('path text is future tense before the run and the recorded label after it', () => {
  const typed = { label: 'Ran under Wine' };
  assert.equal(pathText(typed, 1), 'Will run under Wine');
  assert.equal(pathText(typed, 3), 'Ran under Wine');
});

test('final report is read from the job response in either shape', () => {
  const report = fixture('invoice-py').events.at(-1).data;
  assert.equal(reportFromJobResponse({ status: 'done', report }), report);
  assert.equal(reportFromJobResponse(report), report);
  assert.equal(reportFromJobResponse({ status: 'running' }), null);
});

test('family names: neutral at Sunlight and Twilight, attack name from Midnight down', () => {
  assert.equal(familyName('file-changes', 'twilight'), 'File changes');
  assert.equal(familyName('file-changes', 'trench'), 'Extortion / destruction');
  assert.equal(familyName('mystery', 'trench'), 'mystery');
});

test('creature table matches data/creatures.json', () => {
  const data = readJson('data/creatures.json');
  const withFinding = data.creatures.filter(item => item.findingId);
  assert.deepEqual(FINDING_ORDER, withFinding.map(item => item.findingId), 'same order as the design table');
  for (const item of withFinding) {
    const mine = FINDINGS[item.findingId];
    assert.equal(mine.creature, item.creature, item.findingId);
    assert.equal(mine.depth, item.depth, item.findingId);
    const sprite = item.sprite ?? item.fallbackSprite;
    assert.equal(mine.sprite, sprite ? `/${sprite}` : null, item.findingId);
    if (mine.sprite) assert.ok(existsSync(join(ROOT, mine.sprite)), `${mine.sprite} exists`);
  }
  for (const item of withFinding) if (item.family !== 'variable') assert.ok(FAMILIES[item.family], `family ${item.family}`);
});

test('fish sprites match data/fish.json and the files exist; other species keep the code-drawn fish', () => {
  for (const { species, sprite } of readJson('data/fish.json').fish) {
    assert.equal(fishSprite(species), sprite ? `/${sprite}` : null, species);
    if (sprite) assert.ok(existsSync(join(ROOT, sprite)), `${sprite} exists`);
  }
  assert.equal(fishSprite('unlisted-species'), null);
  assert.ok(existsSync(join(ROOT, 'ui/abyss/pixel/creatures/giant-clam-spritesheet.png')));
});

// ---- SSE client ---------------------------------------------------------------------------------------------

test('SSE parser handles split chunks, CRLF, comments, multi-line data and bad JSON', () => {
  const got = [];
  const parser = new SseParser(message => got.push(message));
  const wire = ': hello\r\nid: 4\r\nevent: stage\r\ndata: {"stage":\r\ndata: "typed"}\r\n\r\nid: 5\nevent: evidence\ndata: not json\n\nid: 6\nevent: signal\ndata: {"id":"x"}\n\n';
  for (let at = 0; at < wire.length; at += 3) parser.push(wire.slice(at, at + 3));
  assert.deepEqual(got, [{ id: 4, event: 'stage', data: { stage: 'typed' } }, { id: 6, event: 'signal', data: { id: 'x' } }]);
});

function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: status < 400, status,
    body: { getReader: () => ({ read: async () => (index < chunks.length ? { done: false, value: encoder.encode(chunks[index++]) } : { done: true }) }) },
  };
}
const wireOf = events => events.map(event => `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);

test('followEvents resumes with Last-Event-ID, sends the token only as a header, and stops at the terminal event', async () => {
  const { events } = fixture('invoice-py');
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, headers: options.headers });
    return requests.length === 1 ? sseResponse(wireOf(events.slice(0, 10))) : sseResponse(wireOf(events.slice(10)));
  };
  const state = createJobState();
  await followEvents({
    url: '/api/jobs/j-1/events', token: 'secret-token-123', fetchImpl, sleep: async () => {}, retryDelays: [1, 1],
    onEvent: event => applyEvent(state, event), isTerminal: () => state.finished, getLastEventId: () => state.lastEventId,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['Last-Event-ID'], undefined);
  assert.equal(requests[1].headers['Last-Event-ID'], '10');
  for (const request of requests) {
    assert.equal(request.headers.Authorization, 'Bearer secret-token-123');
    assert.ok(!request.url.includes('secret-token-123'), 'token is not in the URL');
  }
  assert.equal(state.lastEventId, events.length);
  assert.equal(state.finished, true);
});

test('followEvents gives up on a bad link without retrying', async () => {
  let calls = 0;
  await assert.rejects(followEvents({
    url: '/api/jobs/j-1/events', token: 't', fetchImpl: async () => { calls += 1; return sseResponse([], 401); },
    sleep: async () => {}, onEvent() {}, isTerminal: () => false, getLastEventId: () => 0,
  }), /invalid or has expired/);
  assert.equal(calls, 1);
});

test('network source puts the bearer token in headers only and rejects odd ids and names', async () => {
  const seen = [];
  const source = createNetworkSource({ jobId: 'j-abc', token: 'tok-12345678', fetchImpl: async (url, options) => { seen.push({ url, options }); return { ok: true, json: async () => ({}), blob: async () => new Blob(['x'], { type: 'text/plain' }) }; } });
  await source.fetchJob();
  await source.fetchArtifact('timeline.png');
  assert.deepEqual(seen.map(item => item.url), ['/api/jobs/j-abc', '/api/jobs/j-abc/artifacts/timeline.png']);
  for (const item of seen) {
    assert.equal(item.options.headers.Authorization, 'Bearer tok-12345678');
    assert.equal(item.options.credentials, 'omit');
    assert.equal(item.options.referrerPolicy, 'no-referrer');
  }
  assert.throws(() => createNetworkSource({ jobId: '../x', token: 't' }));
  await assert.rejects(source.fetchArtifact('../secret'));
});

test('mock fixtures are accepted only from localhost', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(isLocalHost(host), true, host);
  for (const host of ['example.com', 'detonation.example.net', 'localhost.evil.test', '']) assert.equal(isLocalHost(host), false, host);
});

test('csv parser keeps quoted commas and empty cells', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y",\n'), [['a', 'b'], ['x,y', '']]);
});

// ---- source hygiene -----------------------------------------------------------------------------------------

test('job view sources render text only, use no third-party URLs, and never store the token', () => {
  const files = [join(ROOT, 'job.html'), ...readdirSync(join(ROOT, 'ui/job')).map(name => join(ROOT, 'ui/job', name))];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const label = file.slice(ROOT.length + 1);
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|EventSource|localStorage|sessionStorage|document\.cookie/, label);
    assert.doesNotMatch(text.replace(/https?:\/\/www\.w3\.org\/\d+\/svg/g, ''), /https?:\/\//, `${label} has no absolute URL`);
    assert.doesNotMatch(text, /\bimport\s*\(|<script[^>]+src=["']https?:/, label);
  }
});

// ---- browser: AT-26, AT-27 --------------------------------------------------------------------------------

const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "font-src 'self'", "img-src 'self' data:", "object-src 'none'", "base-uri 'none'", "form-action 'self'"];
const PAGE_CSP = [...CSP, "frame-ancestors 'none'"].join('; ');
const FRAME_CSP = [...CSP, "frame-ancestors 'self'"].join('; ');
const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff': 'font/woff' };
const NET_TOKEN = 'tok_AbCdEf0123456789xyz';
const apiLog = [];

function startServer() {
  const netFixture = fixture('invoice-py');
  let netStreams = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    const send = (status, body, type, csp = PAGE_CSP) => {
      response.writeHead(status, { 'Content-Type': type, 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(body);
    };
    if (url.pathname.startsWith('/api/jobs/')) {
      apiLog.push({ path: url.pathname, authorization: request.headers.authorization, lastEventId: request.headers['last-event-id'], referer: request.headers.referer });
      const [, , , id, kind, name] = url.pathname.split('/');
      if (request.headers.authorization !== `Bearer ${NET_TOKEN}` || id !== 'j-net') return send(401, '{}', 'application/json');
      if (!kind) return send(200, JSON.stringify({ status: 'done', report: netFixture.events.at(-1).data }), 'application/json');
      if (kind === 'artifacts') {
        const item = netFixture.artifacts[name];
        return item ? send(200, item.base64 ? Buffer.from(item.base64, 'base64') : item.text, item.type) : send(404, '{}', 'application/json');
      }
      if (kind === 'events') {
        netStreams += 1;
        const from = Number(request.headers['last-event-id'] ?? 0);
        const pick = netFixture.events.filter(event => event.id > from).slice(0, netStreams === 1 ? 12 : undefined);
        return send(200, wireOf(pick.map(({ delay, ...event }) => event)).join(''), 'text/event-stream');
      }
      return send(404, '{}', 'application/json');
    }
    if (url.pathname === '/desktop.html') return send(200, `<!doctype html><title>Desktop stub</title><p id="stub">Desktop replay stub for ${url.searchParams.get('job')}</p>`, MIME['.html'], FRAME_CSP);
    if (/^\/job\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.pathname === '/job.html') return send(200, readFileSync(join(ROOT, 'job.html')), MIME['.html']);
    if (url.pathname === '/') return send(200, '<!doctype html><title>Ocean stub</title>', MIME['.html']);
    if (/^\/(ui\/(job|abyss)\/|ui\/abyss\/(fonts|pixel)\/|tests\/fixtures\/detonation\/events\/)/.test(url.pathname) && !url.pathname.includes('..')) {
      const file = resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      if (file.startsWith(ROOT + sep) && existsSync(file)) return send(200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream');
    }
    return send(404, 'not found', 'text/plain');
  });
  return new Promise(resolveStart => server.listen(0, '127.0.0.1', () => resolveStart({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

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

let site, browser, unavailable;
before(async () => {
  site = await startServer();
  ({ browser, why: unavailable } = await launchBrowser());
});
after(async () => {
  await browser?.close();
  site?.server.closeAllConnections?.();
  await new Promise(resolveClose => site.server.close(resolveClose));
});

// Records what the page does over time, because the dive's states are transient.
const RECORDER = () => {
  const log = { clam: [], eatenBy: [], bites: [], overlay: false, creature: false, frame: null, replayShown: false, receiptShown: false };
  window.__jv = log;
  const note = (list, value) => { if (value && list.at(-1) !== value) list.push(value); };
  new MutationObserver(() => {
    const scene = document.getElementById('jv-scene');
    if (!scene) return;
    note(log.clam, scene.dataset.clam);
    note(log.eatenBy, scene.dataset.eatenBy);
    note(log.bites, scene.dataset.bites);
    if (document.getElementById('jv-bite')) log.overlay = true;
    if (document.querySelector('.jv-creature')) log.creature = true;
    const frame = document.getElementById('jv-replay-frame');
    if (frame) log.frame = frame.getAttribute('src');
    if (!document.getElementById('jv-replay').hidden) log.replayShown = true;
    if (document.getElementById('jv-receipt')?.dataset.shown) log.receiptShown = true;
  }).observe(document, { subtree: true, childList: true, attributes: true });
};

async function openPage(path, { viewport = { width: 1280, height: 900 }, reducedMotion = 'no-preference', origin = site.origin, requested = [] } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const problems = [];
  const external = [];
  const allowed = request => request.startsWith(site.origin) || request.startsWith(origin) || request.startsWith('data:') || request.startsWith('about:');
  await context.route(request => !allowed(request.href ?? String(request)), route => { external.push(route.request().url()); route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('response', answer => { if (answer.status() >= 400) problems.push(`http ${answer.status()}: ${answer.url()}`); });
  await page.addInitScript(RECORDER);
  page.on('request', request => requested.push(request.url()));
  await page.goto(`${origin}${path}`);
  return { page, context, problems, external };
}

function browserTest(name, body) {
  test(name, async t => {
    if (!browser) return t.skip(`browser automation unavailable (${unavailable}); AT-26/AT-27 browser verification pending`);
    return body(t);
  });
}

browserTest('AT-26: invoice job shows the clam, two octopus attempts, the eat, the desktop replay and the receipt, with no console errors', async () => {
  const { page, context, problems, external } = await openPage('/job.html?mock=invoice-py&speed=0.05');
  try {
    await page.waitForSelector('#jv-receipt[data-shown]', { timeout: 30000 });
    await page.waitForSelector('#jv-report:not([hidden]) .jv-chart', { timeout: 30000 });
    const log = await page.evaluate(() => window.__jv);

    assert.ok(log.clam.includes('open') && log.clam.includes('closed'), `clam closes: ${log.clam}`);
    assert.ok(log.clam.indexOf('closed') < log.clam.indexOf('shut'), `clam shuts after it closed: ${log.clam}`);
    assert.equal(log.clam.at(-1), 'sunk');
    assert.ok(Number(log.bites.at(-1)) >= 2, `earlier findings bit first: ${log.bites}`);
    assert.deepEqual(log.eatenBy, ['system-wipe'], 'Jörmungandr eats the fish');
    assert.equal(log.overlay, true, 'camera-bite overlay played');
    assert.equal(log.frame, '/desktop.html?job=j-mock-trench');
    assert.equal(log.replayShown, true);

    assert.match(await page.textContent('.jv-caption'), /Jörmungandr ate your file/);
    assert.ok((await page.locator('.jv-attempt').count()) >= 2, 'at least two octopus attempts');
    assert.match(await page.textContent('.jv-attempt[data-n="1"] .jv-stderr'), /KeyError/);
    assert.equal(await page.getAttribute('.jv-attempt[data-n="1"]', 'data-state'), 'failed');
    assert.equal(await page.getAttribute('.jv-attempt[data-n="2"]', 'data-state'), 'ok');
    assert.equal(await page.locator('.jv-stage-row[data-status="done"]').count(), 6);
    assert.equal(await page.locator('.jv-log-row').count() >= 9, true, 'evidence log');
    assert.match(await page.textContent('#jv-receipt'), /Sandbox destroyed · Host untouched/);
    assert.equal(await page.getAttribute('#jv-scene', 'data-species'), 'snake-eel');
    assert.equal(await page.$eval('.jv-clam', clam => getComputedStyle(clam).animationName), 'jv-clam-close', 'clam plays frames 0 to 7');
    assert.equal(await page.locator('.jv-fish.jv-swim').count(), 1, 'snake-eel has swim art');

    assert.match(await page.textContent('#jv-depth-badge'), /Trench/);
    assert.match(await page.textContent('#jv-verdict'), /Harmful behaviour proven/);
    assert.equal(await page.locator('.jv-finding').count(), 5);
    assert.match(await page.textContent('.jv-finding[data-finding="system-wipe"]'), /Jörmungandr/);
    assert.equal(await page.getAttribute('.jv-finding[data-finding="system-wipe"] a', 'href'), '#rep-ev-9');
    assert.equal(await page.locator('#rep-ev-9').count(), 1, 'evidence link target exists');
    assert.equal(await page.locator('.jv-diff tr').count(), 5, 'diff.csv rendered as a table');
    assert.ok(await page.$eval('.jv-chart', image => image.src.startsWith('data:image/png') && image.naturalWidth > 0), 'chart.png decoded');
    assert.match(await page.textContent('.jv-details summary'), /Analysis code \(attempt 2\)/);
    assert.equal(await page.getAttribute('.jv-button[href="/"]', 'href'), '/');
    assert.equal(await page.locator('#jv-report >> text=Back to the ocean').count(), 1);

    const frame = page.frames().find(item => item.url().includes('/desktop.html?job=j-mock-trench'));
    assert.ok(frame, 'desktop replay frame loaded');
    assert.match(await frame.textContent('#stub'), /j-mock-trench/);
    assert.deepEqual(problems, [], 'zero console errors');
    assert.deepEqual(external, [], 'no request left the page origin');
  } finally { await context.close(); }
});

browserTest('Sunlight job skips the eat: the fish settles and the report says no harm was observed', async () => {
  const { page, context, problems } = await openPage('/job.html?mock=clean-chart&speed=0.05');
  try {
    await page.waitForSelector('#jv-receipt[data-shown]', { timeout: 30000 });
    await page.waitForSelector('#jv-report:not([hidden]) .jv-chart', { timeout: 30000 });
    const log = await page.evaluate(() => window.__jv);
    assert.deepEqual(log.eatenBy, []);
    assert.equal(log.overlay, false);
    assert.equal(log.creature, false);
    assert.equal(log.replayShown, false);
    assert.match(await page.textContent('#jv-depth-badge'), /Sunlight/);
    assert.match(await page.textContent('#jv-verdict'), /No harmful behaviour observed/);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

for (const [label, path, options] of [
  ['?rm', '/job.html?mock=invoice-py&speed=0.05&rm', {}],
  ['prefers-reduced-motion', '/job.html?mock=invoice-py&speed=0.05', { reducedMotion: 'reduce' }],
]) {
  browserTest(`AT-27 (${label}): verdict and report appear without the eat or camera-bite`, async () => {
    const { page, context, problems } = await openPage(path, options);
    try {
      await page.waitForSelector('#jv-report:not([hidden]) .jv-chart', { timeout: 30000 });
      const log = await page.evaluate(() => window.__jv);
      assert.equal(log.overlay, false, 'no camera-bite');
      assert.equal(log.creature, false, 'no creature was ever drawn');
      assert.deepEqual(log.eatenBy, [], 'no eat');
      assert.equal(log.frame, null, 'replay frame not mounted automatically');
      assert.match(await page.textContent('#jv-depth-badge'), /Trench/);
      assert.match(await page.textContent('#jv-verdict'), /Harmful behaviour proven/);
      assert.equal(await page.locator('.jv-stage-row[data-status="done"]').count(), 6, 'stage list shown, all done');
      assert.equal(await page.locator('.jv-finding').count(), 5);
      assert.match(await page.textContent('#jv-receipt'), /Sandbox destroyed · Host untouched/);
      assert.equal(await page.getAttribute('#jv-scene', 'data-clam'), 'sunk');
      assert.equal(await page.$eval('.jv-clam', clam => getComputedStyle(clam).backgroundPositionX), '0px', 'clam stays on frame 0');
      assert.equal(await page.$eval('.jv-swim', canvas => canvas.getContext('2d').getImageData(0, 0, 64, 64).data.some((value, index) => index % 4 === 3 && value > 0)), true, 'fish frame 0 painted');
      assert.equal(await page.$eval('.jv-pod', pod => getComputedStyle(pod).transitionDuration), '0s', 'transitions are off');
      assert.deepEqual(problems, []);
    } finally { await context.close(); }
  });
}

browserTest('mobile: the job view is one column without horizontal scroll', async () => {
  const { page, context, problems } = await openPage('/job.html?mock=clean-chart&speed=0.05&rm', { viewport: { width: 390, height: 844 } });
  try {
    await page.waitForSelector('#jv-report:not([hidden]) .jv-chart', { timeout: 30000 });
    const tracks = await page.$eval('.jv-grid', grid => getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length);
    assert.equal(tracks, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal overflow');
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

browserTest('network mode: bearer token only in headers, stream resumes with Last-Event-ID, final report fetched', async () => {
  apiLog.length = 0;
  const { page, context, problems } = await openPage(`/job/j-net?rm#${NET_TOKEN}`);
  try {
    await page.waitForSelector('#jv-report:not([hidden]) .jv-chart', { timeout: 30000 });
    const streams = apiLog.filter(item => item.path.endsWith('/events'));
    assert.equal(streams.length, 2, 'dropped stream was reopened');
    assert.equal(streams[0].lastEventId, undefined);
    assert.equal(streams[1].lastEventId, '12');
    assert.ok(apiLog.some(item => item.path === '/api/jobs/j-net'), 'final report requested');
    assert.ok(apiLog.some(item => item.path.endsWith('/artifacts/timeline.png')));
    for (const item of apiLog) {
      assert.equal(item.authorization, `Bearer ${NET_TOKEN}`);
      assert.ok(!item.path.includes(NET_TOKEN) && !(item.referer ?? '').includes(NET_TOKEN), 'token not in path or referer');
    }
    assert.match(await page.textContent('#jv-depth-badge'), /Trench/);
    assert.match(await page.textContent('#jv-receipt'), /Sandbox destroyed · Host untouched/);
    assert.equal(await page.locator('.jv-attempt').count(), 2);
    assert.deepEqual(problems, []);
  } finally { await context.close(); }
});

browserTest('network mode: a wrong token shows an invalid-link message, not job data', async () => {
  const { page, context } = await openPage('/job/j-net?rm#wrong-token-value-000');
  try {
    await page.waitForSelector('#jv-notice:not([hidden])', { timeout: 15000 });
    assert.match(await page.textContent('#jv-notice'), /invalid or has expired/);
    assert.equal(await page.locator('#jv-report:not([hidden])').count(), 0);
  } finally { await context.close(); }
});

browserTest('?mock is ignored on a host name that is not localhost', async () => {
  const requested = [];
  const { page, context } = await openPage('/job.html?mock=invoice-py', { origin: site.origin.replace('127.0.0.1', 'job-view.localhost'), requested });
  try {
    await page.waitForSelector('#jv-notice:not([hidden])', { timeout: 15000 });
    assert.match(await page.textContent('#jv-notice'), /incomplete/);
    assert.deepEqual(requested.filter(url => url.includes('/tests/fixtures/')), [], 'no fixture was requested');
  } finally { await context.close(); }
});
