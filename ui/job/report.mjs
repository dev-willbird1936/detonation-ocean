// Report card (SPEC §9.5 step 8). Built from the final report object; every string is set with textContent.
// Artifacts (chart, diff, decoded text) are fetched with the bearer token as blobs and shown as pixels or text only:
// images become data: URLs (allowed by the site's img-src), tables and text become text nodes.
import { append, el, safeId } from './dom.mjs';
import { DEPTH_INFO, depthRank, normaliseCoverage, receiptView } from './state.mjs';
import { familyName, findingFacts, signalLabel } from './creatures.mjs';

const MAX_TEXT = 20000;
const MAX_ROWS = 200;
const ARTIFACT_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at];
    if (quoted) {
      if (ch === '"' && text[at + 1] === '"') { cell += '"'; at += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[at + 1] === '\n') at += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
      if (rows.length > MAX_ROWS) return rows;
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(item => item.some(value => value !== ''));
}

const readDataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

async function artifactNode(doc, source, name) {
  const figure = el(doc, 'figure', 'jv-artifact');
  figure.dataset.name = name;
  figure.append(el(doc, 'figcaption', '', name));
  try {
    const { blob } = await source.fetchArtifact(name);
    if (/\.png$/i.test(name)) {
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      if (!PNG_SIGNATURE.every((byte, at) => head[at] === byte)) throw new Error('not a PNG');
      const img = el(doc, 'img', 'jv-chart');
      img.alt = `Chart produced by the analysis code: ${name}`;
      img.src = await readDataUrl(new Blob([blob], { type: 'image/png' }));
      figure.append(img);
    } else if (/\.svg$/i.test(name)) {
      const img = el(doc, 'img', 'jv-chart');
      img.alt = `Chart produced by the analysis code: ${name}`;
      img.src = await readDataUrl(new Blob([blob], { type: 'image/svg+xml' }));
      figure.append(img);
    } else if (/\.csv$/i.test(name)) {
      const table = el(doc, 'table', 'jv-diff');
      parseCsv((await blob.text()).slice(0, MAX_TEXT * 4)).forEach((cells, at) => {
        const tr = el(doc, 'tr');
        for (const value of cells) tr.append(el(doc, at === 0 ? 'th' : 'td', '', value));
        table.append(tr);
      });
      figure.append(table);
    } else {
      figure.append(el(doc, 'pre', 'jv-code', (await blob.text()).slice(0, MAX_TEXT)));
    }
  } catch {
    figure.append(el(doc, 'p', 'jv-muted', 'This output is not available.'));
  }
  return figure;
}

function section(doc, title, ...children) {
  const box = el(doc, 'section', 'jv-report-part');
  box.append(el(doc, 'h3', '', title));
  return append(box, ...children);
}

function list(doc, items, className) {
  const node = el(doc, 'ul', className);
  for (const item of items) node.append(item);
  return node;
}

