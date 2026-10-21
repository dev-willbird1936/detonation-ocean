// Sync E2E: every shared-world item round-trips between the two shells through real UI input. For each case and each
// direction (Windows first, then macOS first): change the item in OS A, switch OS, read it back from OS B's DOM, change
// it again in OS B, switch back and read OS B's value from OS A's DOM. The world is checked after each change; every
// non-loopback request is aborted and counted; page errors fail the case. See README.md (sync coverage matrix).
//
// Every round trip, every random step and every scenario step also ends with assertSynced() (assert-synced.mjs): both
// shells' snapshot() equal normalise(world) after an OS swap.
//
//   node tools/e2e/sync-e2e.mjs                           all cases, both directions
//   node tools/e2e/sync-e2e.mjs notes,mail                cases whose id starts with one of the arguments
//   node tools/e2e/sync-e2e.mjs --random [steps] [seed]   random UI action sequence (default 24 steps, seed 1)
//   node tools/e2e/sync-e2e.mjs --scenarios [prefix]      every scenario in data/desktop-profiles, every step
process.env.E2E_PARENT_PORT ||= '4392';
process.env.E2E_SHELLS_PORT ||= '4393';
const { start, openScene, OUT, FAIL_DIR } = await import('./desktops-e2e-lib.mjs');

const { assertSynced } = await import('./assert-synced.mjs');

const PROFILE = 'intrusion-sunlight';
const MODE = process.argv[2] === '--random' ? 'random' : process.argv[2] === '--scenarios' ? 'scenarios' : 'cases';
const filters = (MODE === 'cases' ? process.argv[2] || '' : '').split(',').filter(Boolean);
const OTHER = { windows: 'macos', macos: 'windows' };
const NAME = { windows: 'Windows', macos: 'macOS' };
const results = [];
const { ctx, external, stop } = await start();

// ---- small helpers -------------------------------------------------------------------------------------------------

const sleep = (s, ms) => s.page.waitForTimeout(ms);
async function until(s, test, label, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await test(); } catch (error) { last = error.message.split('\n')[0]; }
    if (last === true) return;
    if (Date.now() > end) throw new Error(`timed out: ${label}${last && last !== false ? ` (${String(last).slice(0, 200)})` : ''}`);
    await sleep(s, 150);
  }
}
const untilWorld = (s, test, label, timeout) => until(s, async () => test(await s.world()), `world: ${label}`, timeout);
const esc = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = text => new RegExp(`^\\s*${esc(text)}\\s*$`);
const stamp = () => Date.now().toString(36).slice(-5);

// macOS native app names (dock, Spotlight, window title) and Windows app names (taskbar title, search).
const MAC = {
  files: 'Finder', browser: 'Safari', mail: 'Mail', messages: 'Messages', mfa: 'Authenticator', updates: 'Software Update', settings: 'System Settings',
  terminal: 'Terminal', notes: 'Notes', texteditor: 'TextEdit', calendar: 'Calendar', reminders: 'Reminders', contacts: 'Contacts', photos: 'Photos',
  media: 'Music', calculator: 'Calculator', clock: 'Clock', store: 'App Store', taskmanager: 'Activity Monitor', stickies: 'Stickies', whiteboard: 'Freeform',
};
const WIN = {
  files: 'File Explorer', browser: 'Browser', mail: 'Mail', messages: 'Chat', mfa: 'Authenticator', updates: 'Windows Update', settings: 'Settings',
  terminal: 'Terminal', notes: 'Notes', texteditor: 'Notepad', calendar: 'Calendar', reminders: 'To Do', contacts: 'People', photos: 'Photos',
  media: 'Media Player', calculator: 'Calculator', clock: 'Clock', store: 'Store', taskmanager: 'Task Manager', stickies: 'Sticky Notes', whiteboard: 'Whiteboard',
};

const winFrame = s => s.frame('windows');
const macFrame = s => s.frame('macos');
// The window element of an app in each shell.
const macFinder = s => macFrame(s).locator('[role=dialog]:has([data-iconview])').last();
const winWindow = (s, app) => winFrame(s).locator(`.oceanWin[data-app="${app}"]`).last();
const macWindow = (s, label) => macFrame(s).locator(`[role=dialog][aria-label="${label}"]`).last();
// macOS windows titled after their content: Finder (the folder), Terminal ("alex — -zsh — 80×24").
// System Settings is titled after its pane.
const MAC_DIALOG = { terminal: '[role=dialog][aria-label*="-zsh"]' };
const appWindow = (s, os, app, label = MAC[app]) => (os === 'windows' ? winWindow(s, app) : app === 'files' ? macFinder(s)
  : app === 'settings' ? macSettingsWindow(s) : MAC_DIALOG[app] ? macFrame(s).locator(MAC_DIALOG[app]).last() : macWindow(s, label));
const worldWindow = (world, app) => world.windows.filter(win => win.app === app).at(-1);

// Opens an app the way a trainee does: taskbar or dock when pinned, otherwise search (Windows) or Spotlight (macOS).
// A window that is already open and visible is only brought forward (a taskbar click on the focused one minimises it).
async function openApp(s, os, app) {
  let world = await s.world();
  const open = worldWindow(world, app);
  if (open && open.mode !== 'minimized') {
    // Another window may cover the title bar: bring the window forward from the taskbar or the Dock (running apps are there).
    if (world.focusedId !== open.id) await (os === 'windows' ? winFrame(s).locator(`[data-testid="task-${app}"] .tsIcon`).first() : macFrame(s).locator(`button[aria-label="${MAC[app]}"].dock-icon`)).click();
    await untilWorld(s, w => w.focusedId === open.id, `${app} focused`);
    return open;
  }
  if (world.dock.pins.includes(app) && world.installed.includes(app)) {
    if (os === 'windows') await winFrame(s).locator(`[data-testid="task-${app}"] .tsIcon`).first().click();
    else await macFrame(s).locator(`button[aria-label="${MAC[app]}"].dock-icon`).click();
  } else if (os === 'windows') {
    await winFrame(s).locator('[data-testid=search-pill]').click();
    await winFrame(s).locator('[data-testid=search-input]').fill(WIN[app]);
    await sleep(s, 300);
    await s.page.keyboard.press('Enter');
  } else {
    await macFrame(s).locator('button[aria-label=Spotlight]').click();
    await sleep(s, 400);
    await s.page.keyboard.type(MAC[app]);
    await sleep(s, 400);
    await s.page.keyboard.press('Enter');
  }
  await untilWorld(s, w => { const win = worldWindow(w, app); return Boolean(win && win.mode !== 'minimized' && w.focusedId === win.id); }, `${app} open`);
  await sleep(s, 700);
  world = await s.world();
  return worldWindow(world, app);
}

async function closeApp(s, os, app) {
  const count = (await s.world()).windows.filter(win => win.app === app).length;
  if (!count) return;
  const button = appWindow(s, os, app).locator('button[aria-label=Close]').first();
  // The parent's chrome bar (OS switch, Restart, Exit) covers the close button of a window tiled to the top right.
  await button.click({ timeout: 3000 }).catch(() => button.dispatchEvent('click'));
  await untilWorld(s, w => w.windows.filter(win => win.app === app).length < count, `${app} closed`);
}

// The macOS window title bar: the top strip of the frame, right of the traffic lights.
async function macTitleBar(s, app, label = MAC[app]) {
  const box = await appWindow(s, 'macos', app, label).boundingBox();
  return { click: options => s.page.mouse.click(box.x + box.width / 2, box.y + 12, options), box };
}

// A window's on-screen rectangle in the world's 1000x600 virtual work area, read from the shell DOM.
async function domRect(s, os, app, label) {
  const element = appWindow(s, os, app, label);
  if (!(await element.isVisible())) return null;
  const box = await element.boundingBox();
  const area = os === 'windows'
    ? await winFrame(s).evaluate(() => ({ x: 0, y: 0, w: innerWidth, h: Math.max(200, innerHeight - 48) }))
    : await macFrame(s).evaluate(() => window.__macos27.workArea());
  // The Windows frame body includes the title bar; macOS frames are drawn at the world rect directly.
  return { x: (box.x - area.x) * 1000 / area.w, y: (box.y - area.y) * 600 / area.h, w: box.width * 1000 / area.w, h: box.height * 600 / area.h };
}
const near = (a, b, tolerance = 14) => a && b && ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) <= tolerance);
const fmt = rect => (rect ? `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.w)}x${Math.round(rect.h)}` : 'hidden');

// Drags from a point by an offset with real pointer input.
async function drag(s, from, to) {
  await s.page.mouse.move(from.x, from.y);
  await s.page.mouse.down();
  await s.page.mouse.move(to.x, to.y, { steps: 12 });
  await s.page.mouse.up();
}
async function titlePoint(s, os, app) {
  if (os === 'windows') {
    const box = await winWindow(s, app).locator('.oceanTitleText').boundingBox();
    return { x: box.x + 30, y: box.y + box.height / 2 };
  }
  const box = await macWindow(s, MAC[app]).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + 12 };
}

// ---- the round trip ------------------------------------------------------------------------------------------------

// Signs in on the OS the scene starts on. A scenario's Windows lock screen shows the victim's tile instead of Sign in.
async function signIn(s) {
  if (await s.page.evaluate(() => document.body.dataset.os) === 'macos') await macFrame(s).getByText('Click to log in').click({ timeout: 20000 });
  else {
    const win = winFrame(s);
    await win.locator('[data-testid=lock-screen]').waitFor({ timeout: 20000 });
    await sleep(s, 1200);
    await s.page.mouse.click(720, 450);
    await sleep(s, 800);
    await win.locator('[data-testid=lock-user]').or(win.getByRole('button', { name: 'Sign in' })).first().click();
  }
  await s.waitScene(state => state.auth === 'desktop', 'signed in');
  await sleep(s, 1000);
}

