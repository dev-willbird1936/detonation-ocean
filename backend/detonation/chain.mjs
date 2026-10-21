// The M4b compatibility chain for one item (docs/SPEC.md 6.6): identify → unwrap → Wine (runc, flag-gated) → emulate → static → generic.
// Each step that runs is its own container with its own 30 s wall clock (`run` goes through `runContainer`, so the 6.3 flags and the isolation
// check apply to every one); the job's 180 s cap bounds the sum, so a step that no longer fits is skipped and listed as such.
// Returns what stages.mjs `detonate` returns: `{containers, evidence, coverage, children}` plus the facts the job pipeline needs.
import { checkUnpackChildren, clampUnpackBudget, mapRunnerLine, parseRunnerLine } from './runner-result.mjs';
import { mapIdentify, identifyDetail } from './identify.mjs';
import { mapGeneric, mapStatic } from './static.mjs';
import { mapUnwrap } from './unwrap.mjs';
import { mapWine } from './wine.mjs';

const PE_TYPES = new Set(['exe', 'dll']);
const WINE_ONLY_TYPES = new Set(['msi', 'bat', 'vbs', 'js-wsh', 'hta']);
const WINE_KIND = { exe: 'exe', dll: 'dll', msi: 'msi', bat: 'bat', vbs: 'wsh', 'js-wsh': 'wsh', hta: 'hta' };
const WINE_EXTENSION = { exe: 'exe', dll: 'dll', msi: 'msi', bat: 'bat', vbs: 'vbs', 'js-wsh': 'js', hta: 'hta' };
const EXPORT_NAME = /^[A-Za-z0-9_@#?$.-]{1,64}$/; // wine_run.py checks the same pattern
const MAX_EXPORTS = 3;
const STEP_MS = 35_000; // a container's 30 s wall clock plus create, inspect and kill around it
const WINE_STDOUT_BYTES = 4.5 * 1024 * 1024; // three PNGs of up to 1 MB as base64, plus the evidence JSON
const UNPACK_STDOUT_BYTES = 4 * 1024 * 1024; // up to 50 entries with 32 KB of head each, as base64
const PARSER_HEAD_BYTES = 4 * 1024;
const ASAR_JSON_AT = 16;
const SAFE_EXTENSION = /^[a-z0-9]{1,8}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** True for the head of an Electron `.asar` archive: a 4-byte pickle size of 4, then the pickled JSON header that starts `{"files":`. */
export function isAsar(head) {
  return Buffer.isBuffer(head) && head.length >= ASAR_JSON_AT + 9 && head.readUInt32LE(0) === 4 && head.toString('latin1', ASAR_JSON_AT, ASAR_JSON_AT + 9) === '{"files":';
}

/**
 * What the chain does with an item, from its detected type and size tier: `pe` (exe, dll), `pe-static` (a PE over 10 MB: identify and static only),
 * `msi`, `msi-static` (unwrap without executing the large wrapper), `wine-script` (bat, vbs, js for wscript, hta), `asar` or `generic`. A part of a PyInstaller bundle or an Electron app (`inspectOnly`) is
 * always `generic`: it is read, never run.
 */
export function chainFamily(typed, head) {
  if (typed.inspectOnly) return 'generic';
  const full = typed.sizeTier !== 'static';
  if (PE_TYPES.has(typed.detectedType)) return full ? 'pe' : 'pe-static';
  if (typed.detectedType === 'msi') return full ? 'msi' : 'msi-static';
  if (WINE_ONLY_TYPES.has(typed.detectedType) && full) return 'wine-script';
  if (typed.detectedType === 'unknown' && isAsar(head)) return 'asar';
  return 'generic';
}

const stepOf = (step, status, detail) => ({ step, status, detail });

/**
 * `run(ctx, role, spec)` starts a verified container; `receiptRecord(result)` is the receipt record of a finished one; `wineApproved` is
 * DETONATION_WINE_RUNC=true. The returned function takes the item's job context.
 */
export function createChain({ run, receiptRecord, wineApproved }) {
  return async function detonateChain(ctx) {
    const typed = ctx.typed;
    const family = chainFamily(typed, ctx.item?.head ?? ctx.head);
    const from = ctx.item?.from;
    const itemIndex = ctx.itemIndex ?? 0;
    const out = { containers: [], evidence: [], steps: [], children: [], artifacts: {}, label: 'Inspected', path: 'inspect', identify: '', parse: undefined };
    const pe = family === 'pe' || family === 'pe-static';
    const extension = WINE_EXTENSION[typed.detectedType] ?? (SAFE_EXTENSION.test(typed.claimedExtension) ? typed.claimedExtension : 'bin');
    let detonateAttempt = 0;
    let primary = null; // the item's first container: its runsc log is the one parseTrace reads
    let ran = false;
    const at = () => ctx.clock().toISOString();
    const fits = () => !ctx.signal?.aborted && !(typeof ctx.timeLeftMs === 'function' && ctx.timeLeftMs() < STEP_MS);
    const budget = clampUnpackBudget(ctx.budget);
    const unwrapStop = ctx.unwrapDepthExceeded ? 'depth' : budget.entries === 0 ? 'entries' : budget.bytes === 0 ? 'bytes' : null;
    const unwrapStopDetail = unwrapStop === 'depth' ? 'Not unwrapped: nested more than 3 levels deep.' : 'Not unwrapped: the remaining entry or byte budget was used.';
    const stopped = (reason, detail) => out.evidence.push({ source: 'static', kind: 'emulation-stopped', detail, at: at(), reason });
    const skipForBudget = (step, label) => {
      out.steps.push(stepOf(step, 'skipped', `${label}: skipped (job time budget).`));
      stopped('job-budget', `${label} was not run: the job time budget was used.`);
    };

    // A container of the detonate image. The first one of the item is the one whose runsc log parseTrace reads.
    const detonate = async (kind, command, extra = {}) => {
      detonateAttempt += 1;
      const result = await run(ctx, 'detonate', { attempt: detonateAttempt, wallClockMs: ctx.caps.detonate, command: [kind, ...command], ...extra });
      const record = receiptRecord(result);
      out.containers.push(record);
      if (!primary) {
        primary = { id: JSON.parse(result.inspectJson)[0].Id, record, runnable: false, kind };
        ctx.detonation = primary; // a child's context is a copy of its parent's: always set a fresh one
      }
      const parsedLine = parseRunnerLine(result.stdout);
      const line = parsedLine?.kind === kind && parsedLine.started === true && !result.truncated ? parsedLine : null;
      if (!line && record.exit.reason === null) stopped('runner-no-result', 'The runner printed no valid result.');
      return { line, record };
    };
    const fromArgs = from ? ['--from', from, '--source-size', String(ctx.item.size)] : [];
    // The first container's limits are reported by parseTrace (stages.mjs), which reads its exit record.
    const limitItems = record => (record === primary?.record ? []
      : record.exit.reason === 'oom' ? [{ source: 'limits', kind: 'oom', detail: 'A step was killed for using more than 512 MB.', at: at() }]
        : record.exit.reason === 'time' ? [{ source: 'limits', kind: 'time', detail: 'A step was stopped at the wall-clock limit.', at: at() }] : []);

    // Strings, entropy, binwalk and YARA for any file; also the model-written parser's input for a format nobody knows.
    const generic = async () => {
      if (detonateAttempt > 0 && !fits()) {
        skipForBudget('generic', 'Generic analysis');
        return;
      }
      const { line, record } = await detonate('generic', ['--ext', 'bin', ...fromArgs]);
      out.evidence.push(...limitItems(record));
      if (!line?.generic) {
        out.steps.push(stepOf('generic', 'failed', 'The generic tools printed no result.'));
        if (line) stopped('runner-invalid-result', 'The generic result was missing its report.');
        return;
      }
      const mapped = mapGeneric(line.generic, { at: at() });
      out.evidence.push(...mapped.evidence);
      out.steps.push(stepOf('generic', mapped.status, mapped.detail));
      const head = typeof line.generic.head === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(line.generic.head) ? Buffer.from(line.generic.head, 'base64') : null;
      if (typed.detectedType === 'unknown' && head?.length) out.parse = { bytes: head.subarray(0, PARSER_HEAD_BYTES) };
    };
    if (family === 'wine-script' || family === 'generic') await generic();

    const keepUnwrapped = mapped => {
      const checked = checkUnpackChildren(mapped.children, { at: at(), budget, itemIndex, depth: ctx.unwrapDepthExceeded ? 4 : undefined });
      out.children.push(...checked.children);
      out.evidence.push(...mapped.evidence, ...checked.evidence);
      out.steps.push(checked.stopped ? stepOf('unwrap', checked.stopped === 'error' && !checked.children.length ? 'failed' : 'stopped', 'Unwrapping returned invalid children or exceeded the remaining controller budget.') : mapped.step);
    };

    // --- identify and unwrap ---------------------------------------------------------------------------------------------------
    let identified = null;
    if (pe) {
      const { line, record } = await detonate('identify', ['--ext', extension, '--max-entries', String(unwrapStop ? 0 : budget.entries), '--max-bytes', String(unwrapStop ? 0 : budget.bytes), ...fromArgs], { outputCapBytes: UNPACK_STDOUT_BYTES });
      out.evidence.push(...limitItems(record));
      if (!line || !isObject(line.identify) || !Object.hasOwn(line, 'unwrap')) {
        out.steps.push(stepOf('unwrap', 'failed', 'The identify tool printed no valid result.'));
        if (line) stopped('runner-invalid-result', 'The identify result was missing its identification or unwrap fields.');
      } else {
        identified = line;
        out.identify = identifyDetail(line.identify);
        out.evidence.push(...mapIdentify(line.identify, line.dotnet, { at: at() }));
        if (line.unwrap === null) {
          out.steps.push(stepOf('unwrap', 'done', 'Not a packer or installer: nothing to unwrap.'));
        } else if (unwrapStop) {
          out.steps.push(stepOf('unwrap', 'skipped', unwrapStopDetail));
          stopped(`unpack-${unwrapStop}`, unwrapStopDetail);
        } else {
          keepUnwrapped(mapUnwrap(line.unwrap, { at: at(), budget, itemIndex }));
        }
      }
    } else if (family === 'msi' || family === 'msi-static' || family === 'asar') {
      if (unwrapStop) {
        out.steps.push(stepOf('unwrap', 'skipped', unwrapStopDetail));
        stopped(`unpack-${unwrapStop}`, unwrapStopDetail);
      } else {
        const method = family === 'asar' ? 'asar' : 'msi';
        const { line, record } = await detonate('unwrap', ['--method', method, '--ext', extension, '--max-entries', String(budget.entries), '--max-bytes', String(budget.bytes), ...fromArgs], { outputCapBytes: UNPACK_STDOUT_BYTES });
        out.evidence.push(...limitItems(record));
        if (!line) {
          out.steps.push(stepOf('unwrap', 'failed', 'The unwrap tool printed no result.'));
        } else {
          keepUnwrapped(mapUnwrap(line.unpack, { at: at(), budget, itemIndex }));
        }
      }
    }

    const unpackedUpx = identified?.unwrap?.format === 'upx' && out.children.length > 0;
    const dotnet = identified?.identify?.dotnet === true;

    // --- run under Wine --------------------------------------------------------------------------------------------------------
    let wineCompleted = false;
    const wineKind = WINE_KIND[typed.detectedType];
    if (family === 'pe-static' || family === 'msi-static') out.steps.push(stepOf('wine', 'skipped', 'Wine: skipped (the file is over 10 MB: the wrapper is inspected only).'));
    if (family === 'pe' || family === 'wine-script' || family === 'msi') {
      let skip = null;
      if (unpackedUpx) skip = 'Wine: skipped (analysed through the unpacked program).';
      else if (dotnet) skip = 'Wine: skipped (a .NET assembly needs Wine Mono, which is not installed).';
      else if (wineApproved !== true) skip = 'Wine: skipped (not approved)';
      if (skip) {
        out.steps.push(stepOf('wine', 'skipped', skip));
      } else if (!fits()) {
        skipForBudget('wine', 'Wine');
      } else {
        const exports = (Array.isArray(identified?.identify?.exports) ? identified.identify.exports : []).filter(name => typeof name === 'string' && EXPORT_NAME.test(name)).slice(0, MAX_EXPORTS);
        let result;
        try {
          result = await run(ctx, 'wine', {
            wallClockMs: ctx.caps.detonate, outputCapBytes: WINE_STDOUT_BYTES,
            command: ['--kind', wineKind, '--file', '/in/sample', '--ext', extension, ...(from ? ['--source', from, '--source-size', String(ctx.item.size)] : []), ...(wineKind === 'dll' && exports.length ? ['--export', exports.join(',')] : [])],
          });
        } catch (error) {
          if (error.code !== 'WINE_JOB_BUDGET') throw error;
          skipForBudget('wine', 'Wine');
        }
        if (result) {
          const record = receiptRecord(result);
          out.containers.push(record);
          const parsedLine = parseRunnerLine(result.stdout);
          const line = parsedLine?.kind === wineKind && parsedLine.started === true && !result.truncated ? parsedLine : null;
          const wine = line?.wine;
          out.evidence.push(...limitItems(record));
          if (!isObject(wine) || typeof wine.booted !== 'boolean' || typeof wine.timedOut !== 'boolean'
            || !Number.isSafeInteger(wine.commands) || wine.commands < 0 || wine.commands > MAX_EXPORTS
            || !Number.isFinite(wine.seconds) || wine.seconds < 0 || !(Number.isSafeInteger(wine.exitCode) || (wine.commands === 0 && wine.exitCode === null))) {
            out.steps.push(stepOf('wine', 'failed', 'Wine printed no valid result.'));
            if (record.exit.reason === null) stopped('runner-no-result', 'Wine printed no valid result.');
          } else {
            const mapped = mapWine(wine, { at: at(), item: itemIndex });
            out.evidence.push(...mapped.evidence);
            Object.assign(out.artifacts, mapped.artifacts);
            const hostLimited = record.exit.reason === 'oom' || record.exit.reason === 'time';
            const detail = hostLimited
              ? `Stopped by the container ${record.exit.reason === 'oom' ? 'memory' : 'wall-clock'} limit; ${mapped.detail}`
              : mapped.detail;
            out.steps.push(stepOf('wine', hostLimited ? 'stopped' : mapped.status, detail));
            wineCompleted = mapped.completed && !hostLimited;
            if (!mapped.couldNotRun) { ran = true; out.label = 'Ran under Wine'; out.path = 'wine'; }
          }
        }
      }
    }

    // --- emulate ---------------------------------------------------------------------------------------------------------------
    if (pe) {
      if (unpackedUpx) out.steps.push(stepOf('emulate', 'skipped', 'Emulation: skipped (analysed through the unpacked program).'));
      else if (dotnet) out.steps.push(stepOf('emulate', 'skipped', 'Emulation: skipped (a .NET assembly is read statically and not run).'));
      else if (family === 'pe-static') out.steps.push(stepOf('emulate', 'skipped', 'Emulation: skipped (the file is over 10 MB: static analysis only).'));
      else if (wineCompleted) out.steps.push(stepOf('emulate', 'skipped', 'Emulation: not needed (Wine ran the program to its end).'));
      else if (!fits()) skipForBudget('emulate', 'Emulation');
      else {
        const { line, record } = await detonate('exe', ['--ext', 'exe', ...fromArgs]);
        out.evidence.push(...limitItems(record));
        const mapped = mapRunnerLine('exe', line, { at: at(), sampleUrl: 'file:///tmp/dt/sample.exe' });
        out.evidence.push(...mapped.evidence);
        out.steps.push(...mapped.steps);
        if (line) { ran = true; if (out.path !== 'wine') { out.label = 'Emulated'; out.path = 'emulate'; } }
      }
    } else if (family === 'wine-script' || family === 'msi' || family === 'msi-static') {
      out.steps.push(stepOf('emulate', 'skipped', 'Emulation: no emulator is shipped for this type.'));
    }

    // --- static (capa and YARA) ------------------------------------------------------------------------------------------------
    if (pe) {
      if (unpackedUpx) out.steps.push(stepOf('static', 'skipped', 'Static: skipped (analysed through the unpacked program).'));
      else if (!fits()) skipForBudget('static', 'Static analysis');
      else {
        const { line, record } = await detonate('static', ['--ext', extension, '--format', 'pe', ...fromArgs]);
        out.evidence.push(...limitItems(record));
        if (!line?.static) {
          out.steps.push(stepOf('static', 'failed', 'The static tools printed no result.'));
          if (line) stopped('runner-invalid-result', 'The static result was missing its report.');
        } else {
          const staticReport = isObject(line.static) ? line.static : {};
          const mapped = mapStatic({ ...staticReport, capa: isObject(staticReport.capa) ? staticReport.capa : { ok: false } }, { at: at() });
          out.evidence.push(...mapped.evidence);
          out.steps.push(stepOf('static', mapped.status, mapped.detail));
        }
      }
    }

    if (family === 'msi' || family === 'msi-static' || family === 'asar') await generic();

    if (primary) primary.runnable = ran;
    return out;
  };
}
