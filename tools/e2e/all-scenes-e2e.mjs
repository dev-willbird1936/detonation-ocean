// All-scenes E2E: plays creature scenes through real clicks in both final shells.
//   fell: the attack path on one OS, swapping to the other OS when the first action step is reached;
//   safe: the safe path on the other OS (trench scenes have none: the debrief's patched replay is played instead).
// The driver is generic: it reads world.scene.highlight and the data.web page choices and clicks what a trainee
// would. Each run asserts the attack and debrief, a valid world at every step, no page errors and zero non-loopback
// requests. Failures save fail-scenes-<scene>-<path>.png in E2E_FAIL_DIR. See README.md (coverage tables).
//   node tools/e2e/all-scenes-e2e.mjs                           the 30 family scenes, both paths
//   node tools/e2e/all-scenes-e2e.mjs intrusion-twilight        only scene ids that start with the argument
//   node tools/e2e/all-scenes-e2e.mjs --scenarios [prefix]      the 60 scenarios of data/ocean-selection.json
// Scenario mode adds, per scenario (SCENARIOS-60-CONTRACT): the victim's lock screen (name, no password input, one
// click), the intro card and Brief button, focus dimming and the creature on both OSes (re-asserted after the swap),
// creature states up to press and breakthrough, a sandbox controller run (E2E_SANDBOX=docker for real containers,
// else simulated) feeding the attack animation, and the debrief's receipt panel. Screenshots of the attack moment and
// the debrief go to docs/desktop-parity/screens/scenarios-60/<id>-attack.png and <id>-debrief.png.
process.env.E2E_PARENT_PORT ||= '4386';
process.env.E2E_SHELLS_PORT ||= '4387';
const { start, openScene, FAIL_DIR, PROJECT, PARENT } = await import('./desktops-e2e-lib.mjs');
const { mkdirSync } = await import('node:fs');
const { resolve } = await import('node:path');

const scenariosMode = process.argv[2] === '--scenarios';
const only = (scenariosMode ? process.argv[3] : process.argv[2]) || '';
const SANDBOX_MODE = process.env.E2E_SANDBOX === 'docker' ? 'docker' : 'simulated';
const ONLY_PATH = process.env.E2E_ONLY_PATH || '';
const SCENARIO_SHOTS = resolve(process.env.SCENARIO_SHOTS_DIR || resolve(PROJECT, 'docs/desktop-parity/screens/scenarios-60'));
if (scenariosMode) mkdirSync(SCENARIO_SHOTS, { recursive: true });
const MAC_APP_NAMES = Object.freeze({ mail: 'Mail', browser: 'Safari', files: 'Finder', mfa: 'Authenticator', updates: 'Software Update' });
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = text => new RegExp(`^\\s*${escape(text)}\\s*$`);
const rows = [];

const { ctx, external, stop } = await start();
const { runScenario } = await import('../../backend/sandbox/controller.mjs');

// ---- shell gestures (one per OS) ---------------------------------------------------------------------------

// The lock screen of a scenario: the victim's name and email, no input of any kind, a loadable avatar if one is drawn.
async function lockChecks(frame, user, problems) {
  const text = await frame.locator('body').innerText();
  if (!text.includes(user.name)) problems.push(`lock screen does not show the user name "${user.name}"`);
  if (user.email && !text.includes(user.email)) problems.push(`lock screen does not show the email "${user.email}"`);
  // The lock screen is the full-viewport layer around the user's name; any input inside it (or any password input) fails.
  const found = await frame.evaluate(name => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let root = null;
    for (let node = walker.nextNode(); node && !root; node = walker.nextNode()) if (node.textContent.includes(name)) root = node.parentElement;
    while (root && root.parentElement && root !== document.body) {
      const box = root.getBoundingClientRect();
      if (box.width >= innerWidth * 0.9 && box.height >= innerHeight * 0.9) break;
      root = root.parentElement;
    }
    const scope = root ?? document.body;
    return [...scope.querySelectorAll('input, textarea, [contenteditable=true]')].map(element => element.tagName.toLowerCase() + '[type=' + element.type + '][class=' + String(element.className).slice(0, 40) + ']').concat(
      [...document.querySelectorAll('input[type=password]')].map(() => 'password'));
  }, user.name);
  if (found.length) problems.push('lock screen has input element(s); there must be no password field: ' + found.join(' '));
  const broken = await frame.evaluate(() => [...document.querySelectorAll('img[src*="/avatars/"]')].filter(img => !(img.complete && img.naturalWidth > 0)).map(img => img.getAttribute('src')));
  if (broken.length) problems.push(`avatar did not load: ${broken.join(', ')}`);
}

