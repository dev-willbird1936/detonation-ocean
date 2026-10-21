import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createAppServer } from '../server.mjs';

const M = createRequire(import.meta.url)('../ui/desktop/world-model.js');
const seed = JSON.parse(readFileSync(new URL('../data/desktop-world-seed.json', import.meta.url), 'utf8'));
const darkProfile = JSON.parse(readFileSync(new URL('../data/desktop-profiles/example-dark.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-02T10:00:00Z');

const desktopWorld = () => ({ ...M.createWorld(seed), phase: 'desktop' });
// Applies a chain of intents, asserting each one is accepted.
function apply(world, ...intents) {
  return intents.reduce((current, intent) => {
    const result = M.applyIntent(current, intent, NOW);
    assert.equal(result.ok, true, `${intent.kind}: ${result.reason}`);
    return result.world;
  }, world);
}
const rejects = (world, intent, reason) => {
  const result = M.applyIntent(world, intent, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.world, world);
  if (reason) assert.equal(result.reason, reason);
};

test('canonical app list has the 21 PARITY.md apps and no culled app', () => {
  assert.equal(M.CANONICAL_APPS.length, 21);
  assert.deepEqual([...M.CANONICAL_APPS].sort(), [...seed.installed].sort());
  assert.equal(M.CANONICAL_APPS.filter(app => M.CULLED_APPS.includes(app)).length, 0);
  assert.equal(Object.keys(M.APP_NAMES).length, 21);
});

test('the seed validates and createWorld returns an independent copy', () => {
  assert.deepEqual(M.validate(seed), { ok: true, error: null });
  const world = M.createWorld(seed);
  world.sys.theme = 'light';
  assert.equal(seed.sys.theme, 'dark');
});

test('mergeProfile deep-merges objects, replaces arrays, removes objects on null and refuses prototype keys', () => {
  const merged = M.mergeProfile({ a: { b: 1, c: 2 }, list: [1, 2], gone: { x: 1 }, kept: 1 }, { a: { c: 3 }, list: [9], gone: null, kept: null, added: null });
  assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [9], kept: null, added: null });
  assert.throws(() => M.mergeProfile({}, JSON.parse('{"__proto__":{"polluted":true}}')), /forbidden key/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => M.mergeProfile({}, []), /must be an object/);
});

test('the example-dark profile changes theme, wallpaper, apps, user and mail, and filters pins/badges', () => {
  const world = M.createWorld(seed, darkProfile);
  assert.equal(world.sys.accent, 'purple');
  assert.equal(world.sys.wallpaper, 'depth-abyss');
  assert.equal(world.sys.volume, seed.sys.volume);
  assert.equal(world.user.short, 'jordan');
  assert.equal(world.fs.nodes.home.name, 'jordan');
  assert.equal(world.installed.length, 16);
  assert.ok(!world.installed.includes('store'));
  assert.ok(world.dock.pins.every(app => world.installed.includes(app)));
  assert.equal(world.data.mail.messages[0].id, 'm-payroll');
  assert.deepEqual(M.validate(world), { ok: true, error: null });
});

test('createWorld filters pins, badges, windows and notifications by installed, and fails closed on culled apps', () => {
  const world = M.createWorld({ ...seed, phase: 'desktop' }, {
    installed: ['files', 'mail', 'settings'],
    windows: [{ id: 'w-1', app: 'browser', title: 'Browser', rect: { x: 0, y: 0, w: 400, h: 300 }, mode: 'normal', tile: null, payload: null }],
    order: ['w-1'], focusedId: 'w-1',
  });
  assert.deepEqual(world.installed, ['files', 'mail', 'settings']);
  assert.deepEqual(world.dock.pins, ['files', 'mail', 'settings']);
  assert.deepEqual(Object.keys(world.dock.badges), ['mail']);
  assert.deepEqual(world.windows, []);
  assert.equal(world.focusedId, null);
  assert.throws(() => M.createWorld(seed, { installed: ['files', 'facetime'] }), /culled-app/);
  assert.throws(() => M.createWorld(seed, { installed: ['files', 'solitaire'] }), /unknown-app/);
});

test('validate rejects bad shapes, non-fictional domains, external wallpaper URLs and fs cycles', () => {
  const bad = patch => M.validate(M.mergeProfile(seed, patch)).error;
  assert.equal(bad({ extra: 1 }), 'shape');
  assert.equal(bad({ phase: 'hacked' }), 'header');
  assert.equal(bad({ user: { email: 'alex@gmail.com' } }), 'user');
  assert.equal(bad({ sys: { accent: 'teal' } }), 'sys');
  assert.equal(bad({ sys: { wallpaperUrl: 'https://img.example/w.jpg' } }), 'sys');
  assert.equal(bad({ sys: { wallpaperUrl: '//evil.example/w.jpg' } }), 'sys');
  assert.equal(M.validate(M.mergeProfile(seed, { sys: { wallpaperUrl: '/wallpapers/depth-abyss.svg' } })).error, null);
  assert.equal(bad({ fs: { nodes: { desktop: null } } }), 'fs-fixed');
  assert.equal(bad({ fs: { nodes: { 'f-loop': { id: 'f-loop', parentId: 'f-loop', name: 'x', kind: 'folder', mime: null, size: 0, modified: '2026-11-02T09:00:00Z', trashed: false } } } }), 'fs-cycle');
  const mail = clone => ({ data: { mail: { messages: [{ ...seed.data.mail.messages[0], ...clone }] } } });
  assert.equal(bad(mail({ from: 'Bank <alerts@realbank.com>' })), 'data-mail');
  assert.equal(bad(mail({ link: 'https://phish.example' })), 'data-mail');
  assert.equal(bad({ data: { contents: { big: { text: 'x'.repeat(20000) } } } }), 'data-contents');
  assert.equal(bad({ dock: { pins: ['files', 'photobooth'] } }), 'dock');
  assert.equal(bad({ scene: { phase: 'boot', stepId: null, highlight: { app: 'maps', ref: null } } }), 'scene');
});

test('intents are refused outside the desktop phase except phase, sys and notification changes', () => {
  const locked = M.createWorld(seed);
  rejects(locked, { kind: 'open-app', app: 'mail' }, 'not-desktop');
  const result = M.applyIntent(locked, { kind: 'set-sys', patch: { volume: 10 } }, NOW);
  assert.equal(result.changed, true);
  assert.equal(result.world.revision, 1);
  assert.equal(apply(locked, { kind: 'set-phase', phase: 'desktop' }).phase, 'desktop');
});

test('parseIntent is exact-key and rejects culled apps with a specific reason', () => {
  const world = desktopWorld();
  rejects(world, { kind: 'open-app', app: 'facetime' }, 'culled-app');
  rejects(world, { kind: 'install', app: 'chess' }, 'culled-app');
  rejects(world, { kind: 'open-app', app: 'mail', extra: true }, 'invalid-intent');
  rejects(world, { kind: 'open-app', app: 'browser', payload: { url: 'https://example.com' } }, 'invalid-intent');
  rejects(world, { kind: 'nope' }, 'invalid-intent');
  rejects(world, null, 'invalid-intent');
  assert.equal(M.applyIntent(world, { kind: 'set-sys', patch: {} }, NOW).reason, 'invalid-intent');
  assert.equal(M.applyIntent(world, { kind: 'open-app', app: 'mail' }, Number.NaN).reason, 'invalid-time');
  assert.equal(M.applyIntent({ ...world, v: 2 }, { kind: 'open-app', app: 'mail' }, NOW).reason, 'invalid-world');
});

