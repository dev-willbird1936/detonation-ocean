// The detonate runner's last stdout line (deploy/detonation/runner/run.sh) to evidence, coverage steps and child entries
// (docs/SPEC.md 5.3, 6.6; docs/detonation/EVIDENCE.md). Pure. The line is produced by tools that handled an untrusted file, so it is
// parsed defensively: anything unexpected is dropped, never thrown.
import { emulationCoverage, mapEmulation } from './emulator.mjs';
import { mapBrowser } from './browser.mjs';
import { mapOffice, mapPdf, mapPs1 } from './static.mjs';

export const MAX_DEPTH = 3; // SPEC 5.3: archives nested up to 3 levels are unpacked
export const MAX_ENTRIES = 50;
export const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_HEAD_BYTES = 32 * 1024;
const CHILD_PATH = /^\/home\/dana\/Downloads\/\.unpacked\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.dat$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const STOP_REASONS = { entries: 'the remaining entry budget', bytes: 'the remaining byte budget', depth: 'the nesting depth limit', ratio: 'a compression ratio above 100:1', encrypted: 'an encrypted entry', error: 'an unreadable archive or invalid runner result' };
const HOST_URL = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/@\s]*@)?(\[[^\]]+\]|[^/:?#\s]+)/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, size = 200) => String(value ?? '').slice(0, size);

/** The runner's status object: the last non-empty stdout line, if it is JSON with `detonationRunner: 1`; else null. */
export function parseRunnerLine(stdout) {
  const last = String(stdout ?? '').trimEnd().split('\n').at(-1);
  try {
    const parsed = JSON.parse(last);
    return isObject(parsed) && parsed.detonationRunner === 1 ? parsed : null;
  } catch {
    return null;
  }
}

const hostOf = url => HOST_URL.exec(String(url))?.[1]?.toLowerCase().replace(/^\[|\]$/g, '');

/** Link text that names one host while the link goes to another, or a link to an address, is a phishing indicator (harm unproven). */
function linkIndicators(links, at) {
  const items = [];
  for (const { href, text: shown } of Array.isArray(links) ? links.filter(isObject).slice(0, 50) : []) {
    const target = hostOf(href);
    const named = hostOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(shown) ? shown : `http://${String(shown).trim()}`);
    const mismatch = target && named && /^[^\s]+\.[^\s]+$/.test(String(shown).trim()) && target !== named;
    if (mismatch || (target && IPV4.test(target)) || target?.startsWith('xn--')) {
      items.push({ source: 'static', kind: 'phishing-indicator', detail: 'An email link does not go where its text says, or goes to a bare address.', at, indicator: mismatch ? 'link text differs from target host' : 'link to an address or punycode host' });
    }
  }
  return items.slice(0, 10);
}

/** Remaining controller budget, always bounded by SPEC 5.3; malformed or negative values exhaust that budget. */
export const clampUnpackBudget = (budget = {}) => {
  const clamp = (value, max) => value === undefined ? max : Number.isSafeInteger(value) ? Math.max(0, Math.min(max, value)) : 0;
  return { entries: clamp(budget?.entries, MAX_ENTRIES), bytes: clamp(budget?.bytes, MAX_UNPACKED_BYTES) };
};

/** Controller-owned child storage contract shared by unpack result validation and job admission. */
export function isChildPath(path, parentIndex) {
  const match = typeof path === 'string' ? CHILD_PATH.exec(path) : null;
  return Boolean(match && match[0] === path && Number.isSafeInteger(Number(match[1])) && Number(match[1]) <= MAX_ENTRIES
    && Number(match[2]) < MAX_ENTRIES && (parentIndex === undefined || match[1] === String(parentIndex)));
}

const unpackStopped = (stopped, at) => stopped ? [{
  source: 'static', kind: 'emulation-stopped', detail: `Unpacking stopped: ${STOP_REASONS[stopped] ?? 'a limit'}.`, at,
  reason: `unpack-${Object.hasOwn(STOP_REASONS, stopped) ? stopped : 'limit'}`,
}] : [];

