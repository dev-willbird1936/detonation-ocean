// Detonation job pipeline (docs/SPEC.md 5.1, 5.4, 6.2, 7.3, 7.4; events: docs/detonation/EVENTS.md).
// State machine, queue, rate limits, encrypted upload, canary seed, teardown and the reaper. Time, docker, stages,
// inference and the data directory are injectable so tests need no Docker, network or clock.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, open as openFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { runAnalysis, runParserLoop } from './analysis-loop.mjs';
import { REAP_MAX_AGE_MS, dockerExec, reap, runSeed, startHome, teardown } from './containers.mjs';
import { detectType, sizeTier } from './filetype.mjs';
import { evaluateJobWide } from './findings.mjs';
import { createInferenceClient } from './inference.mjs';
import { addResult, applyBatch, loadState, publicView, saveState } from './ocean-state.mjs';
import { buildReceipt, compareCanary, hashFile, receiptAllowsDone, validateReceipt } from './receipts.mjs';
import * as replay from './replay.mjs';
import { MAX_DEPTH, MAX_ENTRIES, MAX_UNPACKED_BYTES, checkUnpackChildren, clampUnpackBudget } from './runner-result.mjs';
import { createStages, runnerKind } from './stages.mjs';
import { mapParserSignals } from './static.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SEED_SOURCE = join(root, 'deploy/detonation/seed/home/dana');
const CANARY_PLACEHOLDER = '{{CANARY}}';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const JOB_TTL_MS = HOUR_MS;
const MAX_EVIDENCE = 500;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const ANALYSIS_ARTIFACT_RESERVE_BYTES = 4 * 1024 * 1024;
const WHOLE_FILE_BYTES = 10 * 1024 * 1024; // the full size tier: the type detector reads all of such a file, and only the ends of a larger one
const FILE_EDGE_BYTES = 1024 * 1024;
const SEALED_HEADER_BYTES = 28; // 12-byte IV, 16-byte tag
const REPLAY_ID_BYTES = 25;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:png|svg|json|txt|csv)$/;
const SECRET_NAME_RE = /KEY|TOKEN|SECRET/;
const PATH_LABELS = { run: 'Executed on Linux', wine: 'Ran under Wine', emulate: 'Emulated', inspect: 'Inspected' };
const STAGE_EVENTS = new Set(['coverage', 'parser-attempt']);
const EMULATED_TYPES = new Set(['exe', 'dll']); // typed 'wine' by filetype.mjs; Speakeasy emulates them when Wine is not approved or could not run them
const HEAD_BYTES = 4096;
const PARSER_MIN_MS = 45_000; // one 30 s parser run plus a model call must fit before the reserve for collecting, analysing and explaining
const ITEM_RESERVE_MS = 70_000; // left for collecting, analysing and explaining when children are detonated one after another
// The detonating cap (CAPS_MS.detonate) is the container's wall clock; create, inspect and a confirmed kill happen around it.
const DETONATE_GRACE_MS = 5_000;

/** Whole-job and per-stage caps (5.1). The analysing cap is three attempts of 30 s run + 30 s model call. */
export const CAPS_MS = Object.freeze({ job: 180_000, prep: 15_000, detonate: 30_000, collect: 10_000, analyse: 180_000, explain: 30_000 });
export const LIMITS_DEFAULT = Object.freeze({ concurrency: 2, queueMax: 10, perIpHour: 3, perDay: 50 });

export class JobError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = data => createHash('sha256').update(data);

/**
 * The run path of a detected type (5.2, 6.6): inspect-only for an unsupported type or a file over 10 MB. A Windows type is 'wine' only when
 * DETONATION_WINE_RUNC=true; without it the exe types are emulated and the other Windows types (msi, bat, vbs, hta) are inspected only.
 */
function pathFor(found, tier, wineApproved) {
  const path = tier === 'static' || !found.supported ? 'inspect' : found.path;
  if (path !== 'wine' || wineApproved) return path;
  return EMULATED_TYPES.has(found.detectedType) ? 'emulate' : 'inspect';
}

const safeExtension = name => (/^[a-z0-9_+-]{0,12}$/.test(name) ? name : '');
const tagged = (list, index) => (index === 0 || !Array.isArray(list) ? list : list.map(item => ({ ...item, item: index })));

const secretValues = env => Object.entries(env).filter(([name, value]) => SECRET_NAME_RE.test(name.toUpperCase()) && typeof value === 'string' && value.length >= 4).map(([, value]) => value);

/** Replaces every value of an env var whose name contains KEY, TOKEN or SECRET (7.2). */
export function createRedactor(env) {
  const secrets = secretValues(env);
  return text => secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text);
}

/**
 * The id the evidence replay (9.1) is published under: 40 characters of a-z2-7 from 25 random bytes (200 bits). It fits the desktop
 * run id `^[a-z0-9-]{1,40}$`, and unlike the job id it is sent only on the job's token-checked event stream.
 */
export function newReplayId() {
  let id = '';
  let bits = 0;
  let buffer = 0;
  for (const byte of randomBytes(REPLAY_ID_BYTES)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    for (; bits >= 5; bits -= 5) id += BASE32[(buffer >> (bits - 5)) & 31];
    buffer &= (1 << bits) - 1;
  }
  return id;
}

