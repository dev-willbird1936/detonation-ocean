// Job view bootstrap: reads the capability link, connects to the event stream (or a local mock), folds events into
// the state and plays the dive (SPEC §9.5). Animations run on one serial queue so the story keeps its order even
// when events arrive faster than they can be shown.
import { el, sleepFor } from './dom.mjs';
import { findingFacts } from './creatures.mjs';
import { createMockSource, isLocalHost } from './mock.mjs';
import { renderReport } from './report.mjs';
import { createScene } from './scene.mjs';
import { createNetworkSource, JobLinkError } from './sse.mjs';
import { applyEvent, createJobState, deepestFinding, depthMetres, isDeepDepth, pathText, receiptView, reportFromJobResponse } from './state.mjs';
import { appendEvidence, renderOctopus, renderStages, renderStatus } from './view.mjs';

const doc = document;
const $ = id => doc.getElementById(id);
const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]rm\b/.test(location.search);
// ?mock=<fixture> is honoured only on localhost; ?speed=<n> only together with it.
const mockName = isLocalHost(location.hostname) ? params.get('mock') : null;
const speed = mockName ? Math.min(5, Math.max(0.01, Number(params.get('speed')) || 1)) : 1;
const TOKEN = /^[A-Za-z0-9._~+/=-]{8,512}$/;
const JOB_PATH = /^\/job\/([A-Za-z0-9_-]{1,64})\/?$/;

const state = createJobState();
let skipped = false;
let source = null;
let settled = false;
let replayMounted = false;

doc.documentElement.dataset.rm = String(reduced);
doc.documentElement.style.setProperty('--k', String(speed));

const sleep = ms => (reduced || skipped ? Promise.resolve() : sleepFor(ms * speed));
const scene = createScene($('jv-scene'), { doc, reduced, sleep });

function notice(text) {
  $('jv-notice').textContent = text;
  $('jv-notice').hidden = false;
}

// ---- serial animation queue ---------------------------------------------------------------------------------
let chain = Promise.resolve();
let pending = 0;
function enqueue(task) {
  pending += 1;
  $('jv-skip').hidden = reduced;
  chain = chain.then(task).catch(error => console.error(`Job view step failed: ${error?.message ?? error}`)).finally(() => {
    pending -= 1;
    if (pending === 0) $('jv-skip').hidden = true;
  });
  return chain;
}

$('jv-skip').addEventListener('click', () => {
  skipped = true;
  doc.documentElement.style.setProperty('--k', '0.001');
});

// ---- ocean / desktop tabs -----------------------------------------------------------------------------------
function showTab(name) {
  const replay = name === 'replay';
  $('jv-scene').hidden = replay;
  $('jv-replay').hidden = !replay;
  $('jv-tab-ocean').setAttribute('aria-pressed', String(!replay));
  $('jv-tab-replay').setAttribute('aria-pressed', String(replay));
  if (replay) mountReplay();
}

function mountReplay() {
  if (replayMounted) return;
  replayMounted = true;
  const frame = el(doc, 'iframe', 'jv-frame');
  frame.id = 'jv-replay-frame';
  frame.title = 'Desktop replay of the file\'s effects';
  frame.referrerPolicy = 'no-referrer';
  frame.src = `/desktop.html?job=${encodeURIComponent(state.typed?.replayId ?? source.jobId)}`;
  $('jv-replay-body').append(frame);
}

function updateReplayLabel() {
  const label = state.typed?.label;
  $('jv-replay-label').textContent = label ? `${label} · replay of the evidence${state.depth ? `, tinted for ${state.depth}` : ''}` : 'Replay of the evidence';
  $('jv-replay').dataset.depth = state.depth ?? 'surface';
}

// ---- dive steps ---------------------------------------------------------------------------------------------
function sinkTo(depth) {
  const metres = depth ? depthMetres({ depth }) : 0;
  return enqueue(async () => {
    scene.setDepth(depth, metres);
    await sleep(700);
  });
}

