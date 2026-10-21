// Wine run (deploy/detonation/runner/wine_run.py) to EVIDENCE.md items, screenshot artifacts and a coverage step (docs/SPEC.md 6.6
// "Run under Wine"). Pure. The program ran under Wine and controls everything it wrote, so shapes are checked, strings cut and counts capped.

const TEXT = 300;
const MAX_PROCESSES = 20;
const MAX_REGISTRY = 100;
const MAX_FILES = 100;
const MAX_READS = 10;
const FAST_FAIL_SECONDS = 2; // SPEC 6.6: a program that exits within 2 s with a Wine error "could not run"
const MAX_SHOT_BYTES = 1024 * 1024;
const REPLAY_IMAGE_BYTES = 30_000; // the replay shows a picture inline only below 37 KB (replay.mjs MAX_IMAGE_CHARS)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHOT_NAME = /^[a-z0-9]{1,6}$/;
const HIVES = new Set(['HKCU', 'HKLM', 'HKCR', 'HKU']);
const REGISTRY_KINDS = new Set(['key-added', 'key-changed', 'key-deleted']);
const FILE_KINDS = new Set(['added', 'changed', 'deleted']);
// Processes Wine starts itself at every boot: they say nothing about the program.
const WINE_INTERNAL = /(?:^|[\\/])(?:winedevice|services|plugplay|rpcss|explorer|conhost|wineboot|svchost|start)\.exe$/i;
const text = (value, size = TEXT) => String(value ?? '').slice(0, size);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value, max) => (Array.isArray(value) ? value.filter(isObject).slice(0, max) : []);
const item = (kind, at, detail, fields) => ({ source: 'wine', kind, detail, at, ...fields });

/** True when Wine could not run the program: it ended within 2 s, with a failing exit code and an error from Wine itself. */
export function wineCouldNotRun(wine) {
  const run = isObject(wine) ? wine : {};
  if (run.booted === false || Number(run.commands) === 0) return true;
  return run.timedOut !== true && Number(run.seconds) <= FAST_FAIL_SECONDS && Number(run.exitCode) !== 0 && Array.isArray(run.errors) && run.errors.length > 0;
}

function screenshots(shots, at, itemIndex) {
  const artifacts = {};
  const evidence = [];
  for (const shot of list(shots, 3)) {
    const name = text(shot.name, 6);
    if (!SHOT_NAME.test(name) || typeof shot.data !== 'string' || !BASE64.test(shot.data) || shot.data.length > Math.ceil(MAX_SHOT_BYTES * 4 / 3) + 4) continue;
    const png = Buffer.from(shot.data, 'base64');
    if (png.length > MAX_SHOT_BYTES || !png.subarray(0, 8).equals(PNG_SIGNATURE)) continue;
    const file = `wine-i${itemIndex}-${name}.png`;
    artifacts[file] = png;
    evidence.push(item('screenshot', at, `Screen of the Wine desktop (${name === 'exit' ? 'at exit' : `after ${name}`}).`, {
      caption: name === 'exit' ? 'Wine desktop at exit' : `Wine desktop after ${name}`, artifact: file,
      ...(png.length <= REPLAY_IMAGE_BYTES ? { image: `data:image/png;base64,${shot.data}` } : {}),
    }));
  }
  return { artifacts, evidence };
}

/**
 * Maps the `wine` object of the runner line. `item` is the item index (names the screenshot artifacts). Returns
 * `{evidence, artifacts, status, detail, couldNotRun, completed}`: `completed` is true only when the program ran and ended on its own,
 * so a run that Wine could not start or that used the whole time limit lets the chain go on to the emulator.
 */
export function mapWine(wine, { at, item: itemIndex = 0 }) {
  const run = isObject(wine) ? wine : {};
  const couldNotRun = wineCouldNotRun(run);
  const registry = list(run.registry, MAX_REGISTRY).flatMap(event => {
    const hive = text(event.hive, 4);
    return REGISTRY_KINDS.has(event.kind) && HIVES.has(hive)
      ? [{ source: 'registry', kind: event.kind, detail: `${event.kind} ${hive}\\${text(event.key, 120)}`, at, hive, key: text(event.key, 400), value: text(event.value, 120), data: text(event.data) }] : [];
  });
  const files = list(run.files, MAX_FILES).flatMap(event => (FILE_KINDS.has(event.kind) && event.path
    ? [{
      source: 'wine', kind: event.kind, detail: `${event.kind} ${text(event.path, 120)}`, at, path: text(event.path, 400), seeded: false, sizeBefore: null,
      sizeAfter: Number.isSafeInteger(event.sizeAfter) ? event.sizeAfter : null, entropyAfter: typeof event.entropyAfter === 'number' ? event.entropyAfter : null, executable: event.executable === true,
    }] : []));
  const processes = list(run.processes, 40).filter(process => process.path && !WINE_INTERNAL.test(text(process.path))).slice(0, MAX_PROCESSES)
    .map(process => item('execve', at, `started ${text(process.path, 120)}`, { path: text(process.path, 400), argv: (Array.isArray(process.argv) ? process.argv : []).slice(0, 20).map(part => text(part, 200)) }));
  const reads = list(run.registryReads, MAX_READS).map(read => item('registry-read', at, `read ${text(read.key, 120)}`, { hive: HIVES.has(text(read.hive, 4)) ? text(read.hive, 4) : 'HKCU', key: text(read.key, 400) }));
  const markers = (Array.isArray(run.wineExports) ? run.wineExports : []).slice(0, MAX_READS).map(name => item('api-call', at, `${text(name, 60)} looked up.`, { api: text(name, 60), args: {}, count: 1 }));
  const pictures = screenshots(run.screenshots, at, itemIndex);
  const timedOut = run.timedOut === true;
  const evidence = [
    ...processes, ...registry, ...files, ...reads, ...markers, ...pictures.evidence,
    ...(timedOut ? [item('emulation-stopped', at, `The program was still running at the ${Number(run.limitSeconds) || 12} s limit.`, { reason: 'wine-timeout' })] : []),
  ];
  const seconds = Number(run.seconds) || 0;
  let status = 'done';
  let detail = `Ran under Wine for ${seconds} s; exit code ${Number(run.exitCode) || 0}; ${processes.length} process(es), ${registry.length} registry change(s), ${files.length} file change(s) in the prefix, ${pictures.evidence.length} screenshot(s).`;
  if (couldNotRun) {
    status = 'failed';
    detail = `Wine could not run it (exit code ${Number(run.exitCode) || 0} after ${seconds} s${run.errors?.[0] ? `: ${text(run.errors[0], 120)}` : ''}).`;
  } else if (timedOut) {
    status = 'stopped';
    detail = `Stopped at the ${Number(run.limitSeconds) || 12} s limit; ${processes.length} process(es), ${registry.length} registry change(s), ${files.length} file change(s) in the prefix, ${pictures.evidence.length} screenshot(s).`;
  }
  return {
    evidence, artifacts: pictures.artifacts, status, detail, couldNotRun, completed: !couldNotRun && !timedOut,
  };
}
