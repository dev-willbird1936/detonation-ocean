// Evidence -> desktop world patches (SPEC §9.1). evidenceToPatches turns the normalised evidence items of one job
// (docs/detonation/EVIDENCE.md) into patches for the desktop world, in evidence order; publish sends them to the
// existing live-world route /api/desktop/events?run=<jobId> (docs/desktop-parity/BACKEND.md). Both desktop shells receive
// every patch, so the same world shows in File Explorer and Finder, Task Manager and Activity Monitor, and so on.
//
// Every patch is valid for the plain seed on its own (the server checks it against the seed) and for the live world, so
// a patch carries whole nodes, whole lists and whole banner lists, never a fragment of one. Lists replace: the replay
// owns data.processes, data.startup, data.screenshots, notifications and windows for the run (BACKEND.md §5).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesktopEvent, RUN_ID_RE } from '../desktop-world-events.mjs';

const OceanWorldModel = createRequire(import.meta.url)('../../ui/desktop/world-model.js');
const SEED_FILE = join(dirname(fileURLToPath(import.meta.url)), '../../data/desktop-world-seed.json');

export const PATH_LABELS = { run: 'Executed on Linux', wine: 'Ran under Wine', emulate: 'Emulated', inspect: 'Inspected' };
// The event hub keeps the last 32 events of a run for a page that connects late: a replay never sends more than this.
export const MAX_PATCHES = 30;
const MAX_BANNERS = 8;
const MAX_HISTORY = 120;
const MAX_NOTE_WINDOWS = 3;
const MAX_SCREENSHOTS = 8;
// A data: URL screenshot must stay small: the world is capped at 256 KB.
const MAX_IMAGE_CHARS = 50_000;
const DEFAULT_TIME = '2026-01-01T00:00:00.000Z';
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
const IMAGE_URL = /^(\/(?!\/)[A-Za-z0-9._~\/-]{1,200}|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]{1,50000})$/;

// The seeded user and folders (SPEC §6.2). Folder names match the desktop world, so the replay maps 1:1.
const USER = { id: 'trainee', name: 'Dana Okafor', short: 'dana', email: 'dana.okafor@northwind.example', avatar: 'initials' };
const HOME = '/home/dana/';
const FOLDERS = { documents: 'documents', downloads: 'downloads', desktop: 'desktop', pictures: 'pictures' };
const SEED_FILES = [
  ['Documents/Q3-report.docx', 400], ['Documents/budget.xlsx', 437], ['Documents/notes.txt', 474], ['Documents/photos-list.csv', 511],
  ['Desktop/todo.txt', 548], ['Pictures/holiday-01.png', 585], ['Pictures/holiday-02.png', 622],
];
const SEED_PICTURES = { 'holiday-01.png': 'photo-1', 'holiday-02.png': 'photo-2' };
const MIME = {
  txt: 'text/plain', csv: 'text/csv', png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const RANSOM_NOTE = /ransom|decrypt|(recover|restore)[ _-]?(your[ _-]?)?files|how[ _-]?to[ _-]?(recover|restore)/i;
const HONEY = /\/\.aws\/credentials$|\/\.ssh\/id_[^/]*$|\/\.env$|\/\.electrum\/wallets\/|\/Microsoft\/Credentials\/|\/Default\/(Login Data|Cookies)$/i;
const RUN_KEY = /\\(Run|RunOnce|Winlogon|Services|TaskCache)(\\|$)/i;
const PERSISTENT_FILE = /\/(cron[^/]*|systemd|init\.d|autostart|Startup)\/|\/etc\/(passwd|shadow)$/i;
const PERSISTENT_COMMAND = /schtasks.*\/create|crontab|systemctl\s+enable|sc\s+create|useradd|adduser|net\s+user.*\/add/i;
const BROWSER_FILE = /(\/extensions\/|\/(Secure )?Preferences$|\/prefs\.js$|\/user\.js$|\/policies\.json$)/i;
const BROWSER_KEY = /Policies\\(Google\\Chrome|Microsoft\\Edge|Mozilla)|Internet Explorer\\Main|StartPage|Start Page|HomepageLocation/i;
const LOOPBACK = /^(127\.|localhost$|\[?::1\]?$)/i;

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/@/g, '(at)').trim().slice(0, max);
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const baseName = path => String(path).replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
const extensionOf = name => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const nodeId = path => `rp-${slug(baseName(path)).slice(0, 22) || 'file'}-${createHash('sha256').update(path).digest('hex').slice(0, 8)}`;