function parseKey(value) {
  if (!value) return randomBytes(32);
  const key = Buffer.from(value, /^[0-9a-f]{64}$/i.test(value) ? 'hex' : 'base64');
  if (key.length !== 32) throw new TypeError('UPLOAD_ENCRYPTION_KEY must be 32 bytes, hex or base64.');
  return key;
}

// AES-256-GCM file layout: 12-byte IV, 16-byte tag, ciphertext. Both directions stream, so a 100 MB upload is never one buffer.
// The tag is only known at the end, so the header is written last.
// `upload` is `{buffer}` or `{path, start, end}` (the byte range of the file in a temp file). Returns the size, the SHA-256 and the
// bytes the type detector reads: the whole file up to 10 MB, else its first and last megabyte.
async function sealUpload(key, upload, sealedPath) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const hash = createHash('sha256');
  const input = upload.buffer ? Readable.from([upload.buffer]) : createReadStream(upload.path, { start: upload.start, end: upload.end - 1 });
  const out = await openFile(sealedPath, 'w', 0o600);
  let size = 0;
  let whole = [];
  let tail = Buffer.alloc(0);
  let head;
  try {
    await out.write(Buffer.alloc(SEALED_HEADER_BYTES));
    for await (const chunk of input) {
      size += chunk.length;
      hash.update(chunk);
      await out.write(cipher.update(chunk));
      if (whole) {
        whole.push(chunk);
        if (size > WHOLE_FILE_BYTES) {
          const all = Buffer.concat(whole);
          head = Buffer.from(all.subarray(0, FILE_EDGE_BYTES));
          tail = Buffer.from(all.subarray(-FILE_EDGE_BYTES));
          whole = null;
        }
      } else {
        tail = Buffer.from(Buffer.concat([tail, chunk]).subarray(-FILE_EDGE_BYTES));
      }
    }
    await out.write(cipher.final());
    await out.write(Buffer.concat([iv, cipher.getAuthTag()]), 0, SEALED_HEADER_BYTES, 0);
  } finally {
    await out.close();
  }
  return { size, sha256: hash.digest('hex'), detectable: whole ? Buffer.concat(whole) : Buffer.concat([head, tail]) };
}

async function openSealed(key, sealedPath, samplePath) {
  const handle = await openFile(sealedPath, 'r');
  const header = Buffer.alloc(SEALED_HEADER_BYTES);
  try {
    await handle.read(header, 0, SEALED_HEADER_BYTES, 0);
  } finally {
    await handle.close();
  }
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(0, 12));
  decipher.setAuthTag(header.subarray(12, SEALED_HEADER_BYTES));
  await pipeline(createReadStream(sealedPath, { start: SEALED_HEADER_BYTES }), decipher, createWriteStream(samplePath, { mode: 0o644 }));
}

/** 10 characters of A-Z0-9 (deploy/detonation/seed/README.md). */
export const newCanaryToken = () => Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[randomInt(36)]).join('');

/** Copies the seed profile into `<jobDir>/seed` with the canary substituted byte for byte; writes `<jobDir>/seed-manifest.json`. */
export async function materialiseSeed({ jobDir, token, source = SEED_SOURCE }) {
  const seedDir = join(jobDir, 'seed');
  const manifest = [];
  for (const entry of await readdir(source, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const from = join(entry.parentPath, entry.name);
    const rel = relative(source, from).split(sep).join('/');
    const data = Buffer.from((await readFile(from)).toString('latin1').replaceAll(CANARY_PLACEHOLDER, token), 'latin1');
    const to = join(seedDir, ...rel.split('/'));
    await mkdir(dirname(to), { recursive: true, mode: 0o755 });
    await writeFile(to, data, { mode: 0o644 });
    manifest.push({ path: `/home/dana/${rel}`, size: data.length, sha256: sha256(data).digest('hex') });
  }
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(jobDir, 'seed-manifest.json'), JSON.stringify(manifest), { mode: 0o644 });
  return { seedDir, manifest };
}

let creatureNames;
const creatureName = id => (creatureNames ??= new Map(JSON.parse(readFileSync(join(root, 'data/creatures.json'), 'utf8')).creatures.map(c => [c.findingId, c.creature]))).get(id) ?? id;

// Sorted by time, capped, and numbered so a finding can cite an item (EVIDENCE.md).
function normaliseEvidence(items) {
  const list = items.filter(item => item && typeof item === 'object' && typeof item.kind === 'string');
  list.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return { evidence: list.slice(0, MAX_EVIDENCE).map((item, index) => ({ ...item, id: `ev-${index + 1}` })), truncated: list.length > MAX_EVIDENCE };
}