test('parseIntentMessage checks the v3 envelope', () => {
  const intent = { kind: 'focus-window', id: 'w-mail-1' };
  assert.deepEqual(M.parseIntentMessage({ type: 'world-intent', version: 3, revision: 4, seq: 1, intent }), { revision: 4, seq: 1, intent });
  assert.equal(M.parseIntentMessage({ type: 'world-intent', version: 2, revision: 4, seq: 1, intent }), null);
  assert.equal(M.parseIntentMessage({ type: 'world-intent', version: 3, revision: 4, seq: 1, intent, x: 1 }), null);
  assert.equal(M.parseIntentMessage({ type: 'world-intent', version: 3, revision: -1, seq: 1, intent }), null);
  assert.equal(M.parseIntentMessage({ type: 'world-intent', version: 3, revision: 0, seq: 0, intent: { kind: 'install', app: 'tv' } }), null);
});

test('open-app creates, focuses and reuses windows, with payload checks and installed gating', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'mail', payload: { messageId: 'm-budget' } });
  assert.equal(world.windows.length, 1);
  assert.equal(world.windows[0].title, 'Budget draft for review');
  assert.equal(world.focusedId, 'w-mail-1');
  assert.equal(world.revision, 1);
  world = apply(world, { kind: 'open-app', app: 'files', payload: { folderId: 'documents' } }, { kind: 'open-app', app: 'mail' });
  assert.equal(world.windows.length, 2);
  assert.deepEqual(world.order, ['w-files-1', 'w-mail-1']);
  world = apply(world, { kind: 'open-app', app: 'files', payload: { folderId: 'downloads' } });
  assert.equal(world.windows.filter(win => win.app === 'files').length, 2);
  rejects(world, { kind: 'open-app', app: 'files', payload: { folderId: 'f-welcome' } }, 'no-such-folder');
  rejects(world, { kind: 'open-app', app: 'texteditor', payload: { fileId: 'missing' } }, 'no-such-file');
  const limited = { ...M.createWorld(seed, { installed: ['files', 'mail'] }), phase: 'desktop' };
  rejects(limited, { kind: 'open-app', app: 'browser' }, 'not-installed');
});

test('window intents: focus, minimise, restore, maximise, fullscreen, set-rect, tile, close', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'mail' }, { kind: 'open-app', app: 'notes' });
  world = apply(world, { kind: 'minimize', id: 'w-notes-1' });
  assert.equal(world.focusedId, 'w-mail-1');
  world = apply(world, { kind: 'focus-window', id: 'w-notes-1' });
  assert.equal(world.windows.find(win => win.id === 'w-notes-1').mode, 'normal');
  assert.equal(M.applyIntent(world, { kind: 'focus-window', id: 'w-notes-1' }, NOW).changed, false);
  world = apply(world, { kind: 'maximize', id: 'w-mail-1' }, { kind: 'fullscreen', id: 'w-notes-1' });
  assert.equal(world.windows.find(win => win.id === 'w-mail-1').mode, 'maximized');
  world = apply(world, { kind: 'set-rect', id: 'w-mail-1', rect: { x: 950, y: -20, w: 5000, h: 10.4 } });
  assert.deepEqual(world.windows.find(win => win.id === 'w-mail-1').rect, { x: 0, y: 0, w: 1000, h: 120 });
  world = apply(world, { kind: 'tile', id: 'w-mail-1', tile: 'tr' });
  assert.deepEqual(world.windows.find(win => win.id === 'w-mail-1').rect, { x: 500, y: 0, w: 500, h: 300 });
  world = apply(world, { kind: 'restore', id: 'w-mail-1' });
  assert.equal(world.windows.find(win => win.id === 'w-mail-1').tile, null);
  world = apply(world, { kind: 'close-window', id: 'w-mail-1' });
  assert.deepEqual(world.order, ['w-notes-1']);
  assert.equal(world.focusedId, 'w-notes-1');
  rejects(world, { kind: 'close-window', id: 'w-mail-1' }, 'no-such-window');
  rejects(world, { kind: 'tile', id: 'w-notes-1', tile: 'fill' }, 'invalid-intent');
});

test('set-sys validates every field and supports a same-origin or data wallpaper URL', () => {
  const world = desktopWorld();
  const next = apply(world, { kind: 'set-sys', patch: { theme: 'light', accent: 'green', wallpaper: 'depth-trench', wallpaperUrl: 'data:image/png;base64,iVBORw0KGgo=' } });
  assert.equal(next.sys.theme, 'light');
  assert.equal(next.sys.wallpaperUrl, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(apply(next, { kind: 'set-sys', patch: { wallpaperUrl: null } }).sys.wallpaperUrl, null);
  assert.equal(M.applyIntent(world, { kind: 'set-sys', patch: { theme: 'dark' } }, NOW).changed, false);
  for (const patch of [{ theme: 'blue' }, { volume: 101 }, { brightness: 5 }, { wifi: 'yes' }, { unknown: 1 }, { wallpaperUrl: 'http://127.0.0.1/x.png' }, { wallpaperUrl: '/a/../b.png' }]) {
    rejects(world, { kind: 'set-sys', patch }, 'invalid-intent');
  }
});

test('set-phase follows the transition table and power-off clears windows', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'mail' }, { kind: 'toggle-overlay', name: 'quick', open: true });
  world = apply(world, { kind: 'set-phase', phase: 'sleep' });
  assert.equal(world.windows.length, 1);
  assert.equal(world.overlays.quick, false);
  rejects(world, { kind: 'set-phase', phase: 'desktop' }, 'phase-transition');
  world = apply(world, { kind: 'set-phase', phase: 'lock' }, { kind: 'set-phase', phase: 'off' });
  assert.deepEqual([world.windows, world.order, world.focusedId], [[], [], null]);
  world = apply(world, { kind: 'set-phase', phase: 'boot' }, { kind: 'set-phase', phase: 'lock' }, { kind: 'set-phase', phase: 'desktop' });
  assert.equal(world.phase, 'desktop');
});

test('overlays are exclusive', () => {
  let world = apply(desktopWorld(), { kind: 'toggle-overlay', name: 'search', open: true }, { kind: 'toggle-overlay', name: 'centre', open: true });
  assert.deepEqual(world.overlays, { launcher: false, search: false, quick: false, centre: true, taskView: false, switcher: false });
  world = apply(world, { kind: 'toggle-overlay', name: 'centre', open: false });
  assert.ok(Object.values(world.overlays).every(open => !open));
  rejects(world, { kind: 'toggle-overlay', name: 'siri', open: true }, 'culled-app');
});

