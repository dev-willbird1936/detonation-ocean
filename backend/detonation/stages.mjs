// Default job stages that run the images for real (docs/SPEC.md 5.1, 6.3, 6.4; contracts: jobs.mjs `defaultStages`).
// Every container goes through `runContainer`, so the 6.3 flags and the isolation check apply to each of them.
// Run where `docker` and the runsc debug logs (/var/log/runsc/<container id>/) are both reachable: Linux or WSL.
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createChain } from './chain.mjs';
import { RUNSC_LOG_ROOT, assertOpen, classifyExit, runContainer } from './containers.mjs';
import { clampUnpackBudget, mapRunnerLine, parseRunnerLine } from './runner-result.mjs';
import { parseTraceDir } from './trace.mjs';

export { RUNSC_LOG_ROOT };
// Runner kinds by detected type (deploy/detonation/runner/run.sh, the JOB_KIND argument). Scripts run for real, html, svg and pdf in
// Chromium, Office files in LibreOffice, exe in Speakeasy, zip and eml are unpacked. Every other type stays unexecuted.
const KIND_BY_TYPE = {
  py: 'py', sh: 'sh', 'js-node': 'node', ps1: 'ps1', html: 'html', svg: 'svg', pdf: 'pdf', exe: 'exe', zip: 'zip', eml: 'eml',
  docx: 'office', docm: 'office', xlsx: 'office', xlsm: 'office', doc: 'office', xls: 'office', pptx: 'office',
};
const EXTENSION_BY_KIND = { node: 'js' }; // every other kind's extension is its name; Office uses the detected type
const CONTAINER_KINDS = new Set(['zip', 'eml']); // unpacked even when the upload is in the static size tier
const BROWSER_KINDS = new Set(['html', 'svg', 'pdf']);
const UNPACK_STDOUT_BYTES = 4 * 1024 * 1024; // up to 50 entries with 32 KB of head each, as base64
const COLLECT_WALL_MS = 7_000; // under the 10 s collecting stage cap, which also covers the trace parse
const ANALYSE_WALL_MS = 30_000; // SPEC 5.1: 30 s run per analysing attempt
const CONTAINER_ID = /^[0-9a-f]{64}$/;
const SECRET_NAME_RE = /KEY|TOKEN|SECRET/;
const DIFF_SUMMARY_ITEMS = 50;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024; // SPEC 7.3
const ARTIFACT_STDOUT_BYTES = Math.ceil(MAX_ARTIFACT_BYTES * 4 / 3) + 64 * 1024; // base64 of the artifacts plus the script's own lines and JSON framing
const ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|svg|json|txt|csv)$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** The runner kind for a typed item, or undefined when the type is inspected only (`typed` is `{detectedType, path}`). */
export function runnerKind(typed) {
  const kind = KIND_BY_TYPE[typed.detectedType];
  return kind && (typed.path !== 'inspect' || CONTAINER_KINDS.has(kind)) ? kind : undefined;
}

const secretValues = env => Object.entries(env).filter(([name, value]) => SECRET_NAME_RE.test(name.toUpperCase()) && typeof value === 'string' && value.length >= 4).map(([, value]) => value);

/**
 * The harness prints {"artifacts": {"<name>": "<base64>"}} as the last line of stdout (deploy/detonation/analyse/harness.py).
 * Returns `{artifacts, overQuota}` for allowlisted names within the remaining job quota. An over-quota result fails the attempt.
 */
function parseArtifacts(stdout, budget = MAX_ARTIFACT_BYTES) {
  let listed;
  try {
    listed = JSON.parse(stdout.trimEnd().split('\n').at(-1)).artifacts;
  } catch {
    return { artifacts: {}, overQuota: false };
  }
  const artifacts = {};
  let total = 0;
  for (const [name, text] of Object.entries(listed && typeof listed === 'object' ? listed : {})) {
    if (!ARTIFACT_RE.test(name) || typeof text !== 'string' || !BASE64_RE.test(text)) continue;
    if (text.length > Math.ceil(Math.min(MAX_ARTIFACT_BYTES, budget) * 4 / 3) + 4) return { artifacts: {}, overQuota: true };
    const data = Buffer.from(text, 'base64');
    if (total + data.length > Math.min(MAX_ARTIFACT_BYTES, budget)) return { artifacts: {}, overQuota: true };
    artifacts[name] = data;
    total += data.length;
  }
  return { artifacts, overQuota: false };
}

/** The receipt record of one finished container: the isolation facts plus Docker's exit classification (6.4 Limits). */
function receiptRecord(result, flags) {
  if (!result.inspectJson) throw new Error('docker inspect failed after the run.');
  return { ...result.isolation, exit: classifyExit(result.inspectJson, { timedOut: result.timedOut, ...flags }) };
}

