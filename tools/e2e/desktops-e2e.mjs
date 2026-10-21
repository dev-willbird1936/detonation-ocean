// Desktops E2E: three scenes (flagship OAuth worm, one deception, one sunlight run-file) on both shells with a
// mid-scene OS swap, on the attack path and on the safe path. Real clicks inside the shells; every non-loopback
// request is aborted and counted. Screenshots: docs/desktop-parity/screens/final-integrate-*.png. See README.md.
import { readFileSync } from 'node:fs';
import { start, openScene, OUT, FAIL_DIR, PARENT } from './desktops-e2e-lib.mjs';
import { evidenceToPatches, publish } from '../../backend/detonation/replay.mjs';

const only = process.argv[2] || 'all';
const results = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const { ctx, external, stop } = await start();

const shot = (s, name) => s.page.screenshot({ path: `${OUT}/final-integrate-${name}.png` });
const macWindow = (s, name) => s.frame('macos').locator(`[role=dialog][aria-label="${name}"]`);

async function signIn(s, os) {
  if (os === 'windows') {
    const win = s.frame('windows');
    await win.locator('[data-testid=lock-screen]').waitFor({ timeout: 20000 });
    await s.page.waitForTimeout(1200);
    await s.page.mouse.click(720, 450);
    await s.page.waitForTimeout(800);
    await win.getByRole('button', { name: 'Sign in' }).click();
  } else {
    await s.frame('macos').getByText('Click to log in').click();
  }
  await s.waitScene(state => state.auth === 'desktop', 'signed in');
  await s.waitScene(state => state.scene.stepId === 'toast', 'toast');
  await s.page.waitForTimeout(900);
}

async function openMail(s, os) {
  if (os === 'windows') await s.frame('windows').locator('[data-testid=task-mail]').click();
  else await s.frame('macos').locator('button[aria-label=Mail].dock-icon').click();
  await s.page.waitForTimeout(1200);
}