test('fs intents: mkdir, touch, write, rename, move, desktop position, trash, restore, empty-trash', () => {
  let world = apply(desktopWorld(),
    { kind: 'fs', op: 'mkdir', parentId: 'documents', name: 'Receipts' },
    { kind: 'fs', op: 'touch', parentId: 'desktop', name: 'todo.txt', id: 'f-todo', text: 'hello' });
  assert.equal(world.fs.nodes['u-1'].kind, 'folder');
  assert.equal(world.fs.nodes['f-todo'].mime, 'text/plain');
  assert.equal(world.data.contents['c-f-todo'].text, 'hello');
  rejects(world, { kind: 'fs', op: 'mkdir', parentId: 'documents', name: 'receipts' }, 'name-taken');
  rejects(world, { kind: 'fs', op: 'touch', parentId: 'desktop', name: 'x', id: 'f-todo' }, 'id-taken');
  rejects(world, { kind: 'fs', op: 'mkdir', parentId: 'documents', name: 'a/b' }, 'invalid-intent');
  world = apply(world, { kind: 'fs', op: 'write', id: 'f-todo', text: 'hello world' });
  assert.equal(world.fs.nodes['f-todo'].size, 11);
  assert.equal(world.fs.nodes['f-todo'].modified, '2026-11-02T10:00:00Z');
  rejects(world, { kind: 'fs', op: 'write', id: 'f-offsite', text: 'x' }, 'read-only');
  world = apply(world, { kind: 'fs', op: 'set-desktop-pos', id: 'f-todo', pos: { x: 10, y: 20 } }, { kind: 'fs', op: 'rename', id: 'f-todo', name: 'done.txt' });
  assert.deepEqual(world.fs.nodes['f-todo'].desktopPos, { x: 10, y: 20 });
  world = apply(world, { kind: 'fs', op: 'move', id: 'f-todo', parentId: 'u-1' });
  assert.equal(world.fs.nodes['f-todo'].desktopPos, undefined);
  rejects(world, { kind: 'fs', op: 'move', id: 'u-1', parentId: 'u-1' }, 'fs-cycle');
  rejects(world, { kind: 'fs', op: 'trash', id: 'documents' }, 'no-such-node');
  rejects(world, { kind: 'fs', op: 'rename', id: 'desktop', name: 'X' }, 'no-such-node');
  world = apply(world, { kind: 'open-app', app: 'texteditor', payload: { fileId: 'f-todo' } }, { kind: 'fs', op: 'trash', id: 'u-1' });
  assert.equal(world.fs.nodes['u-1'].trashed, true);
  world = apply(world, { kind: 'fs', op: 'restore', id: 'u-1' }, { kind: 'fs', op: 'trash', id: 'u-1' }, { kind: 'fs', op: 'empty-trash' });
  assert.equal(world.fs.nodes['u-1'], undefined);
  assert.equal(world.fs.nodes['f-todo'], undefined);
  assert.equal(world.data.contents['c-f-todo'], undefined);
  assert.equal(world.windows.length, 0);
  assert.equal(M.applyIntent(world, { kind: 'fs', op: 'empty-trash' }, NOW).changed, false);
});

