// Playwright harness (SPEC 6.4 "Browser", 6.6): loads ~/Downloads/sample.<html|svg|pdf> in Chromium through file://, records every
// network request (all are aborted: the container has no network), downloads, dialogs and form submissions, types the synthetic
// credential into any password form and submits it, and takes screenshots at 2 s, 10 s and at exit. At most 25 s in total
// (the controller kills the container at 30 s). The last stdout line is the status JSON, mapped by backend/detonation/browser.mjs.
//
// Chromium runs with --no-sandbox (Playwright's default for chromiumSandbox: false). Chromium's own sandbox needs user
// namespaces or a setuid helper, neither of which exists under gVisor with every capability dropped. gVisor is the boundary.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from '/opt/playwright/node_modules/playwright-core/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (index % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), all[index + 1]]]), []));
const TOTAL_MS = 25_000;
const LOAD_MS = 10_000;
const SHOT_AT_MS = [2_000, 10_000]; // screenshots at 2 s and 10 s, then one at exit
const MAX_LIST = 60;
const CHARS = 300;
const BODY_CHARS = 1_024;
const USERNAME = 'dana@example.invalid';
const password = `CorrectHorse-${args.canary || 'NOCANARY'}`;
const LOCAL_URL = /^(?:file|data|blob|about|chrome|devtools):/i;
const scratch = '/tmp/dt';

const result = { loaded: false, error: null, requests: [], downloads: [], dialogs: [], forms: [], screenshots: [], popups: 0, hasPasswordField: false };
let credentialCaptured = false;
const clip = (value, size = CHARS) => String(value ?? '').slice(0, size);
const room = list => list.length < MAX_LIST;
const started = Date.now();
const elapsed = () => Date.now() - started;

function emit(status) {
  let staticReport = {};
  try { staticReport = JSON.parse(readFileSync(args.static, 'utf8')); } catch { /* an absent or cut file is no static report */ }
  const line = { detonationRunner: 1, kind: args.kind, started: true, file: args.file.replace(/^\/home\/dana\//, '').replace(/^\//, ''), exitCode: status, browser: result, static: staticReport };
  process.stdout.write(`\n${JSON.stringify(line)}\n`);
}

function handleRequest(route) {
  const request = route.request();
  const url = request.url();
  const local = LOCAL_URL.test(url);
  if (!local && room(result.requests)) {
    const body = request.postData();
    if (`${url}${body ?? ''}`.includes(password)) credentialCaptured = true;
    result.requests.push({ url: clip(url, 500), method: request.method(), body: clip(body, BODY_CHARS), resourceType: request.resourceType() });
  }
  return local ? route.continue() : route.abort('blockedbyclient');
}

async function shoot(page, label) {
  try {
    const png = await page.screenshot({ type: 'png', timeout: 4_000 });
    if (room(result.screenshots)) result.screenshots.push({ at: label, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') });
  } catch { /* a page that cannot be captured leaves the entry out */ }
}

// Fills every password field with the synthetic credential and submits its form (or presses Enter in it).
async function typeCredential(page) {
  const info = await page.evaluate(({ username, secret }) => {
    const out = [];
    for (const field of document.querySelectorAll('input[type=password]')) {
      const form = field.form;
      const scope = form ?? document;
      const user = [...scope.querySelectorAll('input')].find(input => input !== field && /^(?:text|email|tel|)$/i.test(input.type) && !input.disabled);
      const set = (input, value) => { input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
      if (user) set(user, username);
      set(field, secret);
      const fields = {};
      for (const input of scope.querySelectorAll('input, select, textarea')) {
        if (input.name || input.id) fields[input.name || input.id] = input.value;
      }
      out.push({ action: form ? form.action : '', method: form ? (form.method || 'get') : 'script', fields });
    }
    return out;
  }, { username: USERNAME, secret: password }).catch(() => []);
  result.hasPasswordField ||= info.length > 0;
  for (const form of info) {
    if (room(result.forms)) result.forms.push({ url: clip(form.action || page.url(), 500), method: clip(form.method, 10), fields: Object.fromEntries(Object.entries(form.fields).slice(0, 20).map(([name, value]) => [clip(name, 60), clip(value, 120)])), typedCredential: true });
  }
  if (info.length) {
    // A form is submitted once through the page's own submit path; Enter is for a password field that sits in no form.
    const submitted = await page.evaluate(() => {
      const field = document.querySelector('input[type=password]');
      if (!field?.form) return false;
      if (field.form.requestSubmit) field.form.requestSubmit(); else field.form.submit();
      return true;
    }).catch(() => false);
    if (!submitted) await page.keyboard.press('Enter').catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true, timeout: 15_000, downloadsPath: `${scratch}/dl`,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: `${scratch}/home`, TMPDIR: `${scratch}/tmp`, XDG_CONFIG_HOME: `${scratch}/xdg/config`, XDG_CACHE_HOME: `${scratch}/xdg/cache`, XDG_DATA_HOME: `${scratch}/xdg/data`, LANG: 'C.UTF-8' },
    args: ['--disable-gpu', '--disable-extensions', '--disable-sync', '--disable-component-update', '--disable-background-networking', '--no-first-run',
      '--no-default-browser-check', '--password-store=basic', '--disk-cache-size=1', '--media-cache-size=1', '--renderer-process-limit=1',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, serviceWorkers: 'block', permissions: [] });
    await context.route('**/*', handleRequest);
    const page = await context.newPage();
    page.on('dialog', dialog => { if (room(result.dialogs)) result.dialogs.push({ type: dialog.type(), message: clip(dialog.message()) }); dialog.dismiss().catch(() => {}); });
    page.on('download', download => { if (room(result.downloads)) result.downloads.push({ url: clip(download.url(), 500), filename: clip(download.suggestedFilename(), 120) }); download.cancel().catch(() => {}); });
    context.on('page', popup => { if (popup !== page) { result.popups += 1; popup.close().catch(() => {}); } });

    try {
      await page.goto(`file://${args.file}`, { waitUntil: 'load', timeout: LOAD_MS });
      result.loaded = true;
    } catch (error) {
      // A PDF or other non-HTML file may start a download instead of navigating; that is recorded by the download handler.
      result.loaded = result.downloads.length > 0 || /download is starting/i.test(String(error?.message));
      if (!result.loaded) result.error = clip(error?.message, 160);
    }
    // Marks are measured from the start of the harness; a slow launch (the trace runtime is slow) makes them immediate.
    const until = async at => { await new Promise(resolve => setTimeout(resolve, Math.max(0, at - elapsed()))); };
    await until(SHOT_AT_MS[0]);
    await shoot(page, '2s');
    await typeCredential(page);
    await until(SHOT_AT_MS[1]);
    await shoot(page, '10s');
    await shoot(page, 'exit');
    // A credential counts as captured only when it left the page in a (blocked) request: its URL or body carries the typed password.
    for (const form of result.forms) form.captured = credentialCaptured;
  } finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3_000))]).catch(() => {});
  }
}

const watchdog = setTimeout(() => { result.error ??= 'harness-timeout'; emit(0); process.exit(0); }, TOTAL_MS);
main().catch(error => { result.error ??= clip(error?.message, 160); }).finally(() => { clearTimeout(watchdog); emit(0); process.exit(0); });