async function swapTo(s, os) {
  const from = await s.page.evaluate(() => document.body.dataset.os);
  if (from !== os) await closeOverlays(s, from).catch(() => {});
  await s.swap(os);
  const world = await s.world();
  await until(s, async () => (await s.frame(os).evaluate(() => window.OceanWorldAdapter.world.revision)) === world.revision, `${os} renders revision ${world.revision}`);
  await sleep(s, 400);
}

const shot = (s, name) => s.page.screenshot({ path: `${OUT}/final-sync-${name}.png` });

// One case: { id, title, setup?(s, os), change: {windows, macos}(s, value), world(world, value), seen: {windows, macos}(s, value),
// values: [a, b], cleanup?(s, os), shot?: true }. `seen` returns true or a short reason.
async function roundTrip(s, item, first) {
  const second = OTHER[first];
  const [a, b] = typeof item.values === 'function' ? item.values() : item.values;
  const step = async (os, value, label) => {
    await item.change[os](s, value);
    await untilWorld(s, world => item.world(world, value), `${label} in ${NAME[os]}`);
  };
  const seen = async (os, value, label) => until(s, () => item.seen[os](s, value), `${label} visible in ${NAME[os]}`, 8000);
  await swapTo(s, first);
  if (item.setup) await item.setup(s, first);
  await step(first, a, `change ${JSON.stringify(a)}`);
  await swapTo(s, second);
  await seen(second, a, JSON.stringify(a));
  if (item.shot && first === 'windows') await shot(s, `${item.id}-1-${second}-sees-${first}`);
  await step(second, b, `change ${JSON.stringify(b)}`);
  await swapTo(s, first);
  await seen(first, b, JSON.stringify(b));
  if (item.shot && first === 'windows') await shot(s, `${item.id}-2-${first}-sees-${second}`);
  if (item.cleanup) await item.cleanup(s, first);
  // Whole-world check. A drifting path is recorded once, against the case after which it first shows; later cases only
  // note it, so one shell bug does not fail every case after it.
  const problems = await assertSynced(s);
  const fresh = problems.filter(line => !knownDrift.has(driftKey(line)));
  for (const line of problems) knownDrift.add(driftKey(line));
  if (fresh.length) driftFound.push(`after ${item.id} (${NAME[first]} first): ${fresh.join(' / ')}`);
  return problems.length ? `whole-world drift: ${[...new Set(problems.map(driftKey))].join(', ')}` : '';
}
// Drift is reported in its own row ("Whole world"), so the item rows keep testing their own item.
const driftFound = [];
const knownDrift = new Set();
// "macos /notifications/history/0/id: shell …" -> "macos /notifications/history" (index and leaf dropped).
const driftKey = line => line.split(':')[0].replace(/\/\d+(\/.*)?$/, '');

const CASES = [];
const define = item => CASES.push(item);

// ---- windows: open, move, minimise, maximise, tile, close ------------------------------------------------------------

define({
  id: 'window-open-close', title: 'Window open / close',
  values: ['open', 'closed'],
  change: {
    windows: (s, value) => (value === 'open' ? openApp(s, 'windows', 'calculator') : closeApp(s, 'windows', 'calculator')),
    macos: (s, value) => (value === 'open' ? openApp(s, 'macos', 'calculator') : closeApp(s, 'macos', 'calculator')),
  },
  world: (world, value) => Boolean(worldWindow(world, 'calculator')) === (value === 'open'),
  seen: {
    windows: async (s, value) => (await winWindow(s, 'calculator').isVisible()) === (value === 'open'),
    macos: async (s, value) => (await macWindow(s, 'Calculator').isVisible()) === (value === 'open'),
  },
});

const notesOpen = async (s, os) => { await openApp(s, os, 'notes'); };
const rectSeen = os => async (s, value) => {
  const world = await s.world();
  const win = worldWindow(world, 'notes');
  const rect = await domRect(s, os, 'notes');
  return near(rect, win.rect) || `dom ${fmt(rect)} vs world ${fmt(win.rect)} (${value})`;
};
define({
  id: 'window-move', title: 'Window position (drag)',
  values: [{ dx: 120, dy: 60 }, { dx: -90, dy: -40 }],
  setup: notesOpen,
  change: {
    windows: async (s, by) => { const from = await titlePoint(s, 'windows', 'notes'); await drag(s, from, { x: from.x + by.dx, y: from.y + by.dy }); },
    macos: async (s, by) => { const from = await titlePoint(s, 'macos', 'notes'); await drag(s, from, { x: from.x + by.dx, y: from.y + by.dy }); },
  },
  // The drag lands as one set-rect; the expected world rect is checked through the other shell's DOM.
  world: () => true,
  seen: { windows: rectSeen('windows'), macos: rectSeen('macos') },
  shot: true,
});
// Records the rect after each drag so the world check is exact.
const moveCase = CASES.at(-1);
for (const os of ['windows', 'macos']) {
  const change = moveCase.change[os];
  moveCase.change[os] = async (s, by) => {
    const before = worldWindow(await s.world(), 'notes').rect;
    await change(s, by);
    await untilWorld(s, w => { const r = worldWindow(w, 'notes').rect; return Math.abs(r.x - before.x - by.dx * 1000 / 1440) < 25 && Math.abs(r.y - before.y) > 5; }, `notes moved by ${by.dx},${by.dy}`);
  };
}

define({
  id: 'window-minimize', title: 'Window minimise / restore',
  values: ['minimized', 'normal'],
  setup: notesOpen,
  change: {
    windows: async (s, mode) => {
      if (mode === 'minimized') await winWindow(s, 'notes').locator('button[aria-label=Minimise]').click();
      else await winFrame(s).locator('[data-testid="task-notes"] .tsIcon').first().click();
    },
    macos: async (s, mode) => {
      if (mode === 'minimized') await macWindow(s, 'Notes').locator('button[aria-label=Minimize]').click();
      else await macFrame(s).locator('button[aria-label="Notes"].dock-icon').click();
    },
  },
  world: (world, mode) => worldWindow(world, 'notes')?.mode === mode,
  seen: {
    // A minimised Windows frame stays in the DOM, faded out (data-mode="minimized", opacity 0).
    windows: async (s, mode) => (await winWindow(s, 'notes').getAttribute('data-mode')) === mode &&
      (await winWindow(s, 'notes').evaluate(node => getComputedStyle(node).opacity)) === (mode === 'normal' ? '1' : '0'),
    macos: async (s, mode) => (await macWindow(s, 'Notes').isVisible()) === (mode === 'normal'),
  },
});

const fills = os => async s => {
  const rect = await domRect(s, os, 'notes');
  return near(rect, { x: 0, y: 0, w: 1000, h: 600 }, 20) || `dom ${fmt(rect)}`;
};
define({
  id: 'window-maximize', title: 'Window maximise / restore',
  values: ['maximized', 'normal'],
  setup: notesOpen,
  change: {
    windows: async (s, mode) => {
      await winWindow(s, 'notes').locator(`button[aria-label=${mode === 'maximized' ? 'Maximise' : 'Restore'}]`).click();
    },
    // macOS fills the screen with a double click on the title bar; it has no un-fill gesture, so the trainee drags the
    // bottom-right corner inwards.
    macos: async (s, mode) => {
      if (mode === 'maximized') return (await macTitleBar(s, 'notes')).click({ clickCount: 2 });
      const box = await macWindow(s, 'Notes').boundingBox();
      await drag(s, { x: box.x + box.width - 3, y: box.y + box.height - 3 }, { x: box.x + box.width - 400, y: box.y + box.height - 250 });
    },
  },
  world: (world, mode) => {
    const win = worldWindow(world, 'notes');
    const full = win.mode === 'maximized' || near(win.rect, { x: 0, y: 0, w: 1000, h: 600 }, 2);
    return mode === 'maximized' ? full : !full;
  },
  seen: {
    windows: async (s, mode) => (mode === 'maximized' ? fills('windows')(s) : !(await fills('windows')(s) === true) || 'still full'),
    macos: async (s, mode) => (mode === 'maximized' ? fills('macos')(s) : !(await fills('macos')(s) === true) || 'still full'),
  },
});

const TILE_RECT = { left: { x: 0, y: 0, w: 500, h: 600 }, right: { x: 500, y: 0, w: 500, h: 600 } };
define({
  id: 'window-tile', title: 'Window tile (snap left / right)',
  values: ['left', 'right'],
  setup: notesOpen,
  change: {
    // Windows: drag the title bar to the screen edge (Aero snap).
    windows: async (s, side) => {
      const from = await titlePoint(s, 'windows', 'notes');
      await drag(s, from, { x: side === 'left' ? 1 : 1439, y: from.y + 80 });
    },
    // macOS: menu bar Window ▸ Move & Resize ▸ Left Half / Right Half. (The green button's hover menu shows the same
    // items, but picking one does nothing: requests/sync-e2e-to-engine-mac.md §2.)
    macos: async (s, side) => {
      await macFrame(s).getByText('Window', { exact: true }).first().click();
      await macFrame(s).locator('[role=menuitem]', { hasText: 'Move & Resize' }).hover();
      await macFrame(s).locator('[role=menuitem]', { hasText: side === 'left' ? 'Left Half' : 'Right Half' }).click();
    },
  },
  world: (world, side) => {
    const win = worldWindow(world, 'notes');
    // macOS tiles with an 8 px margin and reports the frame as a rect: accept the half within 14 virtual units.
    return win.tile === side || (win.mode === 'normal' && near(win.rect, TILE_RECT[side], 14));
  },
  seen: {
    windows: async (s, side) => { const rect = await domRect(s, 'windows', 'notes'); return near(rect, TILE_RECT[side], 20) || `dom ${fmt(rect)}`; },
    macos: async (s, side) => { const rect = await domRect(s, 'macos', 'notes'); return near(rect, TILE_RECT[side], 20) || `dom ${fmt(rect)}`; },
  },
  cleanup: (s, os) => closeApp(s, os, 'notes'),
});

// ---- files: create, rename, move, trash / restore --------------------------------------------------------------------