test('data intents for mail, messages, notes, calendar, reminders and contacts', () => {
  let world = apply(desktopWorld(),
    { kind: 'data', store: 'mail', op: 'mark-read', item: { id: 'm-standup', read: true } },
    { kind: 'data', store: 'mail', op: 'flag', item: { id: 'm-standup', flagged: true } },
    { kind: 'data', store: 'mail', op: 'move', item: { id: 'm-it', folder: 'archive' } },
    { kind: 'data', store: 'mail', op: 'save-draft', item: { id: 'd-1', to: 'priya.shah@northwind.example', subject: 'Hi', body: 'Draft' } },
    { kind: 'data', store: 'messages', op: 'append', item: { threadId: 't-priya', id: 'i-9', text: 'Yes, see you there.' } },
    { kind: 'data', store: 'notes', op: 'upsert', item: { id: 'n-new', folder: 'notes', title: 'New', body: 'Body', pinned: false } },
    { kind: 'data', store: 'calendar', op: 'delete', item: { id: 'e-review' } },
    { kind: 'data', store: 'reminders', op: 'toggle', item: { id: 'r-budget', done: true } },
    { kind: 'data', store: 'contacts', op: 'upsert', item: { id: 'p-new', name: 'Lee Park', email: 'lee.park@fabrikam.example', phone: '+1 555 0109', org: 'Fabrikam' } });
  const message = world.data.mail.messages.find(item => item.id === 'm-standup');
  assert.deepEqual([message.read, message.flagged], [true, true]);
  assert.equal(world.data.mail.messages.find(item => item.id === 'm-it').folder, 'archive');
  assert.equal(world.data.mail.messages.find(item => item.id === 'd-1').from, 'Alex Rivera <alex.rivera@northwind.example>');
  assert.equal(world.data.messages.threads[0].items.at(-1).from, 'Alex Rivera');
  assert.equal(world.data.notes.find(item => item.id === 'n-new').modified, '2026-11-02T10:00:00Z');
  assert.equal(world.data.calendar.length, 1);
  assert.equal(world.data.reminders[0].done, true);
  assert.equal(world.data.contacts.length, 5);
  assert.equal(world.revision, 9);
  rejects(world, { kind: 'data', store: 'mail', op: 'save-draft', item: { id: 'm-it', to: 'x@northwind.example', subject: '', body: '' } }, 'not-a-draft');
  rejects(world, { kind: 'data', store: 'mail', op: 'save-draft', item: { id: 'd-2', to: 'boss@realcorp.com', subject: '', body: '' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'mail', op: 'send', item: { id: 'd-1' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'mail', op: 'move', item: { id: 'm-it', folder: 'nowhere' } }, 'no-such-folder');
  rejects(world, { kind: 'data', store: 'contacts', op: 'upsert', item: { id: 'p-x', name: 'X', email: 'x@gmail.com', phone: '', org: '' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'weather', op: 'upsert', item: { id: 'x' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'notes', op: 'delete', item: { id: 'missing' } }, 'no-such-item');
});

test('notifications: dismiss banners, clear history', () => {
  const banner = { id: 'n-b', app: 'mail', title: 'New mail', body: 'x', time: '2026-11-02T09:30:00Z' };
  let world = { ...desktopWorld(), notifications: { banners: [banner], history: [...seed.notifications.history, banner] } };
  world = apply(world, { kind: 'notify-dismiss', id: 'n-b' });
  assert.deepEqual([world.notifications.banners.length, world.notifications.history.length], [0, 2]);
  world = apply(world, { kind: 'notify-clear', id: 'n-welcome' });
  assert.deepEqual(world.notifications.history.map(item => item.id), ['n-b']);
  world = apply(world, { kind: 'notify-clear' });
  assert.equal(world.notifications.history.length, 0);
  assert.equal(M.applyIntent(world, { kind: 'notify-dismiss' }, NOW).changed, false);
});

test('dock and install intents keep pins inside installed and canonical order', () => {
  const limited = { ...M.createWorld(seed, { installed: ['files', 'mail', 'settings'] }), phase: 'desktop' };
  rejects(limited, { kind: 'dock', op: 'pin', app: 'browser' }, 'not-installed');
  let world = apply(limited, { kind: 'install', app: 'browser' }, { kind: 'dock', op: 'pin', app: 'browser', index: 0 });
  assert.deepEqual(world.installed, ['files', 'browser', 'mail', 'settings']);
  assert.deepEqual(world.dock.pins, ['browser', 'files', 'mail', 'settings']);
  world = apply(world, { kind: 'dock', op: 'move', app: 'browser', index: 9 }, { kind: 'dock', op: 'unpin', app: 'mail' });
  assert.deepEqual(world.dock.pins, ['files', 'settings', 'browser']);
  rejects(world, { kind: 'dock', op: 'move', app: 'mail', index: 0 }, 'not-pinned');
  assert.equal(M.applyIntent(world, { kind: 'install', app: 'browser' }, NOW).changed, false);
});

test('scene-choice never edits the world and is forwarded to the scene model', () => {
  const world = desktopWorld();
  const result = M.applyIntent(world, { kind: 'scene-choice', choiceId: 'report' }, NOW);
  assert.deepEqual([result.ok, result.changed, result.world, result.forward], [true, false, world, { kind: 'choose', choiceId: 'report' }]);
});

test('uninstall removes the app, its pins, badges and windows, and refuses core apps', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'mail' }, { kind: 'open-app', app: 'notes' });
  world = apply(world, { kind: 'uninstall', app: 'mail' });
  assert.ok(!world.installed.includes('mail'));
  assert.ok(!world.dock.pins.includes('mail'));
  assert.equal(world.dock.badges.mail, undefined);
  assert.deepEqual(world.windows.map(win => win.app), ['notes']);
  assert.deepEqual(world.order, ['w-notes-1']);
  assert.equal(world.focusedId, 'w-notes-1');
  rejects(world, { kind: 'uninstall', app: 'settings' }, 'core-app');
  rejects(world, { kind: 'uninstall', app: 'files' }, 'core-app');
  rejects(world, { kind: 'uninstall', app: 'facetime' }, 'culled-app');
  assert.equal(M.applyIntent(world, { kind: 'uninstall', app: 'mail' }, NOW).changed, false);
  assert.ok(apply(world, { kind: 'install', app: 'mail' }).installed.includes('mail'));
});

test('alarms, updates and mfa stores use the shapes agreed with the Windows apps', () => {
  const prompt = { id: 'pr-1', app: 'Contoso SSO', account: 'alex.rivera@northwind.example', location: 'Lisbon, PT', device: 'Chrome on Windows', time: '2026-11-02T09:59:00Z', number: 42 };
  const update = { id: 'u-1', title: 'Vendor Utility 4.2', kb: 'KB0042', size: '38 MB', status: 'available', choiceId: 'download' };
  let world = { ...desktopWorld(), data: { ...seed.data, updates: [update], mfa: { accounts: [{ id: 'acc-1', issuer: 'Contoso SSO', label: 'alex.rivera@northwind.example' }], prompts: [prompt] } } };
  assert.equal(M.validate(world).error, null);
  world = apply(world,
    { kind: 'data', store: 'alarms', op: 'upsert', item: { id: 'a-1', time: '10:25', label: 'Stand-up', enabled: true } },
    { kind: 'data', store: 'updates', op: 'upsert', item: { id: 'u-1', title: 'Vendor Utility 4.2', kb: 'KB0042', size: '38 MB', status: 'installed' } });
  assert.deepEqual(world.data.alarms, [{ id: 'a-1', time: '10:25', label: 'Stand-up', enabled: true }]);
  assert.deepEqual(world.data.updates[0], { ...update, status: 'installed' });
  // choiceId is read-only: repeating it is fine, setting or changing it is not.
  assert.equal(M.applyIntent(world, { kind: 'data', store: 'updates', op: 'upsert', item: { ...update, status: 'installed' } }, NOW).changed, false);
  rejects(world, { kind: 'data', store: 'updates', op: 'upsert', item: { ...update, choiceId: 'allow' } }, 'read-only');
  rejects(world, { kind: 'data', store: 'updates', op: 'upsert', item: { id: 'u-2', title: 'x', kb: 'k', size: '1 MB', status: 'available', choiceId: 'allow' } }, 'read-only');
  rejects(world, { kind: 'data', store: 'updates', op: 'upsert', item: { id: 'u-2', title: 'x', kb: 'k', size: '1 MB', status: 'downloading' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'alarms', op: 'upsert', item: { id: 'a-2', time: '25:00', label: 'x', enabled: true } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'alarms', op: 'upsert', item: { id: 'a-2', time: '09:00', label: 'x'.repeat(61), enabled: true } }, 'invalid-intent');
  // Approve/Deny is a scene-choice; the answered prompt is then removed with mfa delete.
  rejects(world, { kind: 'data', store: 'mfa', op: 'upsert', item: { id: 'acc-2', issuer: 'x', label: 'y' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'mfa', op: 'respond', item: { id: 'pr-1', status: 'approved' } }, 'invalid-intent');
  world = apply(world, { kind: 'scene-choice', choiceId: 'approve' }, { kind: 'data', store: 'mfa', op: 'delete', item: { id: 'pr-1' } });
  assert.deepEqual(world.data.mfa.prompts, []);
  rejects(world, { kind: 'data', store: 'mfa', op: 'delete', item: { id: 'pr-1' } }, 'no-such-item');
  world = apply(world, { kind: 'data', store: 'alarms', op: 'delete', item: { id: 'a-1' } }, { kind: 'data', store: 'mfa', op: 'delete', item: { id: 'acc-1' } });
  assert.deepEqual([world.data.alarms, world.data.mfa.accounts], [[], []]);
  const bad = data => M.validate({ ...world, data: { ...world.data, ...data } }).error;
  assert.equal(bad({ mfa: { accounts: [], prompts: [{ ...prompt, number: 'x' }] } }), 'data-mfa');
  assert.equal(bad({ mfa: { accounts: [], prompts: [{ ...prompt, account: 'me@realbank.com' }] } }), 'data-mfa');
  assert.equal(bad({ updates: [{ ...update, size: undefined }] }), 'data-updates');
});

test('processes and web pages are validated, read-only scene data', () => {
  const web = { pages: { 'payroll-portal': { title: 'Payroll portal', url: 'payroll.contoso-hr.example/login', brand: 'Contoso HR', heading: 'Confirm your details',
    body: 'Confirm your details.\n\nThis takes one minute.', choices: [{ label: 'Sign in', choiceId: 'sign-in', style: 'primary' }, { label: 'Close', choiceId: 'close-tab' }], insecure: true } },
  favorites: [{ title: 'Payroll', url: 'scene:payroll-portal' }] };
  const processes = [{ id: 'p-1', name: 'updater-helper', cpu: 12.5, mem: 140, publisher: 'Unknown', suspicious: true, endChoice: 'release' }, { id: 'p-2', name: 'kernel_task' }];
  const world = { ...desktopWorld(), data: { ...seed.data, web, processes } };
  assert.equal(M.validate(world).error, null);
  const bad = data => M.validate({ ...world, data: { ...world.data, ...data } }).error;
  const page = web.pages['payroll-portal'];
  assert.equal(bad({ web: { pages: { x: { ...page, url: 'https://payroll.realbank.com' } } } }), 'data-web');
  assert.equal(bad({ web: { pages: { x: { ...page, choices: ['sign-in'] } } } }), 'data-web');
  assert.equal(bad({ web: { pages: { x: { ...page, choices: [{ label: 'Go', choiceId: 'sign-in', style: 'danger' }] } } } }), 'data-web');
  assert.equal(bad({ web: { pages: {}, favorites: [{ title: 'x', url: 'https://x.example' }] } }), 'data-web');
  assert.equal(bad({ processes: [{ id: 'p-3', name: 'x', cpu: 101 }] }), 'data-processes');
  assert.equal(bad({ processes: [{ id: 'p-3', name: 'x', app: 'mail' }] }), 'data-processes');
  assert.equal(bad({ extra: [] }), 'data');
  rejects(world, { kind: 'data', store: 'processes', op: 'upsert', item: { id: 'p-9', name: 'x' } }, 'invalid-intent');
  rejects(world, { kind: 'data', store: 'web', op: 'delete', item: { id: 'payroll-portal' } }, 'invalid-intent');
});

// ---- synced app stores (docs/desktop-parity/SYNC-AUDIT.md) ----

const SYNCED = ['browser', 'media', 'photos', 'whiteboard', 'calculator', 'clock', 'terminal', 'stickies'];
const data = (store, op, item) => ({ kind: 'data', store, op, item });
const withoutSynced = () => {
  const world = desktopWorld();
  for (const store of SYNCED) delete world.data[store];
  for (const key of ['dockAutohide', 'showBatteryPercent', 'increaseContrast', 'wifiNetwork', 'locationServices', 'shareAnalytics', 'personalizedAds']) delete world.sys[key];
  return world;
};
const badData = (world, patch) => M.validate({ ...world, data: { ...world.data, ...patch } }).error;

test('synced stores are in the seed, optional for older worlds, and created empty by their first intent', () => {
  const world = desktopWorld();
  for (const store of SYNCED) assert.ok(Object.hasOwn(world.data, store), store);
  assert.equal(world.sys.wifiNetwork, 'Northwind-Staff');
  const old = withoutSynced();
  assert.equal(M.validate(old).error, null);
  const next = apply(old,
    data('calculator', 'record', { id: 'tape-1', expr: '2 + 2', result: '4' }),
    data('terminal', 'record', { line: 'ls' }),
    data('stickies', 'upsert', { id: 'stk-1', text: 'Hi', color: 'green', x: 0, y: 0, w: 200, h: 160, collapsed: false }));
  assert.deepEqual(next.data.calculator, { mode: 'basic', angle: 'deg', base: 10, memory: 0, history: [{ id: 'tape-1', expr: '2 + 2', result: '4', time: '2026-11-02T10:00:00Z' }] });
  assert.deepEqual(next.data.terminal, { cwd: 'home', history: ['ls'] });
  assert.equal(next.data.stickies.length, 1);
  assert.equal(next.data.browser, undefined);
  assert.equal(badData(old, { browser: { tabs: [] } }), 'data-browser');
});

test('sys accepts the synced optional settings and checks each one', () => {
  const world = apply(withoutSynced(), { kind: 'set-sys', patch: { dockAutohide: true, showBatteryPercent: true, increaseContrast: true, wifiNetwork: 'Harbor-Library', locationServices: false, shareAnalytics: true, personalizedAds: true } });
  assert.equal(world.sys.dockAutohide, true);
  assert.equal(world.sys.wifiNetwork, 'Harbor-Library');
  for (const patch of [{ dockAutohide: 'yes' }, { wifiNetwork: '' }, { wifiNetwork: 'x'.repeat(41) }, { wifiNetwork: 'a\nb' }, { stageManager: true }]) {
    rejects(world, { kind: 'set-sys', patch }, 'invalid-intent');
  }
  assert.equal(M.validate({ ...world, sys: { ...world.sys, dockSize: 48 } }).error, 'sys');
});

test('browser: tabs, history and bookmarks hold only scene pages and placeholders', () => {
  let world = desktopWorld();
  const tabs = [{ id: 'tab-1', url: 'start:', title: 'Start Page' }, { id: 'tab-2', url: 'scene:payroll', title: 'Payroll' }];
  world = apply(world, { kind: 'open-app', app: 'browser' }, data('browser', 'set-tabs', { tabs, activeTabId: 'tab-2' }));
  assert.deepEqual(world.data.browser.tabs, tabs);
  assert.equal(M.applyIntent(world, data('browser', 'set-tabs', { tabs, activeTabId: 'tab-2' }), NOW).changed, false);
  rejects(world, data('browser', 'set-tabs', { tabs, activeTabId: 'tab-9' }), 'invalid-intent');
  rejects(world, data('browser', 'set-tabs', { tabs, activeTabId: null }), 'invalid-intent');
  rejects(world, data('browser', 'set-tabs', { tabs: [{ id: 'tab-1', url: 'https://www.realbank.com', title: 'x' }], activeTabId: 'tab-1' }), 'invalid-intent');
  rejects(world, data('browser', 'set-tabs', { tabs: Array.from({ length: 17 }, (_, n) => ({ id: `t-${n}`, url: 'start:', title: 'x' })), activeTabId: 't-0' }), 'invalid-intent');
  world = apply(world,
    data('browser', 'visit', { id: 'h-1', url: 'scene:payroll', title: 'Payroll' }),
    data('browser', 'visit', { id: 'h-2', url: 'scene:portal', title: 'Portal' }),
    data('browser', 'visit', { id: 'h-3', url: 'scene:payroll', title: 'Payroll' }),
    data('browser', 'bookmark-upsert', { id: 'bm-1', title: 'Payroll', url: 'scene:payroll' }));
  assert.deepEqual(world.data.browser.history.map(item => item.id), ['h-3', 'h-2']);
  assert.equal(world.data.browser.history[0].time, '2026-11-02T10:00:00Z');
  rejects(world, data('browser', 'visit', { id: 'h-4', url: 'start:', title: 'Start' }), 'invalid-intent');
  rejects(world, data('browser', 'bookmark-upsert', { id: 'bm-2', title: 'x', url: 'https://x.example' }), 'invalid-intent');
  world = apply(world, data('browser', 'history-delete', { id: 'h-2' }), data('browser', 'bookmark-delete', { id: 'bm-1' }));
  assert.deepEqual([world.data.browser.history.length, world.data.browser.bookmarks.length], [1, 0]);
  rejects(world, data('browser', 'history-delete', { id: 'h-2' }), 'no-such-item');
  world = apply(world, data('browser', 'clear-history', {}));
  assert.equal(M.applyIntent(world, data('browser', 'clear-history', {}), NOW).changed, false);
  rejects(world, data('browser', 'clear-history', { all: true }), 'invalid-intent');
  // Tabs belong to the browser window: closing it clears them.
  world = apply(world, { kind: 'close-window', id: 'w-browser-1' });
  assert.deepEqual([world.data.browser.tabs, world.data.browser.activeTabId], [[], null]);
});

test('browser: open-app with a scene url activates that tab or appends one', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'browser', payload: { url: 'scene:payroll' } });
  assert.deepEqual(world.data.browser.tabs, [{ id: 'tab-1', url: 'scene:payroll', title: 'Training page' }]);
  assert.equal(world.data.browser.activeTabId, 'tab-1');
  world = apply(world, data('browser', 'set-tabs', { tabs: [...world.data.browser.tabs, { id: 'tab-x', url: 'start:', title: 'Start Page' }], activeTabId: 'tab-x' }),
    { kind: 'open-app', app: 'browser', payload: { url: 'scene:payroll' } });
  assert.equal(world.data.browser.tabs.length, 2);
  assert.equal(world.data.browser.activeTabId, 'tab-1');
  world = apply(world, { kind: 'set-phase', phase: 'off' });
  assert.deepEqual(world.data.browser.tabs, []);
});