// `C:\Users\Dana\…` and `/home/dana/…` are the same place (EVIDENCE.md, Paths).
const normalisePath = path => String(path ?? '').replace(/\\/g, '/').replace(/^[A-Za-z]:\/Users\/Dana\//i, HOME);

// A path inside a seeded folder: { path, folder, parts } where parts are the segments below the home folder, or null.
function locate(path) {
  const normal = normalisePath(path);
  if (!normal.startsWith(HOME)) return null;
  const parts = normal.slice(HOME.length).split('/').filter(Boolean);
  const folder = FOLDERS[parts[0]?.toLowerCase()];
  return folder && parts.length >= 2 && parts.length <= 4 ? { path: normal, folder, parts } : null;
}

const timeOf = (item, fallback) => (ISO_TIME.test(item?.at ?? '') ? item.at : fallback);

export function evidenceToPatches(evidenceItems, { path, label } = {}) {
  const items = Array.isArray(evidenceItems) ? evidenceItems : [];
  const pathLabel = label ?? PATH_LABELS[path];
  const start = timeOf(items[0], DEFAULT_TIME);
  const nodes = new Map();
  const contents = new Map();
  const byPath = new Map();
  const processes = [];
  const startup = [];
  const screenshots = [];
  const history = [];
  const windows = [];
  const seenNotes = new Set();
  let web = null;
  let counter = 0;
  let touched = new Set();
  let touchedNodes = new Set();
  let touchedContents = new Set();

  const touch = (...domains) => domains.forEach(domain => touched.add(domain));
  const newId = prefix => `rp-${prefix}-${++counter}`;

  const notify = (app, title, body, time) => {
    history.push({ id: newId('n'), app, title: clean(title, 120), body: clean(body, 600), time });
    touch('notifications');
  };

  const ensureFolder = (parentId, name, key, time) => {
    const id = nodeId(key);
    if (!nodes.has(id)) {
      nodes.set(id, { id, parentId, name, kind: 'folder', mime: null, size: 0, modified: time, trashed: false });
      byPath.set(key, id);
      touchedNodes.add(id);
    }
    return id;
  };

  // The node for a path in a seeded folder, created (with its parent folders) when the replay has not seen it yet.
  const fileNode = (location, { size = 0, time, text, asset } = {}) => {
    const known = byPath.get(location.path);
    if (known) return nodes.get(known);
    let parentId = FOLDERS[location.parts[0].toLowerCase()];
    let key = `${HOME}${location.parts[0]}`;
    for (const part of location.parts.slice(1, -1)) {
      key = `${key}/${part}`;
      parentId = ensureFolder(parentId, clean(part, 120), key, time);
    }
    const name = clean(location.parts.at(-1), 120);
    if (!name || name === '.' || name === '..') return null;
    const id = nodeId(location.path);
    const node = { id, parentId, name, kind: 'file', mime: MIME[extensionOf(name)] ?? 'application/octet-stream', size, modified: time, trashed: false };
    if (text !== undefined || asset) {
      node.contentId = `c-${id}`;
      contents.set(node.contentId, asset ? { asset } : { text });
      touchedContents.add(node.contentId);
    }
    nodes.set(id, node);
    byPath.set(location.path, id);
    touchedNodes.add(id);
    return node;
  };

  const update = (node, fields) => {
    Object.assign(node, fields);
    touchedNodes.add(node.id);
  };

  const openNote = (node, time) => {
    if (seenNotes.has(node.id) || windows.length >= MAX_NOTE_WINDOWS) return;
    seenNotes.add(node.id);
    const slot = windows.length * 24;
    windows.push({ id: newId('w'), app: 'texteditor', title: node.name, rect: { x: 210 + slot, y: 70 + slot, w: 580, h: 420 }, mode: 'normal', tile: null, payload: { fileId: node.id } });
    touch('windows');
  };

  // A file written, created or changed in a seeded folder. A ransom note opens in the text editor.
  const written = (location, item, size) => {
    const time = timeOf(item, start);
    const isNote = RANSOM_NOTE.test(location.parts.at(-1));
    const node = fileNode(location, {
      size, time, text: isNote ? 'Fictional ransom note. A program in the sandbox wrote this file; nothing here is real and nothing was encrypted outside the sandbox.' : undefined,
    });
    if (!node) return;
    if (size !== undefined || node.modified !== time) update(node, { modified: time, ...(size === undefined ? {} : { size }) });
    if (isNote) openNote(node, time);
  };

  // A file encrypted: its name gains the new extension and its icon is locked.
  const encrypted = (node, name, time) => update(node, { name: clean(name, 120), modified: time, encrypted: true });

  const renamed = (from, to, item) => {
    const source = locate(from);
    const target = locate(to);
    const time = timeOf(item, start);
    if (!target) return;
    const node = source && byPath.has(source.path) ? nodes.get(byPath.get(source.path)) : source ? fileNode(source, { time }) : null;
    if (!node) return written(target, item);
    const name = clean(target.parts.at(-1), 120);
    if (source) byPath.delete(source.path);
    byPath.set(target.path, node.id);
    if (extensionOf(name) !== extensionOf(node.name)) encrypted(node, name, time);
    else update(node, { name, modified: time });
  };

  const deleted = (location, item) => {
    const id = byPath.get(location.path);
    // A seeded file the replay has not met yet appears first, then goes.
    const node = id ? nodes.get(id) : item.seeded === true ? fileNode(location, { size: item.sizeBefore ?? 0, time: timeOf(item, start) }) : null;
    if (!node || node.trashed) return;
    update(node, { trashed: true, modified: timeOf(item, start) });
    notify('files', 'Deleted by sample', `${node.name} was removed from ${location.parts[0]}.`, timeOf(item, start));
  };

  const started = (item) => {
    const id = /^[a-z0-9-]{1,40}$/.test(item.id ?? '') && !processes.some(entry => entry.id === item.id) ? item.id : newId('p');
    const name = clean(baseName(item.path) || 'process', 80);
    processes.push({ id, name, cpu: 1.5, mem: 24, publisher: 'Started by the sample', suspicious: true });
    touch('processes');
  };

  const blocked = (host, port, item) => {
    const shown = clean(host, 100);
    if (!shown || LOOPBACK.test(shown) || history.some(note => note.title === `Connection blocked: ${shown}`)) return;
    notify('taskmanager', `Connection blocked: ${shown}`, `The sample tried to reach ${shown}${port ? ` on port ${port}` : ''}. The sandbox has no network, so nothing left it.`, timeOf(item, start));
  };

  const persistence = (name, command) => {
    startup.push({ id: newId('s'), name: clean(name, 80) || 'Startup item', command: clean(command, 200) || 'unknown' });
    touch('startup');
  };

  const persistenceOf = (item) => {
    const normal = normalisePath(item.path);
    if (['key-added', 'key-changed'].includes(item.kind) && RUN_KEY.test(String(item.key ?? ''))) return [item.value || baseName(String(item.key).replace(/\\/g, '/')), item.data];
    if (item.kind === 'api-call' && /^CreateService/.test(item.api ?? '')) return [item.args?.name ?? item.args?.serviceName ?? item.api, item.args?.binaryPath ?? item.args?.path ?? item.api];
    if (item.kind === 'file-write' && PERSISTENT_FILE.test(normal)) return [baseName(normal), normal];
    if (item.kind === 'execve' && PERSISTENT_COMMAND.test([item.path, ...(item.argv ?? [])].join(' '))) return [baseName(item.path), (item.argv ?? [item.path]).join(' ')];
    return null;
  };

  const hijacked = () => {
    if (web) return;
    web = {
      pages: {
        'replay-homepage': {
          title: 'Home page changed by the sample', url: 'https://changed-homepage.invalid/', heading: 'Your home page was changed',
          body: 'A program in the sandbox changed the browser settings that decide which page opens first.\n\nThis notice stands in for the page it set. The real address is never loaded.',
          choices: [],
        },
      },
      homepage: 'scene:replay-homepage',
    };
    touch('web');
  };

  const screenshot = (item) => {
    if (screenshots.length >= MAX_SCREENSHOTS || typeof item.image !== 'string' || !IMAGE_URL.test(item.image) || item.image.length > MAX_IMAGE_CHARS) return;
    screenshots.push({ id: newId('shot'), caption: clean(item.caption, 160) || `Screenshot ${screenshots.length + 1}`, image: item.image });
    touch('screenshots');
  };

  const handle = (item) => {
    const time = timeOf(item, start);
    const location = locate(item.path);
    const persistent = persistenceOf(item);
    if (persistent) persistence(...persistent);
    switch (item.kind) {
      case 'execve': return started(item);
      case 'file-read':
        if (HONEY.test(normalisePath(item.path)) && !history.some(note => note.title === 'Credential file read' && note.body.includes(baseName(item.path)))) {
          notify('files', 'Credential file read', `The sample read ${clean(baseName(item.path), 60)}, a decoy credential file planted for this run.`, time);
        }
        return undefined;
      case 'connect': case 'sendto': return blocked(item.host, item.port, item);
      case 'request-blocked': return blocked(((url) => { try { return new URL(url).host; } catch { return ''; } })(item.url), '', item);
      case 'file-write':
        if (BROWSER_FILE.test(normalisePath(item.path))) hijacked();
        return location ? written(location, item) : undefined;
      case 'added': return location ? written(location, item, Number.isInteger(item.sizeAfter) ? item.sizeAfter : 0) : undefined;
      case 'changed': {
        if (!location) return undefined;
        const node = fileNode(location, { size: item.sizeBefore ?? 0, time });
        if (!node) return undefined;
        const size = Number.isInteger(item.sizeAfter) ? { size: item.sizeAfter } : {};
        if (item.entropyAfter >= 7.5) encrypted(node, `${node.name}.locked`, time);
        update(node, { modified: time, ...size });
        return undefined;
      }
      case 'rename': case 'renamed': {
        if (BROWSER_FILE.test(normalisePath(item.to))) hijacked();
        return renamed(item.from ?? item.path, item.to, item);
      }
      case 'unlink': case 'deleted': return location && (item.kind === 'unlink' || item.seeded === true) ? deleted(location, item) : undefined;
      case 'key-added': case 'key-changed': return BROWSER_KEY.test(String(item.key ?? '')) ? hijacked() : undefined;
      case 'screenshot': return screenshot(item);
      default: return undefined;
    }
  };

  // The seeded state first: the user, the home folder named after her, and the files the sample will meet.
  const seedPatch = () => {
    const home = { id: 'home', parentId: 'root', name: USER.short, kind: 'folder', mime: null, size: 0, modified: start, trashed: false };
    for (const [relative, size] of SEED_FILES) {
      const [folder, name] = relative.split('/');
      const text = ['txt', 'csv'].includes(extensionOf(name)) ? `Fictional ${name}: synthetic content for the sandbox.` : undefined;
      fileNode(locate(`${HOME}${relative}`), { size, time: start, text, asset: folder === 'Pictures' ? SEED_PICTURES[name] : undefined });
    }
    const patch = JSON.parse(JSON.stringify({ user: USER, fs: { nodes: { home, ...Object.fromEntries(nodes) } }, data: { contents: Object.fromEntries(contents) } }));
    touchedNodes = new Set();
    touchedContents = new Set();
    if (pathLabel) {
      notify('files', pathLabel, 'Replay of what the file did in the sandbox. Nothing here is real.', start);
      Object.assign(patch, notificationPatch());
      touched = new Set();
    }
    return patch;
  };

  const notificationPatch = () => ({ notifications: { banners: history.slice(-MAX_BANNERS), history: history.slice(-MAX_HISTORY) } });

  // Only what the last item changed, as whole values.
  const patchOfTouched = () => {
    const patch = {};
    if (touchedNodes.size) patch.fs = { nodes: Object.fromEntries([...touchedNodes].map(id => [id, { ...nodes.get(id) }])) };
    const data = {};
    if (touchedContents.size) data.contents = Object.fromEntries([...touchedContents].map(id => [id, contents.get(id)]));
    if (touched.has('processes')) data.processes = processes.map(entry => ({ ...entry }));
    if (touched.has('startup')) data.startup = startup.map(entry => ({ ...entry }));
    if (touched.has('screenshots')) data.screenshots = screenshots.map(entry => ({ ...entry }));
    if (touched.has('web')) data.web = web;
    if (Object.keys(data).length) patch.data = data;
    if (touched.has('notifications')) Object.assign(patch, notificationPatch());
    if (touched.has('windows')) {
      Object.assign(patch, { windows: windows.map(entry => ({ ...entry })), order: windows.map(entry => entry.id), focusedId: windows.at(-1).id });
    }
    return patch;
  };

  const patches = [seedPatch()];
  for (const item of items) {
    touched = new Set();
    touchedNodes = new Set();
    touchedContents = new Set();
    handle(item);
    const patch = patchOfTouched();
    if (Object.keys(patch).length) patches.push(patch);
  }
  return coalesce(patches);
}

// Keeps a long replay within what the event hub remembers: neighbours merge, in order, with the world's own patch rules.
function coalesce(patches) {
  if (patches.length <= MAX_PATCHES) return patches;
  const size = Math.ceil(patches.length / MAX_PATCHES);
  const merged = [];
  for (let at = 0; at < patches.length; at += size) {
    merged.push(patches.slice(at, at + size).reduce((all, next) => OceanWorldModel.mergeProfile(all, next)));
  }
  return merged;
}

// Sends patches to the live-world route of the run `jobId`, in order. With `hub` (the server's DesktopEventHub) the
// events are checked against the seed and published in-process; otherwise they are POSTed to `baseUrl`
// (DESKTOP_EVENTS_TOKEN as `token`, when the server has one).
export async function publish(jobId, patches, { hub, baseUrl = `http://127.0.0.1:${process.env.PORT ?? 4173}`, token, fetchImpl = fetch } = {}) {
  if (!RUN_ID_RE.test(jobId ?? '')) throw new TypeError('The job id must be 1-40 characters of a-z, 0-9 or -.');
  const results = [];
  const seed = hub ? JSON.parse(readFileSync(SEED_FILE, 'utf8')) : null;
  for (const patch of patches) {
    const event = { type: 'patch', patch };
    if (hub) {
      results.push(hub.publish(jobId, parseDesktopEvent(event, seed)));
      continue;
    }
    const response = await fetchImpl(new URL(`/api/desktop/events?run=${jobId}`, baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(event),
    });
    if (response.status !== 202) throw new Error(`The desktop event was refused (${response.status}).`);
    results.push(await response.json());
  }
  return results;
}