/** `{detonate, parseTrace, collect, runScript}` for `createJobController`; `runscLogRoot` and the image names are injectable. */
export function createStages({ env = process.env, runscLogRoot = RUNSC_LOG_ROOT } = {}) {
  const secrets = secretValues(env);
  const imageOf = role => env[`DETONATION_${role.toUpperCase()}_IMAGE`] || `detonation-ocean/${role}`;
  const wineApproved = env.DETONATION_WINE_RUNC === 'true'; // docs/SPEC.md 6.6: the Wine step runs on runc and only when the operator has approved it
  // A stage can outlive its job's guard (a timeout or the whole-job cap); once ctx.signal aborts the job is being torn down and no container may start.
  const run = (ctx, role, { attempt, wallClockMs, command, outputCapBytes, parserSample } = {}) => {
    assertOpen(ctx.signal);
    if (role === 'wine' && !wineApproved) throw new Error('Wine execution requires explicit approval.');
    return runContainer({
      docker: ctx.docker, jobId: ctx.jobId, role, image: imageOf(role), jobDir: ctx.jobDir, itemIndex: ctx.itemIndex, secrets, signal: ctx.signal,
      wineApproved, timeLeftMs: ctx.timeLeftMs, attempt, wallClockMs, command, outputCapBytes, parserSample,
    });
  };

  let detonateChain;

  return {
    /**
     * Runs the item through the runner in the `runsc-trace` container. A type with a single runner kind (scripts, pages, documents,
     * archives) runs that one container. An executable or any other type goes through the compatibility chain of SPEC 6.6
     * (chain.mjs): identify, unwrap, Wine, emulate, static and generic, one container per step that runs. `ctx.item.from` names a
     * child's file in the home volume; `ctx.budget` is the unpacking budget left. Returns `{containers, evidence, coverage, children}`:
     * the runner line mapped to EVIDENCE.md items, SPEC 6.6 coverage steps and the entries to detonate in turn. The chain adds
     * `artifacts` (Wine screenshots), `label`, `path`, `identify` (coverage text) and `parse` (the head of an unknown format).
     */
    async detonate(ctx) {
      const kind = runnerKind(ctx.typed);
      if (kind === undefined || kind === 'exe') {
        detonateChain ??= createChain({ run, receiptRecord, wineApproved });
        const { steps, ...chained } = await detonateChain(ctx);
        return { ...chained, coverage: steps };
      }
      const command = [kind];
      // A child's file is stored without its name, so the runner is told the extension to give its copy; the root keeps the default.
      if (kind === 'office' || (kind && ctx.item?.from)) command.push('--ext', kind === 'office' ? ctx.typed.detectedType : EXTENSION_BY_KIND[kind] ?? kind);
      if (BROWSER_KINDS.has(kind)) command.push('--canary', ctx.canaryToken);
      if (kind && ctx.item?.from) command.push('--from', ctx.item.from, '--source-size', String(ctx.item.size));
      const budget = clampUnpackBudget(ctx.budget);
      if (CONTAINER_KINDS.has(kind)) command.push('--max-entries', String(budget.entries), '--max-bytes', String(budget.bytes));
      const result = await run(ctx, 'detonate', { wallClockMs: ctx.caps.detonate, command, ...(CONTAINER_KINDS.has(kind) ? { outputCapBytes: UNPACK_STDOUT_BYTES } : {}) });
      const record = receiptRecord(result);
      ctx.detonation = { id: JSON.parse(result.inspectJson)[0].Id, record, runnable: true, kind };
      const at = ctx.clock().toISOString();
      const parsedLine = parseRunnerLine(result.stdout);
      const line = parsedLine?.kind === kind && parsedLine.started === true && !result.truncated ? parsedLine : null;
      const mapped = mapRunnerLine(kind, line, { at, budget, itemIndex: ctx.itemIndex ?? 0, depth: ctx.unwrapDepthExceeded ? 4 : undefined, sampleUrl: `file://${ctx.item?.from ? '/tmp/dt' : '/home/dana/Downloads'}/sample.${kind}` });
      // A tool that printed nothing and was not stopped by the time or memory cap did not finish: the run is incomplete.
      const silent = !line && record.exit.reason === null;
      const evidence = [...mapped.evidence, ...(silent ? [{ source: 'static', kind: 'emulation-stopped', detail: 'The runner printed no valid result.', at, reason: 'runner-no-result' }] : [])];
      return { containers: [record], evidence, coverage: mapped.steps, children: mapped.children };
    },

    /**
     * Parses the detonate container's runsc log, then deletes that log directory. Adds `limits` evidence from the exit
     * classification and the trace. Fails the job when the log is missing or a runnable sample never started (no evidence
     * must not read as a clean run).
     */
    async parseTrace(ctx) {
      assertOpen(ctx.signal);
      // A missing primary record leaves no default trace to parse; the controller still calls overridden root trace stages.
      if (ctx.detonation == null) return [];
      const { id, record, runnable } = ctx.detonation;
      if (!CONTAINER_ID.test(id)) throw new Error('The detonate container id is not a 64-hex id.');
      const dir = join(runscLogRoot, id);
      let parsed;
      try {
        parsed = await parseTraceDir(dir, { now: ctx.clock(), kind: ctx.detonation.kind });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      if (runnable && !parsed.sampleStarted) throw new Error('The sample did not start in the sandbox.');
      if (parsed.pidsLimit && record.exit.reason === null) record.exit.reason = 'pids-limit';
      const at = ctx.clock().toISOString();
      const limits = [
        ...(record.exit.reason === 'oom' ? [{ source: 'limits', kind: 'oom', detail: 'The sample was killed for using more than 512 MB.', at }] : []),
        ...(record.exit.reason === 'time' ? [{ source: 'limits', kind: 'time', detail: 'The sample was stopped at the wall-clock limit.', at }] : []),
        ...(parsed.pidsLimit ? [{ source: 'limits', kind: 'pids', detail: 'The sample hit the process limit.', at, crash: parsed.sandboxCrash }] : []),
        ...(parsed.truncated ? [{ source: 'trace', kind: 'emulation-stopped', reason: 'trace-over-20-MB', detail: 'The syscall trace passed 20 MB and was cut.', at }] : []),
      ];
      return [...parsed.items, ...limits];
    },

    /** Runs the collector against the stopped sample's home volume. It prints diff.json to stdout: a tmpfs /out cannot be read after the container stops. */
    async collect(ctx) {
      const result = await run(ctx, 'collect', { wallClockMs: COLLECT_WALL_MS, command: ['--out', '/dev/stdout', '--sample-sha256', ctx.sampleSha256] });
      const record = receiptRecord(result);
      if (result.code !== 0 || result.timedOut || result.truncated) throw new Error('The file-diff collector failed.');
      const diff = JSON.parse(result.stdout);
      ctx.diff = diff;
      const at = ctx.clock().toISOString();
      const evidence = diff.items.map((item, index) => ({ ...item, id: `ev-diff-${index + 1}`, at }));
      if (!ctx.detonation?.runnable && ctx.typed.path !== 'inspect') {
        evidence.push({ source: 'identify', kind: 'unsupported-type', detail: 'This type is not run in this build; it is inspected only.', at, detectedType: ctx.typed.detectedType });
      }
      if (diff.truncated) evidence.push({ source: 'diff', kind: 'emulation-stopped', reason: 'diff-truncated', detail: 'The file diff was cut.', at });
      const items = diff.items.slice(0, DIFF_SUMMARY_ITEMS).map(({ kind, path, to }) => ({ kind, path, to }));
      return { containers: [record], evidence, diffSummary: { counts: diff.counts, truncated: diff.truncated, items } };
    },

    /**
     * One analysing attempt: the model's script runs in an `analyse` container with the four /in files written under their
     * fixed names. /out is a tmpfs that is unreadable after the stop, so the harness returns the files it holds on stdout.
     */
    async runScript(code, ctx) {
      assertOpen(ctx.signal);
      // A parser run (`ctx.parser = {file, bytes}`, SPEC 6.6 Generic) sees its script and the one file; a child's head is written for it.
      const files = ctx.parser
        ? { 'script.py': code, ...(ctx.parser.file === 'parser' ? { 'parser-sample.bin': ctx.parser.bytes } : {}) }
        : { 'evidence.json': JSON.stringify(ctx.evidence), 'diff.json': JSON.stringify(ctx.diff ?? { items: [] }), 'static.json': JSON.stringify(ctx.staticResults ?? {}), 'script.py': code };
      for (const [name, data] of Object.entries(files)) await writeFile(join(ctx.jobDir, name), data, { mode: 0o644 });
      const counters = (ctx.counters ??= { analyse: 0 }); // shared by every copy of the job context, so a container name is never used twice
      counters.analyse += 1;
      const result = await run(ctx, 'analyse', { attempt: counters.analyse, wallClockMs: ANALYSE_WALL_MS, outputCapBytes: ARTIFACT_STDOUT_BYTES, command: [], parserSample: ctx.parser?.file });
      ctx.containers.push(receiptRecord(result));
      const budget = Number.isSafeInteger(ctx.artifactBudgetBytes) ? Math.max(0, Math.min(MAX_ARTIFACT_BYTES, ctx.artifactBudgetBytes)) : MAX_ARTIFACT_BYTES;
      const parsed = parseArtifacts(result.stdout, budget);
      const rejected = parsed.overQuota || result.truncated;
      return {
        exitCode: result.timedOut ? 124 : rejected ? 1 : result.code,
        stderr: result.timedOut ? `${result.stderr}\nThe script ran longer than 30 seconds.`
          : rejected ? `${result.stderr}\nAnalysis artifacts exceeded the remaining job quota or container output was truncated.` : result.stderr,
        artifacts: result.timedOut || rejected ? {} : parsed.artifacts,
      };
    },
  };
}