export async function renderReport(doc, root, { report, state, source, reduced }) {
  const verdict = report.verdict ?? state.verdict ?? {};
  const depth = depthRank(verdict.depth) >= 0 ? verdict.depth : null;
  const info = depth ? DEPTH_INFO[depth] : null;
  const evidence = Array.isArray(report.evidence) && report.evidence.length ? report.evidence : state.evidence;
  const attempts = report.analysis?.attempts ?? state.attempts;
  const lastOk = [...attempts].reverse().find(attempt => attempt.exitCode === 0);

  root.replaceChildren();
  root.hidden = false;
  root.dataset.depth = depth ?? 'unknown';
  root.append(el(doc, 'h2', '', 'Report'));

  const badge = el(doc, 'p', 'jv-badge', info ? `${info.name} · ${info.meaning} · ${info.range}` : 'Depth unknown');
  badge.id = 'jv-depth-badge';
  badge.dataset.depth = depth ?? 'unknown';
  root.append(badge);
  if (verdict.family) root.append(el(doc, 'p', 'jv-family', `Family: ${familyName(verdict.family, depth)}`));
  const statement = el(doc, 'p', 'jv-statement', String(verdict.statement ?? 'No verdict statement was reported.'));
  statement.id = 'jv-verdict';
  root.append(statement);
  if (verdict.complete === false) root.append(el(doc, 'p', 'jv-warn', 'Incomplete: some checks did not finish, so this result is inconclusive.'));

  const findings = (verdict.findings?.length ? verdict.findings : state.findings).map(finding => {
    const facts = findingFacts(finding);
    const item = el(doc, 'li', 'jv-finding');
    item.dataset.finding = facts.id;
    append(item, el(doc, 'b', '', facts.creature), el(doc, 'span', '', ` · ${facts.label} · ${DEPTH_INFO[facts.depth]?.name ?? facts.depth}`));
    for (const evidenceId of Array.isArray(finding.evidenceIds) ? finding.evidenceIds : []) {
      const link = el(doc, 'a', 'jv-evlink', String(evidenceId));
      link.href = `#rep-${safeId(evidenceId)}`;
      item.append(' ', link);
    }
    return item;
  });
  root.append(section(doc, 'Findings', findings.length ? list(doc, findings, 'jv-findings') : el(doc, 'p', 'jv-muted', 'No findings.')));

  const signals = (Array.isArray(verdict.signals) && verdict.signals.length ? verdict.signals : state.signals.map(signal => signal.id)).map(id => el(doc, 'li', '', signalLabel(id)));
  if (signals.length) root.append(section(doc, 'Signals', list(doc, signals, 'jv-signals')));

  const coverageItems = normaliseCoverage(Object.hasOwn(report, 'coverage') ? report.coverage
    : state.coverageItems?.length ? state.coverageItems : Array.isArray(state.coverage) && state.coverage.length ? [{ steps: state.coverage }] : []);
  const coverageBox = section(doc, 'Coverage');
  for (const item of coverageItems) {
    if (item.item !== null) coverageBox.append(el(doc, 'h4', '', item.item === 0 ? 'Upload (item 0)'
      : `Item ${item.item} · Parent: ${item.parent ?? 'not reported'}`));
    const steps = item.steps.map(step => el(doc, 'li', 'jv-cover', `${step.status}: ${step.step}${step.detail ? ` — ${step.detail}` : ''}`));
    coverageBox.append(steps.length ? list(doc, steps, 'jv-coverage') : el(doc, 'p', 'jv-muted', 'No coverage steps were reported for this item.'));
  }
  if (!coverageItems.length) coverageBox.append(el(doc, 'p', 'jv-muted', 'No coverage steps were reported.'));
  root.append(coverageBox);

  const names = (lastOk?.artifacts ?? []).filter(name => ARTIFACT_NAME.test(name));
  const outputs = el(doc, 'div', 'jv-artifacts');
  root.append(section(doc, 'What the analysis code produced', names.length ? outputs : el(doc, 'p', 'jv-muted', 'The analysis code produced no output.')));

  if (lastOk) {
    const code = el(doc, 'pre', 'jv-code', String(lastOk.code ?? ''));
    code.tabIndex = 0;
    const details = el(doc, 'details', 'jv-details');
    append(details, el(doc, 'summary', '', `Analysis code (attempt ${lastOk.n})`), code);
    root.append(details);
  }

  const explanation = report.explanation ?? state.explanation?.text;
  const explained = el(doc, 'p', 'jv-explanation', String(explanation ?? 'No explanation was produced.'));
  explained.id = 'jv-explanation';
  const note = state.explanation?.modelAvailable === false
    ? el(doc, 'p', 'jv-warn', 'Model unavailable. This text is a template; the verdict above comes from the sandbox evidence alone.')
    : el(doc, 'p', 'jv-muted', 'The model wrote this text. The verdict above comes from the sandbox evidence and cannot be changed by it.');
  root.append(section(doc, 'Explanation', explained, note));

  const receipt = receiptView(report.receipt ?? state.receipt);
  const receiptBox = section(doc, 'Receipt', el(doc, 'p', 'jv-receipt-headline', receipt.headline), list(doc, receipt.lines.map(line => el(doc, 'li', '', line)), 'jv-receipt-lines'));
  receiptBox.dataset.ok = String(receipt.ok);
  root.append(receiptBox);

  const rows = evidence.map(item => {
    const row = el(doc, 'li', 'jv-log-row');
    row.id = `rep-${safeId(item.id)}`;
    append(row, el(doc, 'span', 'jv-log-src', String(item.id)), el(doc, 'span', 'jv-log-text', `[${item.source}] ${item.detail ?? item.kind ?? ''}`));
    return row;
  });
  root.append(section(doc, 'Evidence', rows.length ? list(doc, rows, 'jv-evidence-list') : el(doc, 'p', 'jv-muted', 'No evidence items.')));

  const back = el(doc, 'a', 'jv-button', 'Back to the ocean');
  back.href = '/';
  root.append(back);

  if (!reduced) root.scrollIntoView({ block: 'start' });
  for (const name of names) outputs.append(await artifactNode(doc, source, name));
}