const SIDEBAR = { documents: ['Documents', 'Documents'], downloads: ['Downloads', 'Downloads'], trash: ['Recycle Bin', 'Trash'] };
// Shows a folder in the file manager: Explorer's navigation pane; Finder's sidebar, or the Dock's Trash.
async function showFolder(s, os, folder) {
  if (os === 'windows') {
    await openApp(s, 'windows', 'files');
    await winWindow(s, 'files').locator('.fx-side-item', { hasText: exact(SIDEBAR[folder][0]) }).click();
  } else if (folder === 'trash') {
    await macFrame(s).getByRole('button', { name: 'Trash', exact: true }).last().click();
    await until(s, async () => (await macFinder(s).getAttribute('aria-label')) === 'Trash', 'Finder shows Trash');
  } else {
    await openApp(s, 'macos', 'files');
    await macFinder(s).getByRole('button', { name: SIDEBAR[folder][1], exact: true }).click();
    await until(s, async () => (await macFinder(s).getAttribute('aria-label')) === SIDEBAR[folder][1], `Finder shows ${folder}`);
  }
  await sleep(s, 300);
}
const fileItem = (s, os, name) => (os === 'windows'
  ? winWindow(s, 'files').locator(`.fx-item[title="${name}"]`)
  : macFinder(s).locator('[data-item]', { hasText: exact(name) }));
const nodeNamed = (world, name) => Object.values(world.fs.nodes).find(node => node.name === name);
// The folder the fs cases work on: the newest node named "Sync …".
const syncFolder = world => Object.values(world.fs.nodes).filter(node => node.kind === 'folder' && node.name.startsWith('Sync ')).at(-1);

async function newFolder(s, os, name) {
  await showFolder(s, os, 'documents');
  if (os === 'windows') {
    await winWindow(s, 'files').locator('button[title="New folder"]').click();
    const input = winWindow(s, 'files').locator('input.fx-rename');
    await input.waitFor();
    await input.fill(name);
    await input.press('Enter');
  } else {
    const box = await macFinder(s).locator('[data-iconview]').boundingBox();
    await s.page.mouse.click(box.x + box.width - 40, box.y + box.height - 40, { button: 'right' });
    await macFrame(s).locator('[role=menuitem]', { hasText: /^New Folder/ }).click();
    await sleep(s, 300);
    await s.page.keyboard.press('Control+A');
    await s.page.keyboard.type(name);
    await s.page.keyboard.press('Enter');
  }
}

async function renameItem(s, os, from, to) {
  if (os === 'windows') {
    await fileItem(s, os, from).click();
    await winWindow(s, 'files').locator('button[title=Rename]').click();
    const input = winWindow(s, 'files').locator('input.fx-rename');
    await input.fill(to);
    await input.press('Enter');
  } else {
    await fileItem(s, os, from).click({ button: 'right' });
    await macFrame(s).locator('[role=menuitem]', { hasText: /^Rename/ }).click();
    await sleep(s, 300);
    await s.page.keyboard.press('Control+A');
    await s.page.keyboard.type(to);
    await s.page.keyboard.press('Enter');
  }
}

define({
  id: 'fs-create-rename', title: 'Files: new folder, rename',
  values: () => [`Sync A ${stamp()}`, `Sync B ${stamp()}`],
  // OS A creates "Sync A …" in Documents; OS B renames it to "Sync B …".
  change: Object.fromEntries(['windows', 'macos'].map(os => [os, async (s, name) => (name.startsWith('Sync A')
    ? newFolder(s, os, name) : renameItem(s, os, syncFolder(await s.world()).name, name))])),
  world: (world, name) => nodeNamed(world, name)?.parentId === 'documents',
  seen: {
    windows: async (s, name) => { await showFolder(s, 'windows', 'documents'); return fileItem(s, 'windows', name).isVisible(); },
    macos: async (s, name) => { await showFolder(s, 'macos', 'documents'); return fileItem(s, 'macos', name).isVisible(); },
  },
  shot: true,
});

const cutPaste = async (s, name, to) => {
  await fileItem(s, 'windows', name).click();
  await winWindow(s, 'files').locator('button[title=Cut]').click();
  await showFolder(s, 'windows', to);
  await winWindow(s, 'files').locator('button[title=Paste]').click();
};
define({
  id: 'fs-move', title: 'Files: move between folders',
  values: ['downloads', 'documents'],
  setup: async (s, os) => { if (!syncFolder(await s.world())) await newFolder(s, os, `Sync A ${stamp()}`); },
  change: {
    windows: async (s, to) => {
      const node = syncFolder(await s.world());
      await showFolder(s, 'windows', node.parentId);
      await cutPaste(s, node.name, to);
    },
    // Finder: drag the item onto the sidebar folder.
    macos: async (s, to) => {
      const node = syncFolder(await s.world());
      await showFolder(s, 'macos', node.parentId);
      await fileItem(s, 'macos', node.name).dragTo(macFinder(s).getByRole('button', { name: SIDEBAR[to][1], exact: true }));
    },
  },
  world: (world, to) => syncFolder(world)?.parentId === to,
  seen: {
    windows: async (s, to) => { await showFolder(s, 'windows', to); return fileItem(s, 'windows', syncFolder(await s.world()).name).isVisible(); },
    macos: async (s, to) => { await showFolder(s, 'macos', to); return fileItem(s, 'macos', syncFolder(await s.world()).name).isVisible(); },
  },
});

define({
  id: 'fs-trash-restore', title: 'Files: move to trash, put back',
  values: ['trashed', 'restored'],
  setup: async (s, os) => { if (!syncFolder(await s.world())) await newFolder(s, os, `Sync A ${stamp()}`); },
  change: {
    windows: async (s, state) => {
      const node = syncFolder(await s.world());
      if (state === 'trashed') {
        await showFolder(s, 'windows', node.parentId);
        await fileItem(s, 'windows', node.name).click();
        await winWindow(s, 'files').locator('button[title=Delete]').click();
      } else {
        await showFolder(s, 'windows', 'trash');
        await fileItem(s, 'windows', node.name).click();
        await winWindow(s, 'files').getByRole('button', { name: 'Restore the selected items' }).click();
      }
    },
    macos: async (s, state) => {
      const node = syncFolder(await s.world());
      await showFolder(s, 'macos', state === 'trashed' ? node.parentId : 'trash');
      await fileItem(s, 'macos', node.name).click({ button: 'right' });
      await macFrame(s).locator('[role=menuitem]', { hasText: state === 'trashed' ? /^Move to Trash/ : /^Put Back/ }).click();
    },
  },
  world: (world, state) => syncFolder(world)?.trashed === (state === 'trashed'),
  seen: {
    windows: async (s, state) => {
      const node = syncFolder(await s.world());
      await showFolder(s, 'windows', state === 'trashed' ? 'trash' : node.parentId);
      return fileItem(s, 'windows', node.name).isVisible();
    },
    macos: async (s, state) => {
      const node = syncFolder(await s.world());
      await showFolder(s, 'macos', state === 'trashed' ? 'trash' : node.parentId);
      return fileItem(s, 'macos', node.name).isVisible();
    },
  },
  cleanup: async (s, os) => { for (const win of (await s.world()).windows.filter(item => item.app === 'files')) await closeApp(s, os, 'files'); },
});

// ---- settings: quick settings / Control Center, Settings app ---------------------------------------------------------

// Windows quick settings (tray) and macOS Control Center (menu bar) stay open between gestures.
async function winQuick(s) {
  if ((await winFrame(s).locator('[data-testid=quick-settings]').getAttribute('data-hide')) !== 'false') await winFrame(s).locator('[data-testid=tray-quick]').click();
  await sleep(s, 300);
}
const macCcTile = (s, name) => macFrame(s).locator('.cc-tile').filter({ has: macFrame(s).locator('div, span', { hasText: exact(name) }) }).first();
async function macCc(s) {
  if (!(await s.world()).overlays.quick) await macFrame(s).locator('button[aria-label="Control Center"]').click();
  await untilWorld(s, w => w.overlays.quick, 'Control Center open');
  await sleep(s, 400);
}
// Closes quick settings / Control Center on both shells with the same toggle a trainee uses.
async function closeOverlays(s, os) {
  if (os === 'windows' || !os) {
    if ((await winFrame(s).locator('[data-testid=quick-settings]').getAttribute('data-hide')) === 'false') await winFrame(s).locator('[data-testid=tray-quick]').click();
  }
  // The open Control Center covers the menu bar; a click on the desktop closes it, as on a Mac.
  if ((os === 'macos' || !os) && (await s.world()).overlays.quick) await s.page.mouse.click(700, 640);
  await sleep(s, 200);
}
// A Control Center toggle is on when its round icon is filled with a colour (off: translucent grey).
const macTileOn = async (s, name) => !(await macCcTile(s, name).locator('span.rounded-full').first().getAttribute('style')).includes('rgba(120, 120, 128');
const macCcButton = (s, name) => macFrame(s).locator('button.cc-tile', { hasText: exact(name) });
const macButtonOn = async (s, name) => !(await macCcButton(s, name).locator('span.rounded-full').first().getAttribute('style')).includes('rgba(120, 120, 128');

