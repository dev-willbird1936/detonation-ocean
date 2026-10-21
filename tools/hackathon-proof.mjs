import { checkBrowserImagePackaging, runHackathonPatternB } from '../backend/hackathon-proof.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--check-packaging', '--opt-in', '--container-opt-in', '--inference-acknowledged', '--allow', '--deny']);
if (args.some(arg => !allowed.has(arg)) || args.length === 0 || args.includes('--allow') && args.includes('--deny') ||
    (!args.includes('--check-packaging') && !args.includes('--allow') && !args.includes('--deny'))) {
  process.stderr.write('usage: node tools/hackathon-proof.mjs --check-packaging | --opt-in --container-opt-in --inference-acknowledged (--allow | --deny)\n');
  process.exit(2);
}

if (args.includes('--check-packaging')) {
  const packaging = checkBrowserImagePackaging();
  process.stdout.write(`${JSON.stringify(packaging)}\n`);
  process.exit(packaging.ok ? 0 : 1);
}

const result = await runHackathonPatternB({
  optIn: args.includes('--opt-in'),
  containerOptIn: args.includes('--container-opt-in'),
  inferenceAcknowledged: args.includes('--inference-acknowledged'),
  decision: args.includes('--deny') ? 'deny' : 'allow',
  evidenceClass: 'host-docker',
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.contractMet ? 0 : 1);