test('media: library, playlists and now playing reference known tracks; the parent stamps at', () => {
  let world = desktopWorld();
  world = apply(world,
    data('media', 'set-playback', { trackId: 't2', queue: ['t2', 't4'], positionSec: 12.5, playing: true }),
    data('media', 'set-mode', { shuffle: true, repeat: 'all' }),
    data('media', 'track-upsert', { ...world.data.media.tracks[1], loved: true }),
    data('media', 'playlist-upsert', { id: 'pl-new', name: 'New Playlist', trackIds: ['t1'] }));
  assert.deepEqual(world.data.media.nowPlaying, { trackId: 't2', queue: ['t2', 't4'], positionSec: 12.5, playing: true, at: '2026-11-02T10:00:00.000Z' });
  assert.deepEqual([world.data.media.shuffle, world.data.media.repeat, world.data.media.tracks[1].loved], [true, 'all', true]);
  rejects(world, data('media', 'set-playback', { trackId: 't9', queue: ['t9'], positionSec: 0, playing: false }), 'no-such-item');
  rejects(world, data('media', 'set-playback', { trackId: 't2', queue: ['t4'], positionSec: 0, playing: false }), 'invalid-intent');
  rejects(world, data('media', 'set-playback', { trackId: 't2', queue: ['t2'], positionSec: -1, playing: false }), 'invalid-intent');
  rejects(world, data('media', 'set-playback', { trackId: null, queue: [], positionSec: 0, playing: true }), 'invalid-intent');
  rejects(world, data('media', 'set-mode', { shuffle: true, repeat: 'forever' }), 'invalid-intent');
  rejects(world, data('media', 'playlist-upsert', { id: 'pl-x', name: 'x', trackIds: ['t9'] }), 'no-such-item');
  rejects(world, data('media', 'track-upsert', { ...world.data.media.tracks[0], duration: -1 }), 'invalid-intent');
  world = apply(world, data('media', 'playlist-delete', { id: 'pl-new' }), data('media', 'set-playback', { trackId: null, queue: [], positionSec: 0, playing: false }));
  assert.equal(world.data.media.nowPlaying, null);
  assert.equal(badData(world, { media: { ...world.data.media, playlists: [{ id: 'pl-x', name: 'x', trackIds: ['t9'] }] } }), 'data-media');
});