// The macOS Mail window does not select world.windows[].payload.messageId yet (requests/integrate-to-mac.md), so the
// trainee clicks the message, as they would anyway.
async function selectMacMessage(s, subject) {
  await macWindow(s, 'Mail').getByText(subject, { exact: true }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(600);
}

// The macOS Mail link chip shows the scene page's display address (scheme dropped), or `Open <page id>` when the
// page is missing; match either form for the links in the current world.
async function macLinkButton(s) {
  const world = await s.world();
  const pages = world.data.web?.pages ?? {};
  const labels = world.data.mail.messages.filter(item => item.link).map(item => {
    const page = pages[item.link.slice(6)];
    return page ? page.url.replace(/^https?:\/\//, '') : `Open ${item.link.slice(6)}`;
  });
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return macWindow(s, 'Mail').locator('button', { hasText: new RegExp(`^(${labels.map(escape).join('|')})$`) }).first();
}

async function followLink(s, os, subject) {
  if (os === 'windows') await s.frame('windows').locator('.ml-link').first().click();
  else {
    await selectMacMessage(s, subject);
    await (await macLinkButton(s)).click({ timeout: 8000 });
  }
}

async function pageChoice(s, os, label) {
  const button = os === 'windows'
    ? s.frame('windows').locator('.br-choice', { hasText: label })
    : s.frame('macos').locator('[role=dialog] button', { hasText: new RegExp(`^${label}$`) });
  await button.first().click({ timeout: 10000 });
}

async function expectStep(s, stepId) {
  const state = await s.waitScene(item => item.scene.stepId === stepId && item.scene.pendingActionId === null, `step ${stepId}`, 20000);
  check(`${s.label}: reached ${stepId}`, state.scene.stepId === stepId);
  await s.page.waitForTimeout(1000);
}

async function expectAttack(s, os, name) {
  await s.waitScene(state => state.scene.phase === 'attack', 'attack', 20000);
  await s.page.waitForTimeout(1800);
  await shot(s, `${name}-attack-${os}`);
  const world = await s.world();
  check(`${s.label}: malicious process in the world`, Boolean(world.data.processes?.some(item => item.id === 'sc-proc')));
  check(`${s.label}: attack caption over the ${os} shell`, await s.page.locator('#ocean-fx-caption').isVisible());
}

async function expectDebrief(s, os, name, path) {
  const state = await s.waitScene(item => item.scene.phase === 'debrief', 'debrief', 45000);
  check(`${s.label}: debrief on the ${path} path`, state.scene.path === path, state.scene.path);
  await s.page.waitForTimeout(700);
  check(`${s.label}: debrief window visible`, await s.page.locator('#ocean-debrief').isVisible());
  await shot(s, `${name}-debrief-${os}`);
}

async function swap(s, os, name) {
  const before = await s.world();
  await s.swap(os);
  const after = await s.world();
  check(`${s.label}: swap to ${os} keeps windows, mail and step`, JSON.stringify(after.windows) === JSON.stringify(before.windows) &&
    after.scene.stepId === before.scene.stepId && after.data.mail.messages.length === before.data.mail.messages.length);
  const shown = await s.frame(os).evaluate(() => window.OceanWorldAdapter.world.revision);
  check(`${s.label}: ${os} shell renders the current revision`, shown === after.revision, `${shown} vs ${after.revision}`);
  if (name) await shot(s, name);
}

async function run(profileId, label, body) {
  if (only !== 'all' && !label.startsWith(only)) return;
  const s = await openScene(ctx, profileId);
  s.label = label;
  try {
    await body(s);
  } catch (error) {
    check(`${label}: completed`, false, error.message.split('\n').slice(0, 14).join(' / '));
    await s.page.screenshot({ path: `${FAIL_DIR}/fail-${label}.png` });
    console.log('mac dialogs', await s.frame('macos').evaluate(() => [...document.querySelectorAll('[role=dialog]')].map(n => n.getAttribute('aria-label'))));
  }
  check(`${label}: no page errors`, s.errors.length === 0, s.errors.join(' | '));
  await s.page.close();
}

// ---- 1. Flagship: network-abuse-abyss (Gleam Docs OAuth worm) ----
await run('network-abuse-abyss', 'worm-fell', async s => {
  await signIn(s, 'windows');
  await shot(s, 'worm-01-toast-windows');
  await openMail(s, 'windows');
  await expectStep(s, 'mail');
  await shot(s, 'worm-02-lure-windows');
  await followLink(s, 'windows');
  await expectStep(s, 'consent');
  await shot(s, 'worm-03-consent-windows');
  await swap(s, 'macos', 'worm-04-consent-after-swap-macos');
  await pageChoice(s, 'macos', 'Allow');
  await expectStep(s, 'mailbox');
  const world = await s.world();
  check('worm-fell: worm copies in Sent', world.data.mail.messages.filter(item => item.id.startsWith('sc-sent-')).length === 4);
  await selectMacMessage(s, 'Gleam Docs is working in your mailbox');
  await shot(s, 'worm-05-mailbox-macos');
  await (await macLinkButton(s)).click({ timeout: 8000 });
  await s.page.waitForTimeout(800);
  await pageChoice(s, 'macos', 'Continue');
  await expectAttack(s, 'macos', 'worm-06');
  await swap(s, 'windows');
  await s.page.waitForTimeout(500);
  await shot(s, 'worm-07-attack-continues-windows');
  await expectDebrief(s, 'windows', 'worm-08', 'fell');
});

await run('network-abuse-abyss', 'worm-safe', async s => {
  await signIn(s, 'windows');
  await swap(s, 'macos');
  await openMail(s, 'macos');
  await selectMacMessage(s, 'Priya shared "Q4 supplier list" with you');
  await macWindow(s, 'Mail').locator('button[title="Move to Junk"]').first().click({ timeout: 8000 });
  await expectDebrief(s, 'macos', 'worm-09-safe', 'safe');
  const world = await s.world();
  check('worm-safe: lure moved to Junk', world.data.mail.messages.find(item => item.id === 'sc-mail').folder === 'junk');
  check('worm-safe: no attack played', world.data.processes === undefined);
});

// ---- 2. Deception: deception-twilight (look-alike sign-in + verification code) ----
await run('deception-twilight', 'twilight-fell', async s => {
  await swap(s, 'macos');
  await signIn(s, 'macos');
  await openMail(s, 'macos');
  await followLink(s, 'macos', 'Your Tidehall session expires today');
  await expectStep(s, 'signin');
  await shot(s, 'twilight-01-signin-macos');
  await pageChoice(s, 'macos', 'Sign in');
  await expectStep(s, 'mfa');
  check('twilight-fell: code texted to Messages', (await s.world()).data.messages.threads.some(item => item.id === 'sc-sms'));
  await swap(s, 'windows', 'twilight-02-code-after-swap-windows');
  await pageChoice(s, 'windows', 'Verify');
  await expectAttack(s, 'windows', 'twilight-03');
  await expectDebrief(s, 'windows', 'twilight-04', 'fell');
});

await run('deception-twilight', 'twilight-safe', async s => {
  await signIn(s, 'windows');
  await openMail(s, 'windows');
  await followLink(s, 'windows');
  await expectStep(s, 'signin');
  await swap(s, 'macos');
  await pageChoice(s, 'macos', 'Not now');
  await expectDebrief(s, 'macos', 'twilight-05-safe', 'safe');
});

// ---- 3. Sunlight run-file: intrusion-sunlight (attachment → Downloads → open) ----
await run('intrusion-sunlight', 'sunlight-fell', async s => {
  await signIn(s, 'windows');
  await openMail(s, 'windows');
  await expectStep(s, 'mail');
  await s.frame('windows').locator('.ml-attach').first().click();
  await expectStep(s, 'files');
  await shot(s, 'sunlight-01-downloads-windows');
  await swap(s, 'macos', 'sunlight-02-downloads-after-swap-macos');
  await macWindow(s, 'Downloads').getByText('Settlement-Draft-v7.doc', { exact: true }).first().dblclick({ timeout: 8000 });
  await expectAttack(s, 'macos', 'sunlight-03');
  await expectDebrief(s, 'macos', 'sunlight-04', 'fell');
});

await run('intrusion-sunlight', 'sunlight-safe', async s => {
  await swap(s, 'macos');
  await signIn(s, 'macos');
  await openMail(s, 'macos');
  // Mail opened on macOS is already open (and focused) on Windows: no taskbar click, which would minimise it.
  await swap(s, 'windows', 'sunlight-05-mail-after-swap-windows');
  await s.frame('windows').getByRole('button', { name: 'Delete' }).first().click({ timeout: 8000 });
  await expectDebrief(s, 'windows', 'sunlight-06-safe', 'safe');
});

// ---- 4. Runtime configuration: a profile overlay from the API, then live patchWorld / replaceWorld ----
await run('deception-midnight', 'config', async s => {
  let world = await s.world();
  check('config: overlay applied through GET /api/desktop/world', world.user.short === 'sam' && world.sys.theme === 'light' &&
    world.sys.wallpaperUrl === '/previews/win11-final/img/wallpaper/ThemeB/img2.jpg' && world.installed.length === 12 && world.data.mail.messages.length === 1);
  await signIn(s, 'windows');
  await shot(s, 'config-01-overlay-windows');
  await swap(s, 'macos', 'config-02-overlay-macos');
  const patched = await s.page.evaluate(() => window.OceanDesktop.patchWorld({
    sys: { theme: 'dark', accent: 'purple', wallpaper: 'depth-midnight', wallpaperUrl: null }, installed: ['files', 'browser', 'mail', 'settings', 'terminal'],
    dock: { pins: ['files', 'browser', 'mail', 'terminal', 'settings'] },
  }));
  check('config: patchWorld accepted', patched.ok, JSON.stringify(patched));
  await s.page.waitForTimeout(1200);
  world = await s.world();
  check('config: patch keeps the scene lure', world.data.mail.messages.some(item => item.id === 'sc-mail'));
  check('config: macOS shell shows the patched world', await s.frame('macos').evaluate(() => window.OceanWorldAdapter.world.sys.wallpaper) === 'depth-midnight');
  await shot(s, 'config-03-patched-macos');
  await swap(s, 'windows', 'config-04-patched-windows');
  const refused = await s.page.evaluate(() => window.OceanDesktop.patchWorld({ sys: { wallpaperUrl: 'https://cdn.example/x.png' } }));
  check('config: external wallpaper refused', !refused.ok, JSON.stringify(refused));
  const replaced = await s.page.evaluate(async () => {
    const base = await (await fetch('/api/desktop/world')).json();
    base.user = { ...base.user, name: 'Dana Okafor', short: 'dana', email: 'dana.okafor@northwind.example' };
    base.sys.theme = 'light';
    base.sys.wallpaper = 'depth-twilight';
    return window.OceanDesktop.replaceWorld(base);
  });
  check('config: replaceWorld accepted', replaced.ok, JSON.stringify(replaced));
  await s.page.waitForTimeout(1200);
  world = await s.world();
  check('config: replace keeps the session phase and re-applies the lure to the new user', world.phase === 'desktop' &&
    world.data.mail.messages.find(item => item.id === 'sc-mail')?.to === 'dana.okafor@northwind.example');
  await shot(s, 'config-05-replaced-windows');
});

// ---- 5. Detonation replay (AT-17, AT-29): invoice.py evidence published to run=<jobId>, both shells, OS switch ----
const invoice = JSON.parse(readFileSync(new URL('../../tests/fixtures/detonation/evidence/invoice.py.json', import.meta.url), 'utf8'));
const SHOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
// invoice.py plus a Run key, a browser settings write and a Wine screenshot, so every replay capability is on screen.
const replayEvidence = [...invoice.evidence,
  { id: 'ev-19', source: 'registry', kind: 'key-added', detail: 'Run key', at: '2026-01-01T00:00:18.000Z', hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', value: 'Updater', data: 'C:\\Users\\Dana\\Downloads\\updater.exe' },
  { id: 'ev-20', source: 'trace', kind: 'file-write', detail: 'browser settings', at: '2026-01-01T00:00:19.000Z', path: '/home/dana/.config/chromium/Default/Preferences' },
  { id: 'ev-21', source: 'wine', kind: 'screenshot', detail: 'screenshot', at: '2026-01-01T00:00:20.000Z', image: SHOT, caption: 'At 2 s' },
];

async function expectLockedFiles(s, os) {
  const names = ['Q3-report.docx.locked', 'budget.xlsx.locked', 'notes.txt.locked', 'photos-list.csv.locked'];
  const world = await s.world();
  const ids = names.map(name => Object.values(world.fs.nodes).find(node => node.name === name)?.id);
  check(`${s.label}: locked files in the world`, ids.every(Boolean) && ids.every(id => world.fs.nodes[id].encrypted === true));
  if (os === 'windows') {
    const win = s.frame('windows');
    await win.locator('[data-node]').first().waitFor({ timeout: 8000 });
    const locked = await win.locator('[data-node] [data-encrypted=true]').count();
    check(`${s.label}: File Explorer shows ${names.length} locked files`, locked === names.length, String(locked));
  } else {
    const win = macWindow(s, 'Documents');
    await win.locator('[data-item]').first().waitFor({ timeout: 8000 });
    const locked = await win.locator('[data-item] [data-lock-badge]').count();
    check(`${s.label}: Finder shows ${names.length} locked files`, locked === names.length, String(locked));
    for (const name of names) check(`${s.label}: Finder lists ${name}`, await win.getByText(name, { exact: true }).count() > 0);
  }
}

async function openDocuments(s, os) {
  await s.emit(os, { kind: 'open-app', app: 'files', payload: { folderId: 'documents' } });
  await s.page.waitForTimeout(1500);
}

await run('network-abuse-abyss', 'replay-windows-first', async s => {
  await signIn(s, 'windows');
  const patches = evidenceToPatches(replayEvidence, { path: 'run' });
  const sent = await publish('replay-e2e-1', patches, { baseUrl: PARENT });
  check('replay-windows-first: every patch accepted', sent.length === patches.length, `${sent.length}/${patches.length}`);
  // The page follows run=replay-e2e-1 when opened that way; this page follows `local`, so publish there too.
  await publish('local', patches, { baseUrl: PARENT });
  await s.page.waitForTimeout(1500);
  let world = await s.world();
  const titles = world.notifications.history.map(note => note.title);
  for (const title of ['Executed on Linux', 'Credential file read', 'Connection blocked: 203.0.113.9']) check(`replay-windows-first: banner "${title}" in the world`, titles.includes(title));
  const toasts = await s.frame('windows').locator('[data-testid=toast]').allInnerTexts();
  check('replay-windows-first: Windows shows the Connection blocked banner', toasts.some(text => text.includes('Connection blocked: 203.0.113.9')), toasts.join(' | '));
  await shot(s, 'replay-01-banners-windows');
  check('replay-windows-first: ransom note open in Notepad', await s.frame('windows').locator('.oceanWin[data-app=texteditor]').count() > 0);
  await openDocuments(s, 'windows');
  await expectLockedFiles(s, 'windows');
  await shot(s, 'replay-02-locked-windows');
  check('replay-windows-first: "What the program showed" window', await s.page.locator('#ocean-showed').isVisible() && (await s.page.locator('#ocean-showed h2').innerText()) === 'What the program showed');
  await shot(s, 'replay-03-showed-windows');
  await s.emit('windows', { kind: 'open-app', app: 'taskmanager' });
  await s.page.waitForTimeout(1200);
  await s.frame('windows').getByText('Startup apps', { exact: true }).first().click();
  check('replay-windows-first: Startup apps lists the sample\'s Run entry', await s.frame('windows').locator('[data-startup-id]').count() === 1);
  await s.frame('windows').getByText('Processes', { exact: true }).first().click();
  check('replay-windows-first: Task Manager lists python3', await s.frame('windows').locator('.tk-row', { hasText: 'python3' }).count() > 0);
  await shot(s, 'replay-04-taskmanager-windows');
  const before = await s.world();
  await swap(s, 'macos', 'replay-05-after-swap-macos');
  const after = await s.world();
  check('replay-windows-first: swap keeps the replay state', JSON.stringify(after.fs) === JSON.stringify(before.fs) &&
    JSON.stringify(after.data.startup) === JSON.stringify(before.data.startup) && after.data.web.homepage === 'scene:replay-homepage');
  await expectLockedFiles(s, 'macos');
  check('replay-windows-first: Finder window keeps the Documents folder open', await macWindow(s, 'Documents').count() > 0);
  check('replay-windows-first: TextEdit has the ransom note', await s.frame('macos').locator('[role=dialog][aria-label="README_DECRYPT.txt"], [role=dialog][aria-label*="TextEdit"], [role=dialog][aria-label*="README"]').count() > 0);
  check('replay-windows-first: "What the program showed" survives the swap', await s.page.locator('#ocean-showed').isVisible());
  const snapshot = await s.frame('macos').evaluate(() => window.OceanWorldAdapter.snapshot().data);
  check('replay-windows-first: macOS Login items and process from the world', snapshot.startup.length === 1 && snapshot.processes.some(item => item.name === 'python3') && snapshot.homepage === 'scene:replay-homepage', JSON.stringify([snapshot.startup, snapshot.homepage]));
  await shot(s, 'replay-06-locked-macos');
});

await run('network-abuse-abyss', 'replay-macos-first', async s => {
  await swap(s, 'macos');
  await signIn(s, 'macos');
  await publish('local', evidenceToPatches(replayEvidence, { path: 'wine' }), { baseUrl: PARENT });
  await s.page.waitForTimeout(1500);
  const banners = await s.frame('macos').evaluate(() => [...document.querySelectorAll('[code-path="src/os/components/NotificationCenter.tsx:143:5"] > div')].map(node => node.textContent));
  check('replay-macos-first: macOS shows the Connection blocked notification', banners.some(text => text.includes('Connection blocked: 203.0.113.9')), banners.join(' | '));
  await shot(s, 'replay-07-banners-macos');
  await swap(s, 'windows');
  await openDocuments(s, 'windows');
  await expectLockedFiles(s, 'windows');
  check('replay-windows-first: label "Ran under Wine"', (await s.world()).notifications.history.some(note => note.title === 'Ran under Wine'));
  await shot(s, 'replay-08-locked-windows-after-swap');
});

// `?job=<jobId>` follows run=<jobId>.
await (async () => {
  if (only !== 'all' && !'replay-job'.startsWith(only)) return;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${PARENT}/desktop.html?job=replay-e2e-2`);
  await page.locator('#gate-opt-in').check({ timeout: 20000 });
  await page.locator('#gate-enter').click();
  await page.waitForSelector('body[data-session-state="profile-scene"]', { timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.worldStream === 'open', null, { timeout: 10000 });
  // Neutral desktop: signed in as Dana with the seeded folders, and no scene content however long it runs.
  const windows = page.frames().find(item => item.url().includes('/win11-final/'));
  await windows.locator('[data-testid=lock-screen]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(720, 450);
  await page.waitForTimeout(800);
  await windows.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => window.OceanDesktop.getScene().auth === 'desktop', null, { timeout: 15000 });
  await page.waitForTimeout(4000);
  const neutral = await page.evaluate(() => ({ world: window.OceanDesktop.getWorld(), desk: window.OceanDesktop.getScene() }));
  const namesIn = folder => Object.values(neutral.world.fs.nodes).filter(node => node.parentId === folder).map(node => node.name).sort();
  check('replay-job: neutral profile is Dana with the seeded folders',
    neutral.world.user.short === 'dana' && namesIn('documents').join() === 'Q3-report.docx,budget.xlsx,notes.txt,photos-list.csv' &&
    namesIn('desktop').join() === 'todo.txt' && namesIn('pictures').join() === 'holiday-01.png,holiday-02.png' && namesIn('downloads').length === 0, JSON.stringify(neutral.world.user));
  check('replay-job: no scene mail, processes or windows, and the scene does not advance',
    !neutral.world.data.mail.messages.some(item => item.id.startsWith('sc-')) && !(neutral.world.data.processes ?? []).length &&
    neutral.world.windows.length === 0 && neutral.desk.scene.phase === 'boot' && neutral.world.scene.phase === 'boot', neutral.desk.scene.phase);
  await publish('replay-e2e-2', evidenceToPatches(invoice.evidence, { path: 'run' }), { baseUrl: PARENT });
  await page.waitForTimeout(1500);
  const world = await page.evaluate(() => window.OceanDesktop.getWorld());
  check('replay-job: /desktop.html?job=<jobId> follows run=<jobId>', world.user.short === 'dana' && world.notifications.history.some(note => note.title === 'Executed on Linux'));
  check('replay-job: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
})();

check('zero non-loopback requests', external.length === 0, external.slice(0, 5).join(' '));
await stop();
const failed = results.filter(([status]) => status === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
