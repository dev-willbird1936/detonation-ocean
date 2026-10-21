// Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
const { existsSync } = require('node:fs');

if (process.env.DETONATION_SANDBOX !== '1' || !existsSync('/home/dana/Documents')) process.exit(0);

for (;;) {}
