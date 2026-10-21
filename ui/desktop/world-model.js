// Parent-owned desktop world (WORLD-CONTRACT v3). DOM-free: no timers and no randomness; the clock is injected.
//   createWorld(seed, profilePatch)        -> World          (seed + deep-merge overlay, installed filtering, validated)
//   validate(world)                        -> { ok, error }
//   applyIntent(world, intent, now)        -> { ok, changed, world, reason, forward }
//   parseIntent(value) / parseIntentMessage(message)
//   mergeProfile(seed, patch)              -> merged plain JSON (objects merge, arrays replace, null removes an object)
// Both shells (macOS, Windows) render the same world and report gestures as intents; the parent applies them here.
// ESM apps import ./world-model.mjs, which re-exports this file.
(() => {
  'use strict';

  const CANONICAL_APPS = Object.freeze([
    'files', 'browser', 'mail', 'messages', 'mfa', 'updates', 'settings', 'terminal', 'notes', 'texteditor',
    'calendar', 'reminders', 'contacts', 'photos', 'media', 'calculator', 'clock', 'store', 'taskmanager',
    'stickies', 'whiteboard',
  ]);
  // Native or historical ids of apps culled in PARITY.md. They never enter a world, even as an intent value.
  const CULLED_APPS = Object.freeze([
    'photobooth', 'facetime', 'voicememos', 'camera', 'voicerecorder', 'phone', 'yourphone', 'weather', 'maps',
    'dictionary', 'podcasts', 'tv', 'news', 'home', 'chess', 'games', 'movies', 'xbox', 'diskutility', 'siri',
    'cortana', 'copilot', 'screenshot', 'snipping', 'spotify', 'discord', 'github', 'vscode', 'getstarted',
    'buymeacoffee', 'twitter', 'pinterest', 'skype', 'yammer', 'office',
  ]);
  // Scene presentation fields (SCENARIOS-60-CONTRACT §3, §4): creature states, depths and the fixed attack kinds.
  const CREATURE_STATES = Object.freeze(['idle', 'notice', 'approach', 'circle', 'press', 'breakthrough']);
  const SCENE_DEPTHS = Object.freeze(['sunlight', 'twilight', 'midnight', 'abyss', 'trench']);
  const ATTACK_KINDS = Object.freeze([
    'scareware', 'credential-phish', 'mfa-fatigue', 'oauth-consent', 'mass-mail-worm', 'macro-dropper', 'ransomware-encrypt',
    'data-exfil', 'money-transfer', 'wallet-drain', 'supply-chain-update', 'network-worm', 'botnet-ddos', 'account-takeover-post',
    'sim-swap', 'spyware-surveillance', 'server-exploit-leak',
  ]);
  const SANDBOX_MODES = Object.freeze(['docker', 'vultr', 'simulated']);
  const SANDBOX_STATUSES = Object.freeze(['idle', 'provisioning', 'running', 'done', 'destroyed', 'failed']);
  const SANDBOX_MAX_EVENTS = 64;
  const WORLD_MAX_BYTES = 256 * 1024;
  const WORK = Object.freeze({ w: 1000, h: 600 });
  const MIN_SIZE = Object.freeze({ w: 200, h: 120 });
  const PHASES = Object.freeze(['boot', 'lock', 'desktop', 'sleep', 'off']);
  // Allowed shell-requested phase changes. lock -> desktop is the fixed training sign-in (no password).
  const PHASE_MOVES = Object.freeze({
    boot: ['lock'], lock: ['desktop', 'sleep', 'off'], desktop: ['lock', 'sleep', 'off'], sleep: ['lock'], off: ['boot'],
  });
  const ACCENTS = Object.freeze(['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']);
  const WALLPAPERS = Object.freeze(['depth-sunlight', 'depth-twilight', 'depth-midnight', 'depth-abyss', 'depth-trench', 'stock']);
  const MODES = Object.freeze(['normal', 'minimized', 'maximized', 'fullscreen']);
  const TILES = Object.freeze(['left', 'right', 'top', 'bottom', 'tl', 'tr', 'bl', 'br']);
  const OVERLAYS = Object.freeze(['launcher', 'search', 'quick', 'centre', 'taskView', 'switcher']);
  const FIXED_FOLDERS = Object.freeze(['root', 'home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'trash']);
  const NODE_KINDS = Object.freeze(['folder', 'file', 'app']);
  const FS_OPS = Object.freeze(['mkdir', 'touch', 'rename', 'move', 'trash', 'restore', 'empty-trash', 'write', 'set-desktop-pos']);
  const MULTI_WINDOW_APPS = Object.freeze(['files', 'texteditor', 'stickies']);
  // Apps a profile may never remove: the desktop needs a file manager and a settings app.
  const CORE_APPS = Object.freeze(['files', 'settings']);
  // Synced app stores (SYNC-AUDIT.md §4): optional, absent means empty.
  const SYNCED_DATA = Object.freeze(['browser', 'media', 'photos', 'whiteboard', 'calculator', 'clock', 'terminal', 'stickies']);
  const OPTIONAL_DATA = Object.freeze(['alarms', 'updates', 'mfa', 'processes', 'startup', 'screenshots', 'web', ...SYNCED_DATA]);
  const UPDATE_STATUSES = Object.freeze(['available', 'installed']);
  const WINDOW_ID_INTENTS = Object.freeze(['close-window', 'focus-window', 'minimize', 'restore', 'maximize', 'fullscreen']);
  const DATA_OPS = Object.freeze({
    mail: ['mark-read', 'flag', 'move', 'save-draft'],
    messages: ['append', 'pin'],
    notes: ['upsert', 'delete'],
    calendar: ['upsert', 'delete'],
    reminders: ['toggle', 'upsert', 'delete'],
    contacts: ['upsert', 'delete'],
    alarms: ['upsert', 'delete'],
    updates: ['upsert', 'delete'],
    mfa: ['delete'],
    browser: ['set-tabs', 'visit', 'history-delete', 'clear-history', 'bookmark-upsert', 'bookmark-delete'],
    media: ['set-playback', 'set-mode', 'track-upsert', 'playlist-upsert', 'playlist-delete'],
    photos: ['photo-upsert', 'photo-delete', 'album-upsert', 'album-delete'],
    whiteboard: ['board-upsert', 'board-delete', 'set-active'],
    calculator: ['set', 'record', 'clear-history'],
    clock: ['city-upsert', 'city-delete', 'set-timer', 'set-stopwatch'],
    terminal: ['cd', 'record', 'clear-history'],
    stickies: ['upsert', 'delete'],
  });
  const ID_RE = /^[a-z0-9-]{1,40}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
  const SCENE_URL_RE = /^scene:[a-z0-9-]{1,40}$/;
  const WEB_URL_RE = /^(https?:\/\/)?[a-z0-9.-]+\.(example|invalid)(\/[^\s]{0,160})?$/i;
  // Same-origin path or inline image only: the shells run with connect-src 'self' and no external hosts.
  const WALLPAPER_URL_RE = /^(\/(?!\/)[A-Za-z0-9._~\/-]{1,200}|data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+\/=]{1,180000})$/;
  const EMAIL_DOMAIN_RE = /@([A-Za-z0-9.-]+)/g;
  const MAX_TEXT = 16384;
  const MAX_NODES = 600;
  const MAX_WINDOWS = 24;
  const MAX_BANNERS = 8;
  const MAX_HISTORY = 120;
  const MAX_ITEMS = 400;
  const MAX_COUNTER = 2 ** 31;
  const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const DEFAULT_RECTS = Object.freeze({
    files: [110, 60, 720, 440], browser: [120, 40, 780, 500], mail: [80, 40, 820, 500], messages: [180, 70, 640, 440],
    mfa: [350, 130, 300, 340], updates: [190, 80, 620, 420], settings: [170, 50, 660, 480], terminal: [200, 110, 600, 380],
    notes: [150, 60, 700, 440], texteditor: [210, 70, 580, 420], calendar: [120, 50, 760, 480], reminders: [200, 70, 600, 420],
    contacts: [220, 70, 560, 420], photos: [130, 50, 740, 480], media: [150, 60, 700, 460], calculator: [400, 120, 240, 360],
    clock: [260, 90, 480, 380], store: [120, 40, 780, 500], taskmanager: [180, 70, 640, 420], stickies: [640, 60, 240, 220],
    whiteboard: [110, 40, 780, 500],
  });
  // Neutral display names; each shell may show its native name instead.
  const APP_NAMES = Object.freeze({
    files: 'Files', browser: 'Browser', mail: 'Mail', messages: 'Messages', mfa: 'Authenticator', updates: 'Software Update',
    settings: 'Settings', terminal: 'Terminal', notes: 'Notes', texteditor: 'Text Editor', calendar: 'Calendar', reminders: 'Reminders',
    contacts: 'Contacts', photos: 'Photos', media: 'Media', calculator: 'Calculator', clock: 'Clock', store: 'App Store',
    taskmanager: 'Task Manager', stickies: 'Stickies', whiteboard: 'Whiteboard',
  });
  const TILE_RECTS = Object.freeze({
    left: [0, 0, 500, 600], right: [500, 0, 500, 600], top: [0, 0, 1000, 300], bottom: [0, 300, 1000, 300],
    tl: [0, 0, 500, 300], tr: [500, 0, 500, 300], bl: [0, 300, 500, 300], br: [500, 300, 500, 300],
  });

  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasExactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
  // Exact required keys plus a fixed set of optional ones.
  const hasKeys = (value, required, optional = []) => isRecord(value) &&
    required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  const clone = value => JSON.parse(JSON.stringify(value));
  const isId = value => typeof value === 'string' && ID_RE.test(value);
  const isText = (value, max = 200) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const isLine = (value, max = 200) => isText(value, max) && !/[\r\n]/.test(value);
  const isTime = value => typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
  const isAlarmTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const isBool = value => typeof value === 'boolean';
  const isIntIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const nullable = (value, test) => value === null || test(value);
  const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const isCounter = value => isIntIn(value, 0, MAX_COUNTER);
  // Every address-like token must use a reserved fictional domain.
  const fictionalAddresses = text => [...String(text).matchAll(EMAIL_DOMAIN_RE)].every(match => /\.(example|invalid)$/i.test(match[1]));
  const isFileName = value => isLine(value, 120) && value.trim().length > 0 && !/[\/\\]/.test(value) && value !== '.' && value !== '..';
  const toRect = ([x, y, w, h]) => ({ x, y, w, h });

  // ---- world shape --------------------------------------------------------------------------------------

  function rectProblem(rect) {
    return hasExactKeys(rect, ['x', 'y', 'w', 'h']) && Object.values(rect).every(Number.isInteger) &&
      rect.w >= MIN_SIZE.w && rect.w <= WORK.w && rect.h >= MIN_SIZE.h && rect.h <= WORK.h &&
      rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= WORK.w && rect.y + rect.h <= WORK.h ? null : 'rect';
  }

  function payloadOk(payload) {
    if (payload === null) return true;
    if (hasExactKeys(payload, ['folderId'])) return isId(payload.folderId);
    if (hasExactKeys(payload, ['fileId'])) return isId(payload.fileId);
    if (hasExactKeys(payload, ['messageId'])) return isId(payload.messageId);
    if (hasExactKeys(payload, ['url'])) return typeof payload.url === 'string' && SCENE_URL_RE.test(payload.url);
    return false;
  }

  const SYS_CHECKS = Object.freeze({
    theme: value => value === 'light' || value === 'dark',
    accent: value => ACCENTS.includes(value),
    wallpaper: value => WALLPAPERS.includes(value),
    wallpaperUrl: value => value === null || (typeof value === 'string' && WALLPAPER_URL_RE.test(value) && !value.includes('..')),
    volume: value => isIntIn(value, 0, 100),
    muted: isBool,
    brightness: value => isIntIn(value, 20, 100),
    nightLight: isBool, wifi: isBool, bluetooth: isBool, focus: isBool, lowPower: isBool,
    battery: value => isIntIn(value, 0, 100),
    reduceMotion: isBool, reduceTransparency: isBool,
    // Optional settings synced from macOS (SYNC-AUDIT.md §2).
    dockAutohide: isBool, showBatteryPercent: isBool, increaseContrast: isBool,
    wifiNetwork: value => isLine(value, 40) && value.trim() !== '',
    locationServices: isBool, shareAnalytics: isBool, personalizedAds: isBool,
  });
  const SYS_OPTIONAL = Object.freeze(['wallpaperUrl', 'dockAutohide', 'showBatteryPercent', 'increaseContrast', 'wifiNetwork',
    'locationServices', 'shareAnalytics', 'personalizedAds']);
  const SYS_REQUIRED = Object.keys(SYS_CHECKS).filter(key => !SYS_OPTIONAL.includes(key));

  function sysProblem(sys) {
    if (!hasKeys(sys, SYS_REQUIRED, SYS_OPTIONAL)) return 'sys';
    return Object.entries(sys).every(([key, value]) => SYS_CHECKS[key](value)) ? null : 'sys';
  }

  function nodeProblem(node, id, nodes, installed) {
    if (!hasKeys(node, ['id', 'parentId', 'name', 'kind', 'mime', 'size', 'modified', 'trashed'], ['appId', 'contentId', 'desktopPos', 'encrypted'])) return 'fs-node';
    if (Object.hasOwn(node, 'encrypted') && !(isBool(node.encrypted) && node.kind === 'file')) return 'fs-node';
    if (node.id !== id || !isId(id) || !NODE_KINDS.includes(node.kind) || !isBool(node.trashed) || !isTime(node.modified) ||
        !isIntIn(node.size, 0, 1e9) || !nullable(node.mime, value => isLine(value, 80))) return 'fs-node';
    if (id === 'root' ? node.parentId !== null || node.name !== '' : !isFileName(node.name) || !isId(node.parentId) || !nodes[node.parentId]) return 'fs-node';
    if (node.parentId !== null && nodes[node.parentId].kind !== 'folder') return 'fs-parent';
    if (node.kind === 'app' ? !installed.includes(node.appId) : Object.hasOwn(node, 'appId')) return 'fs-app';
    if (Object.hasOwn(node, 'contentId') && (node.kind !== 'file' || !isId(node.contentId))) return 'fs-content';
    if (Object.hasOwn(node, 'desktopPos') && !(hasExactKeys(node.desktopPos, ['x', 'y']) &&
        isIntIn(node.desktopPos.x, 0, WORK.w) && isIntIn(node.desktopPos.y, 0, WORK.h))) return 'fs-pos';
    return null;
  }

  function fsProblem(fs, installed) {
    if (!hasExactKeys(fs, ['nodes']) || !isRecord(fs.nodes)) return 'fs';
    const { nodes } = fs;
    const ids = Object.keys(nodes);
    if (ids.length > MAX_NODES || !FIXED_FOLDERS.every(id => nodes[id]?.kind === 'folder')) return 'fs-fixed';
    for (const id of ids) {
      const problem = nodeProblem(nodes[id], id, nodes, installed);
      if (problem) return problem;
    }
    // Every chain must reach root without a cycle.
    for (const id of ids) {
      let current = nodes[id];
      for (let steps = 0; current.parentId !== null; steps += 1) {
        if (steps > ids.length) return 'fs-cycle';
        current = nodes[current.parentId];
      }
      if (current.id !== 'root') return 'fs-cycle';
    }
    return null;
  }

  const notificationOk = (item, installed) => hasKeys(item, ['id', 'app', 'title', 'body', 'time'], ['ref']) &&
    isId(item.id) && installed.includes(item.app) && isLine(item.title, 120) && isText(item.body, 600) &&
    isTime(item.time) && (!Object.hasOwn(item, 'ref') || isId(item.ref));

  const uniqueIds = list => new Set(list.map(item => item.id)).size === list.length;
  const listOk = (list, test) => Array.isArray(list) && list.length <= MAX_ITEMS && list.every(test) && uniqueIds(list);

  const mailOk = (message, folders) => hasKeys(message, ['id', 'folder', 'from', 'to', 'subject', 'body', 'time', 'read', 'flagged', 'attachments'], ['link']) &&
    isId(message.id) && folders.includes(message.folder) && isLine(message.from, 200) && isLine(message.to, 400) &&
    fictionalAddresses(message.from) && fictionalAddresses(message.to) && isLine(message.subject, 200) && isText(message.body, 4000) &&
    fictionalAddresses(message.body) && isTime(message.time) && isBool(message.read) && isBool(message.flagged) &&
    Array.isArray(message.attachments) && message.attachments.length <= 8 && message.attachments.every(isId) &&
    (!Object.hasOwn(message, 'link') || (typeof message.link === 'string' && SCENE_URL_RE.test(message.link)));
  const threadItemOk = item => hasExactKeys(item, ['id', 'from', 'text', 'time']) && isId(item.id) && isLine(item.from, 80) &&
    isText(item.text, 2000) && fictionalAddresses(item.text) && isTime(item.time);
  const optional = (item, key, test) => !Object.hasOwn(item, key) || test(item[key]);
  const isNotes = value => isText(value, 2000) && fictionalAddresses(value);
  const threadOk = thread => hasKeys(thread, ['id', 'with', 'items'], ['pinned']) && isId(thread.id) && isLine(thread.with, 80) &&
    listOk(thread.items, threadItemOk) && optional(thread, 'pinned', isBool);
  const noteOk = note => hasExactKeys(note, ['id', 'folder', 'title', 'body', 'modified', 'pinned']) && isId(note.id) && isId(note.folder) &&
    isLine(note.title, 120) && isText(note.body, MAX_TEXT) && isTime(note.modified) && isBool(note.pinned);
  const eventOk = event => hasKeys(event, ['id', 'title', 'start', 'end', 'location'], ['invite', 'allDay', 'notes']) && isId(event.id) && isLine(event.title, 120) &&
    isTime(event.start) && isTime(event.end) && Date.parse(event.end) >= Date.parse(event.start) && isLine(event.location, 120) &&
    (!Object.hasOwn(event, 'invite') || (isLine(event.invite, 200) && fictionalAddresses(event.invite))) &&
    optional(event, 'allDay', isBool) && optional(event, 'notes', isNotes);
  const reminderOk = item => hasKeys(item, ['id', 'list', 'title', 'due', 'done'], ['flagged', 'priority', 'notes']) && isId(item.id) && isId(item.list) &&
    isLine(item.title, 160) && nullable(item.due, isTime) && isBool(item.done) && optional(item, 'flagged', isBool) &&
    optional(item, 'priority', value => isIntIn(value, 0, 3)) && optional(item, 'notes', isNotes);
  const contactOk = item => hasKeys(item, ['id', 'name', 'email', 'phone', 'org'], ['favorite']) && isId(item.id) && isLine(item.name, 80) &&
    isLine(item.email, 120) && /^[^@\s]+@[A-Za-z0-9.-]+\.(example|invalid)$/i.test(item.email) && isLine(item.phone, 40) && isLine(item.org, 80) &&
    optional(item, 'favorite', isBool);
  const contentOk = item => (hasExactKeys(item, ['text']) && isText(item.text, MAX_TEXT)) || (hasExactKeys(item, ['asset']) && isId(item.asset));
  // Shapes agreed with the Windows apps (requests/win-apps-to-mac.md). Choice ids are format-checked here; the
  // CONTRACT-V2 scene model decides whether a forwarded choice applies to the current step.
  const alarmOk = item => hasExactKeys(item, ['id', 'time', 'label', 'enabled']) && isId(item.id) && isAlarmTime(item.time) &&
    isLine(item.label, 60) && isBool(item.enabled);
  const updateOk = item => hasKeys(item, ['id', 'title', 'kb', 'size', 'status'], ['choiceId']) && isId(item.id) && isLine(item.title, 160) &&
    isLine(item.kb, 20) && isLine(item.size, 20) && UPDATE_STATUSES.includes(item.status) && (!Object.hasOwn(item, 'choiceId') || isId(item.choiceId));
  const mfaAccountOk = item => hasExactKeys(item, ['id', 'issuer', 'label']) && isId(item.id) && isLine(item.issuer, 80) &&
    isLine(item.label, 120) && fictionalAddresses(item.label);
  const mfaPromptOk = item => hasExactKeys(item, ['id', 'app', 'account', 'location', 'device', 'time', 'number']) && isId(item.id) &&
    isLine(item.app, 80) && isLine(item.account, 120) && fictionalAddresses(item.account) && isLine(item.location, 120) &&
    isLine(item.device, 80) && isTime(item.time) && nullable(item.number, value => isIntIn(value, 0, 999));
  const processOk = item => hasKeys(item, ['id', 'name'], ['cpu', 'mem', 'publisher', 'suspicious', 'endChoice']) && isId(item.id) &&
    isLine(item.name, 80) && (!Object.hasOwn(item, 'cpu') || (typeof item.cpu === 'number' && item.cpu >= 0 && item.cpu <= 100)) &&
    (!Object.hasOwn(item, 'mem') || (typeof item.mem === 'number' && item.mem >= 0 && item.mem <= 1e6)) &&
    (!Object.hasOwn(item, 'publisher') || isLine(item.publisher, 80)) && (!Object.hasOwn(item, 'suspicious') || isBool(item.suspicious)) &&
    (!Object.hasOwn(item, 'endChoice') || isId(item.endChoice));
  // Items the sandbox replay shows (SPEC §9.1): a startup or login item, and a screenshot the program drew under Wine.
  const startupOk = item => hasExactKeys(item, ['id', 'name', 'command']) && isId(item.id) && isLine(item.name, 80) && isLine(item.command, 200);
  const screenshotOk = item => hasExactKeys(item, ['id', 'caption', 'image']) && isId(item.id) && isLine(item.caption, 160) &&
    typeof item.image === 'string' && WALLPAPER_URL_RE.test(item.image) && !item.image.includes('..');
  const webChoiceOk = choice => hasKeys(choice, ['label', 'choiceId'], ['style']) && isLine(choice.label, 60) && isId(choice.choiceId) &&
    (!Object.hasOwn(choice, 'style') || choice.style === 'primary' || choice.style === 'secondary');
  const pageOk = page => hasKeys(page, ['title', 'url', 'body', 'choices'], ['brand', 'heading', 'insecure']) && isLine(page.title, 120) &&
    typeof page.url === 'string' && WEB_URL_RE.test(page.url) && isText(page.body, 4000) && fictionalAddresses(page.body) &&
    (!Object.hasOwn(page, 'brand') || isLine(page.brand, 60)) && (!Object.hasOwn(page, 'heading') || isLine(page.heading, 160)) &&
    (!Object.hasOwn(page, 'insecure') || isBool(page.insecure)) && Array.isArray(page.choices) && page.choices.length <= 6 && page.choices.every(webChoiceOk);
  const favoriteOk = item => hasExactKeys(item, ['title', 'url']) && isLine(item.title, 80) && SCENE_URL_RE.test(item.url);

  // ---- synced app stores (SYNC-AUDIT.md §4) ----
  const capped = (list, max, test) => Array.isArray(list) && list.length <= max && list.every(test) && uniqueIds(list);
  const idsIn = (ids, max, known) => Array.isArray(ids) && ids.length <= max && ids.every(id => isId(id) && (!known || known.has(id)));
  const isNum = (value, limit) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
  const isSceneUrl = value => typeof value === 'string' && SCENE_URL_RE.test(value);
  // The browser stores no typed address: anything that is not a scene page is 'unavailable:'.
  const isBrowserUrl = value => ['start:', 'history:', 'unavailable:'].includes(value) || isSceneUrl(value);
  const tabOk = tab => hasExactKeys(tab, ['id', 'url', 'title']) && isId(tab.id) && isBrowserUrl(tab.url) && isLine(tab.title, 120);
  const tabsOk = (tabs, activeTabId) => capped(tabs, 16, tabOk) &&
    (activeTabId === null ? tabs.length === 0 : tabs.some(tab => tab.id === activeTabId));
  const bookmarkOk = item => hasExactKeys(item, ['id', 'title', 'url']) && isId(item.id) && isLine(item.title, 80) && isSceneUrl(item.url);
  const visitOk = item => hasExactKeys(item, ['id', 'url', 'title', 'time']) && isId(item.id) && isSceneUrl(item.url) && isLine(item.title, 120) && isTime(item.time);
  const browserOk = value => hasExactKeys(value, ['tabs', 'activeTabId', 'bookmarks', 'history']) && tabsOk(value.tabs, value.activeTabId) &&
    capped(value.bookmarks, 50, bookmarkOk) && capped(value.history, 100, visitOk) && new Set(value.history.map(item => item.url)).size === value.history.length;

  const REPEATS = Object.freeze(['off', 'all', 'one']);
  const trackOk = item => hasKeys(item, ['id', 'title', 'artist', 'album', 'genre', 'asset', 'duration', 'loved'], ['cover']) && isId(item.id) &&
    isLine(item.title, 120) && isLine(item.artist, 80) && isLine(item.album, 120) && isLine(item.genre, 40) && isId(item.asset) &&
    optional(item, 'cover', isId) && isIntIn(item.duration, 0, 86400) && isBool(item.loved);
  const playlistShapeOk = item => hasExactKeys(item, ['id', 'name', 'trackIds']) && isId(item.id) && isLine(item.name, 80) && idsIn(item.trackIds, 200);
  const playbackShapeOk = item => isId(item.trackId) && idsIn(item.queue, 200) && item.queue.includes(item.trackId) &&
    isNum(item.positionSec, 86400) && item.positionSec >= 0 && isBool(item.playing);
  function mediaOk(value) {
    if (!hasExactKeys(value, ['tracks', 'playlists', 'shuffle', 'repeat', 'nowPlaying']) || !capped(value.tracks, 200, trackOk) ||
        !isBool(value.shuffle) || !REPEATS.includes(value.repeat)) return false;
    const tracks = new Set(value.tracks.map(item => item.id));
    const playing = value.nowPlaying;
    return capped(value.playlists, 50, item => playlistShapeOk(item) && idsIn(item.trackIds, 200, tracks)) &&
      (playing === null || (hasExactKeys(playing, ['trackId', 'queue', 'positionSec', 'playing', 'at']) && playbackShapeOk(playing) &&
        idsIn(playing.queue, 200, tracks) && isTime(playing.at)));
  }

  const photoOk = item => hasExactKeys(item, ['id', 'name', 'asset', 'taken', 'favorite', 'trashed']) && isId(item.id) && isFileName(item.name) &&
    isId(item.asset) && isTime(item.taken) && isBool(item.favorite) && isBool(item.trashed);
  const albumShapeOk = item => hasExactKeys(item, ['id', 'name', 'photoIds']) && isId(item.id) && isLine(item.name, 80) &&
    idsIn(item.photoIds, MAX_ITEMS) && new Set(item.photoIds).size === item.photoIds.length;
  function photosOk(value) {
    if (!hasExactKeys(value, ['items', 'albums']) || !capped(value.items, MAX_ITEMS, photoOk)) return false;
    const items = new Set(value.items.map(item => item.id));
    return capped(value.albums, 50, item => albumShapeOk(item) && idsIn(item.photoIds, MAX_ITEMS, items));
  }

  const BOARD_TYPES = Object.freeze(['text', 'sticky', 'shape', 'pen']);
  const BOARD_SHAPES = Object.freeze(['rect', 'ellipse', 'arrow']);
  const COLOR_RE = /^(#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?|[a-z]{3,12})$/;
  const isCoord = value => isNum(value, 100000);
  const boardItemOk = item => hasKeys(item, ['id', 'type', 'x', 'y', 'w', 'h'], ['text', 'color', 'shape', 'points', 'width']) && isId(item.id) &&
    BOARD_TYPES.includes(item.type) && ['x', 'y', 'w', 'h'].every(key => isCoord(item[key])) && item.w >= 0 && item.h >= 0 &&
    optional(item, 'text', value => item.type !== 'pen' && isText(value, 2000) && fictionalAddresses(value)) &&
    optional(item, 'color', value => typeof value === 'string' && COLOR_RE.test(value)) &&
    (item.type === 'shape' ? BOARD_SHAPES.includes(item.shape) : !Object.hasOwn(item, 'shape')) &&
    (item.type === 'pen' ? Array.isArray(item.points) && item.points.length >= 4 && item.points.length <= 2000 && item.points.length % 2 === 0 &&
      item.points.every(isCoord) : !Object.hasOwn(item, 'points')) &&
    (item.type === 'pen' ? optional(item, 'width', value => isNum(value, 40) && value >= 1) : !Object.hasOwn(item, 'width'));
  const boardItemsOk = items => capped(items, 300, boardItemOk);
  const boardOk = board => hasExactKeys(board, ['id', 'name', 'modified', 'items']) && isId(board.id) && isLine(board.name, 80) &&
    isTime(board.modified) && boardItemsOk(board.items);
  const whiteboardOk = value => hasExactKeys(value, ['boards', 'activeId']) && capped(value.boards, 20, boardOk) &&
    nullable(value.activeId, id => value.boards.some(board => board.id === id));

  const CALC_MODES = Object.freeze(['basic', 'scientific', 'programmer']);
  const calcSettingsOk = item => CALC_MODES.includes(item.mode) && (item.angle === 'deg' || item.angle === 'rad') &&
    [2, 8, 10, 16].includes(item.base) && isNum(item.memory, Number.MAX_VALUE);
  const calcLineOk = item => hasExactKeys(item, ['id', 'expr', 'result', 'time']) && isId(item.id) && isLine(item.expr, 200) && isLine(item.result, 80) && isTime(item.time);
  const calculatorOk = value => hasExactKeys(value, ['mode', 'angle', 'base', 'memory', 'history']) && calcSettingsOk(value) && capped(value.history, 100, calcLineOk);

  // 'local' is the device's own zone; anything else must be a time zone the runtime knows.
  const isZone = value => {
    if (value === 'local') return true;
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(value) || value.length > 40) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  };
  const cityOk = item => hasExactKeys(item, ['id', 'name', 'tz']) && isId(item.id) && isLine(item.name, 60) && item.name.trim() !== '' && isZone(item.tz);
  const timerShapeOk = item => hasKeys(item, ['label', 'durationMs', 'remainingMs', 'running'], ['at']) && isLine(item.label, 60) &&
    isIntIn(item.durationMs, 1000, 86400000) && isIntIn(item.remainingMs, 0, item.durationMs) && isBool(item.running);
  const lapsOk = laps => Array.isArray(laps) && laps.length <= 100 && laps.every((lap, index) => isIntIn(lap, 0, 1e11) && (index === 0 || lap >= laps[index - 1]));
  const stopwatchShapeOk = item => isBool(item.running) && isIntIn(item.elapsedMs, 0, 1e11) && lapsOk(item.laps);
  const clockOk = value => hasExactKeys(value, ['worldClocks', 'timer', 'stopwatch']) && capped(value.worldClocks, 24, cityOk) &&
    nullable(value.timer, timer => hasExactKeys(timer, ['label', 'durationMs', 'remainingMs', 'running', 'at']) && timerShapeOk(timer) && isTime(timer.at)) &&
    hasExactKeys(value.stopwatch, ['running', 'elapsedMs', 'at', 'laps']) && stopwatchShapeOk(value.stopwatch) &&
    (value.stopwatch.running ? isTime(value.stopwatch.at) : nullable(value.stopwatch.at, isTime));

  const isCommand = value => isLine(value, 500) && value.trim() !== '' && fictionalAddresses(value);
  const terminalOk = value => hasExactKeys(value, ['cwd', 'history']) && isId(value.cwd) && Array.isArray(value.history) &&
    value.history.length <= 100 && value.history.every(isCommand);

  const STICKY_COLORS = Object.freeze(['yellow', 'pink', 'blue', 'green', 'purple', 'gray']);
  const stickyOk = item => hasExactKeys(item, ['id', 'text', 'color', 'x', 'y', 'w', 'h', 'collapsed']) && isId(item.id) &&
    isText(item.text, 4000) && fictionalAddresses(item.text) && STICKY_COLORS.includes(item.color) && isIntIn(item.x, 0, 2000) &&
    isIntIn(item.y, 0, 2000) && isIntIn(item.w, 60, 2000) && isIntIn(item.h, 60, 2000) && isBool(item.collapsed);

  const SYNCED_CHECKS = Object.freeze({
    browser: browserOk, media: mediaOk, photos: photosOk, whiteboard: whiteboardOk, calculator: calculatorOk, clock: clockOk,
    terminal: terminalOk, stickies: value => capped(value, 50, stickyOk),
  });
  // Empty stores, created on the first intent that writes one.
  const EMPTY_SYNCED = Object.freeze({
    browser: () => ({ tabs: [], activeTabId: null, bookmarks: [], history: [] }),
    media: () => ({ tracks: [], playlists: [], shuffle: false, repeat: 'off', nowPlaying: null }),
    photos: () => ({ items: [], albums: [] }),
    whiteboard: () => ({ boards: [], activeId: null }),
    calculator: () => ({ mode: 'basic', angle: 'deg', base: 10, memory: 0, history: [] }),
    clock: () => ({ worldClocks: [], timer: null, stopwatch: { running: false, elapsedMs: 0, at: null, laps: [] } }),
    terminal: () => ({ cwd: 'home', history: [] }),
    stickies: () => [],
  });

  // Optional stores: absent in older worlds; processes and web are scene-provided and read-only.
  function optionalDataProblem(data) {
    if (Object.hasOwn(data, 'alarms') && !listOk(data.alarms, alarmOk)) return 'data-alarms';
    if (Object.hasOwn(data, 'updates') && !listOk(data.updates, updateOk)) return 'data-updates';
    if (Object.hasOwn(data, 'mfa') && !(hasExactKeys(data.mfa, ['accounts', 'prompts']) && listOk(data.mfa.accounts, mfaAccountOk) &&
        listOk(data.mfa.prompts, mfaPromptOk))) return 'data-mfa';
    if (Object.hasOwn(data, 'processes') && !listOk(data.processes, processOk)) return 'data-processes';
    if (Object.hasOwn(data, 'startup') && !listOk(data.startup, startupOk)) return 'data-startup';
    if (Object.hasOwn(data, 'screenshots') && !(Array.isArray(data.screenshots) && data.screenshots.length <= 8 && listOk(data.screenshots, screenshotOk))) return 'data-screenshots';
    if (Object.hasOwn(data, 'web') && !(hasKeys(data.web, ['pages'], ['favorites', 'homepage']) && isRecord(data.web.pages) &&
        Object.keys(data.web.pages).length <= 64 && Object.entries(data.web.pages).every(([id, page]) => isId(id) && pageOk(page)) &&
        (!Object.hasOwn(data.web, 'favorites') || (Array.isArray(data.web.favorites) && data.web.favorites.length <= 16 && data.web.favorites.every(favoriteOk))) &&
        // The page a new browser tab opens (replay: a hijacked homepage).
        (!Object.hasOwn(data.web, 'homepage') || (isSceneUrl(data.web.homepage) && Object.hasOwn(data.web.pages, data.web.homepage.slice(6)))))) return 'data-web';
    for (const store of SYNCED_DATA) if (Object.hasOwn(data, store) && !SYNCED_CHECKS[store](data[store])) return `data-${store}`;
    return null;
  }

  function dataProblem(data) {
    if (!hasKeys(data, ['mail', 'messages', 'notes', 'calendar', 'reminders', 'contacts', 'contents'], OPTIONAL_DATA)) return 'data';
    const { mail } = data;
    if (!hasExactKeys(mail, ['folders', 'messages']) || !Array.isArray(mail.folders) || mail.folders.length > 24 ||
        !mail.folders.every(isId) || new Set(mail.folders).size !== mail.folders.length ||
        !listOk(mail.messages, message => mailOk(message, mail.folders))) return 'data-mail';
    if (!hasExactKeys(data.messages, ['threads']) || !listOk(data.messages.threads, threadOk)) return 'data-messages';
    if (!listOk(data.notes, noteOk)) return 'data-notes';
    if (!listOk(data.calendar, eventOk)) return 'data-calendar';
    if (!listOk(data.reminders, reminderOk)) return 'data-reminders';
    if (!listOk(data.contacts, contactOk)) return 'data-contacts';
    if (!isRecord(data.contents) || Object.keys(data.contents).length > MAX_NODES ||
        !Object.entries(data.contents).every(([id, item]) => isId(id) && contentOk(item))) return 'data-contents';
    return optionalDataProblem(data);
  }

  // world.scene.creature: the wallpaper sprite and what it is doing. The sprite is a same-origin creature GIF.
  const creatureOk = value => hasExactKeys(value, ['family', 'depth', 'sprite', 'state', 'targetApp']) && isId(value.family) &&
    SCENE_DEPTHS.includes(value.depth) && typeof value.sprite === 'string' &&
    /^\/ocean-creatures\/[a-z-]{1,40}\/(sunlight|twilight|midnight|abyss|trench)\.gif$/.test(value.sprite) &&
    CREATURE_STATES.includes(value.state) && nullable(value.targetApp, app => CANONICAL_APPS.includes(app));
  const introOk = value => hasExactKeys(value, ['title', 'line', 'next']) && isLine(value.title, 160) && isLine(value.line, 600) && isLine(value.next, 400);
  const focusAppsOk = value => Array.isArray(value) && value.length <= CANONICAL_APPS.length && new Set(value).size === value.length &&
    value.every(app => CANONICAL_APPS.includes(app));
  const counterOrNull = value => value === null || isIntIn(value, 0, 1_000_000);
  const sandboxEventOk = item => hasKeys(item, ['seq', 'kind', 'label'], ['count', 'total']) && isIntIn(item.seq, 0, 1_000_000) &&
    isId(item.kind) && isLine(item.label, 120) && fictionalAddresses(item.label) &&
    (!Object.hasOwn(item, 'count') || counterOrNull(item.count)) && (!Object.hasOwn(item, 'total') || counterOrNull(item.total));
  const sandboxReceiptOk = value => hasExactKeys(value, ['provider', 'instance', 'startedAt', 'destroyedAt', 'teardownConfirmed', 'egress', 'dataset']) &&
    isLine(value.provider, 40) && isLine(value.instance, 80) && isTime(value.startedAt) && nullable(value.destroyedAt, isTime) &&
    isBool(value.teardownConfirmed) && value.egress === 'none' && value.dataset === 'synthetic';
  // world.sandbox: the live sandbox run behind the scenario. A merged patch removes `receipt: null` (null deletes an
  // object-valued key), so a missing receipt means null.
  const sandboxOk = value => hasKeys(value, ['runId', 'scenario', 'attackKind', 'mode', 'status', 'events'], ['receipt']) && isId(value.runId) &&
    isId(value.scenario) && ATTACK_KINDS.includes(value.attackKind) && SANDBOX_MODES.includes(value.mode) && SANDBOX_STATUSES.includes(value.status) &&
    Array.isArray(value.events) && value.events.length <= SANDBOX_MAX_EVENTS && value.events.every(sandboxEventOk) &&
    (!Object.hasOwn(value, 'receipt') || nullable(value.receipt, sandboxReceiptOk));

  function appListProblem(list) {
    if (!Array.isArray(list) || new Set(list).size !== list.length) return 'apps';
    if (list.some(app => CULLED_APPS.includes(app))) return 'culled-app';
    return list.every(app => CANONICAL_APPS.includes(app)) ? null : 'unknown-app';
  }

  function worldProblem(world) {
    if (!hasKeys(world, ['v', 'revision', 'phase', 'user', 'sys', 'fs', 'windows', 'order', 'focusedId', 'overlays',
      'notifications', 'dock', 'installed', 'data', 'scene'], ['sandbox'])) return 'shape';
    if (world.v !== 3 || !isCounter(world.revision) || !PHASES.includes(world.phase)) return 'header';
    const { user } = world;
    if (!hasExactKeys(user, ['id', 'name', 'short', 'email', 'avatar']) || !isId(user.id) || !isLine(user.name, 80) ||
        !/^[a-z][a-z0-9._-]{0,31}$/.test(user.short) || !/^[^@\s]+@[A-Za-z0-9.-]+\.(example|invalid)$/i.test(user.email) ||
        !(user.avatar === 'initials' || isId(user.avatar))) return 'user';
    const sys = sysProblem(world.sys);
    if (sys) return sys;
    const installed = appListProblem(world.installed);
    if (installed) return installed;
    const fs = fsProblem(world.fs, world.installed);
    if (fs) return fs;
    if (!Array.isArray(world.windows) || world.windows.length > MAX_WINDOWS) return 'windows';
    const ids = [];
    for (const win of world.windows) {
      if (!hasExactKeys(win, ['id', 'app', 'title', 'rect', 'mode', 'tile', 'payload']) || !isId(win.id) || ids.includes(win.id) ||
          !world.installed.includes(win.app) || !isLine(win.title, 120) || rectProblem(win.rect) || !MODES.includes(win.mode) ||
          !nullable(win.tile, tile => TILES.includes(tile)) || !payloadOk(win.payload)) return 'window';
      ids.push(win.id);
    }
    if (!Array.isArray(world.order) || world.order.length !== ids.length || new Set(world.order).size !== ids.length ||
        !world.order.every(id => ids.includes(id))) return 'order';
    if (!nullable(world.focusedId, id => world.windows.some(win => win.id === id && win.mode !== 'minimized'))) return 'focus';
    if (!hasExactKeys(world.overlays, OVERLAYS) || !Object.values(world.overlays).every(isBool)) return 'overlays';
    const { notifications } = world;
    if (!hasExactKeys(notifications, ['banners', 'history']) || !Array.isArray(notifications.banners) || !Array.isArray(notifications.history) ||
        notifications.banners.length > MAX_BANNERS || notifications.history.length > MAX_HISTORY ||
        ![...notifications.banners, ...notifications.history].every(item => notificationOk(item, world.installed)) ||
        !uniqueIds(notifications.banners) || !uniqueIds(notifications.history)) return 'notifications';
    const { dock } = world;
    if (!hasExactKeys(dock, ['pins', 'badges']) || appListProblem(dock.pins) || !dock.pins.every(app => world.installed.includes(app)) ||
        !isRecord(dock.badges) || !Object.entries(dock.badges).every(([app, count]) => world.installed.includes(app) && isIntIn(count, 1, 999))) return 'dock';
    const data = dataProblem(world.data);
    if (data) return data;
    if (world.data.terminal && world.fs.nodes[world.data.terminal.cwd]?.kind !== 'folder') return 'data-terminal';
    const { scene } = world;
    if (!hasKeys(scene, ['phase', 'stepId', 'highlight'], ['focusApps', 'creature', 'intro']) || !isId(scene.phase) || !nullable(scene.stepId, isId) ||
        !nullable(scene.highlight, value => hasExactKeys(value, ['app', 'ref']) && CANONICAL_APPS.includes(value.app) && nullable(value.ref, isId))) return 'scene';
    if (Object.hasOwn(scene, 'focusApps') && !focusAppsOk(scene.focusApps)) return 'scene-focus-apps';
    if (Object.hasOwn(scene, 'creature') && !nullable(scene.creature, creatureOk)) return 'scene-creature';
    if (Object.hasOwn(scene, 'intro') && !nullable(scene.intro, introOk)) return 'scene-intro';
    if (Object.hasOwn(world, 'sandbox') && !nullable(world.sandbox, sandboxOk)) return 'sandbox';
    return byteSize(world) <= WORLD_MAX_BYTES ? null : 'size';
  }

  function validate(world) {
    const problem = worldProblem(world);
    return problem ? { ok: false, error: problem } : { ok: true, error: null };
  }

  // ---- profile overlay ----------------------------------------------------------------------------------

  // Deep merge for plain JSON: objects merge key by key, arrays and scalars replace. null removes a key whose base value
  // is an object (such as an fs node or a content entry); otherwise it is stored as null (such as a folder's mime).
  function mergeProfile(seed, patch) {
    if (patch === undefined || patch === null) return clone(seed);
    if (!isRecord(patch)) throw new TypeError('The profile patch must be an object.');
    const merge = (base, overlay, depth) => {
      if (depth > 12) throw new TypeError('The profile patch is nested too deeply.');
      const out = isRecord(base) ? clone(base) : {};
      for (const [key, value] of Object.entries(overlay)) {
        if (UNSAFE_KEYS.has(key)) throw new TypeError(`The profile patch uses a forbidden key: ${key}`);
        if (value === null && isRecord(out[key])) delete out[key];
        else if (isRecord(value)) out[key] = merge(out[key], value, depth + 1);
        else out[key] = value === null ? null : clone(value);
      }
      return out;
    };
    return merge(seed, patch, 0);
  }

  // Drops everything that refers to an app outside `installed`: pins, badges, windows, notifications, app nodes.
  function filterInstalled(world) {
    const has = app => world.installed.includes(app);
    world.dock.pins = world.dock.pins.filter(has);
    world.dock.badges = Object.fromEntries(Object.entries(world.dock.badges).filter(([app]) => has(app)));
    world.windows = world.windows.filter(win => has(win.app));
    const ids = world.windows.map(win => win.id);
    world.order = world.order.filter(id => ids.includes(id));
    if (!ids.includes(world.focusedId)) world.focusedId = topWindowId(world);
    world.notifications.banners = world.notifications.banners.filter(item => has(item.app));
    world.notifications.history = world.notifications.history.filter(item => has(item.app));
    for (const [id, node] of Object.entries(world.fs.nodes)) if (node.kind === 'app' && !has(node.appId)) delete world.fs.nodes[id];
    if (world.scene.highlight && !has(world.scene.highlight.app)) world.scene.highlight = null;
    if (Array.isArray(world.scene.focusApps)) world.scene.focusApps = world.scene.focusApps.filter(has);
    if (world.scene.creature && !has(world.scene.creature.targetApp)) world.scene.creature.targetApp = null;
  }

  function createWorld(seed, profilePatch) {
    const world = mergeProfile(seed, profilePatch);
    if (!isRecord(world)) throw new TypeError('The world seed must be an object.');
    const apps = appListProblem(world.installed);
    if (apps) throw new TypeError(`Invalid world: ${apps}`);
    world.installed = CANONICAL_APPS.filter(app => world.installed.includes(app));
    try {
      filterInstalled(world);
    } catch {
      // A malformed shape is reported by the validation below.
    }
    const problem = worldProblem(world);
    if (problem) throw new TypeError(`Invalid world: ${problem}`);
    return world;
  }

  // ---- intents ------------------------------------------------------------------------------------------

  function parsePatch(patch) {
    if (!isRecord(patch) || Object.keys(patch).length === 0) return null;
    for (const [key, value] of Object.entries(patch)) if (!Object.hasOwn(SYS_CHECKS, key) || !SYS_CHECKS[key](value)) return null;
    return { ...patch };
  }

  const FS_ARGS = Object.freeze({
    mkdir: [['parentId', 'name'], ['id']],
    touch: [['parentId', 'name'], ['id', 'mime', 'text']],
    rename: [['id', 'name'], []],
    move: [['id', 'parentId'], []],
    trash: [['id'], []],
    restore: [['id'], []],
    'empty-trash': [[], []],
    write: [['id', 'text'], []],
    'set-desktop-pos': [['id', 'pos'], []],
  });
  const FS_FIELD_CHECKS = Object.freeze({
    id: isId, parentId: isId, name: isFileName, mime: value => isLine(value, 80), text: value => isText(value, MAX_TEXT),
    pos: value => hasExactKeys(value, ['x', 'y']) && isIntIn(value.x, 0, WORK.w) && isIntIn(value.y, 0, WORK.h),
  });

  const ITEM_SHAPES = Object.freeze({
    'mail:mark-read': [['id', 'read'], { id: isId, read: isBool }],
    'mail:flag': [['id', 'flagged'], { id: isId, flagged: isBool }],
    'mail:move': [['id', 'folder'], { id: isId, folder: isId }],
    'mail:save-draft': [['id', 'to', 'subject', 'body'], {
      id: isId, to: value => isLine(value, 400) && fictionalAddresses(value), subject: value => isLine(value, 200),
      body: value => isText(value, 4000) && fictionalAddresses(value),
    }],
    'messages:append': [['threadId', 'id', 'text'], { threadId: isId, id: isId, text: value => isText(value, 2000) && value.trim() !== '' && fictionalAddresses(value) }],
    'messages:pin': [['threadId', 'pinned'], { threadId: isId, pinned: isBool }],
    'notes:upsert': [['id', 'folder', 'title', 'body', 'pinned'], { id: isId, folder: isId, title: value => isLine(value, 120), body: value => isText(value, MAX_TEXT), pinned: isBool }],
    'calendar:upsert': [['id', 'title', 'start', 'end', 'location'], { id: isId, title: value => isLine(value, 120), start: isTime, end: isTime,
      location: value => isLine(value, 120), allDay: isBool, notes: isNotes }, ['allDay', 'notes']],
    'reminders:toggle': [['id', 'done'], { id: isId, done: isBool }],
    'reminders:upsert': [['id', 'list', 'title', 'due'], { id: isId, list: isId, title: value => isLine(value, 160), due: value => nullable(value, isTime),
      flagged: isBool, priority: value => isIntIn(value, 0, 3), notes: isNotes }, ['flagged', 'priority', 'notes']],
    'contacts:upsert': [['id', 'name', 'email', 'phone', 'org'], {
      id: isId, name: value => isLine(value, 80), email: value => isLine(value, 120) && /^[^@\s]+@[A-Za-z0-9.-]+\.(example|invalid)$/i.test(value),
      phone: value => isLine(value, 40), org: value => isLine(value, 80), favorite: isBool,
    }, ['favorite']],
    'alarms:upsert': [['id', 'time', 'label', 'enabled'], { id: isId, time: isAlarmTime, label: value => isLine(value, 60), enabled: isBool }],
  });
  const shapeOk = (value, [keys, checks, optionalKeys = []]) => hasKeys(value, keys, optionalKeys) &&
    Object.keys(value).every(key => checks[key](value[key]));
  const onlyId = item => hasExactKeys(item, ['id']) && isId(item.id);
  const empty = item => hasExactKeys(item, []);
  // Items of the synced app stores (SYNC-AUDIT.md §5). The parent stamps time, at and modified.
  const SYNCED_ITEMS = Object.freeze({
    'browser:set-tabs': item => hasExactKeys(item, ['tabs', 'activeTabId']) && nullable(item.activeTabId, isId) && tabsOk(item.tabs, item.activeTabId),
    'browser:visit': item => hasExactKeys(item, ['id', 'url', 'title']) && isId(item.id) && isSceneUrl(item.url) && isLine(item.title, 120),
    'browser:history-delete': onlyId,
    'browser:clear-history': empty,
    'browser:bookmark-upsert': bookmarkOk,
    'browser:bookmark-delete': onlyId,
    'media:set-playback': item => hasExactKeys(item, ['trackId', 'queue', 'positionSec', 'playing']) && (item.trackId === null
      ? Array.isArray(item.queue) && item.queue.length === 0 && item.positionSec === 0 && item.playing === false : playbackShapeOk(item)),
    'media:set-mode': item => hasExactKeys(item, ['shuffle', 'repeat']) && isBool(item.shuffle) && REPEATS.includes(item.repeat),
    'media:track-upsert': trackOk,
    'media:playlist-upsert': playlistShapeOk,
    'media:playlist-delete': onlyId,
    'photos:photo-upsert': photoOk,
    'photos:photo-delete': onlyId,
    'photos:album-upsert': albumShapeOk,
    'photos:album-delete': onlyId,
    'whiteboard:board-upsert': item => hasExactKeys(item, ['id', 'name', 'items']) && isId(item.id) && isLine(item.name, 80) && boardItemsOk(item.items),
    'whiteboard:board-delete': onlyId,
    'whiteboard:set-active': item => hasExactKeys(item, ['id']) && nullable(item.id, isId),
    'calculator:set': item => hasExactKeys(item, ['mode', 'angle', 'base', 'memory']) && calcSettingsOk(item),
    'calculator:record': item => hasExactKeys(item, ['id', 'expr', 'result']) && isId(item.id) && isLine(item.expr, 200) && isLine(item.result, 80),
    'calculator:clear-history': empty,
    'clock:city-upsert': cityOk,
    'clock:city-delete': onlyId,
    'clock:set-timer': item => hasExactKeys(item, ['timer']) && nullable(item.timer, timer => hasExactKeys(timer, ['label', 'durationMs', 'remainingMs', 'running']) && timerShapeOk(timer)),
    'clock:set-stopwatch': item => hasExactKeys(item, ['running', 'elapsedMs', 'laps']) && stopwatchShapeOk(item),
    'terminal:cd': item => hasExactKeys(item, ['cwd']) && isId(item.cwd),
    'terminal:record': item => hasExactKeys(item, ['line']) && isCommand(item.line),
    'terminal:clear-history': empty,
    'stickies:upsert': stickyOk,
    'stickies:delete': onlyId,
  });

  // Strict, exact-key intent shapes. Returns a fresh normalised intent, or null.
  function parseIntent(value) {
    if (!isRecord(value) || typeof value.kind !== 'string') return null;
    const { kind } = value;
    const only = (required, optional = []) => hasKeys(value, ['kind', ...required], optional);
    const app = text => typeof text === 'string' && CANONICAL_APPS.includes(text);
    if (kind === 'open-app') {
      if (!only(['app'], ['payload']) || !app(value.app)) return null;
      if (!Object.hasOwn(value, 'payload')) return { kind, app: value.app };
      return value.payload !== null && payloadOk(value.payload) ? { kind, app: value.app, payload: { ...value.payload } } : null;
    }
    if (WINDOW_ID_INTENTS.includes(kind)) return only(['id']) && isId(value.id) ? { kind, id: value.id } : null;
    if (kind === 'set-rect') {
      return only(['id', 'rect']) && isId(value.id) && hasExactKeys(value.rect, ['x', 'y', 'w', 'h']) &&
        Object.values(value.rect).every(number => typeof number === 'number' && Number.isFinite(number))
        ? { kind, id: value.id, rect: { x: value.rect.x, y: value.rect.y, w: value.rect.w, h: value.rect.h } } : null;
    }
    if (kind === 'tile') return only(['id', 'tile']) && isId(value.id) && nullable(value.tile, tile => TILES.includes(tile)) ? { kind, id: value.id, tile: value.tile } : null;
    if (kind === 'set-sys') {
      const patch = only(['patch']) ? parsePatch(value.patch) : null;
      return patch ? { kind, patch } : null;
    }
    if (kind === 'set-phase') return only(['phase']) && PHASES.includes(value.phase) ? { kind, phase: value.phase } : null;
    if (kind === 'toggle-overlay') return only(['name', 'open']) && OVERLAYS.includes(value.name) && isBool(value.open) ? { kind, name: value.name, open: value.open } : null;
    if (kind === 'fs') {
      const args = FS_ARGS[value.op];
      if (!args || !only(['op', ...args[0]], args[1])) return null;
      const fields = Object.keys(value).filter(key => key !== 'kind' && key !== 'op');
      return fields.every(key => FS_FIELD_CHECKS[key](value[key])) ? clone(value) : null;
    }
    if (kind === 'data') {
      const shape = ITEM_SHAPES[`${value.store}:${value.op}`];
      if (!only(['store', 'op', 'item']) || !DATA_OPS[value.store]?.includes(value.op)) return null;
      const synced = SYNCED_ITEMS[`${value.store}:${value.op}`];
      const item = synced ? synced(value.item) : value.op === 'delete' ? onlyId(value.item)
        : value.store === 'updates' ? updateOk(value.item) : shape && shapeOk(value.item, shape);
      return item ? { kind, store: value.store, op: value.op, item: clone(value.item) } : null;
    }
    if (kind === 'notify-dismiss' || kind === 'notify-clear') {
      if (!only([], ['id'])) return null;
      if (!Object.hasOwn(value, 'id')) return { kind };
      return isId(value.id) ? { kind, id: value.id } : null;
    }
    if (kind === 'dock') {
      if (!['pin', 'unpin', 'move'].includes(value.op) || !app(value.app)) return null;
      if (value.op === 'unpin') return only(['op', 'app']) ? { kind, op: value.op, app: value.app } : null;
      const required = value.op === 'move' ? ['op', 'app', 'index'] : ['op', 'app'];
      if (!only(required, ['index']) || (Object.hasOwn(value, 'index') && !isIntIn(value.index, 0, CANONICAL_APPS.length))) return null;
      return Object.hasOwn(value, 'index') ? { kind, op: value.op, app: value.app, index: value.index } : { kind, op: value.op, app: value.app };
    }
    if (kind === 'install' || kind === 'uninstall') return only(['app']) && app(value.app) ? { kind, app: value.app } : null;
    if (kind === 'scene-choice') return only(['choiceId']) && isId(value.choiceId) ? { kind, choiceId: value.choiceId } : null;
    return null;
  }

  // The shell -> parent envelope: { type:'world-intent', version:3, revision, seq, intent }.
  function parseIntentMessage(message) {
    if (!hasExactKeys(message, ['type', 'version', 'revision', 'seq', 'intent']) || message.type !== 'world-intent' ||
        message.version !== 3 || !isCounter(message.revision) || !isCounter(message.seq)) return null;
    const intent = parseIntent(message.intent);
    return intent ? { revision: message.revision, seq: message.seq, intent } : null;
  }

  // Names the specific reason a raw intent was refused, so a culled app is reported as such.
  function rejectReason(raw) {
    if (!isRecord(raw)) return 'invalid-intent';
    const named = [raw.app, raw.name].filter(value => typeof value === 'string');
    return named.some(value => CULLED_APPS.includes(value)) ? 'culled-app' : 'invalid-intent';
  }

  // ---- reducer ------------------------------------------------------------------------------------------

  const reject = (world, reason) => ({ ok: false, changed: false, world, reason, forward: null });
  const noop = (world, forward = null) => ({ ok: true, changed: false, world, reason: null, forward });

  function topWindowId(world) {
    for (let index = world.order.length - 1; index >= 0; index -= 1) {
      const win = world.windows.find(item => item.id === world.order[index]);
      if (win && win.mode !== 'minimized') return win.id;
    }
    return null;
  }

  function focusWindow(world, win) {
    if (win.mode === 'minimized') win.mode = 'normal';
    world.order = [...world.order.filter(id => id !== win.id), win.id];
    world.focusedId = win.id;
  }

  function clampRect(rect) {
    const w = Math.round(Math.min(Math.max(rect.w, MIN_SIZE.w), WORK.w));
    const h = Math.round(Math.min(Math.max(rect.h, MIN_SIZE.h), WORK.h));
    return { x: Math.round(Math.min(Math.max(rect.x, 0), WORK.w - w)), y: Math.round(Math.min(Math.max(rect.y, 0), WORK.h - h)), w, h };
  }

  const nextId = (prefix, taken) => {
    for (let n = 1; ; n += 1) if (!taken(`${prefix}-${n}`)) return `${prefix}-${n}`;
  };

  function windowTitle(world, app, payload) {
    const node = payload?.fileId ? world.fs.nodes[payload.fileId] : payload?.folderId ? world.fs.nodes[payload.folderId] : null;
    if (node) return node.name.slice(0, 120) || 'Files';
    const message = payload?.messageId ? world.data.mail.messages.find(item => item.id === payload.messageId) : null;
    if (message) return message.subject.slice(0, 120) || 'Mail';
    return APP_NAMES[app];
  }

  function payloadProblem(world, payload) {
    if (!payload) return null;
    if (payload.folderId) return world.fs.nodes[payload.folderId]?.kind === 'folder' ? null : 'no-such-folder';
    if (payload.fileId) return world.fs.nodes[payload.fileId]?.kind === 'file' ? null : 'no-such-file';
    if (payload.messageId) return world.data.mail.messages.some(item => item.id === payload.messageId) ? null : 'no-such-message';
    return null;
  }

  function reduceOpenApp(world, intent) {
    if (!world.installed.includes(intent.app)) return 'not-installed';
    const payload = intent.payload ?? null;
    const problem = payloadProblem(world, payload);
    if (problem) return problem;
    const existing = MULTI_WINDOW_APPS.includes(intent.app) && payload
      ? world.windows.find(win => win.app === intent.app && JSON.stringify(win.payload) === JSON.stringify(payload))
      : world.windows.find(win => win.app === intent.app && (!MULTI_WINDOW_APPS.includes(intent.app) || payload === null));
    if (existing) {
      if (payload && !MULTI_WINDOW_APPS.includes(intent.app)) existing.payload = payload;
      focusWindow(world, existing);
      return null;
    }
    if (world.windows.length >= MAX_WINDOWS) return 'too-many-windows';
    const id = nextId(`w-${intent.app}`, candidate => world.windows.some(win => win.id === candidate));
    const offset = (world.windows.length % 6) * 24;
    const win = { id, app: intent.app, title: windowTitle(world, intent.app, payload), rect: clampRect((({ x, y, w, h }) => ({ x: x + offset, y: y + offset, w, h }))(toRect(DEFAULT_RECTS[intent.app]))), mode: 'normal', tile: null, payload };
    world.windows.push(win);
    focusWindow(world, win);
    return null;
  }

  function reduceWindow(world, intent) {
    const win = world.windows.find(item => item.id === intent.id);
    if (!win) return 'no-such-window';
    switch (intent.kind) {
      case 'close-window':
        world.windows = world.windows.filter(item => item !== win);
        world.order = world.order.filter(id => id !== win.id);
        if (world.focusedId === win.id) world.focusedId = topWindowId(world);
        return null;
      case 'focus-window':
        if (world.focusedId === win.id && win.mode !== 'minimized') return 'unchanged';
        focusWindow(world, win);
        return null;
      case 'minimize':
        if (win.mode === 'minimized') return 'unchanged';
        win.mode = 'minimized';
        if (world.focusedId === win.id) world.focusedId = topWindowId(world);
        return null;
      case 'restore':
        if (win.mode === 'normal' && win.tile === null && world.focusedId === win.id) return 'unchanged';
        win.mode = 'normal';
        win.tile = null;
        focusWindow(world, win);
        return null;
      case 'maximize':
      case 'fullscreen': {
        const mode = intent.kind === 'maximize' ? 'maximized' : 'fullscreen';
        if (win.mode === mode && world.focusedId === win.id) return 'unchanged';
        win.mode = mode;
        focusWindow(world, win);
        return null;
      }
      case 'set-rect': {
        const rect = clampRect(intent.rect);
        if (win.mode === 'normal' && win.tile === null && JSON.stringify(rect) === JSON.stringify(win.rect)) return 'unchanged';
        Object.assign(win, { rect, mode: 'normal', tile: null });
        return null;
      }
      case 'tile':
        if (intent.tile === null) {
          if (win.tile === null) return 'unchanged';
          win.tile = null;
          return null;
        }
        if (win.tile === intent.tile && win.mode === 'normal') return 'unchanged';
        Object.assign(win, { tile: intent.tile, mode: 'normal', rect: toRect(TILE_RECTS[intent.tile]) });
        focusWindow(world, win);
        return null;
      default:
        return 'invalid-intent';
    }
  }

  function setPhase(world, phase) {
    if (world.phase === phase) return 'unchanged';
    if (!PHASE_MOVES[world.phase].includes(phase)) return 'phase-transition';
    world.phase = phase;
    for (const name of OVERLAYS) world.overlays[name] = false;
    if (phase === 'off') {
      world.windows = [];
      world.order = [];
      world.focusedId = null;
      world.notifications.banners = [];
    }
    return null;
  }

  // ---- fs ----

  const children = (world, parentId) => Object.values(world.fs.nodes).filter(node => node.parentId === parentId);
  const nameTaken = (world, parentId, name, exceptId = null) =>
    children(world, parentId).some(node => !node.trashed && node.id !== exceptId && node.name.toLowerCase() === name.toLowerCase());
  const isWithin = (world, id, ancestorId) => {
    for (let node = world.fs.nodes[id]; node; node = world.fs.nodes[node.parentId]) if (node.id === ancestorId) return true;
    return false;
  };
  const mimeFor = name => ({ txt: 'text/plain', md: 'text/markdown', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf', html: 'text/html' })[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

  function reduceFs(world, intent, stamp) {
    const { nodes } = world.fs;
    const node = intent.id && nodes[intent.id];
    const editable = item => item && !FIXED_FOLDERS.includes(item.id);
    switch (intent.op) {
      case 'mkdir':
      case 'touch': {
        const parent = nodes[intent.parentId];
        if (parent?.kind !== 'folder' || parent.trashed || intent.parentId === 'trash') return 'no-such-folder';
        if (Object.keys(nodes).length >= MAX_NODES) return 'fs-full';
        if (nameTaken(world, intent.parentId, intent.name)) return 'name-taken';
        if (intent.id && (nodes[intent.id] || world.data.contents[`c-${intent.id}`])) return 'id-taken';
        const id = intent.id ?? nextId('u', candidate => Boolean(nodes[candidate]));
        const created = { id, parentId: intent.parentId, name: intent.name, kind: intent.op === 'mkdir' ? 'folder' : 'file',
          mime: intent.op === 'mkdir' ? null : (intent.mime ?? mimeFor(intent.name)), size: 0, modified: stamp, trashed: false };
        if (intent.op === 'touch') {
          const contentId = `c-${id}`.slice(0, 40);
          if (world.data.contents[contentId]) return 'id-taken';
          created.contentId = contentId;
          world.data.contents[contentId] = { text: intent.text ?? '' };
          created.size = new TextEncoder().encode(intent.text ?? '').length;
        }
        nodes[id] = created;
        return null;
      }
      case 'rename':
        if (!editable(node)) return 'no-such-node';
        if (node.name === intent.name) return 'unchanged';
        if (nameTaken(world, node.parentId, intent.name, node.id)) return 'name-taken';
        Object.assign(node, { name: intent.name, modified: stamp });
        return null;
      case 'move': {
        if (!editable(node) || node.trashed) return 'no-such-node';
        const parent = nodes[intent.parentId];
        if (parent?.kind !== 'folder' || parent.trashed || intent.parentId === 'trash') return 'no-such-folder';
        if (node.parentId === intent.parentId) return 'unchanged';
        if (isWithin(world, intent.parentId, node.id)) return 'fs-cycle';
        if (nameTaken(world, intent.parentId, node.name, node.id)) return 'name-taken';
        node.parentId = intent.parentId;
        if (intent.parentId !== 'desktop') delete node.desktopPos;
        return null;
      }
      case 'trash':
      case 'restore':
        if (!editable(node)) return 'no-such-node';
        if (node.trashed === (intent.op === 'trash')) return 'unchanged';
        if (intent.op === 'restore' && nameTaken(world, node.parentId, node.name, node.id)) return 'name-taken';
        node.trashed = intent.op === 'trash';
        return null;
      case 'empty-trash': {
        const doomed = Object.keys(nodes).filter(id => Object.values(nodes).some(item => item.trashed && isWithin(world, id, item.id)));
        if (doomed.length === 0) return 'unchanged';
        for (const id of doomed) {
          if (nodes[id].contentId) delete world.data.contents[nodes[id].contentId];
          delete nodes[id];
        }
        world.windows = world.windows.filter(win => !doomed.includes(win.payload?.fileId) && !doomed.includes(win.payload?.folderId));
        world.order = world.order.filter(id => world.windows.some(win => win.id === id));
        if (!world.windows.some(win => win.id === world.focusedId)) world.focusedId = topWindowId(world);
        return null;
      }
      case 'write': {
        if (node?.kind !== 'file' || node.trashed) return 'no-such-file';
        const contentId = node.contentId ?? `c-${node.id}`.slice(0, 40);
        if (world.data.contents[contentId]?.asset) return 'read-only';
        if (world.data.contents[contentId]?.text === intent.text) return 'unchanged';
        world.data.contents[contentId] = { text: intent.text };
        Object.assign(node, { contentId, size: new TextEncoder().encode(intent.text).length, modified: stamp });
        return null;
      }
      case 'set-desktop-pos':
        if (!editable(node) || node.parentId !== 'desktop' || node.trashed) return 'no-such-node';
        if (node.desktopPos?.x === intent.pos.x && node.desktopPos?.y === intent.pos.y) return 'unchanged';
        node.desktopPos = { x: intent.pos.x, y: intent.pos.y };
        return null;
      default:
        return 'invalid-intent';
    }
  }

  // ---- data ----

  function upsert(list, item, max = MAX_ITEMS) {
    const index = list.findIndex(entry => entry.id === item.id);
    if (index >= 0 && JSON.stringify(list[index]) === JSON.stringify(item)) return 'unchanged';
    if (index >= 0) list[index] = item;
    else if (list.length >= max) return 'store-full';
    else list.push(item);
    return null;
  }

  function reduceData(world, { store, op, item }, stamp, stampMs) {
    const { data } = world;
    if (store === 'mail') {
      const message = data.mail.messages.find(entry => entry.id === item.id);
      if (op === 'save-draft') {
        if (message && message.folder !== 'drafts') return 'not-a-draft';
        if (!data.mail.folders.includes('drafts')) return 'no-such-folder';
        return upsert(data.mail.messages, { id: item.id, folder: 'drafts', from: `${world.user.name} <${world.user.email}>`, to: item.to,
          subject: item.subject, body: item.body, time: message?.time ?? stamp, read: true, flagged: false, attachments: [] });
      }
      if (!message) return 'no-such-item';
      const field = { 'mark-read': 'read', flag: 'flagged', move: 'folder' }[op];
      if (op === 'move' && !data.mail.folders.includes(item.folder)) return 'no-such-folder';
      if (message[field] === item[field]) return 'unchanged';
      message[field] = item[field];
      return null;
    }
    // mfa: delete removes an answered prompt (or an account). The answer itself is a scene-choice intent.
    if (store === 'mfa') {
      for (const list of [data.mfa?.prompts, data.mfa?.accounts]) {
        const index = list ? list.findIndex(entry => entry.id === item.id) : -1;
        if (index >= 0) {
          list.splice(index, 1);
          return null;
        }
      }
      return 'no-such-item';
    }
    if (store === 'updates' && op === 'upsert') {
      const current = data.updates?.find(entry => entry.id === item.id);
      // choiceId is scene-provided and read-only: an intent may repeat it but never set or change it.
      if (Object.hasOwn(item, 'choiceId') && item.choiceId !== current?.choiceId) return 'read-only';
      data.updates ??= [];
      return upsert(data.updates, current?.choiceId ? { ...item, choiceId: current.choiceId } : { ...item });
    }
    if (SYNCED_DATA.includes(store)) return reduceSynced(world, store, op, item, { s: stamp, ms: stampMs });
    if (store === 'alarms' || store === 'updates') data[store] ??= [];
    if (store === 'messages') {
      const thread = data.messages.threads.find(entry => entry.id === item.threadId);
      if (!thread) return 'no-such-item';
      if (op === 'pin') {
        if ((thread.pinned ?? false) === item.pinned) return 'unchanged';
        thread.pinned = item.pinned;
        return null;
      }
      if (thread.items.some(entry => entry.id === item.id)) return 'id-taken';
      if (thread.items.length >= MAX_ITEMS) return 'store-full';
      thread.items.push({ id: item.id, from: world.user.name, text: item.text, time: stamp });
      return null;
    }
    const list = data[store];
    if (op === 'delete') {
      const index = list.findIndex(entry => entry.id === item.id);
      if (index < 0) return 'no-such-item';
      list.splice(index, 1);
      return null;
    }
    if (store === 'reminders' && op === 'toggle') {
      const reminder = list.find(entry => entry.id === item.id);
      if (!reminder) return 'no-such-item';
      if (reminder.done === item.done) return 'unchanged';
      reminder.done = item.done;
      return null;
    }
    if (store === 'notes') return upsert(list, { ...item, modified: stamp });
    // An omitted optional field (flagged, priority, notes, allDay, favorite) keeps its stored value.
    if (store === 'reminders') {
      const current = list.find(entry => entry.id === item.id);
      return upsert(list, { ...current, ...item, done: current?.done ?? false });
    }
    if (store === 'calendar' && Date.parse(item.end) < Date.parse(item.start)) return 'invalid-intent';
    return upsert(list, { ...list.find(entry => entry.id === item.id), ...item });
  }

  const removeById = (list, id) => {
    const index = list.findIndex(entry => entry.id === id);
    if (index < 0) return 'no-such-item';
    list.splice(index, 1);
    return null;
  };
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Assigns the fields of `patch` to `target`, or reports 'unchanged'.
  const assignChanged = (target, patch) => {
    if (Object.entries(patch).every(([key, value]) => sameJson(target[key], value))) return 'unchanged';
    Object.assign(target, patch);
    return null;
  };

  // Synced app stores (SYNC-AUDIT.md §5). `stamp` is the parent clock: seconds for list times, milliseconds for `at`.
  function reduceSynced(world, store, op, item, stamp) {
    const { data } = world;
    data[store] ??= EMPTY_SYNCED[store]();
    const value = data[store];
    const at = stamp.ms;
    switch (`${store}:${op}`) {
      case 'browser:set-tabs': return assignChanged(value, { tabs: item.tabs, activeTabId: item.activeTabId });
      case 'browser:visit':
        if (value.history[0]?.url === item.url && value.history[0].title === item.title) return 'unchanged';
        value.history = [{ ...item, time: stamp.s }, ...value.history.filter(entry => entry.url !== item.url && entry.id !== item.id)].slice(0, 100);
        return null;
      case 'browser:history-delete': return removeById(value.history, item.id);
      case 'browser:bookmark-upsert': return upsert(value.bookmarks, item, 50);
      case 'browser:bookmark-delete': return removeById(value.bookmarks, item.id);
      case 'media:set-playback': {
        if (item.trackId === null) {
          if (value.nowPlaying === null) return 'unchanged';
          value.nowPlaying = null;
          return null;
        }
        const tracks = new Set(value.tracks.map(track => track.id));
        if (!item.queue.every(id => tracks.has(id))) return 'no-such-item';
        value.nowPlaying = { ...item, at };
        return null;
      }
      case 'media:set-mode': return assignChanged(value, item);
      case 'media:track-upsert': return upsert(value.tracks, item, 200);
      case 'media:playlist-upsert': {
        const tracks = new Set(value.tracks.map(track => track.id));
        return item.trackIds.every(id => tracks.has(id)) ? upsert(value.playlists, item, 50) : 'no-such-item';
      }
      case 'photos:photo-upsert': return upsert(value.items, item);
      case 'photos:photo-delete': {
        const problem = removeById(value.items, item.id);
        if (!problem) for (const album of value.albums) album.photoIds = album.photoIds.filter(id => id !== item.id);
        return problem;
      }
      case 'photos:album-upsert': {
        const photos = new Set(value.items.map(photo => photo.id));
        return item.photoIds.every(id => photos.has(id)) ? upsert(value.albums, item, 50) : 'no-such-item';
      }
      case 'whiteboard:board-upsert': {
        const board = value.boards.find(entry => entry.id === item.id);
        if (board) {
          if (board.name === item.name && sameJson(board.items, item.items)) return 'unchanged';
          Object.assign(board, { name: item.name, items: item.items, modified: stamp.s });
          return null;
        }
        if (value.boards.length >= 20) return 'store-full';
        // As on macOS, a new board opens.
        value.boards.push({ id: item.id, name: item.name, modified: stamp.s, items: item.items });
        value.activeId = item.id;
        return null;
      }
      case 'whiteboard:board-delete': {
        const problem = removeById(value.boards, item.id);
        if (!problem && value.activeId === item.id) value.activeId = value.boards[0]?.id ?? null;
        return problem;
      }
      case 'whiteboard:set-active':
        if (item.id !== null && !value.boards.some(board => board.id === item.id)) return 'no-such-item';
        return assignChanged(value, { activeId: item.id });
      case 'calculator:set': return assignChanged(value, item);
      case 'calculator:record':
        value.history = [{ ...item, time: stamp.s }, ...value.history.filter(entry => entry.id !== item.id)].slice(0, 100);
        return null;
      case 'clock:city-upsert': return upsert(value.worldClocks, item, 24);
      case 'clock:city-delete': return removeById(value.worldClocks, item.id);
      case 'clock:set-timer': {
        const timer = item.timer && { ...item.timer, at };
        if (timer === null && value.timer === null) return 'unchanged';
        value.timer = timer;
        return null;
      }
      case 'clock:set-stopwatch': {
        const { at: _, ...current } = value.stopwatch;
        if (sameJson(current, item) && !item.running) return 'unchanged';
        value.stopwatch = { running: item.running, elapsedMs: item.elapsedMs, at, laps: item.laps };
        return null;
      }
      case 'terminal:cd': {
        const folder = world.fs.nodes[item.cwd];
        if (folder?.kind !== 'folder' || folder.trashed) return 'no-such-folder';
        return assignChanged(value, { cwd: item.cwd });
      }
      case 'terminal:record':
        if (value.history.at(-1) === item.line) return 'unchanged';
        value.history = [...value.history, item.line].slice(-100);
        return null;
      case 'stickies:upsert': return upsert(value, item, 50);
      case 'stickies:delete': return removeById(value, item.id);
      case 'browser:clear-history':
      case 'calculator:clear-history':
      case 'terminal:clear-history':
        if (value.history.length === 0) return 'unchanged';
        value.history = [];
        return null;
      default:
        return removeById(value[{ media: 'playlists', photos: 'albums' }[store]], item.id);
    }
  }

  // Tabs belong to the open browser window and the working directory to the open terminal (a new macOS window starts
  // fresh): closing the window, switching off or uninstalling resets them, and a deleted folder sends the shell home.
  function resetClosedApps(world) {
    const { browser, terminal } = world.data;
    if (browser?.tabs.length && !world.windows.some(win => win.app === 'browser')) Object.assign(browser, { tabs: [], activeTabId: null });
    if (terminal && terminal.cwd !== 'home' && (!world.windows.some(win => win.app === 'terminal') || world.fs.nodes[terminal.cwd]?.kind !== 'folder')) terminal.cwd = 'home';
  }

  // open-app browser {url: 'scene:<id>'} shows that page in a tab: the existing one, else a new one (or the active one
  // when the strip is full).
  function openBrowserTab(world, url) {
    const browser = world.data.browser ??= EMPTY_SYNCED.browser();
    const title = world.data.web?.pages[url.slice(6)]?.title ?? 'Training page';
    let tab = browser.tabs.find(entry => entry.url === url);
    if (!tab && browser.tabs.length >= 16) tab = Object.assign(browser.tabs.find(entry => entry.id === browser.activeTabId), { url, title });
    if (!tab) {
      tab = { id: nextId('tab', candidate => browser.tabs.some(entry => entry.id === candidate)), url, title };
      browser.tabs.push(tab);
    }
    browser.activeTabId = tab.id;
  }

  function reduceDock(world, intent) {
    const { pins } = world.dock;
    const at = pins.indexOf(intent.app);
    if (intent.op === 'unpin') {
      if (at < 0) return 'unchanged';
      pins.splice(at, 1);
      return null;
    }
    if (!world.installed.includes(intent.app)) return 'not-installed';
    if (intent.op === 'pin' && at >= 0) return 'unchanged';
    if (intent.op === 'move' && at < 0) return 'not-pinned';
    const without = pins.filter(app => app !== intent.app);
    const index = Math.min(intent.index ?? without.length, without.length);
    without.splice(index, 0, intent.app);
    if (without.join('|') === pins.join('|')) return 'unchanged';
    world.dock.pins = without;
    return null;
  }

  // Applies one shell intent. `now` is the parent clock in ms. Returns the next world (revision + 1) when it changed.
  // A scene choice never edits the world; it is returned as `forward` for the CONTRACT-V2 scene model.
  function applyIntent(world, rawIntent, now) {
    if (!Number.isFinite(now) || now < 0) return reject(world, 'invalid-time');
    if (worldProblem(world)) return reject(world, 'invalid-world');
    const intent = parseIntent(rawIntent);
    if (!intent) return reject(world, rejectReason(rawIntent));
    const stamp = new Date(Math.floor(now / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const stampMs = new Date(Math.floor(now)).toISOString();
    const desktopOnly = !['set-phase', 'set-sys', 'notify-dismiss', 'notify-clear'].includes(intent.kind);
    if (desktopOnly && world.phase !== 'desktop') return reject(world, 'not-desktop');
    if (intent.kind === 'scene-choice') return noop(world, { kind: 'choose', choiceId: intent.choiceId });
    const draft = clone(world);
    let problem = null;
    switch (intent.kind) {
      case 'open-app':
        problem = reduceOpenApp(draft, intent);
        if (!problem && intent.app === 'browser' && intent.payload?.url) openBrowserTab(draft, intent.payload.url);
        break;
      case 'set-sys':
        if (Object.entries(intent.patch).every(([key, value]) => draft.sys[key] === value)) problem = 'unchanged';
        Object.assign(draft.sys, intent.patch);
        break;
      case 'set-phase': problem = setPhase(draft, intent.phase); break;
      case 'toggle-overlay':
        if (draft.overlays[intent.name] === intent.open) problem = 'unchanged';
        // Overlays are exclusive: opening one closes the others.
        if (intent.open) for (const name of OVERLAYS) draft.overlays[name] = false;
        draft.overlays[intent.name] = intent.open;
        break;
      case 'fs': problem = reduceFs(draft, intent, stamp); break;
      case 'data': problem = reduceData(draft, intent, stamp, stampMs); break;
      case 'notify-dismiss': {
        const before = draft.notifications.banners.length;
        draft.notifications.banners = intent.id ? draft.notifications.banners.filter(item => item.id !== intent.id) : [];
        if (draft.notifications.banners.length === before) problem = 'unchanged';
        break;
      }
      case 'notify-clear': {
        const keep = item => intent.id && item.id !== intent.id;
        const before = draft.notifications.banners.length + draft.notifications.history.length;
        draft.notifications.banners = draft.notifications.banners.filter(keep);
        draft.notifications.history = draft.notifications.history.filter(keep);
        if (draft.notifications.banners.length + draft.notifications.history.length === before) problem = 'unchanged';
        break;
      }
      case 'dock': problem = reduceDock(draft, intent); break;
      case 'install':
        if (draft.installed.includes(intent.app)) problem = 'unchanged';
        else draft.installed = CANONICAL_APPS.filter(app => app === intent.app || draft.installed.includes(app));
        break;
      case 'uninstall':
        if (CORE_APPS.includes(intent.app)) problem = 'core-app';
        else if (!draft.installed.includes(intent.app)) problem = 'unchanged';
        else {
          draft.installed = draft.installed.filter(app => app !== intent.app);
          filterInstalled(draft);
        }
        break;
      default: problem = reduceWindow(draft, intent);
    }
    if (problem === 'unchanged') return noop(world);
    if (problem) return reject(world, problem);
    resetClosedApps(draft);
    const next = worldProblem(draft);
    if (next) return reject(world, `invalid-result:${next}`);
    draft.revision = world.revision + 1;
    return { ok: true, changed: true, world: draft, reason: null, forward: null };
  }

  // ---- canonical projection ------------------------------------------------------------------------------
  // normalise(world) is what a trainee sees, independent of the OS: both shells' OceanWorldAdapter.snapshot() must
  // equal normalise(the parent's world) once they have applied it. It leaves out geometry (window rects, desktop icon
  // positions), titles a shell derives itself (tab titles, track durations), parent stamps on running values (`at`,
  // and the running remainder or position) and anything without a visible effect (revision, ids of windows).
  // It tolerates partial input: an absent store is empty and an absent optional setting takes its default.

  const SYS_DEFAULTS = Object.freeze({ wallpaperUrl: null, dockAutohide: false, showBatteryPercent: false, increaseContrast: false,
    wifiNetwork: 'Northwind-Staff', locationServices: true, shareAnalytics: false, personalizedAds: false });
  const canonicalTime = time => (typeof time === 'string' && !Number.isNaN(Date.parse(time)) ? new Date(Date.parse(time)).toISOString() : null);
  const sortedKeys = record => Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const pick = (item, keys) => Object.fromEntries(keys.map(key => [key, item[key]]));
  const isFullRect = rect => rect?.x === 0 && rect?.y === 0 && rect?.w === WORK.w && rect?.h === WORK.h;

  // One synced store in canonical form (also used by shells to diff a native store against the world).
  function normaliseStore(store, raw) {
    const value = raw ?? EMPTY_SYNCED[store]();
    switch (store) {
      case 'browser':
        return { tabs: value.tabs.map(tab => pick(tab, ['id', 'url'])), activeTabId: value.activeTabId,
          bookmarks: value.bookmarks.map(item => pick(item, ['id', 'title', 'url'])),
          history: value.history.map(item => ({ id: item.id, url: item.url, title: item.title, time: canonicalTime(item.time) })) };
      case 'media': {
        const playing = value.nowPlaying;
        return { tracks: value.tracks.map(track => ({ ...pick(track, ['id', 'title', 'artist', 'album', 'genre', 'asset', 'loved']), cover: track.cover ?? null })),
          playlists: value.playlists.map(item => pick(item, ['id', 'name', 'trackIds'])), shuffle: value.shuffle, repeat: value.repeat,
          nowPlaying: playing ? { trackId: playing.trackId, queue: playing.queue, playing: playing.playing,
            positionSec: playing.playing ? null : Math.round(playing.positionSec) } : null };
      }
      case 'photos':
        return { items: value.items.map(item => ({ ...pick(item, ['id', 'name', 'asset', 'favorite', 'trashed']), taken: canonicalTime(item.taken) })),
          albums: value.albums.map(item => pick(item, ['id', 'name', 'photoIds'])) };
      case 'whiteboard':
        return { boards: value.boards.map(board => ({ id: board.id, name: board.name, modified: canonicalTime(board.modified),
          items: board.items.map(item => sortedKeys(item)) })), activeId: value.activeId };
      case 'calculator':
        return { ...pick(value, ['mode', 'angle', 'base', 'memory']),
          history: value.history.map(item => ({ ...pick(item, ['id', 'expr', 'result']), time: canonicalTime(item.time) })) };
      case 'clock': {
        const { timer, stopwatch } = value;
        return { worldClocks: value.worldClocks.map(item => pick(item, ['id', 'name', 'tz'])),
          timer: timer ? { label: timer.label, durationMs: timer.durationMs, running: timer.running, remainingMs: timer.running ? null : timer.remainingMs } : null,
          stopwatch: { running: stopwatch.running, elapsedMs: stopwatch.running ? null : stopwatch.elapsedMs, laps: stopwatch.laps } };
      }
      case 'terminal': return { cwd: value.cwd, history: value.history };
      case 'stickies': return value.map(item => pick(item, ['id', 'text', 'color', 'x', 'y', 'w', 'h', 'collapsed']));
      default: throw new TypeError(`Unknown synced store: ${store}`);
    }
  }

  function normalise(world) {
    const data = world.data ?? {};
    const user = world.user ?? {};
    const windows = (world.order ?? []).map(id => (world.windows ?? []).find(win => win.id === id)).filter(Boolean);
    const contents = data.contents ?? {};
    const notification = item => pick(item, ['id', 'app', 'title', 'body']);
    return {
      phase: world.phase,
      user: pick(user, ['name', 'short', 'email']),
      sys: sortedKeys({ ...SYS_DEFAULTS, ...world.sys }),
      installed: CANONICAL_APPS.filter(app => (world.installed ?? []).includes(app)),
      dock: { pins: world.dock?.pins ?? [], badges: sortedKeys(world.dock?.badges) },
      overlays: sortedKeys(world.overlays),
      // Bottom to top. A normal window covering the whole work area looks maximized on both OSes.
      windows: windows.map(win => ({ app: win.app, payload: win.payload ?? null, mode: win.mode === 'normal' && isFullRect(win.rect) ? 'maximized' : win.mode })),
      focused: windows.findIndex(win => win.id === world.focusedId) >= 0 ? windows.findIndex(win => win.id === world.focusedId) : null,
      fs: Object.values(world.fs?.nodes ?? {}).filter(node => node.kind !== 'app' && node.id !== 'root')
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(node => {
          const text = node.contentId ? contents[node.contentId]?.text : undefined;
          return { ...pick(node, ['id', 'parentId', 'name', 'kind', 'trashed']), ...(node.encrypted ? { encrypted: true } : {}), ...(typeof text === 'string' ? { text } : {}) };
        }),
      notifications: { banners: (world.notifications?.banners ?? []).map(notification), history: (world.notifications?.history ?? []).map(notification) },
      data: {
        mail: (data.mail?.messages ?? []).map(item => pick(item, ['id', 'folder', 'subject', 'read', 'flagged'])),
        messages: (data.messages?.threads ?? []).map(thread => ({ id: thread.id, pinned: thread.pinned ?? false,
          items: thread.items.map(item => ({ id: item.id, text: item.text, mine: item.from === user.name })) })),
        notes: (data.notes ?? []).map(item => pick(item, ['id', 'folder', 'title', 'body', 'pinned'])),
        calendar: (data.calendar ?? []).map(item => ({ id: item.id, title: item.title, location: item.location, start: canonicalTime(item.start),
          end: canonicalTime(item.end), allDay: item.allDay ?? false, notes: item.notes ?? '' })),
        reminders: (data.reminders ?? []).map(item => ({ ...pick(item, ['id', 'list', 'title', 'done']), due: canonicalTime(item.due),
          flagged: item.flagged ?? false, priority: item.priority ?? 0, notes: item.notes ?? '' })),
        contacts: (data.contacts ?? []).map(item => ({ ...pick(item, ['id', 'email', 'phone', 'org']), name: item.name.split(/\s+/).filter(Boolean).join(' '),
          favorite: item.favorite ?? false })),
        alarms: (data.alarms ?? []).map(item => pick(item, ['id', 'time', 'label', 'enabled'])),
        updates: (data.updates ?? []).map(item => pick(item, ['id', 'status'])),
        mfa: { accounts: (data.mfa?.accounts ?? []).map(item => item.id), prompts: (data.mfa?.prompts ?? []).map(item => item.id) },
        processes: (data.processes ?? []).map(item => pick(item, ['id', 'name'])),
        startup: (data.startup ?? []).map(item => pick(item, ['id', 'name'])),
        web: Object.keys(data.web?.pages ?? {}).sort(),
        homepage: data.web?.homepage ?? null,
        ...Object.fromEntries(SYNCED_DATA.map(store => [store, normaliseStore(store, data[store])])),
      },
      highlight: world.scene?.highlight ?? null,
    };
  }

  const api = Object.freeze({
    CANONICAL_APPS, CULLED_APPS, CORE_APPS, APP_NAMES, WORK, WORLD_MAX_BYTES, PHASES, ACCENTS, WALLPAPERS, OVERLAYS, TILES, FIXED_FOLDERS, FS_OPS,
    CREATURE_STATES, ATTACK_KINDS, SANDBOX_MODES, SANDBOX_STATUSES, SANDBOX_MAX_EVENTS,
    createWorld, validate, applyIntent, parseIntent, parseIntentMessage, mergeProfile,
    SYNCED_DATA, SYS_DEFAULTS, normalise, normaliseStore, emptyStore: store => EMPTY_SYNCED[store](),
  });
  if (typeof window !== 'undefined') window.OceanWorldModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