/**
 * Stage functions take the job context `ctx` and may be replaced. Contracts:
 *   detonate(ctx)   -> {containers}                              ctx.paths.sample is the decrypted upload
 *   collect(ctx)    -> {containers, evidence, diffSummary?, staticResults?}
 *   parseTrace(ctx) -> evidence[]
 *   analyse(ctx)    -> runAnalysis result (attempts, artifacts, explanation, modelAvailable) plus {containers}
 *   explain(ctx)    -> {text, modelAvailable}
 *   runScript(code) -> {exitCode, stderr, artifacts}             used by the default analyse
 *   parse(ctx)      -> {ok, modelAvailable, attempts, signals}   the model-written parser for an unknown format (ctx.parser.bytes; SPEC 6.6 Generic)
 * detonate may also return {artifacts: {name: Buffer}, label, path, identify, parse: {bytes}} (stages.mjs, chain.mjs).
 * `containers` are verifyIsolation records plus `exit` (receipts.mjs). detonate, collect, parseTrace and runScript default to
 * the Docker and gVisor stages of stages.mjs.
 */
export function defaultStages(env = process.env) {
  return {
    ...createStages({ env }),
    analyse: ctx => runAnalysis({ verdict: ctx.verdict, evidenceSummary: ctx.evidence, diffSummary: ctx.diffSummary, staticResults: ctx.staticResults, model: ctx.model, runScript: ctx.runScript, emit: ctx.emitAttempt }),
    explain: ctx => ({ text: ctx.analysis.explanation, modelAvailable: ctx.analysis.modelAvailable }),
    parse: ctx => runParserLoop({ bytes: ctx.parser.bytes, model: ctx.model, runScript: ctx.runScript, emit: ctx.emitAttempt }),
  };
}