// Scenario mode passes the victim: the lock screen is checked and one click on the user signs in.
async function signIn(s, os, user = null, problems = []) {
  if (os === 'windows') {
    const win = s.frame('windows');
    await win.locator('[data-testid=lock-screen]').waitFor({ timeout: 20000 });
    await s.page.waitForTimeout(1200);
    await s.page.mouse.click(720, 450);
    await s.page.waitForTimeout(800);
    if (user) {
      await lockChecks(win, user, problems);
      await win.locator('[data-testid=lock-user]').click();
    } else await win.getByRole('button', { name: 'Sign in' }).click();
  } else {
    const mac = s.frame('macos');
    const login = mac.getByText('Click to log in');
    if (user) {
      await login.waitFor({ timeout: 20000 });
      await s.page.waitForTimeout(600);
      await lockChecks(mac, user, problems);
    }
    await login.click();
  }
  await s.waitScene(state => state.auth === 'desktop', 'signed in');
}

const macWindow = (s, title) => s.frame('macos').locator(`[role=dialog][aria-label="${title}"]`);

async function openApp(s, os, app) {
  if (os === 'windows') await s.frame('windows').locator(`[data-testid=task-${app}]`).click();
  else await s.frame('macos').locator(`button[aria-label="${MAC_APP_NAMES[app]}"].dock-icon`).click();
}