test('photos: favourites, Recently Deleted and albums', () => {
  let world = desktopWorld();
  const photo = world.data.photos.items[0];
  world = apply(world,
    data('photos', 'photo-upsert', { ...photo, favorite: true, trashed: true }),
    data('photos', 'album-upsert', { id: 'al-new', name: 'New Album', photoIds: ['p1', 'p2'] }));
  assert.deepEqual([world.data.photos.items[0].favorite, world.data.photos.items[0].trashed], [true, true]);
  world = apply(world, data('photos', 'photo-delete', { id: 'p1' }));
  assert.equal(world.data.photos.items.length, 7);
  assert.deepEqual(world.data.photos.albums.find(album => album.id === 'al-new').photoIds, ['p2']);
  rejects(world, data('photos', 'album-upsert', { id: 'al-x', name: 'x', photoIds: ['p1'] }), 'no-such-item');
  rejects(world, data('photos', 'album-upsert', { id: 'al-x', name: 'x', photoIds: ['p2', 'p2'] }), 'invalid-intent');
  rejects(world, data('photos', 'photo-upsert', { ...photo, name: 'a/b.jpg' }), 'invalid-intent');
  world = apply(world, data('photos', 'album-delete', { id: 'al-new' }));
  rejects(world, data('photos', 'album-delete', { id: 'al-new' }), 'no-such-item');
});

test('whiteboard: boards replace their items whole; pen, shape and colour fields are checked', () => {
  let world = desktopWorld();
  const pen = { id: 'ff-pen', type: 'pen', x: 0, y: 0, w: 10, h: 10, points: [0, 0, 10, 10], color: '#0A84FF', width: 3 };
  world = apply(world, data('whiteboard', 'board-upsert', { id: 'board-new', name: 'Board 2', items: [pen] }));
  assert.equal(world.data.whiteboard.activeId, 'board-new');
  assert.equal(world.data.whiteboard.boards[1].modified, '2026-11-02T10:00:00Z');
  assert.equal(M.applyIntent(world, data('whiteboard', 'board-upsert', { id: 'board-new', name: 'Board 2', items: [pen] }), NOW).changed, false);
  for (const item of [{ ...pen, points: [0, 0, 1] }, { ...pen, type: 'text' }, { ...pen, color: 'url(x)' }, { id: 'ff-s', type: 'shape', x: 0, y: 0, w: 1, h: 1, shape: 'star' },
    { id: 'ff-t', type: 'text', x: 0, y: 0, w: 1, h: 1, text: 'mail me@realbank.com' }, { ...pen, x: Infinity }]) {
    rejects(world, data('whiteboard', 'board-upsert', { id: 'board-new', name: 'Board 2', items: [item] }), 'invalid-intent');
  }
  world = apply(world, data('whiteboard', 'set-active', { id: 'board-q3' }), data('whiteboard', 'board-delete', { id: 'board-q3' }));
  assert.equal(world.data.whiteboard.activeId, 'board-new');
  rejects(world, data('whiteboard', 'set-active', { id: 'board-q3' }), 'no-such-item');
  assert.equal(badData(world, { whiteboard: { boards: [], activeId: 'board-new' } }), 'data-whiteboard');
});

test('calculator: mode settings and newest-first history', () => {
  let world = apply(desktopWorld(), data('calculator', 'set', { mode: 'programmer', angle: 'rad', base: 16, memory: 42 }));
  assert.equal(world.data.calculator.base, 16);
  rejects(world, data('calculator', 'set', { mode: 'graphing', angle: 'rad', base: 16, memory: 0 }), 'invalid-intent');
  rejects(world, data('calculator', 'set', { mode: 'basic', angle: 'deg', base: 3, memory: 0 }), 'invalid-intent');
  for (let n = 0; n < 102; n += 1) world = apply(world, data('calculator', 'record', { id: `tape-${n}`, expr: `${n} + 1`, result: String(n + 1) }));
  assert.equal(world.data.calculator.history.length, 100);
  assert.equal(world.data.calculator.history[0].id, 'tape-101');
  world = apply(world, data('calculator', 'clear-history', {}));
  assert.deepEqual(world.data.calculator.history, []);
});

test('clock: world clocks, a running timer and a stopwatch keep time across shells', () => {
  let world = desktopWorld();
  world = apply(world,
    data('clock', 'city-upsert', { id: 'paris', name: 'Paris', tz: 'Europe/Paris' }),
    data('clock', 'set-timer', { timer: { label: 'Tea', durationMs: 300000, remainingMs: 240000, running: true } }),
    data('clock', 'set-stopwatch', { running: true, elapsedMs: 1500, laps: [500, 1200] }));
  assert.equal(world.data.clock.worldClocks.length, 5);
  assert.deepEqual(world.data.clock.timer, { label: 'Tea', durationMs: 300000, remainingMs: 240000, running: true, at: '2026-11-02T10:00:00.000Z' });
  assert.equal(world.data.clock.stopwatch.at, '2026-11-02T10:00:00.000Z');
  rejects(world, data('clock', 'city-upsert', { id: 'nowhere', name: 'Nowhere', tz: 'Mars/Olympus' }), 'invalid-intent');
  rejects(world, data('clock', 'set-timer', { timer: { label: 'x', durationMs: 1000, remainingMs: 2000, running: false } }), 'invalid-intent');
  rejects(world, data('clock', 'set-stopwatch', { running: false, elapsedMs: 10, laps: [5, 2] }), 'invalid-intent');
  world = apply(world, data('clock', 'city-delete', { id: 'paris' }), data('clock', 'set-timer', { timer: null }),
    data('clock', 'set-stopwatch', { running: false, elapsedMs: 0, laps: [] }));
  assert.equal(world.data.clock.timer, null);
  assert.equal(M.applyIntent(world, data('clock', 'set-timer', { timer: null }), NOW).changed, false);
  assert.equal(badData(world, { clock: { ...world.data.clock, stopwatch: { running: true, elapsedMs: 0, at: null, laps: [] } } }), 'data-clock');
});

test('terminal: cwd is a live folder of the open terminal; history keeps the newest 100 lines', () => {
  let world = apply(desktopWorld(), { kind: 'open-app', app: 'terminal' }, data('terminal', 'cd', { cwd: 'documents' }), data('terminal', 'record', { line: 'cd Documents' }));
  assert.equal(world.data.terminal.cwd, 'documents');
  assert.equal(M.applyIntent(world, data('terminal', 'record', { line: 'cd Documents' }), NOW).changed, false);
  rejects(world, data('terminal', 'cd', { cwd: 'f-budget' }), 'no-such-folder');
  rejects(world, data('terminal', 'cd', { cwd: 'applications' }), 'no-such-folder');
  rejects(world, data('terminal', 'record', { line: 'echo me@realbank.com' }), 'invalid-intent');
  for (let n = 0; n < 105; n += 1) world = apply(world, data('terminal', 'record', { line: `echo ${n}` }));
  assert.equal(world.data.terminal.history.length, 100);
  assert.equal(world.data.terminal.history.at(-1), 'echo 104');
  world = apply(world, { kind: 'close-window', id: 'w-terminal-1' });
  assert.equal(world.data.terminal.cwd, 'home');
  assert.equal(world.data.terminal.history.length, 100);
  assert.equal(badData(world, { terminal: { cwd: 'no-such-folder', history: [] } }), 'data-terminal');
});

