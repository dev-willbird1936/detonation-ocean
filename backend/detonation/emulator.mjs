// Speakeasy report (deploy/detonation/runner/emulate.py) to EVIDENCE.md `emulator` items (docs/SPEC.md 6.4 "Emulator report").
// Pure. The emulated program never runs natively, but its report is still program-controlled data: shapes are checked, strings cut and
// counts capped here.

const TEXT = 300;
const MAX_API_ITEMS = 150;
const MAX_EVENTS = 100;
const text = (value, size = TEXT) => String(value ?? '').slice(0, size);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value, max) => (Array.isArray(value) ? value.filter(isObject).slice(0, max) : []);
const item = (kind, at, detail, fields) => ({ source: 'emulator', kind, detail, at, ...fields });
const number = value => (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? parseInt(value, 16) : Number(value));

const HIVES = { HKEY_CURRENT_USER: 'HKCU', HKEY_LOCAL_MACHINE: 'HKLM', HKEY_CLASSES_ROOT: 'HKCR', HKEY_USERS: 'HKU' };
const FILE_KINDS = { create: 'file-write', write: 'file-write', read: 'file-read', open: 'file-read' };
// Speakeasy 1.6.1 logs only open_key, read_value, list_subkeys and create_key; a value written to an existing key is an api-call only.
const REGISTRY_KINDS = { create_key: 'key-added' };

// Named arguments the rule engine reads (EVIDENCE.md `emulator` table); the rest stay positional.
function namedArgs(api, args) {
  if (/^SetWindowsHookEx[AW]?$/.test(api)) return { idHook: number(args[0]) };
  if (/^SetFileAttributes[AW]?$/.test(api)) return { hidden: (number(args[1]) & 0x2) !== 0 };
  if (/^CreateService[AW]?$/.test(api)) return { type: (number(args[4]) & 0x3) !== 0 ? 'driver' : 'process' };
  return {};
}

// One item per API name, at its first call, with `count`: a polling loop stays one item, and order between different calls is kept.
function apiItems(entries, at) {
  const byName = new Map();
  for (const entry of entries) {
    for (const call of list(entry.apis, 5_000)) {
      const api = text(call.api, 80).split('.').pop();
      if (!api) continue;
      const known = byName.get(api);
      if (known) { known.count += 1; continue; }
      const args = Array.isArray(call.args) ? call.args.map(arg => text(arg)) : [];
      byName.set(api, item('api-call', at, `${api} called.`, { api, args: { ...Object.fromEntries(args.slice(0, 12).map((value, index) => [`arg${index}`, value])), ...namedArgs(api, args) }, count: 1 }));
    }
  }
  return [...byName.values()].slice(0, MAX_API_ITEMS);
}

function registryItems(entries, at) {
  return entries.flatMap(entry => list(entry.registry, MAX_EVENTS)).flatMap(event => {
    const kind = REGISTRY_KINDS[text(event.event, 40)];
    const path = text(event.path, 400).replace(/\//g, '\\');
    const [root, ...rest] = path.split('\\');
    if (!kind || !HIVES[root.toUpperCase()]) return [];
    return [item(kind, at, `${kind} ${path}`, { hive: HIVES[root.toUpperCase()], key: rest.join('\\'), value: text(event.value_name, 120), data: text(event.data) })];
  });
}

function fileItems(entries, at) {
  return entries.flatMap(entry => list(entry.files, MAX_EVENTS)).flatMap(event => {
    const kind = FILE_KINDS[text(event.event, 40)];
    return kind && event.path ? [item(kind, at, `${kind} ${text(event.path, 120)}`, { path: text(event.path, 400) })] : [];
  });
}

function networkItems(entries, at) {
  return entries.flatMap(entry => [
    ...list(entry.dns, MAX_EVENTS).map(event => item('connect', at, `DNS lookup ${text(event.query, 120)}`, { host: text(event.query, 255), port: 53, payloadPreview: '' })),
    ...list(entry.traffic, MAX_EVENTS).map(event => {
      const data = text(event.data || event.headers, 256);
      return item('connect', at, `connect ${text(event.server, 120)}:${Number(event.port) || 0}`, {
        host: text(event.server, 255), port: Number(event.port) || 0, payloadPreview: data, ...(/^GET$/i.test(text(event.method, 10)) || /^GET /.test(data) ? { download: true } : {}),
      });
    }),
  ]);
}

// Where an entry point stopped: the unsupported API when there is one, else the error type.
const stopPoint = error => text(error.api_name || error.last_api || error.type || 'error', 80);

/**
 * Items for one Speakeasy run (the `emulation` object of the runner line): api calls, file and registry events, network attempts,
 * and an `emulation-stopped` item for every entry point that ended with an error, for a run that used its whole time limit, and
 * for an emulator fault. Order is api-call, file, registry, network, stop reason.
 */
export function mapEmulation(emulation, { at }) {
  const run = isObject(emulation) ? emulation : {};
  const entries = list(run.entryPoints, 50);
  const items = [...apiItems(entries, at), ...fileItems(entries, at), ...registryItems(entries, at), ...networkItems(entries, at)];
  for (const entry of entries) {
    if (isObject(entry.error)) {
      const where = stopPoint(entry.error);
      items.push(item('emulation-stopped', at, `Emulation stopped: ${where}.`, { reason: `emulator-error ${where}` }));
    }
  }
  if (run.failure) items.push(item('emulation-stopped', at, 'The emulator could not load or run the file.', { reason: 'emulator-failed' }));
  else if (Number(run.seconds) >= Number(run.timeoutSeconds)) items.push(item('emulation-stopped', at, 'Emulation used its whole time limit.', { reason: 'emulator-timeout' }));
  return items;
}

/** Coverage detail for the emulate step: where it stopped, as in SPEC 6.6 ("stopped at NtQuerySystemInformation"). */
export function emulationCoverage(emulation) {
  const run = isObject(emulation) ? emulation : {};
  const stopped = list(run.entryPoints, 50).find(entry => isObject(entry.error));
  if (run.failure) return { status: 'failed', detail: 'The emulator could not load or run the file.' };
  // Speakeasy counts instructions only for some runs; without a count the run time says how far it got.
  if (stopped) return { status: 'stopped', detail: `Stopped at ${stopPoint(stopped.error)} after ${Number(run.instructions) > 0 ? `${Number(run.instructions)} instructions` : `${Number(run.seconds) || 0} s`}.` };
  if (Number(run.seconds) >= Number(run.timeoutSeconds)) return { status: 'stopped', detail: `Stopped at the ${Number(run.timeoutSeconds)} s limit.` };
  return { status: 'done', detail: `Emulated ${list(run.entryPoints, 50).length} entry point(s) in ${Number(run.seconds) || 0} s.` };
}