// The lure (or journey) message: selected in the reader, then its link, attachment, Report/Junk or Delete.
async function mailGesture(s, os, message, action) {
  if (os === 'windows') {
    const win = s.frame('windows');
    const reader = win.locator('.ml-reader');
    if (await reader.locator('.ml-subject', { hasText: exact(message.subject) }).count() === 0) {
      await win.locator('.ml-item', { hasText: message.subject }).first().click({ timeout: 8000 });
    }
    if (action === 'link') await reader.locator('.ml-link').first().click({ timeout: 8000 });
    else if (action === 'attachment') await reader.locator('.ml-attach').first().click({ timeout: 8000 });
    else await reader.getByRole('button', { name: action === 'report' ? 'Report' : 'Delete' }).first().click({ timeout: 8000 });
    return;
  }
  const mail = macWindow(s, 'Mail');
  await mail.getByText(message.subject, { exact: true }).first().click({ timeout: 8000 });
  await s.page.waitForTimeout(400);
  const world = await s.world();
  if (action === 'link') {
    const page = world.data.web?.pages[message.link.slice(6)];
    await mail.locator('button', { hasText: exact(page ? page.url.replace(/^https?:\/\//, '') : `Open ${message.link.slice(6)}`) }).first().click({ timeout: 8000 });
  } else if (action === 'attachment') {
    await mail.locator('button', { hasText: exact(world.fs.nodes[message.attachments[0]].name) }).first().click({ timeout: 8000 });
  } else {
    await mail.locator(`button[title="${action === 'report' ? 'Move to Junk' : 'Move to Trash'}"]`).first().click({ timeout: 8000 });
  }
}

async function pageChoice(s, os, label) {
  const button = os === 'windows'
    ? s.frame('windows').locator('.br-choice', { hasText: exact(label) })
    : s.frame('macos').locator('[role=dialog] button', { hasText: exact(label) });
  await button.first().click({ timeout: 10000 });
}

async function mfaChoice(s, os, label) {
  const button = os === 'windows'
    ? s.frame('windows').locator('.au-app').getByRole('button', { name: label })
    : macWindow(s, 'Authenticator').locator('button', { hasText: exact(label) });
  await button.first().click({ timeout: 10000 });
}

async function fileGesture(s, os, world, node, action) {
  if (os === 'windows') {
    const item = s.frame('windows').locator(`.fx-item[title="${node.name}"]`).first();
    if (action === 'open') await item.dblclick({ timeout: 8000 });
    else {
      await item.click({ timeout: 8000 });
      await s.frame('windows').locator('.fx-app [title=Delete]').first().click({ timeout: 8000 });
    }
    return;
  }
  // Finder titles its window with the folder name.
  const item = macWindow(s, world.fs.nodes[node.parentId].name).getByText(node.name, { exact: true }).first();
  if (action === 'open') await item.dblclick({ timeout: 8000 });
  else {
    await item.click({ button: 'right', timeout: 8000 });
    await s.frame('macos').getByText('Move to Trash', { exact: true }).first().click({ timeout: 8000 });
  }
}

// The parent's OS switch. A click that does not switch is retried once and noted.
async function swapTo(s, os, notes) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await s.swap(os);
    if (await s.page.evaluate(() => document.body.dataset.os) === os) return;
    notes.push(`swap to ${os} retried`);
  }
  throw new Error(`the OS switch did not change to ${os}`);
}

// ---- scenario presentation checks (scenario mode) ------------------------------------------------------------

// The intro card after sign-in: text, dismiss, reopen with the Brief button, dismiss again.
async function checkIntro(s, id, scene, problems) {
  const entry = await s.page.evaluate(key => globalThis.OceanScenarioData?.[key] ?? null, id);
  const card = scene.introCard;
  if (!card || !entry) { problems.push('scene has no intro card'); return; }
  const intro = s.page.locator('#ocean-intro');
  const read = async () => ({
    title: (await s.page.locator('#intro-title').textContent()).trim(),
    line: (await s.page.locator('#intro-line').textContent()).trim(),
    next: (await s.page.locator('#intro-next').textContent()).trim(),
  });
  const verify = (shown, where) => {
    if (shown.title !== card.title || shown.line !== card.line || shown.next !== card.next) problems.push(`intro card text differs ${where}: ${JSON.stringify(shown).slice(0, 200)}`);
  };
  await intro.waitFor({ state: 'visible', timeout: 10000 });
  const first = await read();
  verify(first, 'on first show');
  if (entry.year !== null) {
    if (!first.title.endsWith(`(${entry.year})`)) problems.push(`intro title "${first.title}" does not end with (${entry.year})`);
    if (!first.line.startsWith(`The year is ${entry.year}. You are a `)) problems.push(`intro line does not start with "The year is ${entry.year}. You are a ": "${first.line.slice(0, 80)}"`);
  } else if (!first.line.startsWith('You are a ')) problems.push(`intro line does not start with "You are a ": "${first.line.slice(0, 80)}"`);
  if (!first.title.includes(entry.attackTitle.replace(/\s*\(\d{4}\)$/, '').trim())) problems.push(`intro title "${first.title}" lacks the attack title "${entry.attackTitle}"`);
  await s.page.locator('#intro-dismiss').click({ timeout: 8000 });
  await intro.waitFor({ state: 'hidden', timeout: 5000 });
  await s.page.locator('#ocean-brief').click({ timeout: 8000 });
  await intro.waitFor({ state: 'visible', timeout: 5000 });
  verify(await read(), 'after the Brief button');
  await s.page.locator('#intro-dismiss').click({ timeout: 8000 });
  await intro.waitFor({ state: 'hidden', timeout: 5000 });
}

async function dismissIntro(s) {
  if (await s.page.locator('#ocean-intro').isVisible()) await s.page.locator('#intro-dismiss').click({ timeout: 8000 });
}

// Dock / taskbar icons with the opacity and filter the page actually renders.
function iconStates(s, os) {
  return s.frame(os).evaluate(isWindows => {
    const out = [];
    const look = element => { const style = getComputedStyle(element); return { opacity: Number(style.opacity), filter: style.filter }; };
    if (isWindows) {
      for (const element of document.querySelectorAll('[data-testid^="task-"]')) out.push({ app: element.dataset.testid.slice(5), ...look(element) });
    } else {
      for (const element of document.querySelectorAll('[data-dock-app]')) out.push({ app: window.OceanWorldAdapter.canonicalOf(element.dataset.dockApp), ...look(element) });
    }
    return out;
  }, os === 'windows');
}

// Focus dimming: an icon off the attack path is dimmed, an icon on it is bright.
async function checkFocus(s, os, problems, where) {
  const world = await s.world();
  const focus = world.scene.focusApps ?? [];
  if (!focus.length) { problems.push(`${where}: world.scene.focusApps is empty`); return; }
  const until = Date.now() + 4000;
  let dim = null;
  let bright = null;
  let icons = [];
  for (;;) {
    icons = (await iconStates(s, os)).filter(icon => icon.app && world.installed.includes(icon.app));
    dim = icons.find(icon => !focus.includes(icon.app) && (icon.opacity < 0.8 || /saturate/.test(icon.filter)));
    bright = icons.find(icon => focus.includes(icon.app) && icon.opacity >= 0.8 && !/saturate/.test(icon.filter));
    const dimmable = icons.some(icon => !focus.includes(icon.app));
    const brightable = icons.some(icon => focus.includes(icon.app));
    if ((dim || !dimmable) && (bright || !brightable)) break;
    if (Date.now() > until) break;
    await s.page.waitForTimeout(250);
  }
  const offPath = icons.filter(icon => !focus.includes(icon.app));
  const onPath = icons.filter(icon => focus.includes(icon.app));
  if (!offPath.length) problems.push(`${where}: no off-path app icon in the ${os} dock/taskbar to check dimming on (focus ${focus.join(',')}; icons ${icons.map(icon => icon.app).join(',')})`);
  else if (!dim) problems.push(`${where}: no off-path icon is dimmed in ${os} (${offPath.map(icon => `${icon.app}:${icon.opacity}`).join(' ')})`);
  if (!onPath.length) problems.push(`${where}: no focus-app icon in the ${os} dock/taskbar (focus ${focus.join(',')}; icons ${icons.map(icon => icon.app).join(',')})`);
  else if (!bright) problems.push(`${where}: no focus-app icon is bright in ${os} (${onPath.map(icon => `${icon.app}:${icon.opacity}`).join(' ')})`);
}

// The creature sprite in the shell's wallpaper layer, matching world.scene.creature (hidden at breakthrough).
async function checkCreature(s, os, problems, where) {
  const until = Date.now() + 5000;
  let mismatch = '';
  let state = null;
  for (;;) {
    const world = await s.world();
    const creature = world.scene.creature;
    state = creature?.state ?? null;
    const shown = await s.frame(os).evaluate(isWindows => {
      const layer = document.querySelector(isWindows ? '[data-testid=creature-layer]' : '#ocean-creature');
      if (!layer || layer.hidden || getComputedStyle(layer).display === 'none') return null;
      const image = layer.querySelector('img');
      return { state: layer.dataset.state ?? image?.dataset.state ?? null, src: image?.getAttribute('src') ?? null, loaded: Boolean(image && image.complete && image.naturalWidth > 0) };
    }, os === 'windows');
    mismatch = '';
    if (!creature) mismatch = 'world.scene.creature is null';
    else if (creature.state === 'breakthrough') { if (shown) mismatch = 'the shell still draws the creature at breakthrough'; }
    else if (!shown) mismatch = `no creature element in the ${os} wallpaper layer`;
    else if (shown.state !== creature.state) mismatch = `creature state ${shown.state} in the shell, ${creature.state} in the world`;
    else if (shown.src !== creature.sprite) mismatch = `creature sprite ${shown.src}, expected ${creature.sprite}`;
    else if (!shown.loaded) mismatch = 'creature sprite did not load';
    if (!mismatch || Date.now() > until) break;
    await s.page.waitForTimeout(250);
  }
  if (mismatch) problems.push(`${where}: ${mismatch}`);
  return state;
}

// Records the fx overlay's text while the attack plays: the badge ("verified by sandbox (docker)" / "simulated") and
// the sandbox event labels. Takes the attack-moment screenshot once the expected badge and an event label show.
function watchFx(s, id) {
  const snapshots = new Set();
  const badges = new Set();
  let active = true;
  let shot = false;
  const norm = text => text.toLowerCase().replace(/\s+/g, ' ');
  const loop = (async () => {
    while (active) {
      const seen = await s.page.evaluate(() => ({ text: document.querySelector('#ocean-fx-layer')?.textContent ?? '', labels: (window.OceanDesktop.getWorld().sandbox?.events ?? []).map(event => event.label) })).catch(() => ({ text: '', labels: [] }));
      const text = norm(seen.text);
      if (text) {
        snapshots.add(text);
        for (const badge of text.match(/verified by sandbox \((?:docker|vultr)\)|simulated|waiting for sandbox/g) ?? []) badges.add(badge);
        const wanted = SANDBOX_MODE === 'docker' ? 'verified by sandbox (docker)' : 'simulated';
        if (!shot && badges.has(wanted) && seen.labels.some(label => text.includes(norm(label).slice(0, 30)))) {
          shot = true;
          await s.page.screenshot({ path: `${SCENARIO_SHOTS}/${id}-attack.png` }).catch(() => {});
        }
      }
      await s.page.waitForTimeout(120);
    }
  })();
  return {
    badges, snapshots,
    get shot() { return shot; },
    async stop() { active = false; await loop; },
  };
}

// ---- the generic driver -------------------------------------------------------------------------------------

const live = state => ['lure', 'action'].includes(state.scene.phase);

// One gesture for the live step: the forward choice, or the safe one when `safe` is set.
async function act(s, os, safe) {
  const world = await s.world();
  const highlight = world.scene.highlight;
  const step = s.steps.find(item => item.id === world.scene.stepId);
  if (step.app === 'toast') {
    if (step.dismissPassive) return 'wait';
    await openApp(s, os, highlight.app);
    return 'open';
  }
  if (step.kind === 'benign' || step.kind === 'auto') return 'wait';
  if (highlight.app === 'mail') {
    const message = world.data.mail.messages.find(item => item.id === highlight.ref);
    if (safe) {
      await mailGesture(s, os, message, os === 'windows' ? 'delete' : 'report');
      return os === 'windows' ? 'delete' : 'report';
    }
    if (message.link) await mailGesture(s, os, message, 'link');
    else await mailGesture(s, os, message, 'attachment');
    if (choicesFor(step).forward.some(id => ['follow-link', 'download'].includes(id))) return message.link ? 'follow-link' : 'download';
    // Journey steps (mailbox, redirect): the link opens a status page whose primary button moves the journey on.
    await s.page.waitForTimeout(800);
    return browserChoice(s, os, false);
  }
  if (highlight.app === 'browser') return browserChoice(s, os, safe);
  if (highlight.app === 'mfa') {
    await mfaChoice(s, os, safe ? 'Deny' : 'Approve');
    return safe ? 'deny' : 'approve';
  }
  if (highlight.app === 'files') {
    await fileGesture(s, os, world, world.fs.nodes[highlight.ref], safe ? 'delete' : 'open');
    return safe ? 'delete' : 'run-file';
  }
  throw new Error(`no gesture for highlight ${JSON.stringify(highlight)} at ${step.id}`);
}

// The focused browser window's scene page: its primary (forward) or first secondary (safe) choice button.
async function browserChoice(s, os, safe) {
  const world = await s.world();
  const win = world.windows.find(item => item.app === 'browser');
  const page = world.data.web?.pages[win?.payload?.url?.slice(6)];
  if (!page) throw new Error(`no scene page in the browser (${JSON.stringify(win?.payload)})`);
  const choice = page.choices.find(item => item.style === (safe ? 'secondary' : 'primary'));
  await pageChoice(s, os, choice.label);
  return choice.choiceId;
}

async function validWorld(s) {
  return s.page.evaluate(() => window.OceanWorldModel.validate(window.OceanDesktop.getWorld()));
}

// Starts the sandbox controller against the in-process app server for this run id. Not awaited: its events reach
// the page through the run's event stream while the attack animation plays.
function startSandbox(runId, profileId, attackKind) {
  return runScenario({ scenarioId: profileId, attackKind, runId, mode: SANDBOX_MODE, baseUrl: PARENT, paceMs: 350 });
}

// A run that hangs (a stuck renderer never answers page.evaluate) is cut off and reported, so one scene cannot stall the suite.
const RUN_LIMIT_MS = Number(process.env.E2E_RUN_LIMIT_MS || 360000);
async function play(profileId, path, os, scenario = null) {
  let timer;
  const limit = new Promise(resolve => {
    timer = setTimeout(async () => {
      for (const page of ctx.pages()) await page.close({ runBeforeUnload: false }).catch(() => {});
      const row = { profileId, path, os: os ?? 'windows', swapped: null, ok: false, trail: '', problems: [`run exceeded ${RUN_LIMIT_MS / 1000}s (browser hung)`] };
      console.log('FAIL', profileId, path, row.problems[0]);
      row.pushed = true;
      rows.push(row);
      resolve(row);
    }, RUN_LIMIT_MS);
  });
  try {
    const row = await Promise.race([playRun(profileId, path, os, scenario), limit]);
    if (!row.pushed) rows.push(row);
    return row;
  } finally { clearTimeout(timer); }
}

// `os` null: the scenario's own OS (scenario mode). `scenario` is { run } in scenario mode.
async function playRun(profileId, path, os, scenario = null) {
  let s;
  for (let attempt = 0; !s; attempt += 1) {
    try { s = await openScene(ctx, profileId, scenario?.run); } catch (error) {
      if (!attempt) continue;
      const row = { profileId, path, os: os ?? 'windows', swapped: null, ok: false, trail: '', problems: [`could not open the scene: ${error.message.split('\n')[0]}`] };
      console.log('FAIL', profileId, path, row.problems[0]);
      return row;
    }
  }
  const externalBefore = external.length;
  const startedAt = Date.now();
  const trail = [];
  const problems = [];
  const notes = [];
  const creatureTrail = [];
  let swapped = null;
  let sandbox = null;
  let fxWatch = null;
  let lastLiveCreature = null;
  let label = `${profileId} ${path}`;
  let other = 'windows';
  try {
    const scene = await s.page.evaluate(() => window.OceanScenes.get(new URLSearchParams(location.search).get('profile')));
    s.steps = scene.steps;
    if (os === null) os = scene.os;
    other = os === 'windows' ? 'macos' : 'windows';
    label = `${profileId} ${path}`;
    const safeIndex = path === 'safe' ? scene.steps.findLastIndex(step => choicesFor(step).safe.length > 0) : -1;
    if (path === 'safe' && !scene.safePath) throw new Error('scene has no safe path');
    const startOs = await s.page.evaluate(() => document.body.dataset.os);
    if (scenario && path === 'fell' && startOs !== scene.os) problems.push(`scene starts on ${startOs}, the scenario says ${scene.os}`);
    if (startOs !== os) await swapTo(s, os, notes);
    const world0 = await s.world();
    await signIn(s, os, scenario ? world0.user : null, problems);
    if (scenario) {
      if (path === 'fell') await checkIntro(s, profileId, scene, problems);
      else await dismissIntro(s);
      await checkFocus(s, os, problems, `after sign-in (${os})`);
      creatureTrail.push(await checkCreature(s, os, problems, `after sign-in (${os})`));
    }
    let current = os;
    for (let round = 0; round < 40; round += 1) {
      const state = await s.waitScene(item => item.scene.phase !== 'boot' && (!live(item) || item.scene.pendingActionId === null), 'step settles', 30000);
      if (!live(state)) break;
      const check = await validWorld(s);
      if (!check.ok) problems.push(`invalid world at ${state.scene.stepId}: ${check.error}`);
      const index = scene.steps.findIndex(step => step.id === state.scene.stepId);
      if (path === 'fell' && !swapped && scene.steps[index].phase === 'action') {
        const before = await s.world();
        await swapTo(s, other, notes);
        current = other;
        const after = await s.world();
        const shown = await s.frame(other).evaluate(() => window.OceanWorldAdapter.world.revision);
        swapped = `${state.scene.stepId}`;
        // A timed (trench) step may advance during the swap; going backwards or a shell on an old revision is a loss.
        const stepIndex = id => scene.steps.findIndex(step => step.id === id);
        if (stepIndex(after.scene.stepId) < stepIndex(before.scene.stepId) || shown !== after.revision) problems.push(`swap at ${swapped} lost state (shell rev ${shown}, world ${after.revision})`);
        if (scenario) await checkFocus(s, current, problems, `after the swap to ${current}`);
      }
      if (scenario) {
        lastLiveCreature = await checkCreature(s, current, problems, `step ${state.scene.stepId} (${current})`);
        creatureTrail.push(lastLiveCreature);
        // The creature presses against the glass on the last forward step: the sandbox run starts with the final choice.
        if (path === 'fell' && lastLiveCreature === 'press' && !sandbox) {
          sandbox = { promise: startSandbox(scenario.run, profileId, scene.attackKind) };
          fxWatch = watchFx(s, profileId);
        }
      }
      await s.page.waitForTimeout(600);
      const did = await act(s, current, index === safeIndex);
      trail.push(`${state.scene.stepId}:${did}`);
      const waitMs = did === 'wait' ? 30000 : 20000;
      await s.waitScene(item => !live(item) || item.scene.stepId !== state.scene.stepId || item.runId !== state.runId, `leave ${state.scene.stepId} after ${did}`, waitMs);
    }
    const expected = path === 'fell' ? 'fell' : 'safe';
    if (path === 'fell') {
      await s.waitScene(item => ['attack', 'debrief'].includes(item.scene.phase), 'attack', 20000);
      const world = await s.world();
      if (!world.data.processes?.some(item => item.id === 'sc-proc')) problems.push('no sc-proc in the world during the attack');
      if (scenario) {
        if (lastLiveCreature !== 'press') problems.push(`creature state on the last forward step was ${lastLiveCreature}, expected press`);
        if (world.scene.phase === 'attack' || (await s.scene()).scene.phase === 'attack') {
          if (world.scene.creature?.state !== 'breakthrough') problems.push(`creature state during the attack was ${world.scene.creature?.state}, expected breakthrough`);
          creatureTrail.push(await checkCreature(s, current, problems, 'at breakthrough'));
        } else problems.push('the attack phase ended before the breakthrough could be observed');
        if (!sandbox) {
          problems.push('the sandbox run never started: no press state before the attack; starting it late');
          sandbox = { promise: startSandbox(scenario.run, profileId, scene.attackKind) };
          fxWatch = watchFx(s, profileId);
        }
      }
    }
    let state = await s.waitScene(item => item.scene.phase === 'debrief', 'debrief', 60000);
    if (path === 'patched') {
      // Trench: no safe path; the debrief replays the scene with the patch applied, which ends on the safe debrief.
      await s.page.locator('#ocean-debrief button', { hasText: scene.patched.label }).click();
      trail.push('debrief:patched-replay');
      for (let round = 0; round < 10; round += 1) {
        const next = await s.waitScene(item => item.scene.phase !== 'boot' && (!live(item) || item.scene.pendingActionId === null), 'patched step', 30000);
        if (!live(next)) break;
        await act(s, current, false);
        await s.waitScene(item => !live(item) || item.scene.stepId !== next.scene.stepId, `leave ${next.scene.stepId}`, 30000);
      }
      state = await s.waitScene(item => item.scene.phase === 'debrief' && item.scene.path === 'safe', 'patched debrief', 60000);
    }
    if (state.scene.path !== expected) problems.push(`debrief path ${state.scene.path}, expected ${expected}`);
    await s.page.waitForTimeout(500);
    if (!await s.page.locator('#ocean-debrief').isVisible()) problems.push('debrief window hidden');
    if (scenario && path === 'fell' && sandbox) {
      const result = await sandbox.promise;
      if (!result.ok) problems.push(`sandbox run failed: ${result.error ?? JSON.stringify(result.publish.failures).slice(0, 200)}`);
      await fxWatch.stop();
      const mode = SANDBOX_MODE;
      const wanted = mode === 'docker' ? 'verified by sandbox (docker)' : 'simulated';
      if (!fxWatch.badges.has(wanted)) problems.push(`the attack animation never showed the "${wanted}" badge (saw: ${[...fxWatch.badges].join(' | ') || 'none'})`);
      if (mode === 'docker' && fxWatch.badges.has('simulated')) problems.push('the attack animation showed the "simulated" badge for a docker run');
      const text = [...fxWatch.snapshots].join(' ');
      const unseen = result.events.filter(event => !text.includes(event.label.toLowerCase().replace(/\s+/g, ' ').slice(0, 30)));
      if (unseen.length === result.events.length) problems.push('the attack animation showed none of the sandbox event labels (scripted fallback?)');
      const receiptPanel = s.page.locator('#ocean-debrief .ocean-receipt');
      await receiptPanel.waitFor({ state: 'visible', timeout: 15000 }).catch(() => problems.push('debrief shows no sandbox receipt panel'));
      const panelText = await receiptPanel.innerText().catch(() => '');
      if (!/Teardown confirmed\s*yes/i.test(panelText)) problems.push(`receipt panel does not say "Teardown confirmed yes": ${panelText.replace(/\s+/g, ' ').slice(0, 160)}`);
      const world = await s.world();
      if (world.sandbox?.receipt?.teardownConfirmed !== true) problems.push('world.sandbox.receipt.teardownConfirmed is not true');
      if (world.sandbox?.status !== 'destroyed') problems.push(`world.sandbox.status is ${world.sandbox?.status}, expected destroyed`);
      if (world.sandbox?.mode !== mode) problems.push(`world.sandbox.mode is ${world.sandbox?.mode}, expected ${mode}`);
      notes.push(`sandbox ${mode}: ${result.events.length} events, badge ${[...fxWatch.badges].join('/')}`);
      if (!fxWatch.shot) await s.page.screenshot({ path: `${SCENARIO_SHOTS}/${profileId}-attack-missed.png` }).catch(() => {});
    }
    const check = await validWorld(s);
    if (!check.ok) problems.push(`invalid final world: ${check.error}`);
    if (scenario) await s.page.screenshot({ path: `${SCENARIO_SHOTS}/${profileId}-${path === 'fell' ? 'debrief' : `${path}-debrief`}.png` }).catch(() => {});
  } catch (error) {
    problems.push(error.message.split('\n').slice(0, 6).join(' / '));
  }
  if (fxWatch) await fxWatch.stop().catch(() => {});
  if (sandbox) await sandbox.promise.catch(() => {});
  if (s.errors.length) problems.push(...s.errors);
  if (external.length > externalBefore) problems.push(`non-loopback requests: ${external.slice(externalBefore, externalBefore + 3).join(' ')}`);
  const ok = problems.length === 0;
  if (!ok) await s.page.screenshot({ path: `${FAIL_DIR}/fail-scenes-${profileId}-${path}.png` }).catch(() => {});
  console.log(ok ? 'PASS' : 'FAIL', label, `${Math.round((Date.now() - startedAt) / 1000)}s`, `[${os}${swapped ? ` → ${other} at ${swapped}` : ''}]`, trail.join(' '), creatureTrail.length ? `creature ${creatureTrail.join('>')}` : '', notes.join('; '), ok ? '' : `\n     ${problems.join('\n     ')}`);
  const row = { profileId, path, os, swapped: swapped ? other : null, ok, trail: trail.join(' '), problems };
  await s.page.close().catch(() => {});
  return row;
}

// choicesFor() runs in Node too (CommonJS module), so the plan matches the parent's V2 model exactly.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { choicesFor } = require('../../ui/desktop/desktop-model.js');
const osName = os => (os === 'windows' ? 'Windows' : 'macOS');

// The OS a scenario starts on, read from the page's scenario data (only for E2E_ONLY_PATH=safe).
async function scenarioOs(profileId) {
  const page = await ctx.newPage();
  await page.goto(`${PARENT}/desktop.html?profile=${profileId}`);
  await page.waitForFunction(() => window.OceanScenarioData, null, { timeout: 20000 });
  const os = await page.evaluate(id => window.OceanScenarioData[id].os, profileId);
  await page.close();
  return os;
}

if (scenariosMode) {
  const selection = require('../../data/ocean-selection.json');
  const ids = Object.values(selection.depths).flat().map(item => item.id);
  console.log(`scenario mode: ${ids.length} scenarios, sandbox ${SANDBOX_MODE}, screenshots ${SCENARIO_SHOTS}`);
  // E2E_RANGE=10-20 runs scenarios 10..19 of the selection (chunks keep memory use bounded).
  const [rangeFrom, rangeTo] = (process.env.E2E_RANGE || `0-${ids.length}`).split('-').map(Number);
  for (const [position, profileId] of ids.entries()) {
    if (!profileId.startsWith(only) || position < rangeFrom || position >= rangeTo) continue;
    const run = `e2e-${profileId}`.slice(0, 40);
    const trench = (selection.depths.trench ?? []).some(item => item.id === profileId);
    const fell = ONLY_PATH === 'safe' ? { os: (await scenarioOs(profileId)) } : await play(profileId, 'fell', null, { run });
    if (ONLY_PATH !== 'fell') await play(profileId, trench ? 'patched' : 'safe', fell.os === 'windows' ? 'macos' : 'windows', { run: `e2s-${profileId}`.slice(0, 40) });
  }
} else {
  const { loadOceanProfiles } = await import('../../backend/ocean-profiles.mjs');
  const ids = (await loadOceanProfiles(PROJECT)).profiles.map(profile => profile.id);
  for (const [index, profileId] of ids.entries()) {
    if (!profileId.startsWith(only)) continue;
    const fellOs = index % 2 ? 'macos' : 'windows';
    const safeOs = fellOs === 'windows' ? 'macos' : 'windows';
    await play(profileId, 'fell', fellOs);
    await play(profileId, profileId.endsWith('-trench') ? 'patched' : 'safe', safeOs);
  }
}

await stop();
const failed = rows.filter(row => !row.ok);
console.log('\n| Scene | Fell path | Safe path |\n|---|---|---|');
for (const id of [...new Set(rows.map(row => row.profileId))]) {
  const cell = row => (row ? `${row.ok ? 'pass' : '**FAIL**'} · ${osName(row.os)}${row.swapped ? ` → ${osName(row.swapped)}` : ''}${row.path === 'patched' ? ' (patched replay)' : ''}` : '—');
  console.log(`| \`${id}\` | ${cell(rows.find(row => row.profileId === id && row.path === 'fell'))} | ${cell(rows.find(row => row.profileId === id && row.path !== 'fell'))} |`);
}
console.log(`\n${rows.length - failed.length}/${rows.length} runs passed, ${external.length} non-loopback requests`);
process.exitCode = failed.length || external.length || rows.length === 0 ? 1 : 0;