function quickToggle(id, title, key, winKey, macName, macButton = false) {
  const macOn = s => (macButton ? macButtonOn(s, macName) : macTileOn(s, macName));
  const flip = async (s, value, current, click) => { if (current(await s.world()) !== value) await click(); };
  const get = world => (key === 'theme' ? world.sys.theme === 'dark' : Boolean(world.sys[key]));
  define({
    id, title,
    values: () => [null, null],
    change: {
      windows: async (s, value) => { await winQuick(s); await flip(s, value ?? !get(await s.world()), get, () => winFrame(s).locator(`[data-testid=quick-${winKey}]`).click()); },
      // Dark Mode / Night Shift are buttons. Wi-Fi and Bluetooth tiles open a detail panel with a switch; the Focus tile
      // opens a list (Until Tonight … Off).
      macos: async (s, value) => {
        await macCc(s);
        await flip(s, value ?? !get(await s.world()), get, async () => {
          if (macButton) return macCcButton(s, macName).click();
          await macCcTile(s, macName).click();
          await sleep(s, 400);
          if (macName === 'Focus') return macFrame(s).locator('button', { hasText: value ? /^Until Tonight/ : /^Off$/ }).first().click();
          return macFrame(s).locator('[role=switch]').first().click();
        });
      },
    },
    world: () => true,
    seen: {
      windows: async s => { await winQuick(s); const want = get(await s.world()); return (await winFrame(s).locator(`[data-testid=quick-${winKey}]`).getAttribute('data-state')) === String(want) || `quick-${winKey} not ${want}`; },
      macos: async s => { await macCc(s); const want = get(await s.world()); return (await macOn(s)) === want || `${macName} not ${want}`; },
    },
    cleanup: closeOverlays,
  });
  const item = CASES.at(-1);
  // Each change flips the setting; the world must show the flipped value.
  for (const os of ['windows', 'macos']) {
    const change = item.change[os];
    item.change[os] = async (s, value) => { item.expected = !get(await s.world()); await change(s, item.expected); };
  }
  item.world = world => get(world) === item.expected;
}
quickToggle('sys-theme', 'Settings: light / dark', 'theme', 'theme', 'Dark Mode', true);
quickToggle('sys-focus', 'Settings: Focus', 'focus', 'focus', 'Focus');
quickToggle('sys-wifi', 'Settings: Wi-Fi', 'wifi', 'wifi', 'Wi-Fi');
quickToggle('sys-bluetooth', 'Settings: Bluetooth', 'bluetooth', 'bluetooth', 'Bluetooth');
quickToggle('sys-nightlight', 'Settings: Night light / Night Shift', 'nightLight', 'nightLight', 'Night Shift', true);

// Sliders: a click on the track at a fraction of its width. macOS draws brightness 40–115 % over the track.
const MAC_SLIDER = { volume: ['Sound', v => v], brightness: ['Display', v => (v - 40) * 4 / 3] };
const macSlider = (s, key) => macFrame(s).locator('.cc-tile', { hasText: MAC_SLIDER[key][0] }).locator('div.cursor-pointer').first();
function slider(id, title, key, values) {
  define({
    id, title, values,
    change: {
      windows: async (s, value) => {
        // A toast covers the slider (requests/sync-e2e-to-engine-win.md §1): close it with its ✕ first.
        for (const close of await winFrame(s).locator('[data-testid=toast] button[aria-label=Dismiss]').all()) await close.click().catch(() => {});
        await winQuick(s);
        const input = winFrame(s).locator(`[data-testid=${key}]`);
        const box = await input.boundingBox();
        const min = key === 'brightness' ? 20 : 0;
        await s.page.mouse.click(box.x + 8 + (box.width - 16) * (value - min) / (100 - min), box.y + box.height / 2);
      },
      macos: async (s, value) => {
        await macCc(s);
        const box = await macSlider(s, key).boundingBox();
        await s.page.mouse.click(box.x + box.width * MAC_SLIDER[key][1](value) / 100, box.y + box.height / 2);
      },
    },
    world: (world, value) => Math.abs(world.sys[key] - value) <= 4,
    seen: {
      windows: async s => { await winQuick(s); const shown = Number(await winFrame(s).locator(`[data-testid=${key}]`).inputValue()); const want = (await s.world()).sys[key]; return shown === want || `${key} slider ${shown} vs ${want}`; },
      macos: async s => {
        await macCc(s);
        const width = parseFloat(await macSlider(s, key).locator('div.absolute').first().evaluate(node => node.style.width));
        const want = MAC_SLIDER[key][1]((await s.world()).sys[key]);
        return Math.abs(width - Math.max(0, want)) <= 2 || `${key} bar ${width}% vs ${want}%`;
      },
    },
    cleanup: closeOverlays,
  });
}
slider('sys-volume', 'Settings: volume', 'volume', [30, 75]);
slider('sys-brightness', 'Settings: brightness', 'brightness', [85, 55]);

// Settings app panes.
async function winSettings(s, page) {
  await openApp(s, 'windows', 'settings');
  await winWindow(s, 'settings').locator(`[data-testid="settings-nav-${page}"]`).click();
  await sleep(s, 300);
}
// System Settings windows are titled after the open pane.
const macSettingsWindow = s => macFrame(s).locator('[role=dialog]').filter({ has: macFrame(s).getByRole('button', { name: 'Users & Groups', exact: true }) }).last();
async function macSettings(s, pane) {
  await openApp(s, 'macos', 'settings');
  await macSettingsWindow(s).getByRole('button', { name: pane, exact: true }).first().click();
  await sleep(s, 300);
}
const macRootData = (s, key) => macFrame(s).evaluate(name => document.documentElement.dataset[name], key);
const ACCENT_HEX = { blue: '#007AFF', purple: '#A550A7', pink: '#F74F9E', red: '#FF5257', orange: '#F7821B', yellow: '#FFC600', green: '#62BA46', graphite: '#8C8C8C' };

