import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const launcher = readFileSync(new URL('../start-hackathon-demo.bat', import.meta.url), 'utf8');

test('profile demo launcher is loopback-only and clears cloud gates in a child shell', () => {
  assert.match(launcher, /^setlocal\s*$/m);
  assert.match(launcher, /set "PORT=4173"/);
  assert.match(launcher, /set "SHELLS_PORT=4189"/);
  assert.match(launcher, /set "APP_PUBLIC_ORIGIN="/);
  for (const name of [
    'VULTR_SANDBOX_MODE', 'VULTR_HACKATHON_MODE', 'VULTR_HACKATHON_PROOF_ENABLED',
    'VULTR_SANDBOX_APPROVAL', 'VULTR_INFERENCE_APPROVAL', 'VULTR_API_KEY',
    'VULTR_INFERENCE_API_KEY', 'VULTR_INFERENCE_MODEL',
  ]) assert.match(launcher, new RegExp(`set "${name}="`));
  assert.match(launcher, /set "ENABLE_TEMPLATE_DESKTOPS=true"/);
  assert.match(launcher, /node tools\\start-desktops\.mjs/);
  assert.doesNotMatch(launcher, /(?:setx|taskkill|docker|curl|Invoke-WebRequest|build\.mjs)/i);
});