test('stickies, pinned threads and the optional reminder, event and contact fields', () => {
  let world = desktopWorld();
  const sticky = { ...world.data.stickies[0], text: 'Moved', x: 300, collapsed: true };
  world = apply(world, data('stickies', 'upsert', sticky), data('stickies', 'delete', { id: 'stk-desk' }),
    data('messages', 'pin', { threadId: 't-team', pinned: true }),
    data('reminders', 'upsert', { id: 'r-badge', list: 'work', title: 'Renew building badge', due: null, flagged: true, priority: 2, notes: 'Front desk' }),
    data('reminders', 'upsert', { id: 'r-badge', list: 'work', title: 'Renew badge', due: null }),
    data('calendar', 'upsert', { id: 'e-review', title: 'Budget review', start: '2026-11-06T00:00:00Z', end: '2026-11-07T00:00:00Z', location: 'Video call', allDay: true }),
    data('contacts', 'upsert', { id: 'p-dana', name: 'Dana Okafor', email: 'dana.okafor@northwind.example', phone: '+1 555 0103', org: 'Northwind', favorite: true }));
  assert.deepEqual(world.data.stickies, [sticky]);
  assert.equal(world.data.messages.threads[1].pinned, true);
  assert.deepEqual(world.data.reminders[1], { id: 'r-badge', list: 'work', title: 'Renew badge', due: null, done: false, flagged: true, priority: 2, notes: 'Front desk' });
  assert.equal(world.data.calendar[1].allDay, true);
  assert.equal(world.data.contacts[2].favorite, true);
  rejects(world, data('stickies', 'upsert', { ...sticky, color: 'orange' }), 'invalid-intent');
  rejects(world, data('stickies', 'upsert', { ...sticky, w: 10 }), 'invalid-intent');
  rejects(world, data('messages', 'pin', { threadId: 't-none', pinned: true }), 'no-such-item');
  rejects(world, data('reminders', 'upsert', { id: 'r-x', list: 'work', title: 'x', due: null, priority: 5 }), 'invalid-intent');
  rejects(world, data('contacts', 'upsert', { id: 'p-x', name: 'x', email: 'x@y.example', phone: '', org: '', vip: true }), 'invalid-intent');
  assert.equal(M.applyIntent(world, data('messages', 'pin', { threadId: 't-team', pinned: true }), NOW).changed, false);
  const full = Array.from({ length: 50 }, (_, n) => ({ ...sticky, id: `stk-${n}` }));
  rejects({ ...world, data: { ...world.data, stickies: full } }, data('stickies', 'upsert', { ...sticky, id: 'stk-new' }), 'store-full');
});

// ---- canonical projection (Scenario authors never write sync code: shells are compared through normalise) ----

test('normalise: absent stores and settings equal their empty or default values', () => {
  assert.deepEqual(M.normalise(withoutSynced()), M.normalise({ ...withoutSynced(), sys: { ...withoutSynced().sys, ...M.SYS_DEFAULTS },
    data: { ...withoutSynced().data, ...Object.fromEntries(SYNCED.map(store => [store, M.emptyStore(store)])) } }));
  assert.equal(M.normalise({}).data.media.nowPlaying, null);
  assert.deepEqual(Object.keys(M.normalise(desktopWorld()).data).filter(key => SYNCED.includes(key)), SYNCED);
});

test('normalise: leaves out geometry, window ids, tab titles, durations and parent stamps on running values', () => {
  const world = apply(desktopWorld(), { kind: 'open-app', app: 'notes' }, { kind: 'open-app', app: 'mail' },
    data('media', 'set-playback', { trackId: 't1', queue: ['t1'], positionSec: 30, playing: true }),
    data('clock', 'set-timer', { timer: { label: 'Tea', durationMs: 60000, remainingMs: 30000, running: true } }));
  const moved = { ...world, windows: world.windows.map((win, index) => ({ ...win, id: `w-other-${index}`, rect: { x: 10, y: 10, w: 300, h: 200 }, title: 'x' })),
    order: world.order.map(id => `w-other-${world.windows.findIndex(win => win.id === id)}`), focusedId: `w-other-${world.windows.findIndex(win => win.id === world.focusedId)}`,
    data: { ...world.data, media: { ...world.data.media, tracks: world.data.media.tracks.map(track => ({ ...track, duration: 99 })),
      nowPlaying: { ...world.data.media.nowPlaying, positionSec: 41, at: '2026-11-02T10:00:11.000Z' } },
    clock: { ...world.data.clock, timer: { ...world.data.clock.timer, remainingMs: 19000, at: '2026-11-02T10:00:11.000Z' } } } };
  assert.deepEqual(M.normalise(moved), M.normalise(world));
  assert.deepEqual(M.normalise(world).windows.map(win => win.app), ['notes', 'mail']);
  assert.equal(M.normalise(world).focused, 1);
  // Paused values are exact; times compare as instants.
  const paused = apply(world, data('media', 'set-playback', { trackId: 't1', queue: ['t1'], positionSec: 30, playing: false }));
  assert.equal(M.normalise(paused).data.media.nowPlaying.positionSec, 30);
  assert.equal(M.normaliseStore('calculator', { ...M.emptyStore('calculator'), history: [{ id: 'a', expr: '1', result: '1', time: '2026-11-02T10:00Z' }] }).history[0].time,
    M.normaliseStore('calculator', { ...M.emptyStore('calculator'), history: [{ id: 'a', expr: '1', result: '1', time: '2026-11-02T10:00:00.000Z' }] }).history[0].time);
  // A normal window over the whole work area looks maximized on both OSes.
  const full = apply(world, { kind: 'set-rect', id: world.focusedId, rect: { x: 0, y: 0, w: 1000, h: 600 } });
  assert.equal(M.normalise(full).windows.at(-1).mode, 'maximized');
});

test('generated worlds (check/world-gen.mjs) are valid and their canonical form survives JSON transport', async () => {
  const { generateWorld } = await import('../desktop-comparison/previews/macos-final/check/world-gen.mjs');
  for (let n = 1; n <= 40; n += 1) {
    const world = generateWorld(M, M.createWorld(seed, n % 2 ? darkProfile : undefined), n, 50);
    assert.equal(M.validate(world).error, null, `seed ${n}`);
    const canonical = M.normalise(world);
    assert.deepEqual(JSON.parse(JSON.stringify(canonical)), JSON.parse(JSON.stringify(M.normalise(JSON.parse(JSON.stringify(world))))), `seed ${n}`);
  }
  assert.notDeepEqual(M.normalise(generateWorld(M, M.createWorld(seed), 1, 50)), M.normalise(generateWorld(M, M.createWorld(seed), 2, 50)));
});

test('the ESM wrapper exposes the same model', async () => {
  const esm = await import('../ui/desktop/world-model.mjs');
  assert.equal(esm.default.createWorld, M.createWorld);
  assert.equal(esm.applyIntent, M.applyIntent);
  assert.deepEqual(esm.CANONICAL_APPS, M.CANONICAL_APPS);
});

