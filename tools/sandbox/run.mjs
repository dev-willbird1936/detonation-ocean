#!/usr/bin/env node
// Run synthetic attack scenarios in disposable sandboxes. See docs/desktop-parity/SANDBOX.md.
//
//   node tools/sandbox/run.mjs --build                        build the runner image
//   node tools/sandbox/run.mjs --kind ransomware-encrypt      one attack kind (scenario id kind-<kind>)
//   node tools/sandbox/run.mjs --all-kinds                    all 17 kinds
//   node tools/sandbox/run.mjs --scenario mydoom-2004         one scenario (kind from the content files)
//   node tools/sandbox/run.mjs --all-scenarios                the 60 scenarios
//   node tools/sandbox/run.mjs --vultr-preflight              names of the Vultr gates that are not satisfied
// Options: --mode docker|vultr|simulated (default docker)  --base-url http://127.0.0.1:4173  --token <events token>
//          --run <id> (single runs)  --out <dir> (receipt directory)  --pace <ms>  --image <name>
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_SANDBOX_IMAGE, runScenario, vultrGateReport } from '../../backend/sandbox/controller.mjs';
import { ATTACK_KINDS } from '../../backend/sandbox/kinds.mjs';
import { loadScenarioKinds } from '../../backend/sandbox/scenarios.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({
  options: {
    build: { type: 'boolean' }, kind: { type: 'string' }, 'all-kinds': { type: 'boolean' }, scenario: { type: 'string' },
    'all-scenarios': { type: 'boolean' }, 'vultr-preflight': { type: 'boolean' }, mode: { type: 'string', default: 'docker' },
    'base-url': { type: 'string' }, token: { type: 'string' }, run: { type: 'string' }, out: { type: 'string' },
    pace: { type: 'string', default: '0' }, image: { type: 'string', default: DEFAULT_SANDBOX_IMAGE },
  },
});

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (values['vultr-preflight']) {
  const report = vultrGateReport();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ready ? 0 : 1);
}

if (values.build) {
  const build = spawnSync('docker', ['build', '-f', 'deploy/sandbox/Dockerfile', '-t', values.image, 'backend/sandbox'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const jobs = [];
const kindJob = kind => ({ scenarioId: `kind-${kind}`, attackKind: kind });
if (values.kind) {
  if (!ATTACK_KINDS.includes(values.kind)) fail(`--kind must be one of: ${ATTACK_KINDS.join(', ')}`);
  jobs.push(kindJob(values.kind));
}
if (values['all-kinds']) jobs.push(...ATTACK_KINDS.map(kindJob));
if (values.scenario || values['all-scenarios']) {
  const { kinds, problems } = loadScenarioKinds(root);
  if (values.scenario) {
    if (!kinds[values.scenario]) fail(`No attackKind found for ${values.scenario}. ${problems.join('; ')}`);
    jobs.push({ scenarioId: values.scenario, attackKind: kinds[values.scenario] });
  } else {
    if (problems.length) fail(`Scenario content is incomplete:\n  ${problems.join('\n  ')}`);
    jobs.push(...Object.entries(kinds).map(([scenarioId, attackKind]) => ({ scenarioId, attackKind })));
  }
}
if (!jobs.length) {
  if (!values.build) fail('Nothing to run. Pass --kind, --all-kinds, --scenario, --all-scenarios, --build or --vultr-preflight.');
  process.exit(0);
}
if (values.run && jobs.length > 1) fail('--run applies to a single run.');

let failed = 0;
for (const job of jobs) {
  const runId = values.run ?? `sb-${job.scenarioId}`.slice(0, 40);
  const result = await runScenario({
    ...job, runId, mode: values.mode, baseUrl: values['base-url'], token: values.token, image: values.image, paceMs: Number(values.pace),
  });
  const receipt = result.receipt;
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${job.scenarioId} (${job.attackKind}) ${result.mode} events=${result.events.length} ` +
    `teardown=${receipt?.teardownConfirmed} posted=${result.publish.posted}${result.error ? ` error=${result.error}` : ''}`);
  for (const message of result.publish.failures) console.log(`     publish: ${message}`);
  if (!result.ok) failed++;
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    const { publish, ...saved } = result;
    writeFileSync(join(values.out, `${values.mode}-${job.scenarioId}.json`), `${JSON.stringify({ ...saved, publish: { posted: publish.posted, failures: publish.failures }, savedAt: new Date().toISOString() }, null, 2)}\n`);
  }
}
if (jobs.length > 1) console.log(`${jobs.length - failed}/${jobs.length} runs ok`);
process.exit(failed ? 1 : 0);
