// Shared harness for the desktops E2E: parent (app) server and comparison (shell) server started in-process on
// loopback, Chromium with every non-loopback request aborted and recorded. The comparison server only lets
// 127.0.0.1:4173 frame the shells, so the harness widens frame-ancestors to the test parent origin on the way through
// (headers only, bodies untouched; the server files are not changed).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT = resolve(here, '../..');
const HOST = process.env.E2E_HOST || '127.0.0.1';
const PARENT_PORT = Number(process.env.E2E_PARENT_PORT || 4370);
const SHELLS_PORT = Number(process.env.E2E_SHELLS_PORT || 4371);
export const PARENT = process.env.E2E_PARENT_URL || `http://${HOST}:${PARENT_PORT}`;
export const SHELLS = process.env.E2E_SHELLS_URL || `http://${HOST}:${SHELLS_PORT}`;
export const OUT = resolve(process.env.SHOTS_DIR || resolve(PROJECT, 'docs/desktop-parity/screens'));
export const FAIL_DIR = resolve(process.env.E2E_FAIL_DIR || tmpdir());
// The headless shell uses far less memory than full Chromium; it is preferred when installed.
const HEADLESS_SHELL = 'C:/Users/warcr/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe';
const CHROME = process.env.CHROME_PATH || (existsSync(HEADLESS_SHELL) ? HEADLESS_SHELL : 'C:/Users/warcr/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe');

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Temp/pw-kimi/node_modules/playwright-core');
const { createAppServer } = await import(pathToFileURL(resolve(PROJECT, 'server.mjs')).href);
const { createComparisonServer } = await import(pathToFileURL(resolve(PROJECT, 'desktop-comparison/server.mjs')).href);

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function start() {
  delete process.env.VULTR_SANDBOX_MODE;
  delete process.env.VULTR_HACKATHON_MODE;
  const app = createAppServer({ templateShellsEnabled: true, shellOrigin: SHELLS });
  const shells = createComparisonServer();
  await new Promise(resolve => app.listen(PARENT_PORT, HOST, resolve));
  await new Promise(resolve => shells.listen(SHELLS_PORT, HOST, resolve));
  const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const external = [];
  const allowed = new RegExp(`^(${escape(PARENT)}/|${escape(SHELLS)}/|data:|about:|blob:)`);
  await ctx.route(url => !allowed.test(url.href), route => { external.push(route.request().url()); route.abort(); });
  await ctx.route(`${SHELLS}/**`, async route => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace('frame-ancestors \'self\'', `frame-ancestors 'self' ${PARENT}`);
    await route.fulfill({ response, headers });
  });
  const stop = async () => {
    await browser.close();
    for (const server of [app, shells]) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    app.teardownTrainingSessions?.();
  };
  return { browser, ctx, external, stop };
}

// `run` follows a specific live-world run (desktop.html?profile=<id>&run=<run>), the stream sandbox controllers post to.
export async function openScene(ctx, profileId, run = null) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message.slice(0, 240)}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url().slice(0, 200)}`); });
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 240)}`); });
  await page.goto(`${PARENT}/desktop.html?profile=${profileId}${run ? `&run=${run}` : ''}`);
  await page.locator('#gate-opt-in').check({ timeout: 20000 });
  await page.locator('#gate-enter').click();
  await page.waitForSelector('body[data-session-state="profile-scene"]', { timeout: 30000 });
  const frame = os => page.frames().find(item => item.url().includes(os === 'windows' ? '/win11-final/' : '/macos-final/'));
  const world = () => page.evaluate(() => window.OceanDesktop.getWorld());
  const scene = () => page.evaluate(() => window.OceanDesktop.getScene());
  // A gesture the shell itself would send (used only where a real click is not reachable).
  const emit = (os, intent) => frame(os).evaluate(value => window.__oceanEmit(value), intent);
  const swap = async os => { await page.locator(`#os-${os}`).click(); await page.waitForTimeout(900); };
  const waitScene = async (test, label, timeout = 15000) => {
    const until = Date.now() + timeout;
    for (;;) {
      const state = await scene();
      if (test(state)) return state;
      if (Date.now() > until) throw new Error(`timed out: ${label} (at ${state.scene.phase}/${state.scene.stepId})`);
      await page.waitForTimeout(150);
    }
  };
  return { page, errors, frame, world, scene, emit, swap, waitScene };
}