test('GET /api/desktop/world returns the seed, the seed plus an overlay, and rejects unsafe slugs', async () => {
  const server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}/api/desktop/world`;
  try {
    let response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-desktop-profile'), 'none');
    assert.deepEqual(await response.json(), M.createWorld(seed));
    response = await fetch(`${base}?profile=example-dark`);
    assert.equal(response.headers.get('x-desktop-profile'), 'applied');
    assert.deepEqual(await response.json(), M.createWorld(seed, darkProfile));
    response = await fetch(`${base}?profile=no-such-profile`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-desktop-profile'), 'none');
    for (const profile of ['..%2Fsecrets', 'UPPER', '', 'a'.repeat(41), 'a.json']) {
      assert.equal((await fetch(`${base}?profile=${profile}`)).status, 400, profile);
    }
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

// ---- scene presentation fields and world.sandbox (SCENARIOS-60-CONTRACT §3) -----------------------------------------

const CREATURE = { family: 'deception', depth: 'sunlight', sprite: '/ocean-creatures/deception/sunlight.gif', state: 'idle', targetApp: null };
const SANDBOX = {
  runId: 'run-1', scenario: 'mydoom-2004', attackKind: 'mass-mail-worm', mode: 'simulated', status: 'running',
  events: [{ seq: 1, kind: 'provisioned', label: 'Sandbox ready', count: 0, total: 40 }, { seq: 2, kind: 'mail-sent', label: 'Mail 12 of 40', count: 12, total: 40 }],
  receipt: null,
};
const RECEIPT = {
  provider: 'docker', instance: 'sandbox-1', startedAt: '2026-11-02T10:00:00Z', destroyedAt: '2026-11-02T10:01:00Z',
  teardownConfirmed: true, egress: 'none', dataset: 'synthetic',
};

test('worlds without scene.focusApps, creature, intro or sandbox stay valid', () => {
  const world = M.createWorld(seed);
  assert.equal(Object.hasOwn(world.scene, 'focusApps'), false);
  assert.equal(Object.hasOwn(world, 'sandbox'), false);
  assert.deepEqual(M.validate(world), { ok: true, error: null });
});

test('scene.focusApps, creature and intro validate and reject bad shapes', () => {
  const withScene = patch => ({ ...M.createWorld(seed), scene: { ...M.createWorld(seed).scene, ...patch } });
  const intro = { title: 'Mydoom (2004)', line: 'The year is 2004. You are a clerk using a mail client. You open a message...', next: 'Next: the attachment.' };
  assert.deepEqual(M.validate(withScene({ focusApps: ['mail', 'files'], creature: CREATURE, intro })), { ok: true, error: null });
  assert.deepEqual(M.validate(withScene({ focusApps: [], creature: null, intro: null })), { ok: true, error: null });
  for (const state of M.CREATURE_STATES) assert.equal(M.validate(withScene({ creature: { ...CREATURE, state, targetApp: 'mail' } })).ok, true, state);
  const bad = [
    [{ focusApps: ['nope'] }, 'scene-focus-apps'], [{ focusApps: ['mail', 'mail'] }, 'scene-focus-apps'], [{ focusApps: 'mail' }, 'scene-focus-apps'],
    [{ creature: { ...CREATURE, state: 'dance' } }, 'scene-creature'], [{ creature: { ...CREATURE, sprite: 'https://evil.example/x.gif' } }, 'scene-creature'],
    [{ creature: { ...CREATURE, depth: 'shallow' } }, 'scene-creature'], [{ creature: { ...CREATURE, targetApp: 'camera' } }, 'scene-creature'],
    [{ creature: { ...CREATURE, extra: 1 } }, 'scene-creature'], [{ intro: { title: 'x', line: 'y' } }, 'scene-intro'],
    [{ intro: { title: 'x\ny', line: 'y', next: 'z' } }, 'scene-intro'], [{ unknown: 1 }, 'scene'],
  ];
  for (const [patch, error] of bad) assert.deepEqual(M.validate(withScene(patch)), { ok: false, error }, JSON.stringify(patch));
});

test('world.sandbox validates runs, events and receipts', () => {
  const withSandbox = sandbox => ({ ...M.createWorld(seed), sandbox });
  assert.equal(M.validate(withSandbox(null)).ok, true);
  assert.equal(M.validate(withSandbox(SANDBOX)).ok, true);
  assert.equal(M.validate(withSandbox({ ...SANDBOX, status: 'destroyed', receipt: RECEIPT })).ok, true);
  const { receipt, ...noReceipt } = SANDBOX;
  assert.equal(M.validate(withSandbox(noReceipt)).ok, true);
  assert.equal(M.validate(withSandbox({ ...SANDBOX, events: [{ seq: 3, kind: 'summary', label: 'Done' }] })).ok, true);
  assert.equal(M.validate(withSandbox({ ...SANDBOX, events: Array.from({ length: 64 }, (_, i) => ({ seq: i, kind: 'mail-sent', label: 'Mail' })) })).ok, true);
  const bad = [
    { ...SANDBOX, attackKind: 'launch-missiles' }, { ...SANDBOX, mode: 'prod' }, { ...SANDBOX, status: 'exploded' }, { ...SANDBOX, runId: 'Bad Id' },
    { ...SANDBOX, extra: true }, { ...SANDBOX, events: Array.from({ length: 65 }, (_, i) => ({ seq: i, kind: 'mail-sent', label: 'Mail' })) },
    { ...SANDBOX, events: [{ seq: 1, kind: 'mail-sent', label: 'to bob@evil.com' }] }, { ...SANDBOX, events: [{ seq: -1, kind: 'x', label: 'y' }] },
    { ...SANDBOX, events: [{ seq: 1, kind: 'x', label: 'y', count: 1.5 }] }, { ...SANDBOX, receipt: { ...RECEIPT, egress: 'open' } },
    { ...SANDBOX, receipt: { ...RECEIPT, dataset: 'real' } }, { ...SANDBOX, receipt: { ...RECEIPT, teardownConfirmed: 'yes' } },
    { ...SANDBOX, receipt: { ...RECEIPT, startedAt: 'yesterday' } },
  ];
  for (const sandbox of bad) assert.deepEqual(M.validate(withSandbox(sandbox)), { ok: false, error: 'sandbox' }, JSON.stringify(sandbox).slice(0, 120));
});

test('a sandbox patch merges, replaces events, and null clears the run', () => {
  const first = M.createWorld(seed, { sandbox: SANDBOX });
  const next = M.createWorld(first, { sandbox: { status: 'done', events: [...SANDBOX.events, { seq: 3, kind: 'summary', label: 'Done' }], receipt: RECEIPT } });
  assert.equal(next.sandbox.status, 'done');
  assert.equal(next.sandbox.events.length, 3);
  assert.deepEqual(next.sandbox.receipt, RECEIPT);
  const cleared = M.createWorld(next, { sandbox: null });
  assert.equal(cleared.sandbox ?? null, null);
  assert.throws(() => M.createWorld(seed, { sandbox: { status: 'running' } }), /Invalid world: sandbox/);
});

test('uninstalling an app drops it from focusApps and the creature target', () => {
  const world = M.createWorld(seed, { scene: { focusApps: ['mail', 'browser'], creature: { ...CREATURE, state: 'approach', targetApp: 'mail' } } });
  world.phase = 'desktop';
  const result = M.applyIntent(world, { kind: 'uninstall', app: 'mail' }, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.world.scene.focusApps, ['browser']);
  assert.equal(result.world.scene.creature.targetApp, null);
});
