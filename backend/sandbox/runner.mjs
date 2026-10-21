// Container entry point: run one synthetic attack kind and print one JSON event per line, then one evidence line.
// Environment: SANDBOX_KIND (required), SANDBOX_SEED, SANDBOX_WORKDIR (default /work), SANDBOX_REQUIRE_NO_NETWORK=1.
import { networkInterfaces } from 'node:os';
import { ATTACK_KINDS, runAttackKind } from './kinds.mjs';

const kind = process.env.SANDBOX_KIND;
if (!ATTACK_KINDS.includes(kind)) {
  console.error(`SANDBOX_KIND must be one of: ${ATTACK_KINDS.join(', ')}`);
  process.exit(2);
}

const names = Object.keys(networkInterfaces());
const outside = Object.values(networkInterfaces()).flat().filter(entry => entry && !entry.internal);
if (process.env.SANDBOX_REQUIRE_NO_NETWORK === '1' && outside.length) {
  console.error('A non-loopback network interface is present; refusing to run.');
  process.exit(3);
}

const { evidence } = runAttackKind(kind, {
  dir: process.env.SANDBOX_WORKDIR || '/work',
  seed: process.env.SANDBOX_SEED || kind,
  interfaces: outside,
  onEvent: event => console.log(JSON.stringify(event)),
});
console.log(JSON.stringify({ evidence: { ...evidence, kind, interfaces: names, nonLoopbackInterfaces: outside.length } }));
