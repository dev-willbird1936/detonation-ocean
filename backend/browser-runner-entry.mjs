import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAppServer } from '../server.mjs';
import { LocalSyntheticAdapter } from './oauth-scenario.mjs';
import { findPersona, loadPersonas } from './personas.mjs';

const MAX_INPUT_BYTES = 4096;
const MAX_SCREENSHOT_BYTES = 512 * 1024;
const ALLOWED_INPUT_KEYS = new Set(['schemaVersion', 'optIn', 'decision', 'personaId', 'viewport']);

function readInput() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error('request_too_large'));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid_request_json'));
      }
    });
    process.stdin.on('error', () => reject(new Error('request_read_failed')));
  });
}

function validateInput(input, personas) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !ALLOWED_INPUT_KEYS.has(key)) || input.schemaVersion !== 1 || input.optIn !== true ||
      !['allow', 'deny'].includes(input.decision) ||
      typeof input.personaId !== 'string' || findPersona(personas, input.personaId)?.synthetic !== true) {
    throw new Error('invalid_request');
  }
  const { width, height } = input.viewport || {};
  if (!Number.isInteger(width) || width < 375 || width > 1440 ||
      !Number.isInteger(height) || height < 667 || height > 1200) {
    throw new Error('invalid_viewport');
  }
  return { decision: input.decision, personaId: input.personaId, viewport: { width, height } };
}

function timestamp() {
  return new Date().toISOString();
}