/** Re-check mapped children at every controller admission boundary, including installer and asar branches. */
export function checkUnpackChildren(list, { at, budget, itemIndex, depth, seenPaths } = {}) {
  const remaining = clampUnpackBudget(budget);
  const children = [];
  const paths = new Set();
  let bytes = 0;
  let stopped = !Array.isArray(list) ? 'error' : null;
  if (Array.isArray(list) && list.length && depth > MAX_DEPTH) stopped = 'depth';
  for (const child of Array.isArray(list) && !stopped ? list : []) {
    if (children.length >= remaining.entries) { stopped = 'entries'; break; }
    if (!isObject(child) || typeof child.name !== 'string' || !isChildPath(child.path, itemIndex) || paths.has(child.path) || seenPaths?.has(child.path)
      || !Number.isSafeInteger(child.size) || child.size < 0 || !Buffer.isBuffer(child.head)
      || child.head.length > Math.min(child.size, MAX_HEAD_BYTES) || (child.size > 0 && child.head.length === 0)) {
      stopped = 'error'; break;
    }
    if (bytes + child.size > remaining.bytes || remaining.bytes === 0) { stopped = 'bytes'; break; }
    paths.add(child.path);
    seenPaths?.add(child.path);
    bytes += child.size;
    children.push({ ...child, name: text(child.name), head: Buffer.from(child.head) });
  }
  return { children, stopped, evidence: unpackStopped(stopped, at) };
}

/** Untrusted unpack result to bounded children. Invalid or dropped entries always leave incomplete coverage evidence. */
export function mapUnpack(unpack, { at, budget, itemIndex, depth }) {
  const valid = isObject(unpack) && Array.isArray(unpack.entries)
    && (unpack.stopped === undefined || unpack.stopped === null || typeof unpack.stopped === 'string');
  const entries = valid ? unpack.entries.slice(0, MAX_ENTRIES + 1).map(entry => {
    const head = isObject(entry) && typeof entry.head === 'string' && BASE64.test(entry.head)
      && entry.head.length <= Math.ceil(MAX_HEAD_BYTES * 4 / 3) + 4 ? Buffer.from(entry.head, 'base64') : null;
    return isObject(entry) ? { name: entry.name, size: entry.size, path: entry.path, head: head?.toString('base64') === entry.head ? head : null } : null;
  }) : null;
  const checked = checkUnpackChildren(entries, { at, budget, itemIndex, depth });
  const stopped = checked.stopped ?? (typeof unpack?.stopped === 'string' && unpack.stopped ? text(unpack.stopped, 40) : null);
  return { children: checked.children, stopped, evidence: [...unpackStopped(stopped, at), ...linkIndicators(unpack?.links, at)] };
}

const runResult = (line, what, at) => {
  if (Number.isSafeInteger(line.exitCode)) return { evidence: [], step: { step: 'run', status: 'done', detail: `${what}; exit code ${line.exitCode}.` } };
  const detail = 'The runner returned a missing or malformed exit code.';
  return {
    evidence: [{ source: 'static', kind: 'emulation-stopped', detail, at, reason: 'runner-invalid-result' }],
    step: { step: 'run', status: 'failed', detail },
  };
};

/**
 * Maps one runner status line. `kind` is the runner kind. Returns `{evidence, steps, children}`: `steps` are SPEC 6.6 coverage steps
 * (`{step, status, detail}`) for what this runner did; the caller adds `identify`. A kind with no parsable line gets a failed step.
 */