define({
  id: 'sys-accent', title: 'Settings: accent colour',
  values: ['purple', 'green'],
  change: {
    windows: async (s, accent) => { await winSettings(s, 'personalisation'); await winWindow(s, 'settings').locator(`[data-testid=accent-${accent}]`).click(); },
    macos: async (s, accent) => { await macSettings(s, 'Appearance'); await macSettingsWindow(s).locator(`button[aria-label="${accent}"]`).click(); },
  },
  world: (world, accent) => world.sys.accent === accent,
  seen: {
    windows: async (s, accent) => { await winSettings(s, 'personalisation'); return (await winWindow(s, 'settings').locator(`[data-testid=accent-${accent}]`).getAttribute('data-on')) === 'true'; },
    // The Mac's accent variable resolves to Apple's swatch colour, or a theme-adjusted one; any colour but blue's.
    macos: async (s, accent) => { const value = (await macFrame(s).evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent'))).trim().toUpperCase(); return value !== '#0A84FF' && value !== ACCENT_HEX.blue || `--accent ${value} for ${accent}`; },
  },
  cleanup: async (s, os) => closeApp(s, os, 'settings'),
});

const DEPTH_NAME = { 'depth-twilight': 'Twilight Zone', 'depth-abyss': 'Abyss', 'depth-midnight': 'Midnight Zone' };
define({
  id: 'sys-wallpaper', title: 'Settings: wallpaper',
  values: ['depth-abyss', 'depth-twilight'],
  change: {
    windows: async (s, id) => { await winSettings(s, 'personalisation'); await winWindow(s, 'settings').locator(`[data-testid=wall-${id}]`).click(); },
    macos: async (s, id) => { await macSettings(s, 'Wallpaper'); await macSettingsWindow(s).locator('button', { hasText: exact(DEPTH_NAME[id]) }).first().click(); },
  },
  world: (world, id) => world.sys.wallpaper === id && !world.sys.wallpaperUrl,
  seen: {
    windows: async (s, id) => { const image = await winFrame(s).locator('.background').first().evaluate(node => getComputedStyle(node).backgroundImage); return image.includes(`depth/${id.slice(6)}.svg`) || image.slice(0, 120); },
    macos: async (s, id) => (await macRootData(s, 'oceanWallpaper')) === id && (await macFrame(s).locator(`[style*="${id}.svg"]`).count()) > 0,
  },
  shot: true,
  cleanup: async (s, os) => closeApp(s, os, 'settings'),
});

// ---- app data: notes, reminders, calendar, contacts, mail, messages, alarms -------------------------------------------

const macApp = (s, app) => macWindow(s, MAC[app]);
const macMenu = async (s, target, item) => {
  await target.click({ button: 'right' });
  await macFrame(s).locator('[role=menuitem]', { hasText: item }).first().click();
};
const winMenu = async (s, app, target, item) => {
  await target.click({ button: 'right' });
  await winWindow(s, app).locator('.oc-menu-item', { hasText: item }).first().click();
};
const noteTitled = (world, title) => world.data.notes.find(note => note.title === title);

// Notes: OS A adds a note titled A; OS B retitles it B.
let noteId = null;
define({
  id: 'notes', title: 'Notes: new note, edit title',
  values: () => [`Sync note ${stamp()}`, `Sync edited ${stamp()}`],
  change: {
    windows: async (s, title) => {
      await openApp(s, 'windows', 'notes');
      const win = winWindow(s, 'notes');
      if (title.startsWith('Sync note')) await win.getByRole('button', { name: 'Add page' }).click();
      else await win.locator('.nt-page-item', { hasText: (await s.world()).data.notes.find(note => note.id === noteId).title }).click();
      await win.locator('input.nt-title').fill(title);
      // The title commits on blur.
      await win.locator('.nt-stamp').click();
    },
    macos: async (s, title) => {
      await openApp(s, 'macos', 'notes');
      const win = macApp(s, 'notes');
      if (title.startsWith('Sync note')) { await win.locator('button[title^="New note"]').click(); await win.locator('.notes-ed').click(); }
      else {
        await win.getByText((await s.world()).data.notes.find(note => note.id === noteId).title, { exact: true }).first().click();
        await win.locator('.notes-ed').click();
        await s.page.keyboard.press('Control+A');
      }
      await s.page.keyboard.type(title);
      await s.page.keyboard.press('Enter');
      await s.page.keyboard.type('Synced body');
    },
  },
  world: (world, title) => { const note = noteTitled(world, title); if (note && title.startsWith('Sync note')) noteId = note.id; return Boolean(note) && note.id === noteId; },
  seen: {
    windows: async (s, title) => { await openApp(s, 'windows', 'notes'); return winWindow(s, 'notes').locator('.nt-page-item', { hasText: title }).isVisible(); },
    macos: async (s, title) => { await openApp(s, 'macos', 'notes'); return macApp(s, 'notes').getByText(title, { exact: true }).first().isVisible(); },
  },
  shot: true,
  cleanup: async (s, os) => closeApp(s, os, 'notes'),
});

// Reminders: OS A adds one; OS B completes it.
const reminderTitled = (world, title) => world.data.reminders.find(item => item.title === title);
let reminderTitle = '';
define({
  id: 'reminders', title: 'Reminders: add, complete',
  values: () => { reminderTitle = `Sync task ${stamp()}`; return ['added', 'done']; },
  change: {
    windows: async (s, step) => {
      await openApp(s, 'windows', 'reminders');
      const win = winWindow(s, 'reminders');
      if (step === 'added') { await win.locator('input.ls-add-input').fill(reminderTitle); await win.locator('input.ls-add-input').press('Enter'); }
      else await win.locator('.ls-task', { hasText: reminderTitle }).locator('.oc-check').click();
    },
    macos: async (s, step) => {
      await openApp(s, 'macos', 'reminders');
      const win = macApp(s, 'reminders');
      if (step === 'added') { await win.locator('button[title^="New Reminder"]').click(); await sleep(s, 300); await s.page.keyboard.type(reminderTitle); await s.page.keyboard.press('Enter'); }
      else {
        await win.getByRole('button', { name: /All$/ }).first().click();
        await win.locator('div.group', { hasText: reminderTitle }).locator('button[aria-label="Mark complete"]').click();
      }
    },
  },
  world: (world, step) => { const item = reminderTitled(world, reminderTitle); return Boolean(item) && item.done === (step === 'done'); },
  seen: {
    windows: async (s, step) => {
      await openApp(s, 'windows', 'reminders');
      return (await winWindow(s, 'reminders').locator('.ls-task', { hasText: reminderTitle }).getAttribute('data-done')) === String(step === 'done');
    },
    // macOS lists open reminders under All and completed ones under Completed.
    macos: async (s, step) => {
      await openApp(s, 'macos', 'reminders');
      const win = macApp(s, 'reminders');
      await win.getByRole('button', { name: step === 'done' ? /^Completed/ : /All$/ }).first().click();
      await sleep(s, 400);
      return win.locator('div.group', { hasText: reminderTitle }).first().isVisible();
    },
  },
  cleanup: async (s, os) => closeApp(s, os, 'reminders'),
});

// Calendar: OS A adds an event today; OS B deletes it.
let eventTitle = '';
define({
  id: 'calendar', title: 'Calendar: new event, delete',
  values: () => { eventTitle = `Sync event ${stamp()}`; return ['added', 'deleted']; },
  change: {
    windows: async (s, step) => {
      await openApp(s, 'windows', 'calendar');
      const win = winWindow(s, 'calendar');
      if (step === 'added') {
        await win.getByRole('button', { name: 'New event' }).click();
        await win.locator('.oc-dialog input[placeholder="Add a title"]').fill(eventTitle);
        await win.locator('.oc-dialog').getByRole('button', { name: 'Save' }).click();
      } else {
        // An upcoming event selects its day first; the day's agenda entry opens the event.
        await win.locator('.cl-agenda', { hasText: eventTitle }).first().click();
        if (!(await win.locator('.oc-dialog').isVisible())) await win.locator('.cl-agenda', { hasText: eventTitle }).first().click();
        await win.locator('.oc-dialog').getByRole('button', { name: 'Delete' }).click();
      }
    },
    macos: async (s, step) => {
      await openApp(s, 'macos', 'calendar');
      const win = macApp(s, 'calendar');
      if (step === 'added') {
        await win.locator('button[title^="New Event"]').click();
        await sleep(s, 300);
        await s.page.keyboard.type(eventTitle);
        await win.getByRole('button', { name: 'Save', exact: true }).click();
      } else {
        await win.getByText(eventTitle).first().click();
        await win.getByRole('button', { name: 'Delete', exact: true }).click();
      }
    },
  },
  world: (world, step) => world.data.calendar.some(item => item.title === eventTitle) === (step === 'added'),
  seen: {
    windows: async (s, step) => { await openApp(s, 'windows', 'calendar'); return (await winWindow(s, 'calendar').locator('.cl-agenda', { hasText: eventTitle }).count() > 0) === (step === 'added'); },
    macos: async (s, step) => { await openApp(s, 'macos', 'calendar'); return (await macApp(s, 'calendar').getByText(eventTitle).count() > 0) === (step === 'added'); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'calendar'),
});

// Contacts: OS A adds a contact; OS B deletes it.
let contactName = '';
define({
  id: 'contacts', title: 'Contacts: new contact, delete',
  values: () => { contactName = `Sync ${stamp().replace(/[0-9]/g, 'k')}`; return ['added', 'deleted']; },
  change: {
    windows: async (s, step) => {
      await openApp(s, 'windows', 'contacts');
      const win = winWindow(s, 'contacts');
      if (step === 'added') {
        await win.locator('button[title="New contact"]').click();
        await win.locator('.oc-dialog input[placeholder=Name]').fill(`${contactName} Tester`);
        await win.locator('.oc-dialog input[placeholder^=Email]').fill('sync.tester@northwind.example');
        await win.locator('.oc-dialog').getByRole('button', { name: 'Save' }).click();
      } else {
        await win.locator('.pp-item', { hasText: contactName }).click();
        await win.locator('button[title="Delete contact"]').click();
      }
    },
    macos: async (s, step) => {
      await openApp(s, 'macos', 'contacts');
      const win = macApp(s, 'contacts');
      if (step === 'added') {
        await win.locator('button[title^="New Contact"]').click();
        await win.locator('input[placeholder="First name"]').fill(contactName);
        await win.locator('input[placeholder="Last name"]').fill('Tester');
        await win.locator('span', { hasText: /^email$/ }).locator('xpath=following-sibling::input[1]').fill('sync.tester@northwind.example');
        await win.getByRole('button', { name: 'Done', exact: true }).click();
      } else {
        await win.getByText(`${contactName} Tester`).first().click();
        await win.getByRole('button', { name: 'Edit', exact: true }).click();
        await win.locator('button[title=Delete]').click();
        await macFrame(s).getByRole('button', { name: 'Delete', exact: true }).last().click();
      }
    },
  },
  world: (world, step) => world.data.contacts.some(item => item.name === `${contactName} Tester`) === (step === 'added'),
  seen: {
    windows: async (s, step) => { await openApp(s, 'windows', 'contacts'); return (await winWindow(s, 'contacts').locator('.pp-item', { hasText: contactName }).count() > 0) === (step === 'added'); },
    macos: async (s, step) => { await openApp(s, 'macos', 'contacts'); return (await macApp(s, 'contacts').getByText(`${contactName} Tester`).count() > 0) === (step === 'added'); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'contacts'),
});

// Mail. The cases use seed messages that no scene highlights, through each list's context menu (a click to select
// would also mark a message read).
const MAIL_SUBJECT = { 'm-standup': 'Stand-up moved to 10:30', 'm-it': 'Planned maintenance Saturday' };
const message = (world, id) => world.data.mail.messages.find(item => item.id === id);
const winMailRow = (s, id) => winWindow(s, 'mail').locator('.ml-item', { hasText: MAIL_SUBJECT[id] }).first();
const macMailRow = (s, id) => macApp(s, 'mail').locator('div.group', { hasText: MAIL_SUBJECT[id] }).first();
const WIN_FOLDER = { inbox: 'Inbox', junk: 'Junk Email' };
const MAC_FOLDER = { inbox: /^Inbox/, junk: /^Junk/ };
async function mailFolder(s, os, folder) {
  await openApp(s, os, 'mail');
  if (os === 'windows') await winWindow(s, 'mail').locator('.oc-nav-item', { hasText: exact(WIN_FOLDER[folder]) }).first().click().catch(() =>
    winWindow(s, 'mail').locator('.oc-nav-item', { hasText: WIN_FOLDER[folder] }).first().click());
  else await macApp(s, 'mail').getByRole('button', { name: MAC_FOLDER[folder] }).first().click();
  await sleep(s, 300);
}

define({
  id: 'mail-read', title: 'Mail: mark read / unread',
  values: [true, false],
  change: {
    windows: async (s, read) => { await mailFolder(s, 'windows', 'inbox'); await winMenu(s, 'mail', winMailRow(s, 'm-standup'), read ? 'Mark as read' : 'Mark as unread'); },
    macos: async (s, read) => { await mailFolder(s, 'macos', 'inbox'); await macMenu(s, macMailRow(s, 'm-standup'), read ? /^Mark as Read/ : /^Mark as Unread/); },
  },
  world: (world, read) => message(world, 'm-standup').read === read,
  seen: {
    windows: async (s, read) => { await mailFolder(s, 'windows', 'inbox'); return (await winMailRow(s, 'm-standup').getAttribute('data-unread')) === String(!read); },
    macos: async (s, read) => { await mailFolder(s, 'macos', 'inbox'); return (await macMailRow(s, 'm-standup').locator('div.rounded-full.bg-accent').count() > 0) === !read; },
  },
});

define({
  id: 'mail-flag', title: 'Mail: flag / unflag',
  values: [true, false],
  change: {
    windows: async (s, flagged) => { await mailFolder(s, 'windows', 'inbox'); await winMenu(s, 'mail', winMailRow(s, 'm-it'), flagged ? /^Flag$/ : 'Clear flag'); },
    macos: async (s, flagged) => { await mailFolder(s, 'macos', 'inbox'); await macMenu(s, macMailRow(s, 'm-it'), flagged ? /^Flag/ : /^Unflag/); },
  },
  world: (world, flagged) => message(world, 'm-it').flagged === flagged,
  seen: {
    windows: async (s, flagged) => { await mailFolder(s, 'windows', 'inbox'); return (await winMailRow(s, 'm-it').locator('.ml-flag').count() > 0) === flagged; },
    macos: async (s, flagged) => { await mailFolder(s, 'macos', 'inbox'); return (await macMailRow(s, 'm-it').locator(':not(button) > svg.lucide-flag').count() > 0) === flagged; },   // not the hover toolbar's Flag button
  },
});

define({
  id: 'mail-move', title: 'Mail: move to Junk and back to Inbox',
  values: ['junk', 'inbox'],
  change: {
    windows: async (s, folder) => { await mailFolder(s, 'windows', folder === 'junk' ? 'inbox' : 'junk'); await winMenu(s, 'mail', winMailRow(s, 'm-standup'), `Move to ${WIN_FOLDER[folder]}`); },
    // macOS: Move to Junk from the list menu; a junk message shows a Move to Inbox banner button.
    macos: async (s, folder) => {
      if (folder === 'junk') { await mailFolder(s, 'macos', 'inbox'); await macMenu(s, macMailRow(s, 'm-standup'), /^Move to Junk/); return; }
      await mailFolder(s, 'macos', 'junk');
      await macMailRow(s, 'm-standup').click();
      await macApp(s, 'mail').getByRole('button', { name: 'Move to Inbox', exact: true }).click();
    },
  },
  world: (world, folder) => message(world, 'm-standup').folder === folder,
  seen: {
    windows: async (s, folder) => { await mailFolder(s, 'windows', folder); return winMailRow(s, 'm-standup').isVisible(); },
    macos: async (s, folder) => { await mailFolder(s, 'macos', folder); return macMailRow(s, 'm-standup').isVisible(); },
  },
});

// Drafts: each OS writes a draft; the other lists it under Drafts.
define({
  id: 'mail-draft', title: 'Mail: save a draft',
  values: () => [`Sync draft ${stamp()}`, `Sync draft ${stamp()}b`],
  change: {
    windows: async (s, subject) => {
      await openApp(s, 'windows', 'mail');
      const win = winWindow(s, 'mail');
      await win.getByRole('button', { name: 'New mail' }).click();
      await win.locator('.ml-compose input').first().fill('priya.shah@northwind.example');
      await win.locator('.ml-compose input').nth(1).fill(subject);
      await win.locator('textarea.ml-compose-body').fill('Draft from the sync test.');
      await win.getByRole('button', { name: 'Save draft' }).click();
    },
    // macOS: select a message, then New Message in the reader toolbar. Send keeps the message in Drafts (sending is off on
    // the training desktop).
    macos: async (s, subject) => {
      await mailFolder(s, 'macos', 'inbox');
      await macMailRow(s, 'm-it').click();
      await macApp(s, 'mail').locator('button[aria-label^="New Message"]').first().click();
      const composer = macApp(s, 'mail').locator('button[aria-label="Close composer"]').locator('xpath=ancestor::div[.//input][1]');
      await s.page.keyboard.type('priya.shah@northwind.example');
      await composer.locator('input.font-semibold').fill(subject);
      await composer.locator('[contenteditable=true]').click();
      await s.page.keyboard.type('Draft from the sync test.');
      await macApp(s, 'mail').locator('button[aria-label=Send]').click();
    },
  },
  world: (world, subject) => world.data.mail.messages.some(item => item.folder === 'drafts' && item.subject === subject),
  seen: {
    windows: async (s, subject) => { await openApp(s, 'windows', 'mail'); await winWindow(s, 'mail').locator('.oc-nav-item', { hasText: 'Drafts' }).click(); return winWindow(s, 'mail').locator('.ml-item', { hasText: subject }).isVisible(); },
    macos: async (s, subject) => { await openApp(s, 'macos', 'mail'); await macApp(s, 'mail').getByRole('button', { name: /^Drafts/ }).first().click(); return macApp(s, 'mail').locator('div.group', { hasText: subject }).first().isVisible(); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'mail'),
});

// Messages: each OS sends a line in the Priya Shah thread.
define({
  id: 'messages', title: 'Messages: send',
  values: () => [`Sync hello ${stamp()}`, `Sync reply ${stamp()}`],
  change: {
    windows: async (s, text) => {
      await openApp(s, 'windows', 'messages');
      const win = winWindow(s, 'messages');
      await win.locator('.ch-thread', { hasText: 'Priya Shah' }).click();
      await win.locator('.ch-compose input').fill(text);
      await win.locator('.ch-compose input').press('Enter');
    },
    macos: async (s, text) => {
      await openApp(s, 'macos', 'messages');
      const win = macApp(s, 'messages');
      await win.getByRole('button', { name: /Priya Shah/ }).first().click();
      await win.locator('textarea[placeholder=iMessage]').fill(text);
      await win.locator('textarea[placeholder=iMessage]').press('Enter');
    },
  },
  world: (world, text) => world.data.messages.threads.find(item => item.id === 't-priya').items.some(item => item.text === text),
  seen: {
    windows: async (s, text) => { await openApp(s, 'windows', 'messages'); await winWindow(s, 'messages').locator('.ch-thread', { hasText: 'Priya Shah' }).click(); return winWindow(s, 'messages').locator('.ch-bubble', { hasText: text }).isVisible(); },
    macos: async (s, text) => { await openApp(s, 'macos', 'messages'); await macApp(s, 'messages').getByRole('button', { name: /Priya Shah/ }).first().click(); return macApp(s, 'messages').getByText(text, { exact: true }).first().isVisible(); },
  },
  shot: true,
  cleanup: async (s, os) => closeApp(s, os, 'messages'),
});

// Clock alarms: OS A adds an alarm; OS B switches it off.
let alarmLabel = '';
const alarm = world => (world.data.alarms ?? []).find(item => item.label === alarmLabel);
async function macAlarms(s) {
  await openApp(s, 'macos', 'clock');
  await macApp(s, 'clock').getByRole('button', { name: 'Alarms', exact: true }).click();
  await sleep(s, 300);
}
async function winAlarms(s) {
  await openApp(s, 'windows', 'clock');
  await winWindow(s, 'clock').locator('.oc-nav-item', { hasText: 'Alarm' }).click();
  await sleep(s, 300);
}
const macAlarmRow = s => macApp(s, 'clock').locator('div').filter({ hasText: alarmLabel }).filter({ has: macFrame(s).locator('[role=switch]') }).last();
define({
  id: 'alarms', title: 'Clock: add alarm, switch off',
  values: () => { alarmLabel = `Sync alarm ${stamp()}`; return ['added', 'off']; },
  change: {
    windows: async (s, step) => {
      await winAlarms(s);
      const win = winWindow(s, 'clock');
      if (step === 'added') { await win.locator('input[placeholder="Alarm name"]').fill(alarmLabel); await win.getByRole('button', { name: 'Add alarm' }).click(); }
      else await win.locator(`[role=switch][aria-label="Alarm ${alarmLabel}"]`).click();
    },
    macos: async (s, step) => {
      await macAlarms(s);
      const win = macApp(s, 'clock');
      if (step === 'added') {
        await win.locator('button[title="Add alarm"]').click();
        const sheet = macFrame(s).locator('[role=dialog]', { hasText: 'New Alarm' });
        await sheet.locator('input').last().fill(alarmLabel);
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();
      } else await macAlarmRow(s).locator('[role=switch]').first().click();
    },
  },
  world: (world, step) => { const item = alarm(world); return Boolean(item) && item.enabled === (step === 'added'); },
  seen: {
    windows: async (s, step) => { await winAlarms(s); return (await winWindow(s, 'clock').locator(`[role=switch][aria-label="Alarm ${alarmLabel}"]`).getAttribute('aria-checked')) === String(step === 'added'); },
    macos: async (s, step) => { await macAlarms(s); return (await macAlarmRow(s).locator('[role=switch]').first().getAttribute('aria-checked')) === String(step === 'added'); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'clock'),
});

// ---- dock / taskbar, notifications, store -----------------------------------------------------------------------------

const winTask = (s, app) => winFrame(s).locator(`[data-testid="task-${app}"]`);
const macDock = (s, app) => macFrame(s).locator(`button[aria-label="${MAC[app]}"].dock-icon`);
// Terminal: OS A unpins it from the dock / taskbar; OS B pins it again (open it, pin it, close it).
define({
  id: 'dock-pins', title: 'Dock / taskbar pins',
  values: ['unpinned', 'pinned'],
  change: {
    windows: async (s, step) => {
      if (step === 'pinned') await openApp(s, 'windows', 'terminal');
      await winTask(s, 'terminal').click({ button: 'right' });
      await winFrame(s).locator('[data-testid=context-menu] .menuopt', { hasText: step === 'pinned' ? 'Pin to taskbar' : 'Unpin from taskbar' }).click();
      if (step === 'pinned') { await untilWorld(s, w => w.dock.pins.includes('terminal'), 'pinned'); await closeApp(s, 'windows', 'terminal'); }
    },
    macos: async (s, step) => {
      if (step === 'pinned') await openApp(s, 'macos', 'terminal');
      await macDock(s, 'terminal').click({ button: 'right' });
      await macFrame(s).locator('[role=menuitem]', { hasText: /^Options/ }).hover();
      await macFrame(s).locator('[role=menuitem]', { hasText: /^Keep in Dock/ }).click();
      if (step === 'pinned') { await untilWorld(s, w => w.dock.pins.includes('terminal'), 'pinned'); await closeApp(s, 'macos', 'terminal'); }
    },
  },
  world: (world, step) => world.dock.pins.includes('terminal') === (step === 'pinned') && !worldWindow(world, 'terminal'),
  seen: {
    windows: async (s, step) => (await winTask(s, 'terminal').count() > 0) === (step === 'pinned'),
    macos: async (s, step) => (await macDock(s, 'terminal').count() > 0) === (step === 'pinned'),
  },
});

// Badges come from the scene or the backend (there is no gesture that sets one): a live patch while OS A is showing.
define({
  id: 'dock-badges', title: 'Dock / taskbar badges (backend push)',
  values: [7, 3],
  change: Object.fromEntries(['windows', 'macos'].map(os => [os, (s, count) => s.page.evaluate(n => window.OceanDesktop.patchWorld({ dock: { badges: { mail: n } } }), count)])),
  world: (world, count) => world.dock.badges.mail === count,
  seen: {
    windows: async (s, count) => (await winTask(s, 'mail').locator('.taskBadge').innerText()) === String(count),
    macos: async (s, count) => (await macDock(s, 'mail').evaluate(node => node.parentElement.innerText.trim())) === String(count),
  },
});

// Notification history: two notices arrive (backend push); OS A clears the first, OS B the second.
const NOTICES = [
  { id: 'sync-n1', app: 'calendar', title: 'Sync notice one', body: 'First notice from the sync test', time: '2026-10-07T10:00:00Z' },
  { id: 'sync-n2', app: 'reminders', title: 'Sync notice two', body: 'Second notice from the sync test', time: '2026-10-07T10:01:00Z' },
];
async function winCentre(s, open) {
  const shown = (await winFrame(s).locator('[data-testid=centre]').getAttribute('data-hide')) === 'false';
  if (shown !== open) await winFrame(s).locator('[data-testid=tray-bell]').click();
  await sleep(s, 300);
}
async function macCentre(s, open) {
  const shown = (await s.world()).overlays.centre;
  // The open Notification Center covers the menu bar clock; a click on the desktop closes it, as on a Mac.
  if (shown !== open) await (open ? macFrame(s).locator('button[aria-label=Notifications]').click() : s.page.mouse.click(700, 640));
  await sleep(s, 500);
}
define({
  id: 'notifications', title: 'Notifications: clear from the centre',
  values: ['sync-n1', 'sync-n2'],
  setup: async s => {
    const world = await s.world();
    const history = [...world.notifications.history.filter(item => !item.id.startsWith('sync-n')), ...NOTICES];
    await s.page.evaluate(value => window.OceanDesktop.patchWorld({ notifications: { history: value } }), history);
  },
  change: {
    windows: async (s, id) => {
      await winCentre(s, true);
      await winFrame(s).locator('.centreItem', { hasText: NOTICES.find(item => item.id === id).title }).locator('button[aria-label=Clear]').click();
      await winCentre(s, false);
    },
    macos: async (s, id) => {
      await macCentre(s, true);
      await macFrame(s).getByText(NOTICES.find(item => item.id === id).title, { exact: true }).first().hover();
      await macFrame(s).locator('button[aria-label=Dismiss]').first().click();
      await macCentre(s, false);
    },
  },
  world: (world, id) => !world.notifications.history.some(item => item.id === id),
  seen: {
    windows: async (s, id) => {
      await winCentre(s, true);
      const gone = NOTICES.filter(item => NOTICES.findIndex(x => x.id === id) >= NOTICES.indexOf(item));
      const left = NOTICES.filter(item => !gone.includes(item));
      const ok = (await Promise.all(gone.map(async item => (await winFrame(s).locator('.centreItem', { hasText: item.title }).count()) === 0))).every(Boolean) &&
        (await Promise.all(left.map(item => winFrame(s).locator('.centreItem', { hasText: item.title }).isVisible()))).every(Boolean);
      await winCentre(s, false);
      return ok;
    },
    macos: async (s, id) => {
      await macCentre(s, true);
      const gone = NOTICES.filter(item => NOTICES.findIndex(x => x.id === id) >= NOTICES.indexOf(item));
      const left = NOTICES.filter(item => !gone.includes(item));
      const ok = (await Promise.all(gone.map(async item => (await macFrame(s).getByText(item.title, { exact: true }).count()) === 0))).every(Boolean) &&
        (await Promise.all(left.map(item => macFrame(s).getByText(item.title, { exact: true }).first().isVisible()))).every(Boolean);
      await macCentre(s, false);
      return ok;
    },
  },
});

// Store: OS A uninstalls Calculator, OS B installs it again. Both stores show Open (installed) or Get / Install.
async function winStoreLookup(s, name) {
  await openApp(s, 'windows', 'store');
  await winWindow(s, 'store').locator('input[placeholder="Search apps"]').fill('');
  await winWindow(s, 'store').locator('input[placeholder="Search apps"]').fill(name);
  await winWindow(s, 'store').locator('.st-card', { hasText: name }).first().click();
  await sleep(s, 300);
}
async function macStoreLookup(s, name) {
  await openApp(s, 'macos', 'store');
  await macApp(s, 'store').getByPlaceholder('Search').fill(name);
  await s.page.keyboard.press('Enter');
  await sleep(s, 500);
}
const macStoreRow = (s, name) => macApp(s, 'store').getByRole('button', { name: new RegExp(`^${name}`) }).first().locator('xpath=..');
define({
  id: 'store', title: 'Store: uninstall, install',
  values: ['uninstalled', 'installed'],
  change: {
    windows: async (s, step) => {
      await winStoreLookup(s, 'Calculator');
      await winWindow(s, 'store').locator('.st-detail-act').getByRole('button', { name: step === 'installed' ? 'Install' : 'Uninstall' }).click();
    },
    macos: async (s, step) => {
      if (step === 'uninstalled') throw new Error('macOS has no uninstall gesture (requests/sync-e2e-to-sync-model-mac.md §2)');
      await macStoreLookup(s, 'Calculator');
      await macStoreRow(s, 'Calculator').getByRole('button', { name: 'Get', exact: true }).click();
    },
  },
  world: (world, step) => world.installed.includes('calculator') === (step === 'installed'),
  seen: {
    windows: async (s, step) => { await winStoreLookup(s, 'Calculator'); return (await winWindow(s, 'store').locator('.st-detail-act').getByRole('button', { name: 'Open' }).count() > 0) === (step === 'installed'); },
    macos: async (s, step) => { await macStoreLookup(s, 'Calculator'); return (await macStoreRow(s, 'Calculator').getByRole('button', { name: 'Open', exact: true }).count() > 0) === (step === 'installed'); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'store'),
});

// ---- new synced stores (SYNC-AUDIT.md §3–5) ----------------------------------------------------------------------------

// Calculator: OS A computes a sum and switches to Scientific; OS B computes another sum and switches back to Basic.
// Each OS then shows the other's last line in its history and the other's mode.
const CALC = [{ keys: ['1', '2', '+', '7'], expr: '12 + 7', result: '19', mode: 'scientific' }, { keys: ['3', '4', '+', '5'], expr: '34 + 5', result: '39', mode: 'basic' }];
const MODE_NAME = { basic: 'Basic', scientific: 'Scientific', programmer: 'Programmer' };
async function winCalcMode(s, mode) {
  const win = winWindow(s, 'calculator');
  if ((await win.locator('.cc-app').getAttribute('data-mode')) === mode) return;
  await win.locator('[data-testid=calc-nav]').click();
  await win.locator(`.cc-nav-item[data-mode=${mode}]`).click();
}
define({
  id: 'calculator', title: 'Calculator: history line and mode',
  values: CALC,
  change: {
    windows: async (s, run) => {
      await openApp(s, 'windows', 'calculator');
      // In a narrow window the History pane covers the keypad.
      if ((await winWindow(s, 'calculator').locator('.cc-hist').getAttribute('data-open')) === 'true') await winWindow(s, 'calculator').locator('.cc-hist-btn').click();
      await winCalcMode(s, 'basic');
      for (const key of [...run.keys, '=']) await winWindow(s, 'calculator').locator(`.cc-key[data-key="${key}"]`).click();
      await untilWorld(s, w => w.data.calculator?.history?.[0]?.result === run.result, 'recorded');
      await winCalcMode(s, run.mode);
    },
    // macOS operator keys are icon-only: the expression is typed after a digit click focuses the keypad.
    macos: async (s, run) => {
      await openApp(s, 'macos', 'calculator');
      const win = macApp(s, 'calculator');
      await win.getByRole('button', { name: 'Basic', exact: true }).click();
      await win.getByRole('button', { name: run.keys[0], exact: true }).first().click();
      await s.page.keyboard.type(`${run.keys.slice(1).join('')}=`);
      await untilWorld(s, w => w.data.calculator?.history?.[0]?.result === run.result, 'recorded');
      await win.getByRole('button', { name: MODE_NAME[run.mode], exact: true }).click();
    },
  },
  world: (world, run) => world.data.calculator?.mode === run.mode && world.data.calculator.history[0]?.expr === run.expr,
  seen: {
    windows: async (s, run) => {
      await openApp(s, 'windows', 'calculator');
      const win = winWindow(s, 'calculator');
      if ((await win.locator('.cc-app').getAttribute('data-mode')) !== run.mode) return `mode ${await win.locator('.cc-app').getAttribute('data-mode')}`;
      // A wide window docks the History pane and hides its button.
      if ((await win.locator('.cc-hist').getAttribute('data-open')) !== 'true' && await win.locator('.cc-hist-btn').isVisible()) await win.locator('.cc-hist-btn').click();
      return win.locator('.cc-hist-item', { hasText: run.result }).first().isVisible();
    },
    macos: async (s, run) => {
      await openApp(s, 'macos', 'calculator');
      const win = macApp(s, 'calculator');
      const pressed = await win.getByRole('button', { name: MODE_NAME[run.mode], exact: true }).evaluate(node => /bg-|accent/.test(node.className) || node.getAttribute('aria-pressed') === 'true');
      if (!(await win.getByText(new RegExp(esc(run.expr).replace(/ /g, '\\s*'))).count())) await win.locator('button[title^="History"]').click();
      return (await win.getByText(new RegExp(esc(run.expr).replace(/ /g, '\\s*'))).first().isVisible()) && pressed || `tape or mode (${pressed})`;
    },
  },
  cleanup: async (s, os) => closeApp(s, os, 'calculator'),
});

// Clock world clocks: OS A adds Sydney, OS B removes it.
async function clockTab(s, os, tab) {
  await openApp(s, os, 'clock');
  if (os === 'windows') await winWindow(s, 'clock').locator('.oc-nav-item', { hasText: tab === 'world' ? 'World clock' : tab === 'timer' ? 'Timer' : 'Stopwatch' }).click();
  else await macApp(s, 'clock').getByRole('button', { name: { world: 'World Clock', timer: 'Timers', stopwatch: 'Stopwatch' }[tab], exact: true }).click();
  await sleep(s, 300);
}
define({
  id: 'clock-cities', title: 'Clock: add / remove a world clock',
  values: ['added', 'removed'],
  change: {
    windows: async (s, step) => {
      await clockTab(s, 'windows', 'world');
      const win = winWindow(s, 'clock');
      if (step === 'added') { await win.locator('select[aria-label="Add a city"]').selectOption('Sydney'); await win.getByRole('button', { name: 'Add' }).click(); }
      else await win.locator('button[title="Remove Sydney"]').click();
    },
    macos: async (s, step) => {
      await clockTab(s, 'macos', 'world');
      const win = macApp(s, 'clock');
      if (step === 'added') { await win.locator('button[title="Add city"]').click(); await s.page.keyboard.type('Sydney'); await win.getByText('Sydney').first().click(); }
      else await win.locator('button[title="Remove Sydney"]').click();
    },
  },
  world: (world, step) => (world.data.clock?.worldClocks ?? []).some(item => item.name === 'Sydney') === (step === 'added'),
  seen: {
    windows: async (s, step) => { await clockTab(s, 'windows', 'world'); return (await winWindow(s, 'clock').locator('.ck-city', { hasText: 'Sydney' }).count() > 0) === (step === 'added'); },
    macos: async (s, step) => { await clockTab(s, 'macos', 'world'); return (await macApp(s, 'clock').locator('button[title="Remove Sydney"]').count() > 0) === (step === 'added'); },
  },
  cleanup: async (s, os) => closeApp(s, os, 'clock'),
});

// ---- run -----------------------------------------------------------------------------------------------------------

const selected = MODE === 'cases' ? CASES.filter(item => !filters.length || filters.some(prefix => item.id.startsWith(prefix))) : [];
for (const first of selected.length ? ['windows', 'macos'] : []) {
  const s = await openScene(ctx, PROFILE);
  await signIn(s);
  for (const item of selected) {
    const label = `${item.id}: ${NAME[first]} → ${NAME[OTHER[first]]} → ${NAME[first]}`;
    const errorsBefore = s.errors.length;
    try {
      const note = await roundTrip(s, item, first);
      const errors = s.errors.slice(errorsBefore);
      results.push({ id: item.id, title: item.title, first, ok: errors.length === 0, detail: [...errors, note].filter(Boolean).join(' | ') });
    } catch (error) {
      results.push({ id: item.id, title: item.title, first, ok: false, detail: error.message.split('\n').slice(0, 4).join(' / ') });
      await s.page.screenshot({ path: `${FAIL_DIR}/fail-sync-${item.id}-${first}.png` });
      try { if (item.cleanup) await item.cleanup(s, await s.page.evaluate(() => document.body.dataset.os)); } catch { /* best effort */ }
    }
    const last = results.at(-1);
    console.log(last.ok ? 'PASS' : 'FAIL', label, last.detail);
  }
  await s.page.close();
}
if (selected.length) {
  results.push({ id: 'whole-world', title: 'Whole world: both snapshot() = normalise(world) after every case', first: 'both', ok: driftFound.length === 0, detail: driftFound.join(' || ') });
  console.log(driftFound.length ? 'FAIL' : 'PASS', 'whole world after every case', driftFound.join(' || ').slice(0, 1500));
}

// ---- random UI action sequences ----------------------------------------------------------------------------------
// A seeded sequence of real UI changes taken from the cases above, each on a random OS, with assertSynced() after
// every step. Only cases whose change does not depend on an earlier step are drawn. A failure names the seed and step.
const RANDOM_POOL = ['sys-theme', 'sys-focus', 'sys-wifi', 'sys-bluetooth', 'sys-nightlight', 'sys-volume', 'sys-brightness', 'sys-accent',
  'sys-wallpaper', 'window-open-close', 'mail-read', 'mail-flag', 'messages'];
if (MODE === 'random') {
  const steps = Number(process.argv[3] || 24);
  const seed = Number(process.argv[4] || 1);
  let state = seed >>> 0 || 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const pickOne = list => list[Math.floor(random() * list.length)];
  const s = await openScene(ctx, PROFILE);
  await signIn(s);
  for (let n = 1; n <= steps; n += 1) {
    const id = pickOne(RANDOM_POOL);
    const item = CASES.find(entry => entry.id === id);
    const os = pickOne(['windows', 'macos']);
    const world = await s.world();
    const values = typeof item.values === 'function' ? item.values() : item.values;
    // A value that changes something; toggle cases (values null) flip whatever is set.
    const value = pickOne(values.filter(v => v === null || !item.world(world, v)));
    const label = `random seed ${seed} step ${n}: ${item.id} = ${JSON.stringify(value)} on ${NAME[os]}`;
    const errorsBefore = s.errors.length;
    try {
      if (value === undefined) throw new Error('no value would change anything');
      await swapTo(s, os);
      await item.change[os](s, value);
      await untilWorld(s, w => item.world(w, value), label);
      await closeOverlays(s, os);
      const problems = [...await assertSynced(s), ...s.errors.slice(errorsBefore)];
      results.push({ id: `random-${n}`, title: label, first: os, ok: problems.length === 0, detail: problems.join(' / ') });
    } catch (error) {
      results.push({ id: `random-${n}`, title: label, first: os, ok: false, detail: error.message.split('\n').slice(0, 3).join(' / ') });
      await s.page.screenshot({ path: `${FAIL_DIR}/fail-sync-random-${seed}-${n}.png` });
    }
    const last = results.at(-1);
    console.log(last.ok ? 'PASS' : 'FAIL', label, last.detail);
  }
  await s.page.close();
}

// ---- every step of every scenario --------------------------------------------------------------------------------
// The scenarios are the profiles in data/desktop-profiles that the parent plays as a scene (a creature scene or an entry
// of data/ocean-selection.json). Each is played on the forward path with the gestures a shell sends (open the toast's
// app, then each step's forward choice). assertSynced() runs after sign-in, at every new step, the attack and the debrief.
if (MODE === 'scenarios') {
  const { readdirSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { choicesFor } = require('../../ui/desktop/desktop-model.js');
  const { loadOceanProfiles } = await import('../../backend/ocean-profiles.mjs');
  const { PROJECT } = await import('./desktops-e2e-lib.mjs');
  const selection = require('../../data/ocean-selection.json');
  const scenes = new Set([...Object.values(selection.depths).flat().map(item => item.id), ...(await loadOceanProfiles(PROJECT)).profiles.map(item => item.id)]);
  const files = readdirSync(new URL('../../data/desktop-profiles/', import.meta.url)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  const prefix = process.argv[3] || '';
  const overlays = files.filter(id => !scenes.has(id));
  if (overlays.length) console.log(`not a scene (profile overlay only): ${overlays.join(', ')}`);
  for (const id of files.filter(item => scenes.has(item) && item.startsWith(prefix))) {
    const checked = [];
    const problems = [];
    let s;
    try {
      s = await openScene(ctx, id);
      const steps = (await s.page.evaluate(() => window.OceanScenes.get(new URLSearchParams(location.search).get('profile')))).steps;
      await signIn(s);
      if (await s.page.locator('#ocean-intro').isVisible()) await s.page.locator('#intro-dismiss').click();
      const check = async where => { checked.push(where); for (const problem of await assertSynced(s)) problems.push(`${where}: ${problem}`); };
      await check('sign-in');
      const acted = new Set();
      let seen = '';
      const end = Date.now() + Number(process.env.SYNC_SCENARIO_MS || 240000);
      for (;;) {
        const { scene } = await s.scene();
        const key = `${scene.phase}/${scene.stepId}`;
        if (key !== seen && scene.pendingActionId === null) { seen = key; await check(key); }
        if (['debrief', 'done'].includes(scene.phase)) break;
        if (Date.now() > end) throw new Error(`timed out at ${key}`);
        const step = steps.find(item => item.id === scene.stepId);
        if (['lure', 'action'].includes(scene.phase) && step && scene.pendingActionId === null && !acted.has(key)) {
          acted.add(key);
          const world = await s.world();
          const os = await s.page.evaluate(() => document.body.dataset.os);
          const forward = choicesFor(step).forward[0];
          if (step.id === 'toast' && world.scene.highlight?.app) await s.emit(os, { kind: 'open-app', app: world.scene.highlight.app });
          else if (forward) await s.emit(os, { kind: 'scene-choice', choiceId: forward });
        }
        await s.page.waitForTimeout(400);
      }
      problems.push(...s.errors);
    } catch (error) {
      problems.push(error.message.split('\n')[0]);
      await s?.page.screenshot({ path: `${FAIL_DIR}/fail-sync-scenario-${id}.png` }).catch(() => {});
    }
    await s?.page.close().catch(() => {});
    results.push({ id, title: `scenario ${id}`, first: 'windows', ok: problems.length === 0, detail: problems.slice(0, 3).join(' / ') });
    console.log(problems.length ? 'FAIL' : 'PASS', `scenario ${id}: ${checked.length} checks (${checked.join(' > ')})`.slice(0, 400), problems.slice(0, 3).join(' / ').slice(0, 600));
  }
}

const externalOk = external.length === 0;
console.log(externalOk ? 'PASS' : 'FAIL', 'zero non-loopback requests', external.slice(0, 5).join(' '));
await stop();

// Coverage matrix (paste into README.md).
if (selected.length) console.log('\n| Item | Windows → macOS → Windows | macOS → Windows → macOS |\n|---|---|---|');
for (const item of selected) {
  const cell = first => { const r = results.find(x => x.id === item.id && x.first === first); return r ? (r.ok ? 'pass' : 'FAIL') : 'not run'; };
  console.log(`| ${item.title} | ${cell('windows')} | ${cell('macos')} |`);
}
const whole = results.find(r => r.id === 'whole-world');
if (whole) console.log(`| ${whole.title} | ${whole.ok ? 'pass' : 'FAIL'} (both directions) | |`);
const failed = results.filter(r => !r.ok).length + (externalOk ? 0 : 1);
console.log(`\n${results.length - results.filter(r => !r.ok).length}/${results.length} ${{ cases: 'round trips', random: 'random steps', scenarios: 'scenarios' }[MODE]} passed`);
process.exitCode = failed || results.length === 0 ? 1 : 0;