export function createJobController({
  env = process.env,
  dataDir = env.DETONATION_DATA_DIR || '/var/lib/detonation-ocean',
  docker = dockerExec,
  clock = () => new Date(),
  logger = console.log,
  stages: stageOverrides = {},
  desktopHub, // the server's in-process DesktopEventHub: the evidence replay (9.1) is published to it under a random replay id; without it there is no replay
  inference = createInferenceClient({ env }),
  caps: capOverrides = {},
  limits: limitOverrides = {},
  seedSource = SEED_SOURCE,
  reaperIntervalMs = MINUTE_MS,
  batchIntervalMs = 5 * MINUTE_MS,
} = {}) {
  const stages = { ...defaultStages(env), ...Object.fromEntries(Object.entries(stageOverrides).filter(([, stage]) => stage)) };
  const caps = { ...CAPS_MS, ...capOverrides };
  const limits = { ...LIMITS_DEFAULT, ...limitOverrides };
  const enabled = env.DETONATION_ENABLED === 'true';
  const wineApproved = env.DETONATION_WINE_RUNC === 'true';
  const key = parseKey(env.UPLOAD_ENCRYPTION_KEY);
  const redact = createRedactor(env);
  const seedImage = env.DETONATION_SEED_IMAGE || env.DETONATION_DETONATE_IMAGE || 'detonation-ocean/detonate';
  const jobsDir = join(dataDir, 'jobs');
  const canaryFile = join(dataDir, 'host-canary');
  const oceanFile = join(dataDir, 'ocean-state.json');
  const now = () => clock().getTime();
  const jobs = new Map();
  const active = new Set();
  const waiters = [];
  const hits = new Map();
  const pending = [];
  const oceanState = loadState(oceanFile);
  let batchAt = clock().toISOString();
  let dayHits = [];
  let acceptingJobs = false;
  let inFlight = 0;
  let running = 0;
  let timers = [];

  // Logs carry the job id, stage, timings, limits and errors only: never file names, content, hashes or secrets (15.5).
  const log = fields => logger(redact(JSON.stringify({ at: clock().toISOString(), ...fields })));

  function emit(job, event, data) {
    if (event === 'coverage') {
      const at = job.coverage.findIndex(item => item.item === data.item);
      if (at >= 0) job.coverage[at] = data;
      else job.coverage.push(data);
    }
    const record = { id: ++job.seq, event, data };
    job.events.push(record);
    for (const listener of job.listeners) listener(record);
  }

  function setStage(job, stage, extra = {}) {
    job.state = stage;
    emit(job, 'stage', { stage, at: clock().toISOString(), ...extra });
    log({ job: job.id, stage, ms: now() - job.startedAt });
  }

  const recent = (list, ms, at) => list.filter(time => at - time < ms);
  function rateLimited(ip) {
    const at = now();
    dayHits = recent(dayHits, DAY_MS, at);
    return recent(hits.get(ip) ?? [], HOUR_MS, at).length >= limits.perIpHour || dayHits.length >= limits.perDay;
  }

  /** `null` when a job may be submitted, else `{status, message}` (4.2: 503 not accepting or queue full, 429 rate limit). */
  function admit(ip) {
    if (!enabled || !acceptingJobs) return { status: 503, message: 'Uploads are not being accepted right now.' };
    if (inFlight >= limits.concurrency + limits.queueMax) return { status: 503, message: 'The queue is full. Try again shortly.' };
    if (rateLimited(ip)) return { status: 429, message: 'Rate limit reached. Try again later.' };
    return null;
  }

  const acquire = () => (running < limits.concurrency ? (running += 1, Promise.resolve()) : new Promise(resolve => waiters.push(resolve)));
  const release = () => { const next = waiters.shift(); if (next) next(); else running -= 1; };

  // The quota volume and its holder (7.3), then the seed container (6.2); both are verified like every other container.
  async function seedHome(ctx) {
    const { manifest } = await materialiseSeed({ jobDir: ctx.jobDir, token: ctx.canaryToken, source: seedSource });
    ctx.seedManifest = manifest;
    await openSealed(key, join(ctx.jobDir, 'upload.enc'), ctx.paths.sample);
    const spec = { docker, jobId: ctx.jobId, image: seedImage, jobDir: ctx.jobDir, secrets: secretValues(env), signal: ctx.signal };
    const step = async (action, message) => {
      try {
        return await action();
      } catch (error) {
        log({ job: ctx.jobId, error: `seed: ${error?.name ?? 'Error'}` });
        throw new JobError(500, message);
      }
    };
    await step(() => startHome({ ...spec, timeoutMs: caps.prep }), 'The sandbox volume could not be created.');
    await step(() => runSeed({ ...spec, wallClockMs: caps.prep }), 'The sandbox profile could not be seeded.');
  }

  async function processJob(job, upload, claimedName) {
    const jobId = job.id;
    const jobDir = join(jobsDir, jobId);
    const abort = new AbortController();
    const model = { available: () => inference.available(), complete: (messages, options) => { ctx.inferenceCalls += 1; return inference.complete(messages, options); } };
    const ctx = {
      jobId, jobDir, docker, clock, caps, signal: abort.signal, containers: [], evidence: [], inferenceCalls: 0, itemIndex: 0, counters: { analyse: 0 },
      paths: { sample: join(jobDir, 'sample.bin'), manifest: join(jobDir, 'seed-manifest.json') },
      canaryToken: newCanaryToken(), model, runScript: code => stages.runScript(code, ctx),
      emit: (event, data) => { if (STAGE_EVENTS.has(event)) emit(job, event, data); },
      emitAttempt: ({ type, ...data }) => emit(job, type, data),
    };
    const replayId = desktopHub ? newReplayId() : null; // not the job id: the job id is not a secret, a replay must not be readable with it
    let failure = null;
    let analysisArtifacts = [];
    let failedEmitted = false;
    let hostBefore = null;
    let slot = false;
    let jobTimer;
    let expired = new Promise(() => {});
    const guard = (fn, ms, label) => {
      let timer;
      const stageTimer = new Promise((_, reject) => { timer = setTimeout(() => reject(new JobError(500, `The ${label} stage timed out.`)), ms); });
      return Promise.race([Promise.resolve().then(fn), stageTimer, expired]).finally(() => clearTimeout(timer));
    };
    const keepContainers = result => { if (Array.isArray(result?.containers)) ctx.containers.push(...result.containers.filter(item => item && typeof item === 'object')); };
    const fail = error => {
      failure ??= error;
      if (!failedEmitted) { failedEmitted = true; setStage(job, 'failed'); }
    };

    try {
      await mkdir(jobDir, { recursive: true, mode: 0o755 });
      let sealed;
      try {
        sealed = await sealUpload(key, upload, join(jobDir, 'upload.enc'));
      } finally {
        if (upload.path) await rm(upload.path, { force: true }); // the route's temp file is ours once the job is accepted
      }
      const found = detectType(sealed.detectable, claimedName);
      const tier = sizeTier(sealed.size);
      const path = pathFor(found, tier, wineApproved);
      const extension = safeExtension(found.claimedExtension);
      ctx.typed = { detectedType: found.detectedType, claimedExtension: extension, path, mismatch: found.mismatch, sizeTier: tier };
      ctx.sizeBytes = sealed.size;
      ctx.head = Buffer.from(sealed.detectable.subarray(0, HEAD_BYTES)); // lets the compatibility chain recognise an .asar archive
      ctx.sampleSha256 = sealed.sha256; // memory only: dedup within the job (5.4)
      setStage(job, 'typed');
      emit(job, 'typed', {
        ...ctx.typed, species: addResult([], { detectedType: found.detectedType, depth: 'sunlight' })[0].species, label: PATH_LABELS[path], ...(replayId ? { replayId } : {}),
      });
      sealed = null;
      setStage(job, 'queued');
      await acquire();
      slot = true;
      // A job that waited in the queue must not start once an earlier teardown has closed the gate (7.4).
      if (!acceptingJobs) throw new JobError(503, 'Uploads are not being accepted right now.');
      jobTimer = setTimeout(() => abort.abort(), caps.job);
      expired = new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(new JobError(500, `The job exceeded ${caps.job / 1000} seconds.`))));
      expired.catch(() => {});
      const slotAt = now();
      hostBefore = await hashFile(canaryFile).catch(() => null);

      setStage(job, 'detonating');
      await guard(() => seedHome(ctx), caps.prep, 'detonating');
      const items = [{ index: 0, parent: null, depth: 1, typed: ctx.typed, supported: found.supported, head: ctx.head }];
      const produced = []; // what the runners mapped, and what the pipeline itself refused to run (5.3)
      const queue = [items[0]];
      const unpacked = { entries: 0, bytes: 0 };
      const childSources = new Set();
      ctx.budget = { entries: MAX_ENTRIES, bytes: MAX_UNPACKED_BYTES };
      const reserveMs = Math.min(ITEM_RESERVE_MS, caps.job * 0.4);
      ctx.timeLeftMs = () => caps.job - (now() - slotAt) - reserveMs; // what the compatibility chain may still spend on steps (chain.mjs)
      const refuse = (item, reason, detail) => {
        const at = clock().toISOString();
        produced.push(...tagged([{ source: 'static', kind: 'emulation-stopped', detail, at, reason }], item.index));
        return { step: 'run', status: 'skipped', detail };
      };
      const artifactBytes = () => [...job.artifacts.values()].reduce((sum, buffer) => sum + buffer.length, 0);
      const storeArtifact = (name, data, cap = MAX_ARTIFACT_BYTES) => {
        if (!ARTIFACT_RE.test(name) || !Buffer.isBuffer(data) || artifactBytes() - (job.artifacts.get(name)?.length ?? 0) + data.length > cap) return false;
        job.artifacts.set(name, data);
        return true;
      };
      // SPEC 6.6 Generic: the model writes a parser for a format nobody knows. It adds Twilight signals only (static evidence).
      const parseUnknown = async (item, itemCtx, bytes) => {
        const deadline = slotAt + caps.job - reserveMs;
        const at = () => clock().toISOString();
        if (!stages.parse || deadline - now() < PARSER_MIN_MS) {
          return {
            evidence: [{ source: 'static', kind: 'emulation-stopped', detail: 'The model-written parser was not run: the job time budget was used.', at: at(), reason: 'job-budget' }],
            step: { step: 'parser', status: 'skipped', detail: 'Parser: skipped (job time budget).' },
          };
        }
        const parserCtx = { ...itemCtx, parser: { file: item.index === 0 ? 'sample' : 'parser', bytes } };
        parserCtx.runScript = code => (now() > deadline ? Promise.resolve({ exitCode: 124, stderr: 'The job time budget ran out.', artifacts: {} }) : stages.runScript(code, parserCtx));
        parserCtx.model = { available: () => model.available(), complete: (messages, options) => (now() > deadline ? Promise.reject(new Error('The job time budget ran out.')) : model.complete(messages, options)) };
        parserCtx.emitAttempt = attempt => ctx.emitAttempt(item.index ? { ...attempt, item: item.index } : attempt);
        const outcome = await guard(() => stages.parse(parserCtx), Math.max(1_000, deadline - now() + 45_000), 'detonating');
        if (outcome?.modelAvailable === false) return { evidence: [], step: { step: 'parser', status: 'skipped', detail: 'Parser: skipped (no model is available).' } };
        if (outcome?.ok === true) {
          const signals = Array.isArray(outcome.signals) ? outcome.signals : [];
          return {
            evidence: mapParserSignals(signals, { at: at() }),
            step: { step: 'parser', status: 'done', detail: `A model-written parser ran (${outcome.attempts?.length ?? 1} attempt(s)) and reported ${signals.length} signal(s).` },
          };
        }
        return {
          evidence: [{ source: 'static', kind: 'emulation-stopped', detail: 'The model-written parser did not produce a result.', at: at(), reason: 'parser-failed' }],
          step: { step: 'parser', status: 'failed', detail: `The model-written parser did not produce a result after ${outcome?.attempts?.length ?? 0} attempt(s).` },
        };
      };
      while (queue.length) {
        const item = queue.shift();
        const budget = clampUnpackBudget({ entries: MAX_ENTRIES - unpacked.entries, bytes: MAX_UNPACKED_BYTES - unpacked.bytes });
        const itemCtx = item.index === 0 ? ctx : { ...ctx, itemIndex: item.index, typed: item.typed, item: { from: item.from, size: item.size, head: item.head } };
        itemCtx.budget = budget;
        itemCtx.unwrapDepthExceeded = item.depth > MAX_DEPTH; // the chain reads these two from the context it is given
        const kind = runnerKind(item.typed);
        const container = kind === 'zip' || kind === 'eml';
        let refused = null;
        if (item.index > 0 && now() - slotAt + caps.detonate + DETONATE_GRACE_MS > caps.job - reserveMs) refused = refuse(item, 'job-budget', 'Not run: the job time budget was used.');
        else if (container && item.depth > MAX_DEPTH) refused = refuse(item, 'unpack-depth', `Not unpacked: archives nested more than ${MAX_DEPTH} levels deep.`);
        else if (container && (budget.entries === 0 || budget.bytes === 0)) refused = refuse(item, 'unpack-limit', 'Not unpacked: the 50 entry or 50 MB limit was used.');
        // The compatibility chain (chain.mjs) runs one container per step, each with its own wall clock; the job cap bounds the sum.
        const chain = kind === undefined || kind === 'exe';
        const result = refused ? null : await guard(() => stages.detonate(itemCtx), chain ? caps.job : caps.detonate + DETONATE_GRACE_MS, 'detonating');
        keepContainers(result);
        item.detonation = refused ? undefined : itemCtx.detonation;
        const rejectedArtifacts = new Set();
        for (const [name, data] of Object.entries(result?.artifacts ?? {})) {
          if (!storeArtifact(name, data, MAX_ARTIFACT_BYTES - ANALYSIS_ARTIFACT_RESERVE_BYTES)) rejectedArtifacts.add(name);
        }
        produced.push(...tagged((result?.evidence ?? []).filter(evidence => !rejectedArtifacts.has(evidence.artifact)), item.index));
        if (rejectedArtifacts.size) refuse(item, 'artifact-quota', 'Detonation artifacts were dropped to preserve 4 MiB for analysis within the 8 MiB job quota.');
        const checked = result && (result.children !== undefined || container || result.coverage?.some(step => step.step === 'unwrap'))
          ? checkUnpackChildren(result.children, { at: clock().toISOString(), budget, itemIndex: item.index, depth: item.depth, seenPaths: childSources })
          : { children: [], evidence: [], stopped: null };
        produced.push(...tagged(checked.evidence, item.index));
        if (typeof result?.path === 'string') item.typed.path = result.path; // the route that really ran: Wine can fail and the emulator take over
        const label = result?.label ?? (container ? 'Unpacked' : kind ? PATH_LABELS[item.typed.path] : PATH_LABELS.inspect);
        const inspectedOnly = { step: 'run', status: 'skipped', detail: 'Inspected only: this type is not run.' };
        const steps = [
          { step: 'identify', status: 'done', detail: `Identified as ${item.typed.detectedType}: ${label}.${result?.identify ? ` ${result.identify}.` : ''}` },
          ...(refused ? [refused] : result?.coverage ?? (item.index > 0 ? [inspectedOnly] : [])),
          ...(checked.stopped ? [{ step: 'unwrap', status: checked.stopped === 'error' && !checked.children.length ? 'failed' : 'stopped', detail: 'Children rejected: invalid runner results or the remaining unpacking budget was exceeded.' }] : []),
        ];
        if (result?.parse) {
          const parsed = await parseUnknown(item, itemCtx, result.parse.bytes);
          produced.push(...tagged(parsed.evidence, item.index));
          steps.push(parsed.step);
        }
        if (refused || checked.stopped || Array.isArray(result?.coverage) || item.index > 0) emit(job, 'coverage', { item: item.index, parent: item.parent, steps });
        unpacked.entries += checked.children.length;
        unpacked.bytes += checked.children.reduce((sum, child) => sum + child.size, 0);
        for (const child of checked.children) {
          const childFound = detectType(child.head, child.name);
          const childTier = sizeTier(child.size);
          // Parts of a PyInstaller bundle or an Electron app are read, never run: the type stays what it is, the path is inspect.
          const typed = {
            detectedType: childFound.detectedType, claimedExtension: safeExtension(childFound.claimedExtension), mismatch: childFound.mismatch, sizeTier: childTier,
            path: child.inspectOnly ? 'inspect' : pathFor(childFound, childTier, wineApproved), ...(child.inspectOnly ? { inspectOnly: true } : {}),
          };
          const next = { index: items.length, parent: item.index, depth: item.depth + 1, typed, supported: childFound.supported && childTier !== 'static', from: child.path, size: child.size, head: child.head };
          items.push(next);
          queue.push(next);
        }
      }

      setStage(job, 'collecting');
      const gathered = await guard(async () => {
        const trace = [];
        for (const item of items) {
          if (item.index > 0 && !item.detonation) continue;
          const itemCtx = item.index === 0 ? ctx : { ...ctx, itemIndex: item.index, typed: item.typed, detonation: item.detonation };
          const parsed = await stages.parseTrace(itemCtx);
          trace.push(...tagged(Array.isArray(parsed) ? parsed : [], item.index));
        }
        return { trace, collected: await stages.collect(ctx) };
      }, caps.collect + 3_000 * (items.length - 1), 'collecting');
      keepContainers(gathered.collected);
      ctx.diffSummary = gathered.collected?.diffSummary;
      ctx.staticResults = gathered.collected?.staticResults;
      const at = clock().toISOString();
      const identify = items.flatMap(item => tagged([
        ...(item.typed.mismatch ? [{ source: 'identify', kind: 'type-mismatch', detail: 'The content type differs from the extension.', at, detectedType: item.typed.detectedType, claimedExtension: item.typed.claimedExtension }] : []),
        ...(item.supported ? [] : [{ source: 'identify', kind: 'unsupported-type', detail: 'Type outside the supported set or over 10 MB; inspected only.', at, detectedType: item.typed.detectedType }]),
      ], item.index));
      const { evidence, truncated } = normaliseEvidence([...identify, ...produced, ...gathered.trace, ...(gathered.collected?.evidence ?? [])]);
      ctx.evidence = evidence;
      for (const item of evidence) emit(job, 'evidence', item);
      // One verdict over every item's evidence is the deepest child verdict: depth is the deepest finding of any item (5.3, 6.5).
      // An archive that was unpacked has been run, so a root typed 'inspect' is not inspect-only when a runner handled anything.
      const evaluatedPath = ctx.typed.path === 'inspect' && items.some(item => item.detonation?.runnable) ? 'run' : ctx.typed.path;
      ctx.verdict = evaluateJobWide({ evidence, path: evaluatedPath, complete: !truncated, seedManifest: ctx.seedManifest, canaryTokens: [ctx.canaryToken] });
      for (const id of ctx.verdict.signals) emit(job, 'signal', { id, evidenceIds: [] });
      for (const { id, depth, family, evidenceIds } of ctx.verdict.findings) emit(job, 'finding', { id, depth, family, creature: creatureName(id), evidenceIds });
      if (desktopHub) {
        try {
          await replay.publish(replayId, replay.evidenceToPatches(evidence, { path: ctx.typed.path, label: PATH_LABELS[ctx.typed.path] }), { hub: desktopHub });
        } catch (error) {
          log({ job: jobId, error: `replay: ${error?.name ?? 'Error'}` });
        }
      }

      setStage(job, 'analysing', { attempt: 1 });
      ctx.artifactBudgetBytes = MAX_ARTIFACT_BYTES - artifactBytes();
      ctx.analysis = await guard(() => stages.analyse(ctx), caps.analyse, 'analysing');
      keepContainers(ctx.analysis);
      const analysisOutput = Object.entries(ctx.analysis.artifacts ?? {});
      if (analysisOutput.some(([name, data]) => !ARTIFACT_RE.test(name) || !Buffer.isBuffer(data))
        || analysisOutput.reduce((sum, [, data]) => sum + data.length, 0) > ctx.artifactBudgetBytes) {
        ctx.analysis.scriptOk = false;
        ctx.analysis.artifacts = {};
        const attempt = ctx.analysis.attempts?.at(-1);
        if (attempt) { attempt.exitCode = 1; attempt.stderr = `${attempt.stderr ?? ''}\nAnalysis artifacts were rejected: invalid output or the remaining job quota was exceeded.`; attempt.artifacts = []; }
      } else {
        analysisArtifacts = analysisOutput.filter(([name, data]) => storeArtifact(name, data)).map(([name]) => name);
      }

      setStage(job, 'explaining');
      const explanation = await guard(() => stages.explain(ctx), caps.explain, 'explaining');
      ctx.explanation = { text: String(explanation?.text ?? ''), modelAvailable: explanation?.modelAvailable === true };
      emit(job, 'explanation', ctx.explanation);

      setStage(job, 'verdict');
      emit(job, 'verdict', ctx.verdict);
    } catch (error) {
      fail(error);
      log({ job: jobId, error: error instanceof JobError ? error.message : error?.name ?? 'Error' });
    }
    clearTimeout(jobTimer);
    abort.abort();

    try {
      setStage(job, 'tearing_down');
      const removed = await teardown(jobId, { docker, clock }).catch(() => ({ confirmed: false, removedAt: null, errors: ['teardown threw'] }));
      const uploadDeleted = await rm(jobDir, { recursive: true, force: true }).then(() => !existsSync(jobDir), () => false);
      const hostAfter = await hashFile(canaryFile).catch(() => null);
      const hostCanary = compareCanary(hostBefore, hostAfter);
      if (!removed.confirmed || !uploadDeleted) {
        acceptingJobs = false;
        log({ job: jobId, operator: 'teardown unconfirmed; uploads stopped until restart', containersAndVolumes: removed.confirmed, uploadDeleted });
      }
      const receipt = buildReceipt({
        jobId, containers: ctx.containers, teardown: removed, uploadDeleted, hostCanary,
        inference: { provider: 'vultr-serverless-inference', calls: ctx.inferenceCalls, model: env.VULTR_INFERENCE_CODE_MODEL ?? null },
      });
      if (validateReceipt(receipt).ok) emit(job, 'receipt', receipt);
      log({ job: jobId, limitsHit: receipt.limitsHit, teardownConfirmed: removed.confirmed, teardownErrors: removed.errors.length, uploadDeleted, hostCanary });
      if (!failure && !receiptAllowsDone(receipt)) fail(new JobError(500, 'Teardown or the receipt check failed.'));

      if (failure) {
        job.state = 'failed';
        job.error = failure instanceof JobError ? failure.message : 'The job failed.';
        emit(job, 'error', { message: job.error });
      } else {
        const attempts = (ctx.analysis.attempts ?? []).map(attempt => ({ ...attempt }));
        if (ctx.analysis.scriptOk && attempts.length) attempts.at(-1).artifacts = analysisArtifacts;
        job.report = {
          jobId,
          file: { detectedType: ctx.typed.detectedType, claimedExtension: ctx.typed.claimedExtension, path: ctx.typed.path, sizeBytes: ctx.sizeBytes },
          verdict: ctx.verdict, evidence: ctx.evidence, coverage: [...job.coverage], analysis: { attempts }, explanation: ctx.explanation.text, receipt,
        };
        addResult(pending, { detectedType: ctx.typed.detectedType, depth: ctx.verdict.depth, findings: ctx.verdict.findings });
        setStage(job, 'done');
        emit(job, 'report', job.report);
      }
    } finally {
      if (upload.path) await rm(upload.path, { force: true });
      job.finished = true;
      job.finishedAt = now();
      for (const listener of job.listeners) listener(null);
      job.listeners.clear();
      if (slot) release();
      inFlight -= 1;
    }
  }

  /**
   * Accepts one upload (already size-capped by the caller): `file` is its bytes, or `source` is `{path, start, end}`, the byte range
   * of the file inside a temp file, which is then streamed to the encrypted copy and never held whole in memory. The job owns
   * `source.path` once this returns and deletes it after sealing; when this throws the caller still owns it.
   * Returns `{jobId, token}`; throws JobError 503, 429, 413 or 400.
   */
  function submit({ file, source, claimedName = '', ip = '' }) {
    const refusal = admit(ip);
    if (refusal) throw new JobError(refusal.status, refusal.message);
    const upload = source ? { path: source.path, start: source.start, end: source.end } : { buffer: file };
    const size = source ? source.end - source.start : file?.length;
    const valid = source ? typeof source.path === 'string' && Number.isSafeInteger(source.start) && source.start >= 0 && Number.isSafeInteger(size) : Buffer.isBuffer(file);
    if (!valid || !(size > 0)) throw new JobError(400, 'A non-empty file is required.');
    if (sizeTier(size) === 'reject') throw new JobError(413, 'The file is over 100 MB.');
    const at = now();
    hits.set(ip, [...recent(hits.get(ip) ?? [], HOUR_MS, at), at]);
    dayHits.push(at);
    const token = randomBytes(32).toString('base64url');
    const job = {
      id: `j-${randomBytes(8).toString('hex')}`, tokenDigest: sha256(token).digest(), state: 'received', seq: 0, events: [], listeners: new Set(),
      artifacts: new Map(), coverage: [], report: null, error: null, finished: false, finishedAt: null, startedAt: at,
    };
    jobs.set(job.id, job);
    inFlight += 1;
    setStage(job, 'received');
    const run = processJob(job, upload, claimedName).catch(error => log({ job: job.id, error: error?.name ?? 'Error' })).finally(() => active.delete(run));
    active.add(run);
    return { jobId: job.id, token };
  }

  // `maxAgeMs` 0 sweeps every labelled leftover: at start nothing of a previous process may stay.
  async function housekeeping(maxAgeMs = REAP_MAX_AGE_MS) {
    const result = await reap(maxAgeMs, { docker, clock }).catch(error => ({ removed: { containers: [], volumes: [], logs: [] }, errors: [error?.name ?? 'Error'] }));
    log({ reaper: true, containers: result.removed.containers.length, volumes: result.removed.volumes.length, logs: result.removed.logs.length, errors: result.errors.length });
    const at = now();
    for (const [id, job] of jobs) if (job.finished && at - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
    for (const [ip, list] of hits) {
      const kept = recent(list, HOUR_MS, at);
      if (kept.length) hits.set(ip, kept); else hits.delete(ip);
    }
    return result;
  }

  function applyPending() {
    try {
      applyBatch(oceanState, pending);
      saveState(oceanFile, oceanState);
    } catch (error) {
      log({ error: `ocean batch: ${error?.name ?? 'Error'}` });
    }
    batchAt = clock().toISOString();
  }

  return {
    get acceptingJobs() { return acceptingJobs; },
    get enabled() { return enabled; },
    health: () => ({ acceptingJobs, queueDepth: waiters.length }),
    admit,
    submit,
    applyPending,
    reapOnce: housekeeping,
    oceanView: () => publicView(oceanState, batchAt),
    getJob: id => jobs.get(id) ?? null,
    artifact: (job, name) => job.artifacts.get(name) ?? null,
    /** Constant-time check of a presented bearer token against the job's digest. */
    authorise: (job, token) => typeof token === 'string' && timingSafeEqual(sha256(token).digest(), job.tokenDigest),
    status: job => ({ jobId: job.id, state: job.state, ...(job.report ? { report: job.report } : {}), ...(job.error ? { error: job.error } : {}) }),
    /** Events after `afterId`, then live ones through `listener`; `listener(null)` means the job ended. Returns an unsubscribe. */
    subscribe(job, afterId, listener) {
      for (const record of job.events) if (record.id > afterId) listener(record);
      if (job.finished) { listener(null); return () => {}; }
      job.listeners.add(listener);
      return () => job.listeners.delete(listener);
    },
    idle: async () => { while (active.size) await Promise.all([...active]); },
    /** Clean-slate reaper pass at start (every labelled leftover, any age); uploads open only if it was clean (7.4). Then the reaper and the ocean batch run on timers. */
    async start() {
      await rm(jobsDir, { recursive: true, force: true });
      await mkdir(jobsDir, { recursive: true, mode: 0o755 });
      if (!existsSync(canaryFile)) await writeFile(canaryFile, randomBytes(32), { mode: 0o600 });
      const first = await housekeeping(0);
      acceptingJobs = first.errors.length === 0;
      timers = [setInterval(() => housekeeping(), reaperIntervalMs), setInterval(applyPending, batchIntervalMs)];
      for (const timer of timers) timer.unref();
      log({ started: true, acceptingJobs });
    },
    stop() { timers.forEach(clearInterval); timers = []; },
  };
}