export function mapRunnerLine(kind, line, { at, sampleUrl, budget, itemIndex, depth }) {
  if (!line) return { evidence: [], steps: [{ step: kind === 'zip' || kind === 'eml' ? 'unwrap' : kind === 'exe' ? 'emulate' : 'run', status: 'failed', detail: 'The runner printed no result.' }], children: [] };
  switch (kind) {
    case 'py': case 'sh': case 'node': {
      const run = runResult(line, 'The script ran', at);
      return { evidence: run.evidence, steps: [run.step], children: [] };
    }
    case 'ps1': {
      const evidence = mapPs1(line.static, { at });
      const staticFailed = evidence.some(item => item.reason === 'ps1-static-failed');
      const staticTruncated = evidence.some(item => item.reason === 'ps1-static-truncated');
      const run = runResult(line, 'PowerShell 7 ran the script', at);
      return {
        evidence: [...evidence, ...run.evidence],
        steps: [
          { step: 'static', status: staticFailed ? 'failed' : staticTruncated ? 'stopped' : 'done', detail: staticFailed ? 'The PowerShell static scanner returned no valid report.' : staticTruncated ? 'The PowerShell static scan reached its byte cap; prefix indicators are retained.' : `${evidence.length} indicator(s) in the script text.` },
          run.step,
        ],
        children: [],
      };
    }
    case 'html': case 'svg': case 'pdf': {
      const browser = line.browser;
      const browserError = isObject(browser) && Boolean(browser.error);
      const browserStatusValid = isObject(browser) && typeof browser.loaded === 'boolean'
        && (browser.error === null || (typeof browser.error === 'string' && browser.error.length > 0));
      const browserIncomplete = !browserStatusValid || (browser?.loaded === false && !browserError);
      const pdfEvidence = kind === 'pdf' ? mapPdf(line.static, { at }) : [];
      const pdfidFailed = pdfEvidence.some(item => item.reason === 'pdfid-failed');
      const pdfToolFailed = pdfEvidence.some(item => item.reason === 'pdf-static-failed');
      const pdfStaticFailed = pdfidFailed || pdfToolFailed;
      const evidence = [...mapBrowser(browser, { at, sampleUrl }), ...pdfEvidence];
      if (browserIncomplete && !evidence.some(item => item.kind === 'emulation-stopped')) {
        evidence.push({ source: 'browser', kind: 'emulation-stopped', detail: 'The browser did not return a valid completion status.', at, reason: 'browser-failed' });
      }
      const stopped = browserIncomplete || browserError;
      const steps = [
        ...(kind === 'pdf' ? [{
          step: 'static', status: pdfStaticFailed ? 'failed' : 'done',
          detail: pdfidFailed ? 'pdfid produced no counts; static PDF analysis is incomplete.'
            : pdfToolFailed ? 'A PDF static tool returned an error; static analysis is incomplete.'
              : `pdfid and pdf-parser found ${pdfEvidence.filter(item => item.kind === 'exploit-indicator').length} exploit indicator(s).`,
        }] : []),
        {
          step: 'run', status: stopped ? 'stopped' : 'done',
          detail: browserIncomplete ? 'The browser did not return a valid completion status.'
            : stopped ? 'The browser stopped before the page finished.'
              : kind === 'pdf' ? 'Loaded in Chromium; its headless shell has no PDF viewer, so the PDF was not rendered.' : 'Rendered in headless Chromium with no network; screenshots taken.',
        },
      ];
      return { evidence, steps, children: [] };
    }
    case 'office': {
      const evidence = mapOffice(line.office, { at });
      const opened = isObject(line.office?.libreoffice) && line.office.libreoffice.opened === true;
      const macros = Number(line.office?.olevba?.macroCount) || 0;
      return {
        evidence,
        steps: [
          { step: 'static', status: line.office?.olevba?.ok !== true ? 'failed' : 'done', detail: `olevba found ${macros} macro module(s).` },
          { step: 'run', status: opened ? 'done' : 'stopped', detail: opened ? 'LibreOffice opened the document with macros enabled.' : 'LibreOffice did not finish opening the document.' },
        ],
        children: [],
      };
    }
    case 'exe': {
      const emulation = line.emulation;
      const validEnvelope = isObject(emulation) && Array.isArray(emulation.entryPoints)
        && typeof emulation.seconds === 'number' && Number.isFinite(emulation.seconds) && emulation.seconds >= 0
        && typeof emulation.timeoutSeconds === 'number' && Number.isFinite(emulation.timeoutSeconds) && emulation.timeoutSeconds > 0
        && (emulation.failure === null || (typeof emulation.failure === 'string' && emulation.failure.length > 0));
      const evidence = mapEmulation(emulation, { at });
      if (!validEnvelope && !evidence.some(item => item.kind === 'emulation-stopped' && item.reason === 'emulator-failed')) {
        evidence.push({ source: 'emulator', kind: 'emulation-stopped', detail: 'The emulator returned a missing or malformed completion report.', at, reason: 'emulator-failed' });
      }
      const coverage = validEnvelope ? emulationCoverage(emulation) : { status: 'failed', detail: 'The emulator returned a missing or malformed completion report.' };
      return { evidence, steps: [{ step: 'emulate', ...coverage }], children: [] };
    }
    case 'zip': case 'eml': {
      const { children, evidence, stopped } = mapUnpack(line.unpack, { at, budget, itemIndex, depth });
      return {
        evidence,
        steps: [{ step: 'unwrap', status: stopped === 'error' && !children.length ? 'failed' : stopped ? 'stopped' : 'done', detail: stopped ? `Unpacked ${children.length} entries, then stopped: ${STOP_REASONS[stopped] ?? 'a limit'}.` : `Unpacked ${children.length} entries.` }],
        children,
      };
    }
    default:
      return { evidence: [], steps: [], children: [] };
  }
}
