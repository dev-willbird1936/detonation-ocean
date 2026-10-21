// Unwrap results (deploy/detonation/runner/unwrap.py, identify.py) to child items, evidence and a coverage step (docs/SPEC.md 5.3, 6.6 "Unwrap").
// Pure. The tools ran on an untrusted file, so shapes are checked and strings cut before they leave this module.
import { mapUnpack } from './runner-result.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, size = 120) => String(value ?? '').slice(0, size);

// What the file was, in the words of a coverage detail.
export const WRAPPER_LABELS = {
  upx: 'a UPX-packed program', inno: 'an Inno Setup installer', nsis: 'an NSIS installer', sfx: 'a self-extracting archive', '7z': 'an archive',
  msi: 'an MSI package', pyinstaller: 'a PyInstaller bundle', asar: 'an Electron archive', electron: 'an Electron app', dotnet: 'a .NET assembly',
};

/**
 * `unwrap` is the runner's `{method, format, entries, stopped, listed, detail?, inspectOnly?, innoVersion?}`. Returns `{children, evidence, step}`.
 * A child keeps `inspectOnly` when the tool says its parts are read and never run (PyInstaller scripts, Electron JavaScript). A tool that
 * unpacked nothing and said why is `failed`, not `stopped`: the file was not opened at all.
 */
export function mapUnwrap(unwrap, { at, budget, itemIndex, depth }) {
  const data = isObject(unwrap) ? unwrap : {};
  const { children, evidence, stopped } = mapUnpack(data, { at, budget, itemIndex, depth });
  const inspectOnly = data.inspectOnly === true;
  const label = WRAPPER_LABELS[text(data.format, 20)] ?? 'a container';
  const failed = !isObject(unwrap) || (stopped === 'error' && children.length === 0);
  const notes = failed ? [] : [
    data.format === 'inno' ? 'innoextract lists the installer files only; its [Run] entries are not exposed' : '',
    data.format === 'inno' && data.innoVersion ? `setup data ${text(data.innoVersion, 20)}` : '',
    inspectOnly ? 'its parts are inspected, not run' : '',
  ].filter(Boolean);
  // innoextract is stale upstream: it reads Inno Setup up to 6.3.3 and says only "Could not determine setup data version!" for a newer installer.
  const reason = data.format === 'inno' && !data.innoVersion ? 'innoextract reads Inno Setup only up to 6.3.3, and this installer was not recognised' : text(data.detail, 160).replace(/\s+/g, ' ').trim();
  let detail = `Unwrapped ${label}: ${children.length} part(s)`;
  let status = 'done';
  if (failed) {
    status = 'failed';
    detail = `Could not unwrap ${label}${reason ? `: ${reason}` : ''}`;
  } else if (stopped) {
    status = 'stopped';
    detail = `Unwrapped ${label}: ${children.length} part(s), then stopped at a limit`;
  }
  return {
    children: children.map(child => ({ ...child, inspectOnly })),
    evidence,
    step: { step: 'unwrap', status, detail: `${[detail, ...notes].join('; ')}.` },
  };
}
