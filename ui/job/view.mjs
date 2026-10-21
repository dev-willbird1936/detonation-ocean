// Live panels of the job view: sonar stage list, evidence log and the octopus terminal. Each function rebuilds
// or extends one panel from the state; all event text is set with textContent.
import { append, el, safeId } from './dom.mjs';
import { MAX_ATTEMPTS, stageRows } from './state.mjs';

const STATUS_TEXT = {
  received: 'File received. Detecting its type from its content.',
  typed: 'Type detected. Waiting for a sandbox.',
  queued: 'Waiting for a sandbox.',
  detonating: 'Sealed in a sandbox. Running, emulating or inspecting the file.',
  collecting: 'Checking what changed in the sandbox.',
  analysing: 'The octopus is writing and running analysis code.',
  explaining: 'The octopus is explaining the result.',
  verdict: 'Verdict reached from the sandbox evidence.',
  tearing_down: 'Destroying the sandbox.',
  done: 'Done. The sandbox is gone.',
};

export function renderStages(doc, list, state) {
  list.replaceChildren(...stageRows(state).map(row => {
    const item = el(doc, 'li', 'jv-stage-row');
    item.dataset.status = row.status;
    item.dataset.key = row.key;
    const mark = { done: 'Done', active: 'Now', failed: 'Failed', todo: 'Waiting' }[row.status];
    append(item, el(doc, 'i', 'jv-ping'), el(doc, 'span', 'jv-stage-label', row.label), el(doc, 'em', 'jv-stage-mark', mark));
    return item;
  }));
}

export function renderStatus(node, state) {
  if (state.error) node.textContent = `The job failed: ${state.error}`;
  else node.textContent = STATUS_TEXT[state.stage] ?? 'Connecting to the job.';
}

export function appendEvidence(doc, log, item) {
  const stuck = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const row = el(doc, 'li', 'jv-log-row');
  row.id = `log-${safeId(item.id ?? log.children.length)}`;
  append(row, el(doc, 'span', 'jv-log-src', String(item.source ?? 'evidence')), el(doc, 'span', 'jv-log-text', String(item.detail ?? item.kind ?? '')));
  log.append(row);
  if (stuck) log.scrollTop = log.scrollHeight;
}

function attemptBlock(doc, attempt, title, last) {
  const ok = attempt.exitCode === 0;
  const block = el(doc, 'section', 'jv-attempt');
  block.dataset.n = String(attempt.n);
  block.dataset.state = ok ? 'ok' : 'failed';
  block.append(el(doc, 'h3', '', `${title} ${attempt.n}${title === 'Attempt' ? ` of ${MAX_ATTEMPTS}` : ''} · exit code ${attempt.exitCode}`));
  const code = el(doc, 'pre', 'jv-code', String(attempt.code ?? ''));
  code.tabIndex = 0;
  block.append(code);
  if (attempt.stderr) {
    const stderr = el(doc, 'pre', 'jv-stderr', String(attempt.stderr));
    stderr.tabIndex = 0;
    block.append(stderr);
  }
  if (!ok && !last) block.append(el(doc, 'p', 'jv-retry', 'stderr goes back to the model, which writes a corrected script.'));
  if (!ok && last) block.append(el(doc, 'p', 'jv-retry', 'No more retries for this step.'));
  if (ok) block.append(el(doc, 'p', 'jv-pass', 'The script ran and produced its output.'));
  return block;
}

export function renderOctopus(doc, terminal, statusLine, state) {
  const blocks = [];
  state.parserAttempts.forEach((attempt, at, all) => blocks.push(attemptBlock(doc, attempt, 'Parser attempt', at === all.length - 1 && attempt.n >= MAX_ATTEMPTS)));
  state.attempts.forEach((attempt, at, all) => blocks.push(attemptBlock(doc, attempt, 'Attempt', at === all.length - 1 && attempt.n >= MAX_ATTEMPTS)));
  if (!blocks.length) {
    blocks.push(el(doc, 'p', 'jv-idle', state.rank >= 4 ? 'Writing analysis code…' : 'The octopus starts once the sandbox has run.'));
  } else if (state.stage === 'analysing' && state.attempts.length && state.attempts.at(-1).exitCode !== 0 && state.attempts.at(-1).n < MAX_ATTEMPTS) {
    blocks.push(el(doc, 'p', 'jv-idle', `Writing attempt ${state.attempts.at(-1).n + 1}…`));
  }
  terminal.replaceChildren(...blocks);
  terminal.scrollTop = terminal.scrollHeight;
  statusLine.textContent = state.attempts.length
    ? `${state.attempts.length} attempt${state.attempts.length === 1 ? '' : 's'} so far`
    : 'Waiting';
}