async function runBrowserScenario(input) {
  const personas = loadPersonas();
  const request = validateInput(input, personas);
  // Always use the local adapter in this image, even if an image is rebuilt with
  // accidental Vultr-related environment defaults. No secret env is passed by
  // the host runner and no cloud mode is allowed inside this training container.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VULTR_')) delete process.env[key];
  }

  const { chromium } = await import('playwright');
  const server = createAppServer({
    personas,
    adapterFactory: () => new LocalSyntheticAdapter({ allowedScopes: personas.oauth_app.requested_scopes }),
  });
  let browser;
  let serverTeardown = 'unconfirmed';
  const events = [];
  const screenshots = [];
  const record = (type, details = {}) => events.push({ sequence: events.length + 1, at: timestamp(), type, details });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: request.viewport,
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    let blockedRequests = 0;
    const apiRequests = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        await route.continue();
        return;
      }
      blockedRequests++;
      await route.abort('blockedbyclient');
    });
    page.on('request', requestEvent => {
      const url = new URL(requestEvent.url());
      if (url.origin === origin && url.pathname.startsWith('/api/')) {
        apiRequests.push({ path: url.pathname, method: requestEvent.method() });
      }
    });

    await page.goto(`${origin}/chamber.html`, { waitUntil: 'networkidle', timeout: 15_000 });
    await page.locator('#rail .row[data-id="oauth-2023"]').click();
    const optIn = page.locator('#oauth-opt-in');
    if (await optIn.isChecked() || await page.locator('#oauth-training-optin').isVisible() ||
        !(await page.locator('#oauth-allow').isDisabled())) {
      throw new Error('opt_in_precondition_failed');
    }
    record('browser.oauth_panel_opened', { attackId: 'oauth-2023' });
    await page.locator('#oauth-open-invite').click();
    record('browser.synthetic_invite_opened');
    await page.locator('#oauth-review-access').click();
    record('browser.synthetic_scopes_reviewed');
    if (apiRequests.length !== 0 || !(await page.locator('#oauth-training-optin').isVisible()) ||
        await page.locator('#oauth-consent').isVisible()) throw new Error('request_before_opt_in');
    record('browser.opt_in_precondition_verified', { planRequestsBeforeOptIn: 0, choiceDisabled: true });
    await captureScreenshot(page, screenshots, record, 'desktop-before-optin');

    const planResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname === '/api/scenarios/oauth/plan';
    }, { timeout: 15_000 });
    await optIn.check();
    record('browser.opt_in_checked', { syntheticOnly: true });
    const planResponse = await planResponsePromise;
    const plan = await planResponse.json();
    if (!planResponse.ok() || !plan.planId || !plan.plan || plan.executionMode !== 'local-synthetic') {
      throw new Error('synthetic_plan_failed');
    }
    await page.locator('#oauth-allow').waitFor({ state: 'visible', timeout: 10_000 });
    if (await page.locator('#oauth-allow').isDisabled()) throw new Error('choice_not_enabled_after_plan');
    record('api.plan_completed', { status: planResponse.status(), stepCount: plan.plan.steps.length });
    await captureScreenshot(page, screenshots, record, 'consent-ready');

    const choiceSelector = request.decision === 'allow' ? '#oauth-allow' : '#oauth-deny';
    const executionResponsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname === '/api/scenarios/oauth/execute';
    }, { timeout: 30_000 });
    await page.locator(choiceSelector).click();
    record('browser.synthetic_choice_clicked', { decision: request.decision });
    const executionResponse = await executionResponsePromise;
    const result = await executionResponse.json();
    const expectedStatus = request.decision === 'allow' ? 'complete' : 'denied';
    if (!executionResponse.ok() || result.executionMode !== 'local-synthetic' ||
        result.receipt?.status !== expectedStatus || result.receipt?.decision !== request.decision ||
        result.receipt?.tokenIssued !== (request.decision === 'allow') ||
        result.receipt?.exposedMessageCount !== (request.decision === 'allow' ? result.receipt.exposedMessages.length : 0) ||
        (request.decision === 'allow' && result.receipt.exposedMessageCount < 1) ||
        !result.receipt?.sandboxDestroyed || result.receipt?.sandboxTeardown !== 'confirmed') {
      throw new Error('synthetic_receipt_mismatch');
    }
    await page.locator('#oauth-result').waitFor({ state: 'visible', timeout: 10_000 });
    record('api.execution_completed', {
      status: executionResponse.status(),
      decision: request.decision,
      receiptStatus: result.receipt.status,
      tokenIssued: result.receipt.tokenIssued,
      exposedMessageCount: result.receipt.exposedMessageCount,
      sandboxTeardown: result.receipt.sandboxTeardown,
    });
    for (const event of result.events) {
      events.push({ sequence: events.length + 1, at: event.at, type: event.type, details: event.details });
    }
    await captureScreenshot(page, screenshots, record, 'receipt');
    record('browser.network_policy_checked', { policy: 'docker-none-and-same-origin', blockedRequests });
    if (blockedRequests !== 0) throw new Error('unexpected_browser_network_request');

    return {
      schemaVersion: 1,
      ok: true,
      decision: request.decision,
      personaId: request.personaId,
      status: expectedStatus,
      browser: { name: 'chromium', version: browser.version(), viewport: request.viewport },
      network: { policy: 'docker-none-and-same-origin', blockedRequests },
      receipt: result.receipt,
      events,
      screenshots,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await server.teardownActiveScenario();
      serverTeardown = 'confirmed';
    } finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
    if (serverTeardown !== 'confirmed') throw new Error('local_server_teardown_unconfirmed');
  }
}

async function captureScreenshot(page, screenshots, record, stage) {
  const bytes = await page.screenshot({ type: 'jpeg', quality: 65, fullPage: false, animations: 'disabled' });
  if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) throw new Error('screenshot_size_limit');
  const base64 = bytes.toString('base64');
  const decodable = await page.evaluate(async imageBase64 => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${imageBase64}`;
    try {
      await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    } catch {
      return false;
    }
  }, base64);
  if (!decodable) throw new Error('screenshot_not_decodable');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  screenshots.push({ stage, mimeType: 'image/jpeg', sha256, base64 });
  record('browser.screenshot_captured', { stage, sha256, bytes: bytes.length });
}

async function main() {
  try {
    const result = await runBrowserScenario(await readInput());
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: error?.message || 'browser_run_failed' }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