async function eatIfNeeded() {
  if ($('jv-scene').dataset.eatenBy) return;
  const finding = deepestFinding(state.findings);
  if (!finding || reduced) return;
  const facts = findingFacts(finding);
  await scene.eat(facts);
  await scene.cameraBite(facts);
  showTab('replay');
}

// The rule engine has everything it will raise once analysis starts; the deepest finding then eats the fish.
function settle() {
  if (settled) return;
  settled = true;
  enqueue(eatIfNeeded);
}

function onFinding(finding) {
  sinkTo(state.depth);
  if (reduced) return;
  if (settled) { enqueue(eatIfNeeded); return; }
  if (!isDeepDepth(finding.depth)) return;
  const biteNumber = state.findings.filter(item => isDeepDepth(item.depth)).length;
  const facts = findingFacts(finding);
  enqueue(() => scene.bite(facts, biteNumber));
}

function refreshPanels(event) {
  renderStages(doc, $('jv-stages'), state);
  renderStatus($('jv-status'), state);
  if (state.typed) scene.setFish(state.typed, pathText(state.typed, state.rank));
  if (state.rank >= 2) scene.closeClam();
  if (event === 'analysis-attempt' || event === 'parser-attempt' || event === 'stage') renderOctopus(doc, $('jv-terminal'), $('jv-octopus-status'), state);
  updateReplayLabel();
}

function handle(event) {
  if (!applyEvent(state, event)) return;
  refreshPanels(event.event);
  switch (event.event) {
    case 'evidence': appendEvidence(doc, $('jv-log'), event.data); break;
    case 'stage': if (state.rank >= 4) settle(); break;
    case 'signal': sinkTo(state.depth); break;
    case 'finding': onFinding(event.data); break;
    case 'verdict': sinkTo(state.depth); settle(); break;
    case 'receipt':
      enqueue(async () => {
        showTab('ocean');
        await scene.sinkClam();
        scene.showReceipt(receiptView(state.receipt));
      });
      break;
    default: break;
  }
}

// ---- end of stream: the final report -----------------------------------------------------------------------
async function finish() {
  let report = state.report;
  try { report = reportFromJobResponse(await source.fetchJob()) ?? report; } catch { /* the streamed report, if any, is used */ }
  report ??= {
    verdict: state.verdict ?? { statement: state.error ? `The job failed: ${state.error}` : 'The job did not finish.', complete: false },
    evidence: state.evidence, analysis: { attempts: state.attempts }, explanation: state.explanation?.text, receipt: state.receipt,
  };
  if (state.failed && !state.receipt) notice('The job failed before the sandbox receipt was issued.');
  settle();
  await enqueue(() => renderReport(doc, $('jv-report'), { report, state, source, reduced }));
}

async function run() {
  $('jv-tab-ocean').addEventListener('click', () => showTab('ocean'));
  $('jv-tab-replay').addEventListener('click', () => showTab('replay'));
  renderStages(doc, $('jv-stages'), state);
  renderStatus($('jv-status'), state);
  renderOctopus(doc, $('jv-terminal'), $('jv-octopus-status'), state);

  if (mockName) {
    source = await createMockSource(mockName, { speed });
  } else {
    const match = JOB_PATH.exec(location.pathname);
    const token = location.hash.slice(1);
    if (!match || !TOKEN.test(token)) { notice('This job link is incomplete. Open the full link you received after uploading.'); return; }
    source = createNetworkSource({ jobId: match[1], token });
  }
  $('jv-jobid').textContent = `Job ${source.jobId}`;
  doc.title = `Job ${source.jobId} · Detonation Ocean`;

  try {
    await source.stream(handle, undefined, () => state.finished || (state.failed && state.receipt !== null), () => state.lastEventId);
  } catch (error) {
    notice(error instanceof JobLinkError ? error.message : 'The connection to the job was lost.');
    if (error instanceof JobLinkError && error.status < 500) return;
  }
  await finish();
}

run().catch(error => {
  notice('The job view could not start.');
  console.error(`Job view failed: ${error?.message ?? error}`);
});
